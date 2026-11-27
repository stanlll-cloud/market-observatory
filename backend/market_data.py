"""
market_data.py — 异步拉取真实市场K线数据
支持 crypto (Binance)、us (Yahoo Finance)、cn (Yahoo Finance .SS/.SZ)
带 30 秒内存 TTL 缓存，httpx.AsyncClient timeout=10s
"""

import asyncio
import datetime
import os
import socket
import sys
import time
import urllib.parse
from typing import List, Dict, Optional, Any
from zoneinfo import ZoneInfo

import httpx

ET_TZ = ZoneInfo("America/New_York")


_http_client: Optional[httpx.AsyncClient] = None


def _detect_live_proxy() -> Optional[str]:
    """Detect an active local HTTP proxy (Clash/V2RayN/Windows IE) without hanging on dead ports."""
    candidates: List[str] = []
    for key in ("OBS_PROXY", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        val = (os.environ.get(key) or "").strip()
        if val:
            candidates.append(val)

    if sys.platform == "win32":
        try:
            import winreg  # type: ignore

            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            ) as key:
                enabled, _ = winreg.QueryValueEx(key, "ProxyEnable")
                server, _ = winreg.QueryValueEx(key, "ProxyServer")
                if int(enabled) == 1 and isinstance(server, str) and server.strip():
                    srv = server.strip()
                    if "=" in srv:
                        for part in srv.split(";"):
                            if part.lower().startswith(("http=", "https=")):
                                host_port = part.split("=", 1)[1].strip()
                                if host_port:
                                    candidates.append(f"http://{host_port}")
                    elif "://" not in srv:
                        candidates.append(f"http://{srv}")
                    else:
                        candidates.append(srv)
        except Exception:
            pass

    candidates.extend([
        "http://127.0.0.1:7890",
        "http://127.0.0.1:7897",
        "http://127.0.0.1:10809",
        "http://127.0.0.1:1087",
        "http://127.0.0.1:10808",
    ])

    seen = set()
    for url in candidates:
        u = url.strip()
        if not u or u in seen:
            continue
        seen.add(u)
        if not (u.startswith("http://") or u.startswith("https://")):
            continue
        parsed = urllib.parse.urlparse(u)
        host = parsed.hostname
        port = parsed.port
        if not host or not port:
            continue
        try:
            with socket.create_connection((host, port), timeout=0.08):
                return u
        except OSError:
            continue
    return None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        live_proxy = _detect_live_proxy()
        client_kwargs: Dict[str, Any] = {
            "trust_env": False,
            "timeout": httpx.Timeout(8.0, connect=4.0),
            "limits": httpx.Limits(
                max_keepalive_connections=30,
                max_connections=80,
                keepalive_expiry=20.0,
            ),
        }
        if live_proxy:
            client_kwargs["proxy"] = live_proxy
        _http_client = httpx.AsyncClient(**client_kwargs)
    return _http_client


# ──────────────────────────────────────────────
# 分级内存 TTL 缓存（含 Stale 兜底）
# ──────────────────────────────────────────────

INTERVAL_TTL_MAP = {
    "1m": 4,
    "5m": 6,
    "15m": 10,
    "30m": 12,
    "1h": 15,
    "4h": 25,
    "1d": 25,
    "1w": 45,
}


class MarketDataCache:
    def __init__(self, ttl: int = 20):
        self._store: Dict[str, tuple] = {}
        self.ttl = ttl

    def get(self, key: str, ttl_override: Optional[int] = None) -> Optional[Any]:
        if key in self._store:
            data, ts = self._store[key]
            max_age = self.ttl if ttl_override is None else ttl_override
            if time.time() - ts < max_age:
                return data
        return None

    def get_stale(self, key: str) -> Optional[Any]:
        if key in self._store:
            return self._store[key][0]
        return None

    def set(self, key: str, data: Any) -> None:
        self._store[key] = (data, time.time())


cache = MarketDataCache(ttl=20)


def prime_daily_cache(market: str, symbol: str, klines: List[Dict]) -> None:
    """由后台雷达扫描预热日线缓存，供看盘台与大势锁 0ms 共享。"""
    if not klines:
        return
    if market in ("us", "commodity"):
        cache.set(f"yh:{symbol}:1d", klines)
    elif market == "crypto":
        cache.set(f"bk:{symbol}:1d", klines)


# ──────────────────────────────────────────────
# Binance K线 & 24hr Ticker (粘性最优节点)
# ──────────────────────────────────────────────

BINANCE_KLINES_URLS = [
    "https://api.binance.com/api/v3/klines",
    "https://data-api.binance.vision/api/v3/klines",
    "https://api1.binance.com/api/v3/klines",
    "https://api2.binance.com/api/v3/klines",
]

BINANCE_TICKER_URLS = [
    "https://api.binance.com/api/v3/ticker/24hr",
    "https://data-api.binance.vision/api/v3/ticker/24hr",
    "https://api1.binance.com/api/v3/ticker/24hr",
    "https://api2.binance.com/api/v3/ticker/24hr",
]

_best_binance_idx = 0


def _binance_url_order() -> List[int]:
    n = len(BINANCE_KLINES_URLS)
    return [(_best_binance_idx + offset) % n for offset in range(n)]


