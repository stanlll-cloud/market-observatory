"""
radar_engine.py — 全市场后台量化选股/选币雷达 + 24H 美股期指 + 真 VIX 恐慌中枢 + 泡沫/抄底温度计
纯 Python + asyncio + httpx 异步并发扫描，内存中仅保存轻量级快照，不驻留历史 K 线，确保 VPS 内存 < 60MB。
"""

import asyncio
import json
import math
import time
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import market_data
from market_data import (
    BINANCE_KLINES_URLS,
    BINANCE_TICKER_URLS,
    CRYPTO_CATALOG,
    ET_TZ,
    US_CATALOG,
    YAHOO_UA,
    _binance_url_order,
    _http_get_json,
    fetch_yahoo_realtime_quote,
    prime_daily_cache,
)

# 排除出纯美股温度计统计的非美股正股/对冲资产
EXCLUDED_TEMP_SYMBOLS = frozenset({"SQQQ", "VIXY", "TLT", "GLD", "IBIT", "MSTR", "COIN", "QQQ", "SPY", "IWM", "TQQQ", "SOXL"})
HEDGE_INVERSE_SYMBOLS = frozenset({"SQQQ", "VIXY", "TLT", "GLD"})

_radar_state: Optional[Dict[str, Any]] = None
_radar_task: Optional[asyncio.Task] = None
_scan_lock = asyncio.Lock()
_per_symbol_cache: Dict[str, Dict[str, Any]] = {}


def _ema_series(values: List[float], period: int) -> List[float]:
    if not values:
        return []
    k = 2.0 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1.0 - k))
    return out


def _sma_last(values: List[float], period: int) -> float:
    if not values:
        return 0.0
    sub = values[-period:]
    return sum(sub) / len(sub)


def _rsi14_last(closes: List[float]) -> float:
    if len(closes) < 15:
        return 50.0
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    period = 14
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss <= 1e-12:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return round(100.0 - 100.0 / (1.0 + rs), 1)


def _atr14_last(candles: List[Dict[str, float]]) -> float:
    if len(candles) < 3:
        return 0.0
    trs: List[float] = []
    for i in range(1, len(candles)):
        h = candles[i]["high"]
        l = candles[i]["low"]
        pc = candles[i - 1]["close"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    sub = trs[-14:]
    return sum(sub) / len(sub) if sub else 0.0


async def _fetch_yahoo_daily_meta(sym: str, range_str: str = "1y") -> Optional[Dict[str, Any]]:
    enc = urllib.parse.quote(sym)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}"
    try:
        if sym.startswith("^"):
            data = await _http_get_json(
                url,
                params={"interval": "1d", "range": range_str},
                headers={"User-Agent": YAHOO_UA},
            )
            rt: Dict[str, Any] = {}
        else:
            data, rt = await asyncio.gather(
                _http_get_json(
                    url,
                    params={"interval": "1d", "range": range_str},
                    headers={"User-Agent": YAHOO_UA},
                ),
                fetch_yahoo_realtime_quote(sym, force=True),
            )
        res = data["chart"]["result"][0]
        meta = res.get("meta", {})
        ts = res.get("timestamp", [])
        q = res["indicators"]["quote"][0]
        candles: List[Dict[str, float]] = []
        for i in range(len(ts)):
            o = q["open"][i]
            h = q["high"][i]
            l = q["low"][i]
            c = q["close"][i]
            v = q["volume"][i]
            if o is None or h is None or l is None or c is None:
                continue
            candles.append({
                "time": int(ts[i]),
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": float(v) if v is not None else 0.0,
            })
        if not candles:
            return None

        if isinstance(rt, dict) and rt.get("price"):
            price = float(rt["price"])
            prev_close = float(rt.get("ref_close") or price)
            if range_str == "1y" and not sym.endswith("=F") and rt.get("today_et_date") and rt.get("session") in ("pre", "regular", "post"):
                last_dt = datetime.fromtimestamp(candles[-1]["time"], tz=ET_TZ).strftime("%Y-%m-%d")
                if last_dt < rt["today_et_date"]:
                    candles.append({
                        "time": int(rt.get("today_0930_ts") or rt.get("latest_ts") or candles[-1]["time"] + 86400),
                        "open": float(rt.get("day_open") or price),
                        "high": max(float(rt.get("day_high") or price), price),
                        "low": min(float(rt.get("day_low") or price), price),
                        "close": price,
                        "volume": float(rt.get("day_vol") or 0.0),
                    })
                else:
                    last = candles[-1]
                    candles[-1] = {
                        **last,
                        "close": price,
                        "high": max(last["high"], price),
                        "low": min(last["low"], price),
                    }
            else:
                last = candles[-1]
                candles[-1] = {
                    **last,
                    "close": price,
                    "high": max(last["high"], price),
                    "low": min(last["low"], price),
                }
        else:
            price = float(meta.get("regularMarketPrice") or candles[-1]["close"])
            prev_close = float(
                meta.get("previousClose")
                or (candles[-2]["close"] if len(candles) >= 2 else price)
            )
            last = candles[-1]
            candles[-1] = {
                **last,
                "close": price,
                "high": max(last["high"], price),
                "low": min(last["low"], price),
            }

        if range_str == "1y" and not sym.startswith("^") and not sym.endswith("=F"):
            prime_daily_cache("us", sym, list(candles))
        return {"price": price, "prev_close": prev_close, "candles": candles}
    except Exception:
        return None


async def _fetch_binance_daily(sym: str, ticker_map: Dict[str, Dict[str, float]]) -> Optional[Dict[str, Any]]:
    raw = None
    for idx in _binance_url_order():
        base = BINANCE_KLINES_URLS[idx]
        try:
            raw = await _http_get_json(base, params={"symbol": sym, "interval": "1d", "limit": "260"})
            market_data._best_binance_idx = idx
            break
        except Exception:
            continue
    if not raw:
        return None
    candles = [
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
    if not candles:
        return None
    tk = ticker_map.get(sym)
    price = tk["price"] if tk else candles[-1]["close"]
    change_pct = tk["change_pct"] if tk else (
        round((price - candles[-2]["close"]) / candles[-2]["close"] * 100.0, 2)
        if len(candles) >= 2 and candles[-2]["close"]
        else 0.0
    )
    last = candles[-1]
    candles[-1] = {
        **last,
        "close": price,
        "high": max(last["high"], price),
        "low": min(last["low"], price),
    }
    prime_daily_cache("crypto", sym, list(candles))
    return {"price": price, "change_pct": change_pct, "candles": candles}


async def _fetch_binance_24hr_batch(symbols: List[str]) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    encoded = json.dumps(symbols, separators=(",", ":"))
    for idx in _binance_url_order():
        base = BINANCE_TICKER_URLS[idx]
        try:
            arr = await _http_get_json(base, params={"symbols": encoded})
            if isinstance(arr, list):
                market_data._best_binance_idx = idx
                for item in arr:
                    s = item.get("symbol")
                    if s:
                        out[s] = {
                            "price": float(item["lastPrice"]),
                            "change_pct": round(float(item["priceChangePercent"]), 2),
                        }
                return out
        except Exception:
            continue
    return out


async def fetch_vix_and_futures() -> Dict[str, Any]:
    """抓取 ^VIX, ^VIX3M, NQ=F, ES=F 并计算真 VIX 期限结构刹车状态"""
    vix_d, vix3m_d, nq_d, es_d = await asyncio.gather(
        _fetch_yahoo_daily_meta("^VIX", "1mo"),
        _fetch_yahoo_daily_meta("^VIX3M", "1mo"),
        _fetch_yahoo_daily_meta("NQ=F", "15d"),
        _fetch_yahoo_daily_meta("ES=F", "15d"),
        return_exceptions=True,
    )

    def _fut_obj(res: Any, code: str, label_zh: str, label_en: str) -> Dict[str, Any]:
        if isinstance(res, dict) and res.get("price"):
            p = res["price"]
            prev = res["prev_close"] or p
            chg = round((p - prev) / prev * 100.0, 2) if prev else 0.0
            return {"symbol": f"{code}=F", "code": code, "label_zh": label_zh, "label_en": label_en, "price": round(p, 2), "change_pct": chg}
        return {"symbol": f"{code}=F", "code": code, "label_zh": label_zh, "label_en": label_en, "price": 0.0, "change_pct": 0.0}

    nq = _fut_obj(nq_d, "NQ", "纳指100期货", "Nasdaq 100 Fut")
    es = _fut_obj(es_d, "ES", "标普500期货", "S&P 500 Fut")

    vix_spot = round(vix_d["price"], 2) if isinstance(vix_d, dict) and vix_d.get("price") else 0.0
    vix3m = round(vix3m_d["price"], 2) if isinstance(vix3m_d, dict) and vix3m_d.get("price") else 0.0
    term_ratio = round(vix_spot / vix3m, 2) if (vix_spot > 0 and vix3m > 0) else 0.0

    vix_10d_peak = vix_spot
    if isinstance(vix_d, dict) and vix_d.get("candles"):
        recent_highs = [c["high"] for c in vix_d["candles"][-10:]]
        if recent_highs:
            vix_10d_peak = round(max(recent_highs + [vix_spot]), 2)

    if vix_spot == 0.0:
        state = "CAUTION"
        label_zh = "🟡 VIX 数据同步中"
        label_en = "VIX Syncing"
        desc_zh = "正在连接 CBOE 波动率接口，建议关注美股期货强弱。"
        desc_en = "Connecting CBOE VIX feed; monitor US futures."
    elif term_ratio >= 1.00 or vix_spot >= 30.0:
        state = "HARD_BRAKE"
        label_zh = "🔴 恐慌倒挂刹车 · 禁左侧接刀"
        label_en = "VIX Inversion Brake · No Knife Catching"
        desc_zh = f"VIX ({vix_spot}) 高于远月 VIX3M ({vix3m})（比值 {term_ratio:.2f}）或突破30，机构急买近月暴跌保护，严禁盲目抄底！"
        desc_en = f"VIX ({vix_spot}) inverted over VIX3M ({vix3m}, ratio {term_ratio:.2f}); strict bottom-fishing brake."
    elif vix_10d_peak >= 28.0 and vix_spot <= vix_10d_peak * 0.88 and term_ratio < 1.0:
        state = "RELIEF_WINDOW"
        label_zh = "🟢 恐慌见顶回落 · 右侧抄底窗"
        label_en = "Panic Relief · Right-Side Window"
        desc_zh = f"VIX 从10日峰值 ({vix_10d_peak}) 回落至 {vix_spot} 并恢复升水 ({term_ratio:.2f})，错杀龙头迎右侧黄金坑！"
        desc_en = f"VIX cooled from {vix_10d_peak} to {vix_spot} (ratio {term_ratio:.2f}); panic clearing."
    elif vix_spot >= 21.0 or term_ratio >= 0.95:
        state = "CAUTION"
        label_zh = "🟡 避险升温 · 控仓精选"
        label_en = "Elevated Fear · Selective Sizing"
        desc_zh = f"VIX 处 {vix_spot}（比值 {term_ratio:.2f}），市场波动放大，严格控制总仓位。"
        desc_en = f"VIX at {vix_spot} (ratio {term_ratio:.2f}); keep position size disciplined."
    else:
        state = "NORMAL"
        label_zh = "🟢 恐慌平稳 · 顺势做多"
        label_en = "Calm Contango · Trend Friendly"
        desc_zh = f"VIX 处 {vix_spot}，期限升水健康（比值 {term_ratio:.2f}），适合顺大均线波段操作。"
        desc_en = f"VIX at {vix_spot} in healthy contango ({term_ratio:.2f})."

    return {
        "nq": nq,
        "es": es,
        "vix_spot": vix_spot,
        "vix3m": vix3m,
        "term_ratio": term_ratio,
        "vix_10d_peak": vix_10d_peak,
        "state": state,
        "label_zh": label_zh,
        "label_en": label_en,
        "desc_zh": desc_zh,
        "desc_en": desc_en,
    }


def _macd_state(closes: List[float]) -> Dict[str, Any]:
    """计算日线 MACD(12, 26, 9) 四状态"""
    if len(closes) < 35:
        return {
            "state": "below_bear",
            "label_zh": "0轴下方",
            "label_en": "Below 0",
            "dif": 0.0,
            "dea": 0.0,
            "hist": 0.0,
        }
    ema12 = _ema_series(closes, 12)
    ema26 = _ema_series(closes, 26)
    dif_series = [a - b for a, b in zip(ema12, ema26)]
    dea_series = _ema_series(dif_series, 9)
    dif = dif_series[-1]
    dea = dea_series[-1]
    hist = 2.0 * (dif - dea)
    prev_hist = 2.0 * (dif_series[-2] - dea_series[-2]) if len(dif_series) >= 2 else hist

    if dif > 0 and dea > 0:
        if dif > dea and hist >= prev_hist * 0.9:
            state, zh, en = "above_open", "0轴上方打开", "Above 0 Open"
        else:
            state, zh, en = "above_consol", "0轴上方整理", "Above 0 Consol"
    elif dif > dea or hist > prev_hist:
        state, zh, en = "below_recover", "0轴下修复", "Recovering"
    else:
        state, zh, en = "below_bear", "0轴下方", "Below 0"

    return {
        "state": state,
        "label_zh": zh,
        "label_en": en,
        "dif": round(dif, 4),
        "dea": round(dea, 4),
        "hist": round(hist, 4),
    }


def _evaluate_symbol_metrics(
    item: Dict[str, str],
    market: str,
    price: float,
    change_pct: float,
    candles: List[Dict[str, float]],
    bench_ret20: float,
    vix_state: str,
) -> Dict[str, Any]:
    closes = [c["close"] for c in candles]
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    vols = [c["volume"] for c in candles]

    ema20 = _ema_series(closes, 20)[-1] if closes else price
    ema60 = _ema_series(closes, 60)[-1] if closes else price
    sma120 = _sma_last(closes, 120) if closes else price

    ma_spread_pct = round(((ema20 - ema60) / ema60 * 100.0) if ema60 else 0.0, 2)
    dist_ema20_pct = round(((price - ema20) / ema20 * 100.0) if ema20 else 0.0, 2)
    rsi14 = _rsi14_last(closes)
    macd_info = _macd_state(closes)
    atr14 = _atr14_last(candles)
    atr_pct = round((atr14 / price * 100.0) if price else 0.0, 2)

    rvol = 1.0
    if len(vols) >= 4 and vols[-1] > 0:
        hist = [v for v in vols[-11:-1] if v > 0]
        if hist:
            avg_v = sum(hist) / len(hist)
            if avg_v > 0:
                rvol = round(vols[-1] / avg_v, 2)

    ret20 = ((price - closes[-21]) / closes[-21] * 100.0) if len(closes) >= 21 and closes[-21] else 0.0
    rs_20d = round(ret20 - bench_ret20, 2)

    win_h = highs[-60:] if len(highs) >= 20 else highs
    win_l = lows[-60:] if len(lows) >= 20 else lows
    high60 = max(win_h) if win_h else price
    low60 = min(win_l) if win_l else price
    range60 = high60 - low60
    fib_high = high60 - 0.50 * range60
    fib_low = high60 - 0.618 * range60
    in_fib_pit = (range60 > 0) and (fib_low * 0.98 <= price <= fib_high * 1.03)

    last_open = candles[-1]["open"]
    prev_close = candles[-2]["close"] if len(candles) >= 2 else last_open
    right_side_bounce = (price > last_open) and (price > prev_close)

    # V3.2 暴跌熔断 & 断头铡刀防接飞刀锁
    ret_3d = ((price - closes[-4]) / closes[-4] * 100.0) if len(closes) >= 4 and closes[-4] else 0.0
    intraday_flush_pct = ((price - highs[-1]) / highs[-1] * 100.0) if highs[-1] > 0 else 0.0
    is_inverse = item["symbol"] in HEDGE_INVERSE_SYMBOLS
    crash_lock = (not is_inverse) and (
        (ret_3d <= (-10.0 if market == "us" else -14.0))
        or (intraday_flush_pct <= (-6.0 if market == "us" else -8.0))
    )

    is_squeeze = (not is_inverse) and (abs(ma_spread_pct) <= 1.8) and (not crash_lock)
    is_resilient = (
        (not is_inverse)
        and (rs_20d >= 4.5)
        and (ema20 > ema60)
        and (change_pct > -1.2)
        and (not crash_lock)
    )

    # 策略归因分桶
    setup = "watch"
    setup_zh = "⚪ 震荡观望"
    setup_en = "Watch"

    if is_inverse:
        setup = "hedge_tool"
        setup_zh = "🛡️ 对冲工具"
        setup_en = "Hedge Tool"
    elif crash_lock:
        setup = "crash_knife"
        setup_zh = "🛑 暴跌熔断·禁接刀"
        setup_en = "Crash Lock"
    elif (in_fib_pit or (ema20 > ema60 and -2.2 <= dist_ema20_pct <= 1.8)) and rsi14 <= 52 and right_side_bounce:
        if vix_state == "HARD_BRAKE" and market == "us" and not is_inverse and rs_20d < 5.0:
            setup = "watch"
            setup_zh = "⚠️ VIX倒挂暂缓抄底"
            setup_en = "VIX Brake · Wait"
        else:
            setup = "golden_pit"
            setup_zh = "🟢 黄金坑右侧"
            setup_en = "Golden Pit"
    elif ema20 < ema60 and -2.2 <= dist_ema20_pct <= 2.5:
        setup = "bear_short_put"
        setup_zh = "🩸 反抽做空/Put"
        setup_en = "Short / Put"
    elif is_resilient:
        setup = "resilient_leader"
        setup_zh = "🛡️ 抗跌领涨"
        setup_en = "Resilient Leader"
    elif is_squeeze:
        setup = "ma_squeeze"
        setup_zh = "⚡ 均线粘合·变盘"
        setup_en = "MA Squeeze"
    elif price > ema20 > ema60 and dist_ema20_pct <= 6.0:
        setup = "bull_runner"
        setup_zh = "🚀 多头主升"
        setup_en = "Bull Runner"

    # 价位与 1.5% 账户风险平价配仓
    last_low = lows[-1]
    last_high = highs[-1]
    if setup == "bear_short_put" or (ema20 < ema60 and dist_ema20_pct <= 2.5):
        stop_ref = round(min(max(last_high + 0.5 * atr14, ema60 * 1.015), price * 1.068), 4)
        entry_ref = round(ema20, 4)
        target_ref = round(max(low60, price - 2.2 * atr14), 4)
    else:
        stop_ref = round(max(min(last_low - 0.5 * atr14, price - 1.8 * atr14), price * 0.932), 4)
        entry_ref = round(fib_high if in_fib_pit else ema20, 4)
        target_ref = round(max(high60 * 0.98, price + 2.4 * atr14), 4)

    stop_dist_pct = max(1.2, round(abs(price - stop_ref) / price * 100.0, 2)) if price else 5.0
    risk_parity_pct = 0.0 if crash_lock else min(25.0, round(1.5 / (stop_dist_pct / 100.0), 1))

    # 综合实战评分 (0-99)
    base_score = 45
    if setup == "hedge_tool":
        base_score = 62 + (8 if change_pct > 1.0 else 0) + (6 if vix_state == "HARD_BRAKE" else 0)
    elif setup == "golden_pit":
        base_score = 86 + (5 if is_resilient else 0) + (4 if in_fib_pit else 0)
    elif setup == "resilient_leader":
        base_score = 82 + min(12, int(max(0.0, rs_20d)))
    elif setup == "bear_short_put":
        base_score = 79 + (6 if price < sma120 else 0)
    elif setup == "ma_squeeze":
        base_score = 76 + (5 if price >= ema20 else 0)
    elif setup == "bull_runner":
        base_score = 70 + min(10, int(max(0.0, rs_20d * 0.6)))
    elif setup == "crash_knife":
        base_score = 22
    else:
        base_score = 52 + min(15, int(max(-15.0, rs_20d)))

    if macd_info["state"] in ("above_open", "above_consol") and ema20 > ema60 and setup not in ("hedge_tool", "crash_knife", "bear_short_put"):
        base_score += 3

    radar_score = max(10, min(99, base_score))

    # 大势与K线一致性硬锁：避免慢线压制或单日放量阴线打高分
    if setup not in ("bear_short_put", "hedge_tool"):
        if ema20 < ema60:
            radar_score = min(radar_score, 48)
        if price < last_open and change_pct <= -1.5:
            radar_score = min(radar_score, 46)

    # 精简多标签用于交叉筛选
    tags: List[str] = [setup]
    if is_resilient and "resilient_leader" not in tags:
        tags.append("resilient_leader")
    if is_squeeze and "ma_squeeze" not in tags:
        tags.append("ma_squeeze")
    if in_fib_pit and not crash_lock and not is_inverse:
        tags.append("in_pit")
    if macd_info["state"] in ("above_open", "above_consol") and not is_inverse:
        tags.append("macd_bull")

    return {
        "symbol": item["symbol"],
        "market": market,
        "name": item["name"],
        "exchange": item["exchange"],
        "sector": item.get("sector", ""),
        "sector_en": item.get("sector_en", ""),
        "alias": item.get("alias", ""),
        "price": round(price, 4),
        "change_pct": round(change_pct, 2),
        "rvol": rvol,
        "rsi14": rsi14,
        "atr_pct": atr_pct,
        "ema20": round(ema20, 4),
        "ema60": round(ema60, 4),
        "sma120": round(sma120, 4),
        "ma_spread_pct": ma_spread_pct,
        "dist_ema20_pct": dist_ema20_pct,
        "rs_20d": rs_20d,
        "in_fib_pit": in_fib_pit,
        "right_side_bounce": right_side_bounce,
        "crash_lock": crash_lock,
        "is_squeeze": is_squeeze,
        "is_resilient": is_resilient,
        "is_hedge": is_inverse,
        "macd_state": macd_info["state"],
        "macd_label_zh": macd_info["label_zh"],
        "macd_label_en": macd_info["label_en"],
        "macd_dif": macd_info["dif"],
        "macd_dea": macd_info["dea"],
        "macd_hist": macd_info["hist"],
        "setup": setup,
        "setup_zh": setup_zh,
        "setup_en": setup_en,
        "tags": tags,
        "radar_score": radar_score,
        "entry_ref": entry_ref,
        "target_ref": target_ref,
        "stop_ref": stop_ref,
        "stop_dist_pct": stop_dist_pct,
        "risk_parity_pct": risk_parity_pct,
    }


def _compute_temperature(items: List[Dict[str, Any]], vix_state: str) -> Dict[str, Any]:
    """纯美股口径泡沫评分 & 抄底指数 (0~100)"""
    eq = [x for x in items if x["market"] == "us" and x["symbol"] not in EXCLUDED_TEMP_SYMBOLS]
    if not eq:
        return {
            "bubble_score": 50,
            "bottom_score": 50,
            "bubble_label_zh": "同步中",
            "bottom_label_zh": "同步中",
            "note_zh": "",
        }
    n = len(eq)
    pct_above_ema20 = sum(1 for x in eq if x["price"] > x["ema20"]) / n * 100.0
    avg_rsi = sum(x["rsi14"] for x in eq) / n
    rsi_scaled = max(0.0, min(100.0, (avg_rsi - 35.0) / 40.0 * 100.0))
    pct_overext = sum(1 for x in eq if x["dist_ema20_pct"] > 5.0) / n * 100.0

    bubble = round(min(100.0, max(0.0, 0.45 * pct_above_ema20 + 0.35 * rsi_scaled + 0.20 * min(100.0, pct_overext * 2.5))))

    pct_pit_or_oversold = sum(1 for x in eq if x["in_fib_pit"] or x["rsi14"] <= 38.0) / n * 100.0
    pct_deep_below = sum(1 for x in eq if x["dist_ema20_pct"] < -3.0) / n * 100.0
    vix_bonus = 18.0 if vix_state == "RELIEF_WINDOW" else (8.0 if vix_state == "NORMAL" else 0.0)
    raw_bottom = round(min(100.0, max(0.0, 0.45 * min(100.0, pct_pit_or_oversold * 1.6) + 0.35 * min(100.0, pct_deep_below * 1.4) + vix_bonus)))

    note_zh = ""
    if vix_state == "HARD_BRAKE" and raw_bottom > 45:
        raw_bottom = 45
        note_zh = "VIX倒挂期防接刀封顶(≤45)"

    bubble_lbl = "极度过热" if bubble >= 75 else ("偏热注意" if bubble >= 58 else ("温和平稳" if bubble >= 35 else "情绪冰点"))
    bottom_lbl = "右侧黄金坑" if raw_bottom >= 68 else ("蓄势观察" if raw_bottom >= 46 else ("倒挂防接刀" if vix_state == "HARD_BRAKE" else "暂无大坑"))

    return {
        "bubble_score": bubble,
        "bottom_score": raw_bottom,
        "bubble_label_zh": bubble_lbl,
        "bottom_label_zh": bottom_lbl,
        "note_zh": note_zh,
    }


async def run_radar_scan_once() -> Dict[str, Any]:
    global _radar_state
    async with _scan_lock:
        vix_fut_task = asyncio.create_task(fetch_vix_and_futures())
        qqq_task = asyncio.create_task(_fetch_yahoo_daily_meta("QQQ", "1y"))
        btc_batch_task = asyncio.create_task(
            _fetch_binance_24hr_batch([x["symbol"] for x in CRYPTO_CATALOG])
        )
        btc_daily_task = asyncio.create_task(_fetch_binance_daily("BTCUSDT", {}))

        vix_fut, qqq_res, btc_ticker_map, btc_daily = await asyncio.gather(
            vix_fut_task, qqq_task, btc_batch_task, btc_daily_task
        )

        qqq_ret20 = 0.0
        if isinstance(qqq_res, dict) and len(qqq_res.get("candles", [])) >= 21:
            qc = qqq_res["candles"]
            if qc[-21]["close"]:
                qqq_ret20 = (qqq_res["price"] - qc[-21]["close"]) / qc[-21]["close"] * 100.0

        btc_ret20 = 0.0
        if isinstance(btc_daily, dict) and len(btc_daily.get("candles", [])) >= 21:
            bc = btc_daily["candles"]
            if bc[-21]["close"]:
                btc_ret20 = (btc_daily["candles"][-1]["close"] - bc[-21]["close"]) / bc[-21]["close"] * 100.0

        sem = asyncio.Semaphore(4)
        vix_state = vix_fut.get("state", "NORMAL")

        async def _scan_us(item: Dict[str, str]) -> Optional[Dict[str, Any]]:
            sym = item["symbol"]
            async with sem:
                raw = await _fetch_yahoo_daily_meta(sym, "1y")
            if raw and len(raw["candles"]) >= 20:
                p = raw["price"]
                prev = raw["prev_close"] or p
                chg = ((p - prev) / prev * 100.0) if prev else 0.0
                res = _evaluate_symbol_metrics(item, "us", p, chg, raw["candles"], qqq_ret20, vix_state)
                _per_symbol_cache[f"us:{sym}"] = res
                return res
            return _per_symbol_cache.get(f"us:{sym}")

        async def _scan_crypto(item: Dict[str, str]) -> Optional[Dict[str, Any]]:
            sym = item["symbol"]
            async with sem:
                raw = await _fetch_binance_daily(sym, btc_ticker_map)
            if raw and len(raw["candles"]) >= 20:
                res = _evaluate_symbol_metrics(
                    item, "crypto", raw["price"], raw["change_pct"], raw["candles"], btc_ret20, vix_state
                )
                _per_symbol_cache[f"crypto:{sym}"] = res
                return res
            return _per_symbol_cache.get(f"crypto:{sym}")

        all_tasks = [_scan_us(x) for x in US_CATALOG] + [_scan_crypto(x) for x in CRYPTO_CATALOG]
        scanned = await asyncio.gather(*all_tasks, return_exceptions=True)

        items: List[Dict[str, Any]] = []
        for entry in scanned:
            if isinstance(entry, dict):
                items.append(entry)

        # Fallback placeholders for any symbol not yet fetched so UI catalog is always complete
        seen_keys = {(x["market"], x["symbol"]) for x in items}
        for market_key, pool in (("us", US_CATALOG), ("crypto", CRYPTO_CATALOG)):
            for x in pool:
                if (market_key, x["symbol"]) not in seen_keys:
                    items.append({
                        "symbol": x["symbol"],
                        "market": market_key,
                        "name": x["name"],
                        "exchange": x["exchange"],
                        "sector": x.get("sector", ""),
                        "sector_en": x.get("sector_en", ""),
                        "alias": x.get("alias", ""),
                        "price": 0.0,
                        "change_pct": 0.0,
                        "rvol": 1.0,
                        "rsi14": 50.0,
                        "atr_pct": 0.0,
                        "ema20": 0.0,
                        "ema60": 0.0,
                        "sma120": 0.0,
                        "ma_spread_pct": 0.0,
                        "dist_ema20_pct": 0.0,
                        "rs_20d": 0.0,
                        "in_fib_pit": False,
                        "right_side_bounce": False,
                        "crash_lock": False,
                        "is_squeeze": False,
                        "is_resilient": False,
                        "is_hedge": x["symbol"] in HEDGE_INVERSE_SYMBOLS,
                        "macd_state": "below_bear",
                        "macd_label_zh": "0轴下方",
                        "macd_label_en": "Below 0",
                        "macd_dif": 0.0,
                        "macd_dea": 0.0,
                        "macd_hist": 0.0,
                        "setup": "watch",
                        "setup_zh": "⚪ 待同步",
                        "setup_en": "Syncing",
                        "tags": ["watch"],
                        "radar_score": 30,
                        "entry_ref": 0.0,
                        "target_ref": 0.0,
                        "stop_ref": 0.0,
                        "stop_dist_pct": 0.0,
                        "risk_parity_pct": 0.0,
                    })

        items.sort(key=lambda x: (x["radar_score"], x["rs_20d"]), reverse=True)

        counts = {
            "total": len(items),
            "golden_pit": sum(1 for x in items if x["setup"] == "golden_pit"),
            "bear_short_put": sum(1 for x in items if x["setup"] == "bear_short_put"),
            "resilient_leader": sum(1 for x in items if "resilient_leader" in x["tags"]),
            "ma_squeeze": sum(1 for x in items if "ma_squeeze" in x["tags"]),
            "bull_runner": sum(1 for x in items if x["setup"] == "bull_runner"),
            "macd_bull": sum(1 for x in items if "macd_bull" in x["tags"]),
            "hedge_tool": sum(1 for x in items if x.get("is_hedge")),
            "crash_knife": sum(1 for x in items if x["setup"] == "crash_knife"),
        }
        temperature = _compute_temperature(items, vix_state)

        bj_tz = timezone(timedelta(hours=8))
        now_bj = datetime.now(bj_tz).strftime("%H:%M:%S")
        snapshot = {
            "vix_futures": vix_fut,
            "temperature": temperature,
            "counts": counts,
            "items": items,
            "updated_at": now_bj,
            "ts": int(time.time()),
        }
        _radar_state = snapshot
        return snapshot


async def _radar_background_loop() -> None:
    while True:
        try:
            await run_radar_scan_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(60)


def start_radar_loop() -> None:
    global _radar_task
    if _radar_task is None or _radar_task.done():
        _radar_task = asyncio.create_task(_radar_background_loop())


async def stop_radar_loop() -> None:
    global _radar_task
    if _radar_task is not None and not _radar_task.done():
        _radar_task.cancel()
        try:
            await _radar_task
        except asyncio.CancelledError:
            pass
    _radar_task = None


async def get_radar_snapshot(force: bool = False) -> Dict[str, Any]:
    if not force and _radar_state is not None and _radar_state.get("items"):
        return _radar_state
    try:
        return await asyncio.wait_for(run_radar_scan_once(), timeout=8.0)
    except Exception:
        if _radar_state is not None:
            return _radar_state
        # Return instant cold-start skeleton while background task finishes
        vix_fut = await fetch_vix_and_futures()
        return {
            "vix_futures": vix_fut,
            "temperature": {"bubble_score": 50, "bottom_score": 50, "bubble_label_zh": "初始化中", "bottom_label_zh": "初始化中", "note_zh": ""},
            "counts": {"total": 0, "golden_pit": 0, "bear_short_put": 0, "resilient_leader": 0, "ma_squeeze": 0, "bull_runner": 0, "crash_knife": 0},
            "items": [],
            "updated_at": "--:--:--",
            "ts": int(time.time()),
        }