async def _http_get_json(url: str, params: Optional[Dict] = None,
                         headers: Optional[Dict] = None) -> Any:
    client = _get_client()
    resp = await client.get(url, params=params, headers=headers or {})
    resp.raise_for_status()
    return resp.json()


async def fetch_binance_klines(symbol: str, interval: str,
                               limit: int = 300,
                               force: bool = False) -> List[Dict]:
    global _best_binance_idx
    ckey = f"bk:{symbol}:{interval}"
    ttl = INTERVAL_TTL_MAP.get(interval, 15)
    if not force:
        hit = cache.get(ckey, ttl_override=ttl)
        if hit is not None:
            return hit[-limit:]

    fetch_lim = min(max(limit, 300), 800)
    params = {"symbol": symbol, "interval": interval, "limit": str(fetch_lim)}
    last_err: Optional[Exception] = None
    for idx in _binance_url_order():
        base = BINANCE_KLINES_URLS[idx]
        try:
            raw = await _http_get_json(base, params=params)
            klines = [
                {
                    "time": int(k[0] // 1000),
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                }
                for k in raw
            ]
            _best_binance_idx = idx
            cache.set(ckey, klines)
            return klines[-limit:]
        except Exception as exc:
            last_err = exc
            continue

    stale = cache.get_stale(ckey)
    if stale is not None:
        return stale[-limit:]
    raise RuntimeError(
        f"All Binance klines endpoints failed for {symbol}: {repr(last_err)}")


async def fetch_binance_24hr(symbol: str, force: bool = False) -> Dict:
    global _best_binance_idx
    ckey = f"bt:{symbol}"
    if not force:
        hit = cache.get(ckey, ttl_override=6)
        if hit is not None:
            return hit

    params = {"symbol": symbol}
    last_err: Optional[Exception] = None
    for idx in _binance_url_order():
        base = BINANCE_TICKER_URLS[idx]
        try:
            d = await _http_get_json(base, params=params)
            ticker = {
                "symbol": symbol,
                "price": float(d["lastPrice"]),
                "price_change": float(d["priceChange"]),
                "price_change_percent": float(d["priceChangePercent"]),
                "source": "binance",
            }
            _best_binance_idx = idx
            cache.set(ckey, ticker)
            return ticker
        except Exception as exc:
            last_err = exc
            continue

    stale = cache.get_stale(ckey)
    if stale is not None:
        return stale
    raise RuntimeError(
        f"All Binance ticker endpoints failed for {symbol}: {repr(last_err)}")


# ──────────────────────────────────────────────
# Yahoo Finance K线 (共享缓存 + 4h真实聚合)
# ──────────────────────────────────────────────

YAHOO_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

YAHOO_INTERVAL_MAP = {
    "1m": ("1m", "5d"),
    "5m": ("5m", "30d"),
    "15m": ("15m", "60d"),
    "30m": ("30m", "60d"),
    "1h": ("60m", "3mo"),
    "4h": ("60m", "3mo"),
    "1d": ("1d", "2y"),
    "1w": ("1wk", "3y"),
}


async def fetch_yahoo_realtime_quote(symbol: str, force: bool = False) -> Dict[str, Any]:
    """
    获取 Yahoo 真实盘前 / 盘中 / 盘后最新报价：
    Yahoo v8 meta.regularMarketPrice 在盘前盘后不会更新，必须读 includePrePost=true 的 1m 最新成交柱。
    """
    ckey = f"yrt:{symbol}"
    if not force:
        hit = cache.get(ckey, ttl_override=4)
        if hit is not None:
            return hit

    enc = urllib.parse.quote(symbol)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}"
    try:
        data = None
        for attempt in range(2):
            try:
                data = await _http_get_json(
                    url,
                    params={"interval": "1m", "range": "1d", "includePrePost": "true"},
                    headers={"User-Agent": YAHOO_UA},
                )
                break
            except Exception:
                if attempt == 1:
                    raise
                await asyncio.sleep(0.15)
        res = data["chart"]["result"][0]
        meta = res.get("meta", {})
        ts = res.get("timestamp") or []
        q = res.get("indicators", {}).get("quote", [{}])[0]
        opens = q.get("open") or []
        highs = q.get("high") or []
        lows = q.get("low") or []
        closes = q.get("close") or []
        vols = q.get("volume") or []

        valid_bars: List[Dict[str, float]] = []
        for i in range(len(ts)):
            c = closes[i] if i < len(closes) else None
            if c is None:
                continue
            o = opens[i] if i < len(opens) and opens[i] is not None else c
            h = highs[i] if i < len(highs) and highs[i] is not None else c
            l = lows[i] if i < len(lows) and lows[i] is not None else c
            v = vols[i] if i < len(vols) and vols[i] is not None else 0.0
            valid_bars.append({
                "time": int(ts[i]),
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": float(v),
            })

        reg_price = float(meta.get("regularMarketPrice") or 0.0)
        reg_time = int(meta.get("regularMarketTime") or 0)
        prev_meta_close = float(meta.get("chartPreviousClose") or meta.get("previousClose") or reg_price or 0.0)

        day_open = 0.0
        day_high = 0.0
        day_low = 0.0
        day_vol = 0.0
        today_et_date = ""
        today_0930_ts = 0
        latest_ts = reg_time
        live_price = reg_price
        session = "closed"
        session_zh = "收盘"
        session_en = "Closed"
        ref_close = prev_meta_close or reg_price

        if valid_bars:
            last_bar = valid_bars[-1]
            latest_ts = last_bar["time"]
            dt_latest = datetime.datetime.fromtimestamp(latest_ts, tz=ET_TZ)
            today_et_date = dt_latest.strftime("%Y-%m-%d")
            dt_open_et = datetime.datetime(dt_latest.year, dt_latest.month, dt_latest.day, 9, 30, tzinfo=ET_TZ)
            today_0930_ts = int(dt_open_et.timestamp())

            day_bars = [
                b for b in valid_bars
                if datetime.datetime.fromtimestamp(b["time"], tz=ET_TZ).strftime("%Y-%m-%d") == today_et_date
            ]
            if day_bars:
                day_open = day_bars[0]["open"]
                day_high = max(b["high"] for b in day_bars)
                day_low = min(b["low"] for b in day_bars)
                day_vol = sum(b["volume"] for b in day_bars)

            hm = dt_latest.hour * 60 + dt_latest.minute
            if latest_ts > reg_time + 30:
                live_price = last_bar["close"]
                if hm < 9 * 60 + 30:
                    session, session_zh, session_en = "pre", "盘前实时", "Pre-Market"
                    ref_close = reg_price if reg_price > 0 else prev_meta_close
                elif hm >= 16 * 60:
                    session, session_zh, session_en = "post", "盘后实时", "After-Hours"
                    ref_close = reg_price if reg_price > 0 else prev_meta_close
                else:
                    session, session_zh, session_en = "regular", "盘中实时", "Live"
                    ref_close = prev_meta_close if prev_meta_close > 0 else live_price
            else:
                # 盘中或休市回落到常规价格与最新1m柱较新者
                if reg_price > 0 and reg_time >= latest_ts:
                    live_price = reg_price
                else:
                    live_price = last_bar["close"]
                now_et = datetime.datetime.now(ET_TZ)
                now_hm = now_et.hour * 60 + now_et.minute
                if now_et.weekday() < 5 and (9 * 60 + 30) <= now_hm < 16 * 60:
                    session, session_zh, session_en = "regular", "盘中实时", "Live"
                else:
                    session, session_zh, session_en = "closed", "收盘价", "Closed"
                ref_close = prev_meta_close if prev_meta_close > 0 else live_price

        if ref_close <= 0:
            ref_close = live_price
        chg = live_price - ref_close
        chg_pct = (chg / ref_close * 100.0) if ref_close > 0 else 0.0

        out = {
            "symbol": symbol,
            "price": live_price,
            "price_change": round(chg, 4),
            "price_change_percent": round(chg_pct, 2),
            "ref_close": ref_close,
            "session": session,
            "session_zh": session_zh,
            "session_en": session_en,
            "day_open": day_open or live_price,
            "day_high": max(day_high, live_price) if day_high else live_price,
            "day_low": min(day_low, live_price) if day_low else live_price,
            "day_vol": day_vol,
            "today_et_date": today_et_date,
            "today_0930_ts": today_0930_ts,
            "latest_ts": latest_ts,
        }
        cache.set(ckey, out)
        return out
    except Exception:
        stale = cache.get_stale(ckey)
        if stale is not None:
            return stale
        return {}


async def fetch_yahoo_klines(symbol: str, interval: str = "1d",
                             limit: int = 300,
                             force: bool = False) -> List[Dict]:
    ckey = f"yh:{symbol}:{interval}"
    ttl = INTERVAL_TTL_MAP.get(interval, 15)
    if not force:
        hit = cache.get(ckey, ttl_override=ttl)
        if hit is not None:
            return hit[-limit:]

    yinterval, yrange = YAHOO_INTERVAL_MAP.get(interval, ("1d", "1y"))
    enc = urllib.parse.quote(symbol)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}"
    params: Dict[str, str] = {"interval": yinterval, "range": yrange}
    if interval in ("1m", "5m", "15m", "30m", "1h", "4h"):
        params["includePrePost"] = "true"

    try:
        data = await _http_get_json(url, params=params,
                                    headers={"User-Agent": YAHOO_UA})
        result = data["chart"]["result"][0]
        ts = result["timestamp"]
        q = result["indicators"]["quote"][0]

        klines = []
        for i in range(len(ts)):
            o = q["open"][i]
            h = q["high"][i]
            l = q["low"][i]
            c = q["close"][i]
            v = q["volume"][i]
            if o is None or h is None or l is None or c is None:
                continue
            klines.append({
                "time": int(ts[i]),
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": float(v) if v is not None else 0.0,
            })

        if interval == "4h" and klines:
            agg: List[Dict] = []
            cur_bucket = -1
            for bar in klines:
                b = (bar["time"] // 14400) * 14400
                if b != cur_bucket:
                    cur_bucket = b
                    agg.append({
                        "time": b,
                        "open": bar["open"],
                        "high": bar["high"],
                        "low": bar["low"],
                        "close": bar["close"],
                        "volume": bar["volume"],
                    })
                else:
                    cur = agg[-1]
                    cur["high"] = max(cur["high"], bar["high"])
                    cur["low"] = min(cur["low"], bar["low"])
                    cur["close"] = bar["close"]
                    cur["volume"] += bar["volume"]
            klines = agg

        cache.set(ckey, klines)
        return klines[-limit:]
    except Exception as exc:
        stale = cache.get_stale(ckey)
        if stale is not None:
            return stale[-limit:]
        raise RuntimeError(f"Yahoo Finance failed for {symbol}: {repr(exc)}")


# ──────────────────────────────────────────────
# 统一入口
# ──────────────────────────────────────────────

async def fetch_market_data(
    market: str,
    symbol: str,
    interval: str = "1h",
    limit: int = 300,
    replay_index: int = -1,
    force: bool = False,
) -> Dict:
    """返回 {meta, candles, total_candles} 或 {error, ...}"""
    try:
        if market == "crypto":
            klines, ticker = await asyncio.gather(
                fetch_binance_klines(symbol, interval, limit, force=force),
                fetch_binance_24hr(symbol, force=force),
            )
            klines = list(klines)
            ticker["session"] = "crypto_24h"
            ticker["session_zh"] = "24H实时"
            ticker["session_en"] = "24H Live"
            if klines and ticker.get("price"):
                p = ticker["price"]
                last = klines[-1]
                klines[-1] = {
                    **last,
                    "close": p,
                    "high": max(last["high"], p),
                    "low": min(last["low"], p),
                }
        elif market in ("us", "commodity"):
            klines_raw, rt = await asyncio.gather(
                fetch_yahoo_klines(symbol, interval, limit, force=force),
                fetch_yahoo_realtime_quote(symbol, force=force),
            )
            klines = list(klines_raw)
            if klines and rt.get("price"):
                p = float(rt["price"])
                if interval == "1d" and rt.get("today_et_date") and rt.get("session") in ("pre", "regular", "post"):
                    last_dt = datetime.datetime.fromtimestamp(klines[-1]["time"], tz=ET_TZ).strftime("%Y-%m-%d")
                    if last_dt < rt["today_et_date"]:
                        klines.append({
                            "time": int(rt["today_0930_ts"] or rt["latest_ts"]),
                            "open": float(rt["day_open"] or p),
                            "high": max(float(rt["day_high"] or p), p),
                            "low": min(float(rt["day_low"] or p), p),
                            "close": p,
                            "volume": float(rt.get("day_vol") or 0.0),
                        })
                    else:
                        last = klines[-1]
                        klines[-1] = {
                            **last,
                            "close": p,
                            "high": max(last["high"], p),
                            "low": min(last["low"], p),
                        }
                elif rt.get("latest_ts", 0) >= klines[-1]["time"]:
                    last = klines[-1]
                    klines[-1] = {
                        **last,
                        "close": p,
                        "high": max(last["high"], p),
                        "low": min(last["low"], p),
                    }
                sess = rt["session"]
                sess_zh = rt["session_zh"]
                sess_en = rt["session_en"]
                if market == "commodity" and abs(time.time() - rt.get("latest_ts", 0)) < 1800:
                    sess = "futures_live"
                    sess_zh = "期货实时"
                    sess_en = "Futures Live"
                ticker = {
                    "symbol": symbol,
                    "price": p,
                    "price_change": rt["price_change"],
                    "price_change_percent": rt["price_change_percent"],
                    "session": sess,
                    "session_zh": sess_zh,
                    "session_en": sess_en,
                    "source": "yahoo_rt",
                }
            else:
                last_c = klines[-1]["close"] if klines else 0
                prev_c = klines[-2]["close"] if len(klines) >= 2 else last_c
                chg = last_c - prev_c
                chg_pct = (chg / prev_c * 100) if prev_c else 0
                ticker = {
                    "symbol": symbol,
                    "price": last_c,
                    "price_change": round(chg, 4),
                    "price_change_percent": round(chg_pct, 2),
                    "session": "closed",
                    "session_zh": "收盘价",
                    "session_en": "Closed",
                    "source": "yahoo",
                }
        else:
            raise ValueError(f"Unsupported market: {market}")

        total = len(klines)
        if replay_index >= 0 and replay_index < total:
            klines = klines[: replay_index + 1]

        return {"meta": dict(ticker), "candles": klines, "total_candles": total}

    except Exception as exc:
        return {
            "error": f"Failed to fetch data for {symbol} ({market}): {exc}",
            "meta": {
                "symbol": symbol,
                "price": 0,
                "price_change": 0,
                "price_change_percent": 0,
                "source": "error",
            },
            "candles": [],
            "total_candles": 0,
        }


async def fetch_live_tick(market: str, symbol: str, interval: str = "1h") -> Dict:
    """无缓存秒级最新价格与当前K线切片"""
    global _best_binance_idx
    try:
        if market == "crypto":
            raw_k = None
            raw_t = None
            last_exc: Optional[Exception] = None
            for idx in _binance_url_order():
                k_url = BINANCE_KLINES_URLS[idx]
                t_url = BINANCE_TICKER_URLS[idx]
                try:
                    raw_k, raw_t = await asyncio.gather(
                        _http_get_json(k_url, params={"symbol": symbol, "interval": interval, "limit": "2"}),
                        _http_get_json(t_url, params={"symbol": symbol}),
                    )
                    _best_binance_idx = idx
                    break
                except Exception as exc:
                    last_exc = exc
                    continue
            if raw_k is None or raw_t is None:
                raise RuntimeError(str(last_exc or "All Binance tick endpoints failed"))
            last_k = raw_k[-1]
            return {
                "price": float(raw_t["lastPrice"]),
                "price_change": float(raw_t["priceChange"]),
                "price_change_percent": float(raw_t["priceChangePercent"]),
                "candle": {
                    "time": int(last_k[0] // 1000),
                    "open": float(last_k[1]),
                    "high": float(last_k[2]),
                    "low": float(last_k[3]),
                    "close": float(last_k[4]),
                    "volume": float(last_k[5]),
                },
                "ts": int(time.time() * 1000),
            }
        elif market in ("us", "commodity"):
            rt = await fetch_yahoo_realtime_quote(symbol, force=True)
            if not rt.get("price"):
                return {"error": f"No live quote for {symbol}"}
            sess = rt["session"]
            sess_zh = rt["session_zh"]
            sess_en = rt["session_en"]
            if market == "commodity" and abs(time.time() - rt.get("latest_ts", 0)) < 1800:
                sess = "futures_live"
                sess_zh = "期货实时"
                sess_en = "Futures Live"
            return {
                "price": rt["price"],
                "price_change": rt["price_change"],
                "price_change_percent": rt["price_change_percent"],
                "session": sess,
                "session_zh": sess_zh,
                "session_en": sess_en,
                "candle": None,
                "ts": int(time.time() * 1000),
            }
        else:
            return {"error": f"Unsupported market: {market}"}
    except Exception as exc:
        return {"error": str(exc)}


# ──────────────────────────────────────────────
# 标的字典 & 中英文模糊搜索
# ──────────────────────────────────────────────

CRYPTO_CATALOG = [
    {"symbol": "BTCUSDT", "name": "比特币 Bitcoin", "exchange": "Binance", "sector": "主流核心", "sector_en": "Core", "alias": "大饼 btc bitcoin 比特币"},
    {"symbol": "ETHUSDT", "name": "以太坊 Ethereum", "exchange": "Binance", "sector": "主流核心", "sector_en": "Core", "alias": "二饼 eth ethereum 以太坊"},
    {"symbol": "SOLUSDT", "name": "索拉纳 Solana", "exchange": "Binance", "sector": "主流核心", "sector_en": "Core", "alias": "sol solana 索拉纳"},
    {"symbol": "BNBUSDT", "name": "币安币 BNB", "exchange": "Binance", "sector": "主流核心", "sector_en": "Core", "alias": "bnb binance 币安币"},
    {"symbol": "XRPUSDT", "name": "瑞波币 XRP", "exchange": "Binance", "sector": "主流核心", "sector_en": "Core", "alias": "xrp ripple 瑞波"},
    {"symbol": "SUIUSDT", "name": "Sui", "exchange": "Binance", "sector": "高弹公链", "sector_en": "Alt L1", "alias": "sui"},
    {"symbol": "AVAXUSDT", "name": "雪崩 Avalanche", "exchange": "Binance", "sector": "高弹公链", "sector_en": "Alt L1", "alias": "avax avalanche 雪崩"},
    {"symbol": "ADAUSDT", "name": "艾达币 Cardano", "exchange": "Binance", "sector": "高弹公链", "sector_en": "Alt L1", "alias": "ada cardano 艾达"},
    {"symbol": "TONUSDT", "name": "Toncoin", "exchange": "Binance", "sector": "高弹公链", "sector_en": "Alt L1", "alias": "ton telegram"},
    {"symbol": "APTUSDT", "name": "Aptos", "exchange": "Binance", "sector": "高弹公链", "sector_en": "Alt L1", "alias": "apt aptos"},
    {"symbol": "NEARUSDT", "name": "NEAR Protocol", "exchange": "Binance", "sector": "高弹公链", "sector_en": "Alt L1", "alias": "near ai 公链"},
    {"symbol": "TAOUSDT", "name": "Bittensor TAO", "exchange": "Binance", "sector": "AI与DeFi", "sector_en": "AI & DeFi", "alias": "tao bittensor ai 算力"},
    {"symbol": "FETUSDT", "name": "ASI Alliance FET", "exchange": "Binance", "sector": "AI与DeFi", "sector_en": "AI & DeFi", "alias": "fet fetch asi ai"},
    {"symbol": "RENDERUSDT", "name": "Render", "exchange": "Binance", "sector": "AI与DeFi", "sector_en": "AI & DeFi", "alias": "render rndr gpu ai"},
    {"symbol": "LINKUSDT", "name": "Chainlink", "exchange": "Binance", "sector": "AI与DeFi", "sector_en": "AI & DeFi", "alias": "link chainlink 预言机"},
    {"symbol": "UNIUSDT", "name": "Uniswap", "exchange": "Binance", "sector": "AI与DeFi", "sector_en": "AI & DeFi", "alias": "uni uniswap defi"},
    {"symbol": "AAVEUSDT", "name": "Aave", "exchange": "Binance", "sector": "AI与DeFi", "sector_en": "AI & DeFi", "alias": "aave defi 借贷"},
    {"symbol": "DOGEUSDT", "name": "狗狗币 Dogecoin", "exchange": "Binance", "sector": "情绪Meme", "sector_en": "Meme", "alias": "doge dogecoin 狗狗币 马斯克"},
    {"symbol": "PEPEUSDT", "name": "佩佩蛙 PEPE", "exchange": "Binance", "sector": "情绪Meme", "sector_en": "Meme", "alias": "pepe 佩佩 青蛙"},
    {"symbol": "WIFUSDT", "name": "dogwifhat WIF", "exchange": "Binance", "sector": "情绪Meme", "sector_en": "Meme", "alias": "wif 帽子狗 meme"},
]

US_CATALOG = [
    # 芯片半导体
    {"symbol": "NVDA", "name": "英伟达 NVIDIA", "exchange": "NASDAQ", "sector": "芯片半导体", "sector_en": "Semis", "alias": "nvda nvidia 英伟达 辉达 芯片"},
    {"symbol": "TSM", "name": "台积电 TSMC", "exchange": "NYSE", "sector": "芯片半导体", "sector_en": "Semis", "alias": "tsm tsmc 台积电 晶圆"},
    {"symbol": "AVGO", "name": "博通 Broadcom", "exchange": "NASDAQ", "sector": "芯片半导体", "sector_en": "Semis", "alias": "avgo broadcom 博通 asic"},
    {"symbol": "AMD", "name": "超微 AMD", "exchange": "NASDAQ", "sector": "芯片半导体", "sector_en": "Semis", "alias": "amd 超微 苏妈 芯片"},
    {"symbol": "ASML", "name": "阿斯麦 ASML", "exchange": "NASDAQ", "sector": "芯片半导体", "sector_en": "Semis", "alias": "asml 阿斯麦 光刻机"},
    {"symbol": "AMAT", "name": "应用材料 AMAT", "exchange": "NASDAQ", "sector": "芯片半导体", "sector_en": "Semis", "alias": "amat 应用材料 设备"},
    {"symbol": "MRVL", "name": "迈威尔 Marvell", "exchange": "NASDAQ", "sector": "芯片半导体", "sector_en": "Semis", "alias": "mrvl marvell 迈威尔 光通信"},
    {"symbol": "ARM", "name": "Arm Holdings", "exchange": "NASDAQ", "sector": "芯片半导体", "sector_en": "Semis", "alias": "arm 架构 芯片"},
    {"symbol": "SMH", "name": "半导体 ETF", "exchange": "NASDAQ", "sector": "芯片半导体", "sector_en": "Semis", "alias": "smh soxx 半导体 芯片 etf"},
    {"symbol": "SOXL", "name": "3倍做多半导体 ETF", "exchange": "NYSE", "sector": "芯片半导体", "sector_en": "Semis", "alias": "soxl 3倍 半导体 三倍做多 etf"},
    # 存储与硬件
    {"symbol": "MU", "name": "美光科技 Micron", "exchange": "NASDAQ", "sector": "存储与硬件", "sector_en": "Memory & HW", "alias": "mu micron 美光 存储 内存 hbm 海力士"},
    {"symbol": "WDC", "name": "西部数据 WDC", "exchange": "NASDAQ", "sector": "存储与硬件", "sector_en": "Memory & HW", "alias": "wdc 西部数据 存储 硬盘"},
    {"symbol": "STX", "name": "希捷科技 Seagate", "exchange": "NASDAQ", "sector": "存储与硬件", "sector_en": "Memory & HW", "alias": "stx seagate 希捷 存储 硬盘"},
    {"symbol": "DELL", "name": "戴尔科技 Dell", "exchange": "NYSE", "sector": "存储与硬件", "sector_en": "Memory & HW", "alias": "dell 戴尔 ai服务器"},
    {"symbol": "VRT", "name": "维谛技术 Vertiv", "exchange": "NYSE", "sector": "存储与硬件", "sector_en": "Memory & HW", "alias": "vrt vertiv 维谛 液冷 服务器"},
    {"symbol": "SMCI", "name": "超微电脑 SMCI", "exchange": "NASDAQ", "sector": "存储与硬件", "sector_en": "Memory & HW", "alias": "smci 超微电脑 服务器"},
    # AI云与软件
    {"symbol": "MSFT", "name": "微软 Microsoft", "exchange": "NASDAQ", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "msft microsoft 微软"},
    {"symbol": "META", "name": "Meta 脸书", "exchange": "NASDAQ", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "meta facebook 脸书"},
    {"symbol": "GOOGL", "name": "谷歌 Alphabet", "exchange": "NASDAQ", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "googl goog google alphabet 谷歌"},
    {"symbol": "AMZN", "name": "亚马逊 Amazon", "exchange": "NASDAQ", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "amzn amazon 亚马逊"},
    {"symbol": "AAPL", "name": "苹果 Apple", "exchange": "NASDAQ", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "aapl apple 苹果"},
    {"symbol": "PLTR", "name": "Palantir", "exchange": "NASDAQ", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "pltr palantir 大数据 ai软件"},
    {"symbol": "ORCL", "name": "甲骨文 Oracle", "exchange": "NYSE", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "orcl oracle 甲骨文 云"},
    {"symbol": "CRWD", "name": "CrowdStrike", "exchange": "NASDAQ", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "crwd crowdstrike 网安 网络安全"},
    {"symbol": "NFLX", "name": "奈飞 Netflix", "exchange": "NASDAQ", "sector": "AI云与软件", "sector_en": "Cloud & AI", "alias": "nflx netflix 奈飞 网飞"},
    # 特斯拉与核电太空
    {"symbol": "TSLA", "name": "特斯拉 Tesla", "exchange": "NASDAQ", "sector": "特斯拉与核电太空", "sector_en": "EV·Nuclear·Space", "alias": "tsla tesla 特斯拉"},
    {"symbol": "VST", "name": "Vistra 核电", "exchange": "NYSE", "sector": "特斯拉与核电太空", "sector_en": "EV·Nuclear·Space", "alias": "vst vistra 核电 电力 能源"},
    {"symbol": "CEG", "name": "星座能源 CEG", "exchange": "NASDAQ", "sector": "特斯拉与核电太空", "sector_en": "EV·Nuclear·Space", "alias": "ceg constellation 星座 核电 电力"},
    {"symbol": "RKLB", "name": "火箭实验室 RKLB", "exchange": "NASDAQ", "sector": "特斯拉与核电太空", "sector_en": "EV·Nuclear·Space", "alias": "rklb rocket lab 火箭 太空 商业航天"},
    {"symbol": "ASTS", "name": "AST SpaceMobile", "exchange": "NASDAQ", "sector": "特斯拉与核电太空", "sector_en": "EV·Nuclear·Space", "alias": "asts 卫星 太空 商业航天"},
    # 加密概念与中概
    {"symbol": "MSTR", "name": "微策略 Strategy", "exchange": "NASDAQ", "sector": "加密概念与中概", "sector_en": "Crypto & China", "alias": "mstr microstrategy 微策略 比特币"},
    {"symbol": "COIN", "name": "Coinbase", "exchange": "NASDAQ", "sector": "加密概念与中概", "sector_en": "Crypto & China", "alias": "coin coinbase 交易所 加密"},
    {"symbol": "IBIT", "name": "贝莱德比特币 ETF", "exchange": "NASDAQ", "sector": "加密概念与中概", "sector_en": "Crypto & China", "alias": "ibit bitcoin etf 比特币etf"},
    {"symbol": "BABA", "name": "阿里巴巴 Alibaba", "exchange": "NYSE", "sector": "加密概念与中概", "sector_en": "Crypto & China", "alias": "baba alibaba 阿里 阿里巴巴 中概"},
    {"symbol": "PDD", "name": "拼多多 PDD", "exchange": "NASDAQ", "sector": "加密概念与中概", "sector_en": "Crypto & China", "alias": "pdd pinduoduo 拼多多 中概"},
    {"symbol": "FUTU", "name": "富途控股 Futu", "exchange": "NASDAQ", "sector": "加密概念与中概", "sector_en": "Crypto & China", "alias": "futu 富途 牛牛 中概"},
    # 宽基与对冲ETF
    {"symbol": "QQQ", "name": "纳指100 ETF", "exchange": "NASDAQ", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "qqq nasdaq 纳指 纳斯达克 etf"},
    {"symbol": "SPY", "name": "标普500 ETF", "exchange": "NYSE", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "spy sp500 标普 标普500 etf 大盘"},
    {"symbol": "TQQQ", "name": "3倍做多纳指 ETF", "exchange": "NASDAQ", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "tqqq 3倍 纳指 三倍做多 etf"},
    {"symbol": "SQQQ", "name": "3倍做空纳指 ETF", "exchange": "NASDAQ", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "sqqq 3倍 做空 纳指 对冲"},
    {"symbol": "TLT", "name": "20年美债 ETF", "exchange": "NASDAQ", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "tlt 美债 债券 对冲 etf"},
    {"symbol": "GLD", "name": "黄金 ETF", "exchange": "NYSE", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "gld gold 黄金 etf"},
    {"symbol": "IWM", "name": "罗素2000 小盘ETF", "exchange": "NYSE", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "iwm russell 罗素 小盘 etf"},
    {"symbol": "VIXY", "name": "恐慌指数 VIXY ETF", "exchange": "NYSE", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "vixy vix 恐慌 波动率 对冲"},
    {"symbol": "QQQI", "name": "NEOS 纳指高息 QQQI", "exchange": "NASDAQ", "sector": "美股ETF配置", "sector_en": "US ETF Plan", "alias": "qqqi neos 纳指 月息 高息 备兑 etf"},
    {"symbol": "SPYI", "name": "NEOS 标普高息 SPYI", "exchange": "NYSE", "sector": "美股ETF配置", "sector_en": "US ETF Plan", "alias": "spyi neos 标普 月息 高息 备兑 etf"},
    {"symbol": "SGOV", "name": "0-3月短债避险 SGOV", "exchange": "NYSE", "sector": "美股ETF配置", "sector_en": "US ETF Plan", "alias": "sgov 国债 短债 美债 月息 避险 防爆 etf"},
    {"symbol": "SPMO", "name": "标普500动量 SPMO", "exchange": "NYSE", "sector": "美股ETF配置", "sector_en": "US ETF Plan", "alias": "spmo 标普 动量 进攻 etf"},
    {"symbol": "QQQM", "name": "纳指100低费版 QQQM", "exchange": "NASDAQ", "sector": "美股ETF配置", "sector_en": "US ETF Plan", "alias": "qqqm 纳指 长持 低费 etf"},
    {"symbol": "SCHD", "name": "高股息红利 SCHD", "exchange": "NYSE", "sector": "美股ETF配置", "sector_en": "US ETF Plan", "alias": "schd 高股息 红利 价值 压仓 etf"},
    {"symbol": "UPRO", "name": "3倍做多标普 UPRO", "exchange": "NYSE", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "upro 3倍 标普 三倍做多 杠杆 etf"},
    {"symbol": "RSP", "name": "标普等权重 RSP", "exchange": "NYSE", "sector": "宽基与对冲ETF", "sector_en": "Index & Hedge", "alias": "rsp 等权 标普 对比 etf"},
]

COMMODITY_CATALOG = [
    {"symbol": "GC=F", "name": "纽约黄金 COMEX Gold", "exchange": "COMEX", "sector": "贵金属", "sector_en": "Precious Metals", "alias": "gold xau xauusd 黄金 金价 现货黄金 comex"},
    {"symbol": "SI=F", "name": "纽约白银 COMEX Silver", "exchange": "COMEX", "sector": "贵金属", "sector_en": "Precious Metals", "alias": "silver xag xagusd 白银 银价"},
    {"symbol": "CL=F", "name": "WTI 美原油 Crude Oil", "exchange": "NYMEX", "sector": "能源原油", "sector_en": "Energy", "alias": "oil wti crude usoil 原油 美油 油价"},
    {"symbol": "BZ=F", "name": "布伦特原油 Brent Oil", "exchange": "ICE", "sector": "能源原油", "sector_en": "Energy", "alias": "brent ukoil 布油 布伦特 原油"},
    {"symbol": "HG=F", "name": "纽约精铜 COMEX Copper", "exchange": "COMEX", "sector": "工业金属", "sector_en": "Industrial Metals", "alias": "copper 铜 博士铜"},
    {"symbol": "NG=F", "name": "美国天然气 NatGas", "exchange": "NYMEX", "sector": "能源原油", "sector_en": "Energy", "alias": "natgas gas 天然气"},
    {"symbol": "PL=F", "name": "纽约铂金 Platinum", "exchange": "NYMEX", "sector": "贵金属", "sector_en": "Precious Metals", "alias": "platinum 铂金"},
    {"symbol": "DX-Y.NYB", "name": "美元指数 DXY", "exchange": "ICE", "sector": "宏观外汇", "sector_en": "Macro FX", "alias": "dxy usd dollar 美元指数 美元"},
]


async def search_symbols(market: str, query: str = "") -> List[Dict]:
    if market == "crypto":
        pool = CRYPTO_CATALOG
    elif market == "commodity":
        pool = COMMODITY_CATALOG
    else:
        pool = US_CATALOG
    q = query.strip().lower()
    if not q:
        return [
            {
                "symbol": x["symbol"],
                "market": market,
                "name": x["name"],
                "exchange": x["exchange"],
                "sector": x["sector"],
                "sector_en": x["sector_en"],
            }
            for x in pool
        ]

    # 本地字典中英文 + 别名模糊匹配
    matched = [
        {
            "symbol": x["symbol"],
            "market": market,
            "name": x["name"],
            "exchange": x["exchange"],
            "sector": x["sector"],
            "sector_en": x["sector_en"],
        }
        for x in pool
        if q in x["symbol"].lower() or q in x["name"].lower() or q in x["alias"].lower() or q in x["sector"].lower()
    ]

    # Crypto 兜底：用户输入了任意字母代码（如 WIF、TON）直接拼成 *USDT
    if market == "crypto" and q.isascii() and q.isalnum():
        cand = q.upper() if q.upper().endswith("USDT") else f"{q.upper()}USDT"
        if not any(m["symbol"] == cand for m in matched):
            matched.append({
                "symbol": cand,
                "market": "crypto",
                "name": f"{cand} (Binance)",
                "exchange": "Binance",
                "sector": "自定义币种",
                "sector_en": "Custom",
            })

    # 美股 / 商品兜底：如果本地字典结果少于 3 条，实时查 Yahoo Search API
    if market in ("us", "commodity") and len(matched) < 3:
        allowed_qtypes = (
            ("FUTURE", "INDEX", "CURRENCY", "ETF")
            if market == "commodity"
            else ("EQUITY", "ETF", "INDEX")
        )
        try:
            ydata = await _http_get_json(
                "https://query2.finance.yahoo.com/v1/finance/search",
                params={"q": query.strip(), "quotesCount": "6", "newsCount": "0"},
                headers={"User-Agent": YAHOO_UA},
            )
            for item in ydata.get("quotes", []):
                sym = item.get("symbol", "")
                qtype = item.get("quoteType", "")
                if not sym or qtype not in allowed_qtypes:
                    continue
                if any(m["symbol"] == sym for m in matched):
                    continue
                name = item.get("shortname") or item.get("longname") or sym
                exch = item.get("exchDisp") or item.get("exchange") or ("FUTURES" if market == "commodity" else "US")
                matched.append({
                    "symbol": sym,
                    "market": market,
                    "name": name,
                    "exchange": exch,
                    "sector": "商品检索" if market == "commodity" else "美股检索",
                    "sector_en": "Commodity Search" if market == "commodity" else "US Search",
                })
        except Exception:
            pass

    return matched


def get_symbol_info(symbol: str) -> Dict[str, str]:
    for x in CRYPTO_CATALOG + US_CATALOG + COMMODITY_CATALOG:
        if x["symbol"] == symbol:
            return {
                "name": x["name"],
                "exchange": x["exchange"],
                "sector": x["sector"],
                "sector_en": x["sector_en"],
            }
    return {}
