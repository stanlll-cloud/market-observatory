"""
macro_intel.py — 美股 7 大 ETF 资金风向、宏观双水源（美联储流动性/现货ETF）、
半小时实时大新闻（华尔街见闻 + 新浪7x24兜底）以及日线 SMA 20/60/120 扣抵「熊转牛四步曲」引擎。
"""

import asyncio
import datetime
import re
import time
from typing import Any, Dict, List, Optional

from market_data import MarketDataCache, YAHOO_UA, _http_get_json, fetch_market_data, fetch_yahoo_realtime_quote

_macro_cache = MarketDataCache(ttl=20)

ETF_LIST = [
    {"symbol": "QQQ", "label_zh": "纳指100", "label_en": "Nasdaq 100"},
    {"symbol": "SPY", "label_zh": "标普500", "label_en": "S&P 500"},
    {"symbol": "SMH", "label_zh": "半导体", "label_en": "Semis"},
    {"symbol": "IBIT", "label_zh": "贝莱德BTC", "label_en": "iShares BTC"},
    {"symbol": "FBTC", "label_zh": "富达BTC", "label_en": "Fidelity BTC"},
    {"symbol": "GLD", "label_zh": "黄金ETF", "label_en": "Gold ETF"},
    {"symbol": "TLT", "label_zh": "20年美债", "label_en": "20Y Treasury"},
]

FIN_FILTER_RE = re.compile(
    r"美股|纳指|标普|道指|美联储|利率|通胀|CPI|PCE|非农|降息|加息|缩表|关税|特朗普|鲍威尔|"
    r"比特币|以太坊|加密|英伟达|特斯拉|苹果|微软|谷歌|黄金|原油|美债|收益率|ETF|财报|芯片|半导体"
)
HIGH_IMPACT_RE = re.compile(
    r"美联储|鲍威尔|CPI|PCE|非农|利率决议|降息|加息|关税|特朗普|暴涨|暴跌|跳水|飙升|熔断|"
    r"突发|警告|比特币|BTC|ETH|ETF|英伟达|停火|袭击|制裁|财报"
)
BULL_NEWS_RE = re.compile(r"大涨|飙升|拉升|突破|净流入|抢筹|降息|利好|超预期|停火|达成协议|回购|增持")
BEAR_NEWS_RE = re.compile(r"大跌|暴跌|跳水|重挫|净流出|抛售|加息|通胀反弹|超预期下行|袭击|制裁|冲突|警告|裁员|破产")
VOLATILE_NEWS_RE = re.compile(r"巨震|波动|插针|突发|决议|鲍威尔|非农|CPI|财报|关税")


async def _fetch_single_etf(item: Dict[str, str], force: bool = False) -> Dict[str, Any]:
    sym = item["symbol"]
    ckey = f"etf:{sym}"
    if not force:
        hit = _macro_cache.get(ckey)
        if hit is not None:
            return hit

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
    try:
        data, rt = await asyncio.gather(
            _http_get_json(
                url,
                params={"interval": "1d", "range": "1mo"},
                headers={"User-Agent": YAHOO_UA},
            ),
            fetch_yahoo_realtime_quote(sym, force=force),
        )
        res = data["chart"]["result"][0]
        meta = res.get("meta", {})
        q = res["indicators"]["quote"][0]

        closes = [float(x) for x in q.get("close", []) if x is not None]
        highs = [float(x) for x in q.get("high", []) if x is not None]
        lows = [float(x) for x in q.get("low", []) if x is not None]
        vols = [float(x) for x in q.get("volume", []) if x is not None]

        if isinstance(rt, dict) and rt.get("price"):
            price = float(rt["price"])
            change_pct = float(rt["price_change_percent"])
        else:
            price = float(meta.get("regularMarketPrice") or (closes[-1] if closes else 0.0))
            prev_close = float(
                meta.get("previousClose")
                or (closes[-2] if len(closes) >= 2 else None)
                or meta.get("chartPreviousClose")
                or price
            )
            change_pct = round(((price - prev_close) / prev_close * 100.0) if prev_close else 0.0, 2)

        intraday_range_pct = 0.0
        if highs and lows and price:
            intraday_range_pct = round((highs[-1] - lows[-1]) / price * 100.0, 2)

        rvol = 1.0
        if len(vols) >= 3 and vols[-1] > 0:
            hist_vols = [v for v in vols[-11:-1] if v > 0]
            if hist_vols:
                avg_v = sum(hist_vols) / len(hist_vols)
                if avg_v > 0:
                    rvol = round(vols[-1] / avg_v, 2)

        if change_pct >= 1.2 and rvol >= 1.05:
            flow_state, flow_zh, flow_en = "strong_inflow", "放量抢筹", "Strong Inflow"
        elif change_pct >= 0.25:
            flow_state, flow_zh, flow_en = "inflow", "资金流入", "Inflow"
        elif change_pct <= -1.2 and rvol >= 1.05:
            flow_state, flow_zh, flow_en = "strong_outflow", "放量出逃", "Strong Outflow"
        elif change_pct <= -0.25:
            flow_state, flow_zh, flow_en = "outflow", "资金流出", "Outflow"
        else:
            flow_state, flow_zh, flow_en = "neutral", "存量观望", "Neutral"

        out = {
            "symbol": sym,
            "label_zh": item["label_zh"],
            "label_en": item["label_en"],
            "price": round(price, 2),
            "change_pct": change_pct,
            "intraday_range_pct": intraday_range_pct,
            "rvol": rvol,
            "flow_state": flow_state,
            "flow_zh": flow_zh,
            "flow_en": flow_en,
        }
        _macro_cache.set(ckey, out)
        return out
    except Exception:
        stale = _macro_cache.get_stale(ckey)
        if stale is not None:
            return stale
        return {
            "symbol": sym,
            "label_zh": item["label_zh"],
            "label_en": item["label_en"],
            "price": 0.0,
            "change_pct": 0.0,
            "intraday_range_pct": 0.0,
            "rvol": 1.0,
            "flow_state": "neutral",
            "flow_zh": "暂无数据",
            "flow_en": "N/A",
        }


async def fetch_etf_flows(force: bool = False) -> Dict[str, Any]:
    ckey = "etf_bundle"
    if not force:
        hit = _macro_cache.get(ckey)
        if hit is not None:
            return hit

    results = await asyncio.gather(*(_fetch_single_etf(item, force=force) for item in ETF_LIST), return_exceptions=True)
    etfs: List[Dict[str, Any]] = []
    by_sym: Dict[str, Dict[str, Any]] = {}
    for item, res in zip(ETF_LIST, results):
        row = res if isinstance(res, dict) else {
            "symbol": item["symbol"],
            "label_zh": item["label_zh"],
            "label_en": item["label_en"],
            "price": 0.0,
            "change_pct": 0.0,
            "intraday_range_pct": 0.0,
            "rvol": 1.0,
            "flow_state": "neutral",
            "flow_zh": "暂无数据",
            "flow_en": "N/A",
        }
        etfs.append(row)
        by_sym[row["symbol"]] = row

    ibit = by_sym.get("IBIT", {})
    fbtc = by_sym.get("FBTC", {})
    tlt = by_sym.get("TLT", {})
    btc_avg_chg = (ibit.get("change_pct", 0.0) + fbtc.get("change_pct", 0.0)) / 2.0
    btc_max_rvol = max(ibit.get("rvol", 1.0), fbtc.get("rvol", 1.0))

    if btc_avg_chg >= 1.2 and btc_max_rvol >= 1.0:
        btc_flow_zh = f"华尔街现货ETF抢筹净流入 ({btc_avg_chg:+.2f}%)"
        btc_flow_en = f"BTC Spot ETF Inflow ({btc_avg_chg:+.2f}%)"
    elif btc_avg_chg >= 0.3:
        btc_flow_zh = f"现货ETF温和偏暖 ({btc_avg_chg:+.2f}%)"
        btc_flow_en = f"BTC ETF Mild Inflow ({btc_avg_chg:+.2f}%)"
    elif btc_avg_chg <= -1.2:
        btc_flow_zh = f"现货ETF派发承压 ({btc_avg_chg:+.2f}%)"
        btc_flow_en = f"BTC ETF Outflow Pressure ({btc_avg_chg:+.2f}%)"
    else:
        btc_flow_zh = f"现货ETF存量博弈 ({btc_avg_chg:+.2f}%)"
        btc_flow_en = f"BTC ETF Neutral ({btc_avg_chg:+.2f}%)"

    tlt_chg = tlt.get("change_pct", 0.0)
    if tlt_chg >= 0.45:
        fed_zh = f"TLT走强({tlt_chg:+.2f}%) · 降息/宽松流动性升温"
        fed_en = f"TLT Up ({tlt_chg:+.2f}%) · Easing Hopes"
    elif tlt_chg <= -0.45:
        fed_zh = f"TLT走弱({tlt_chg:+.2f}%) · 美债收益率走高抽水"
        fed_en = f"TLT Down ({tlt_chg:+.2f}%) · Tightening Yields"
    else:
        fed_zh = f"TLT平稳({tlt_chg:+.2f}%) · 美联储流动性中性"
        fed_en = f"TLT Flat ({tlt_chg:+.2f}%) · Neutral Liquidity"

    bundle = {
        "etfs": etfs,
        "by_sym": by_sym,
        "water_sources": {
            "btc_etf_flow_zh": btc_flow_zh,
            "btc_etf_flow_en": btc_flow_en,
            "fed_liquidity_zh": fed_zh,
            "fed_liquidity_en": fed_en,
        },
    }
    _macro_cache.set(ckey, bundle)
    return bundle


def _sma_last(values: List[float], period: int) -> float:
    if not values:
        return 0.0
    sub = values[-period:] if len(values) >= period else values
    return sum(sub) / len(sub)


async def compute_bull_bear_cycle(market: str, symbol: str, force: bool = False) -> Dict[str, Any]:
    ckey = f"cycle:{market}:{symbol}"
    if not force:
        hit = _macro_cache.get(ckey)
        if hit is not None:
            return hit

    try:
        daily = await fetch_market_data(market=market, symbol=symbol, interval="1d", limit=180, replay_index=-1, force=force)
        candles = daily.get("candles", [])
        if len(candles) < 30:
            return {
                "ready": False,
                "sma20": 0.0,
                "sma60": 0.0,
                "sma120": 0.0,
                "deduct_20": 0.0,
                "is_deduct_low": False,
                "deduct_label_zh": "日线数据不足",
                "deduct_label_en": "Insufficient Daily Bars",
                "gap_20_60_pct": 0.0,
                "vol_compress_ratio": 1.0,
                "low_vol_bottoming": False,
                "steps": [
                    {"id": 1, "done": False, "label_zh": "20线走平扣低", "label_en": "SMA20 Flat & Low Deduct"},
                    {"id": 2, "done": False, "label_zh": "20/60粘合<1.8% (降波前夜)", "label_en": "SMA20/60 Coil <1.8%"},
                    {"id": 3, "done": False, "label_zh": "站上SMA120半年线 (发令枪)", "label_en": "Above Daily SMA120"},
                    {"id": 4, "done": False, "label_zh": "三线多头主升浪 (Call滚仓)", "label_en": "3-Line Bull Alignment"},
                ],
                "completed_steps": 0,
                "permission_state": "neutral",
                "permission_zh": "日线不足30根，暂以当前周期均线为准",
                "permission_en": "Fewer than 30 daily bars",
                "squeeze_warning_zh": "",
                "squeeze_warning_en": "",
            }

        closes = [c["close"] for c in candles]
        last_close = closes[-1]
        prev_close = closes[-2] if len(closes) >= 2 else last_close

        sma20 = _sma_last(closes, 20)
        sma60 = _sma_last(closes, 60)
        sma120 = _sma_last(closes, 120)

        sma20_prev5 = _sma_last(closes[:-5], 20) if len(closes) >= 25 else sma20
        sma20_slope_pct = ((sma20 - sma20_prev5) / sma20_prev5 * 100.0) if sma20_prev5 else 0.0

        deduct_20 = closes[-20] if len(closes) >= 20 else closes[0]
        is_deduct_low = last_close >= deduct_20

        gap_20_60_pct = (abs(sma20 - sma60) / sma60 * 100.0) if sma60 else 0.0

        # 缩量降波检测：近10日振幅 vs 前30日振幅
        ranges = [(c["high"] - c["low"]) / (c["close"] or 1.0) for c in candles]
        recent_rng = sum(ranges[-10:]) / len(ranges[-10:])
        base_slice = ranges[-40:-10] if len(ranges) >= 40 else ranges[:-10]
        base_rng = (sum(base_slice) / len(base_slice)) if base_slice else recent_rng
        vol_compress_ratio = round(recent_rng / base_rng, 2) if base_rng > 0 else 1.0
        low_vol_bottoming = vol_compress_ratio < 0.78

        step1 = bool(is_deduct_low and sma20_slope_pct >= -0.35)
        step2 = bool(gap_20_60_pct < 1.8)
        step3 = bool(last_close > sma120 and sma20 >= sma60 * 0.998)
        step4 = bool(last_close > sma20 > sma60 > sma120)
        completed_steps = sum(1 for s in (step1, step2, step3, step4) if s)

        if step4:
            perm_state = "bull_full"
            perm_zh = "🚀 三线多头主升浪：全力顺势做多 / 买 Call 滚仓（禁买 Put）"
            perm_en = "🚀 Full 3-SMA Bull Trend: Roll Calls / Long Only"
        elif step3:
            perm_state = "bull_unlock"
            perm_zh = "🟢 站稳日线 SMA120：熊转牛发令枪已响，解锁做多 / 买 Call 权限"
            perm_en = "🟢 Above Daily SMA120: Long / Call Unlocked"
        elif step2 and last_close <= sma120:
            perm_state = "coil_watch"
            perm_zh = "⚡ 20/60 均线极度粘合(<1.8%)：降波变盘前夜，盯紧放量突破 SMA120"
            perm_en = "⚡ SMA20/60 Tight Coil (<1.8%): Watch SMA120 Breakout"
        elif last_close < sma120:
            perm_state = "bear_lock"
            perm_zh = f"🔒 低于日线 SMA120 ({round(sma120, 2)})：宏观锁死只做空 / 买 Put（禁买 Call）"
            perm_en = f"🔒 Below Daily SMA120 ({round(sma120, 2)}): Bear Lock / Put Only"
        else:
            perm_state = "transition"
            perm_zh = f"🟡 站上 SMA120 ({round(sma120, 2)}) 待金叉确认：等待 SMA20/60 发散"
            perm_en = f"🟡 Above SMA120 ({round(sma120, 2)}): Awaiting SMA20/60 Cross"

        day_ret = (last_close - prev_close) / prev_close if prev_close else 0.0
        squeeze_zh = ""
        squeeze_en = ""
        if last_close < sma120 and day_ret >= 0.035:
            squeeze_zh = (
                f"⚠️ 逼空脉冲警告：当日暴涨 {day_ret * 100:+.1f}% 但仍在日线 SMA120 ({round(sma120, 2)}) 下方，"
                "未完成缩量磨底前多为空头平仓死猫跳，切忌当成熊转牛追高！"
            )
            squeeze_en = (
                f"⚠️ Short-Squeeze Alert: +{day_ret * 100:.1f}% spike while still below Daily SMA120 ({round(sma120, 2)}). Avoid chasing!"
            )

        out = {
            "ready": True,
            "sma20": round(sma20, 2),
            "sma60": round(sma60, 2),
            "sma120": round(sma120, 2),
            "deduct_20": round(deduct_20, 2),
            "is_deduct_low": is_deduct_low,
            "deduct_label_zh": "🟢 扣低值 (助涨磨平)" if is_deduct_low else "🔴 扣高值 (助跌压制)",
            "deduct_label_en": "🟢 Low Deduct" if is_deduct_low else "🔴 High Deduct",
            "gap_20_60_pct": round(gap_20_60_pct, 2),
            "vol_compress_ratio": vol_compress_ratio,
            "low_vol_bottoming": low_vol_bottoming,
            "steps": [
                {"id": 1, "done": step1, "label_zh": "20线走平扣低", "label_en": "SMA20 Flat & Low Deduct"},
                {"id": 2, "done": step2, "label_zh": "20/60粘合<1.8% (降波前夜)", "label_en": "SMA20/60 Coil <1.8%"},
                {"id": 3, "done": step3, "label_zh": "站上SMA120半年线 (发令枪)", "label_en": "Above Daily SMA120"},
                {"id": 4, "done": step4, "label_zh": "三线多头主升浪 (Call滚仓)", "label_en": "3-Line Bull Alignment"},
            ],
            "completed_steps": completed_steps,
            "permission_state": perm_state,
            "permission_zh": perm_zh,
            "permission_en": perm_en,
            "squeeze_warning_zh": squeeze_zh,
            "squeeze_warning_en": squeeze_en,
        }
        _macro_cache.set(ckey, out)
        return out
    except Exception:
        stale = _macro_cache.get_stale(ckey)
        if stale is not None:
            return stale
        return {"ready": False, "steps": [], "completed_steps": 0, "permission_state": "neutral", "permission_zh": "日线加载中", "permission_en": "Loading", "squeeze_warning_zh": "", "squeeze_warning_en": ""}


def _classify_news(text: str, score: int = 1) -> Dict[str, str]:
    is_high = score >= 2 or bool(HIGH_IMPACT_RE.search(text))
    if VOLATILE_NEWS_RE.search(text) and is_high:
        sentiment, tag_zh, tag_en = "volatile", "巨震预警", "Volatile"
    elif BULL_NEWS_RE.search(text) and not BEAR_NEWS_RE.search(text):
        sentiment, tag_zh, tag_en = "bull", "偏多利好", "Bullish"
    elif BEAR_NEWS_RE.search(text) and not BULL_NEWS_RE.search(text):
        sentiment, tag_zh, tag_en = "bear", "偏空避险", "Bearish"
    else:
        sentiment, tag_zh, tag_en = "neutral", "市场动向", "Update"

    return {
        "importance": "high" if is_high else "normal",
        "sentiment": sentiment,
        "tag_zh": tag_zh,
        "tag_en": tag_en,
    }


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


async def fetch_breaking_news() -> Dict[str, Any]:
    ckey = "breaking_news"
    hit = _macro_cache.get(ckey)
    if hit is not None:
        return hit

    now_ts = int(time.time())
    headers = {"User-Agent": YAHOO_UA}
    raw_items: List[Dict[str, Any]] = []

    # 主源：华尔街见闻 global-channel + us-stock-channel
    wscn_urls = [
        "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=25",
        "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=us-stock-channel&limit=20",
    ]
    wscn_res = await asyncio.gather(
        *(_http_get_json(u, headers=headers) for u in wscn_urls),
        return_exceptions=True,
    )
    for res in wscn_res:
        if not isinstance(res, dict):
            continue
        for it in res.get("data", {}).get("items", []):
            txt = _clean_text(it.get("content_text") or it.get("content") or it.get("title") or "")
            if not txt:
                continue
            ts = int(it.get("display_time") or now_ts)
            score = int(it.get("score") or 1)
            raw_items.append({
                "id": str(it.get("id") or txt[:30]),
                "ts": ts,
                "text": txt,
                "source": "华尔街见闻",
                "score": score,
            })

    # 兜底源：新浪财经 7x24（仅保留金融/美股/加密关键词）
    if not raw_items:
        try:
            sina = await _http_get_json(
                "https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=25&zhibo_id=152",
                headers=headers,
            )
            for it in sina.get("result", {}).get("data", {}).get("feed", {}).get("list", []):
                txt = _clean_text(it.get("rich_text") or "")
                if not txt or not FIN_FILTER_RE.search(txt):
                    continue
                ctime = it.get("create_time", "")
                ts = now_ts
                if ctime:
                    try:
                        dt = datetime.datetime.strptime(ctime, "%Y-%m-%d %H:%M:%S")
                        ts = int(dt.timestamp())
                    except Exception:
                        ts = now_ts
                raw_items.append({
                    "id": str(it.get("id") or txt[:30]),
                    "ts": ts,
                    "text": txt,
                    "source": "新浪财经",
                    "score": 1,
                })
        except Exception:
            pass

    # 去重 & 排序
    seen = set()
    news: List[Dict[str, Any]] = []
    for it in sorted(raw_items, key=lambda x: x["ts"], reverse=True):
        key = it["text"][:30]
        if it["id"] in seen or key in seen:
            continue
        seen.add(it["id"])
        seen.add(key)
        age_min = max(0, int((now_ts - it["ts"]) // 60))
        dt_str = datetime.datetime.fromtimestamp(it["ts"]).strftime("%H:%M")
        cls = _classify_news(it["text"], it["score"])
        news.append({
            "id": it["id"],
            "ts": it["ts"],
            "time_str": dt_str,
            "age_minutes": age_min,
            "age_label_zh": "刚刚" if age_min < 1 else (f"{age_min}分钟前" if age_min < 60 else f"{age_min // 60}小时前"),
            "age_label_en": "Just now" if age_min < 1 else (f"{age_min}m ago" if age_min < 60 else f"{age_min // 60}h ago"),
            "is_within_30m": age_min <= 30,
            "source": it["source"],
            "text": it["text"],
            **cls,
        })
        if len(news) >= 15:
            break

    if not news:
        stale = _macro_cache.get_stale(ckey)
        if stale is not None:
            return stale

    within_30m_count = sum(1 for n in news if n["is_within_30m"])
    out = {"news": news, "within_30m_count": within_30m_count}
    _macro_cache.set(ckey, out)
    return out


def build_macro_guidance(
    by_sym: Dict[str, Dict[str, Any]],
    water_sources: Dict[str, str],
    cycle: Dict[str, Any],
    news: List[Dict[str, Any]],
    market: str,
    symbol: str,
) -> Dict[str, Any]:
    qqq = by_sym.get("QQQ", {}).get("change_pct", 0.0)
    spy = by_sym.get("SPY", {}).get("change_pct", 0.0)
    smh = by_sym.get("SMH", {}).get("change_pct", 0.0)
    ibit = by_sym.get("IBIT", {}).get("change_pct", 0.0)
    gld = by_sym.get("GLD", {}).get("change_pct", 0.0)

    now_bj = datetime.datetime.now()
    hhmm = now_bj.hour * 100 + now_bj.minute
    in_us_open_window = 2030 <= hhmm <= 2330

    hot_30m = [n for n in news if n["is_within_30m"] and n["importance"] == "high"]

    if qqq >= 1.2 or spy >= 1.0 or ibit >= 2.0:
        mood = "risk_on"
        mood_zh = "🔥 美股/ETF 强势大涨 · 风险资金涌入"
        mood_en = "🔥 US Equities & ETFs Surging · Risk-On"
        wick_level = "high"
        wick_zh = "⚡ 上涨插针警告：美股与核心 ETF 大幅拉升，币圈及高弹品种极易先出现「向下急插针清扫高倍多单」或「冲高假突破留长上影针」双向洗盘！"
        wick_en = "⚡ Wick Alert: Strong US ETF rally often triggers sharp shakeout wicks before continuation."
        buy_zh = "📌 购买方法：严禁市价追涨大红柱！采用「分批限价接针法」——在 15m/1H 白线(EMA20)及下方 0.5%~0.8% 提前挂限价单接下影针；3倍ETF顺势持有，期权等回踩降温买 Call。"
        buy_en = "📌 Buy Method: Never chase green spikes at market. Place staged limit orders near 15m/1H EMA20 (-0.5%~-0.8%)."
    elif qqq <= -1.2 or spy <= -1.0 or ibit <= -2.0:
        mood = "risk_off"
        gold_note = "（黄金 GLD 吸金避险）" if gld > 0.4 else ""
        mood_zh = f"⚠️ 美股 ETF 放量出逃 · 避险升温{gold_note}"
        mood_en = "⚠️ US ETFs Selling Off · Risk-Off"
        wick_level = "high"
        wick_zh = "⚠️ 诱多插针警告：美股主流 ETF 走弱流出，极易在盘中突然拉出「向上急抽假阳针」打爆追空止损后再加速瀑布下跌！"
        wick_en = "⚠️ Bull-Trap Wick Alert: Weak US ETFs often snap up briefly to hunt short stops before dropping."
        buy_zh = "📌 购买方法：现货与 3倍ETF 严禁左侧抄底接飞刀；合约/Put 切忌地板追空，改在上方白线(EMA20)附近挂限价空单接「向上诱多针」，止损放黄线外侧。"
        buy_en = "📌 Buy Method: Cash/3x ETF stay flat; shorts/Puts place limit orders near overhead EMA20 to catch trap wicks."
    elif (qqq >= 0.6 and ibit <= -0.8) or (qqq <= -0.6 and ibit >= 0.8):
        mood = "divergence"
        mood_zh = "⚡ 纳指(QQQ)与比特币(IBIT)走势劈叉 · 分化博弈"
        mood_en = "⚡ QQQ / IBIT Divergence · Choppy Battle"
        wick_level = "medium"
        wick_zh = "⚡ 画门插针警告：美股科技与加密 ETF 资金流向背离，主力极易借波动上下「画门插针」双杀急躁仓位！"
        wick_en = "⚡ Bart-Pattern Alert: QQQ and IBIT diverging; expect two-way liquidity sweeps."
        buy_zh = "📌 购买方法：仓位减半，放弃突破追单；仅在 4H 斐波那契(0.5/0.618)与白黄均线重合位挂极值接针单，浮盈 +10%~15% 先锁一半。"
        buy_en = "📌 Buy Method: Cut size 50%; only place limit orders at 4H Fib 0.5/0.618 + MA confluences."
    else:
        mood = "balanced"
        if smh >= 0.5 or qqq >= 0.4:
            mood_zh = "🌤 美股盘面温和偏强 · 半导体/纳指领涨"
            mood_en = "🌤 US Equities Mildly Bullish"
        elif smh <= -0.5 or qqq <= -0.4:
            mood_zh = "☁️ 美股盘面温和偏弱 · 资金略显谨慎"
            mood_en = "☁️ US Equities Mildly Cautious"
        else:
            mood_zh = "🧭 美股/ETF 盘面平稳 · 跟随本周期双均线纪律"
            mood_en = "🧭 Balanced Macro · Follow Dual MA Rules"
        wick_level = "low"
        wick_zh = "🔍 当前美股与 ETF 资金流向平稳，按 1H/4H 双均线大势锁执行即可，留意盘中突发行情。"
        wick_en = "🔍 Steady ETF flows; follow HTF Dual MA rules."
        buy_zh = "📌 购买方法：大周期白线在黄线上方时等回踩白线分批进场；大势锁死时管住手（或只等反抽白线受阻做空/买Put）。"
        buy_en = "📌 Buy Method: Buy pullbacks to white MA when HTF is bullish; stay flat or short bounces when locked."

    if in_us_open_window or hot_30m:
        wick_level = "high"
        extras_zh = []
        extras_en = []
        if in_us_open_window:
            extras_zh.append("美股开盘/盘前数据高危扫损窗口(20:30~23:30)")
            extras_en.append("US Open Volatility Window")
        if hot_30m:
            snippet = hot_30m[0]["text"][:32]
            extras_zh.append(f"30分内突发重磅({len(hot_30m)}条)：{snippet}...")
            extras_en.append(f"{len(hot_30m)} breaking news in 30m")
        wick_zh = f"{wick_zh} 【{'；'.join(extras_zh)}】"
        wick_en = f"{wick_en} [{' | '.join(extras_en)}]"

    if cycle.get("squeeze_warning_zh"):
        wick_level = "high"

    return {
        "mood": mood,
        "mood_zh": mood_zh,
        "mood_en": mood_en,
        "wick_level": wick_level,
        "wick_warning_zh": wick_zh,
        "wick_warning_en": wick_en,
        "buy_method_zh": buy_zh,
        "buy_method_en": buy_en,
        "in_us_open_window": in_us_open_window,
        "hot_30m_count": len(hot_30m),
        "target_context": f"{market}:{symbol}",
    }


async def fetch_macro_intelligence(market: str = "crypto", symbol: str = "BTCUSDT", force: bool = False) -> Dict[str, Any]:
    etf_bundle, news_bundle, cycle = await asyncio.gather(
        fetch_etf_flows(force=force),
        fetch_breaking_news(),
        compute_bull_bear_cycle(market, symbol, force=force),
    )

    guidance = build_macro_guidance(
        by_sym=etf_bundle["by_sym"],
        water_sources=etf_bundle["water_sources"],
        cycle=cycle,
        news=news_bundle["news"],
        market=market,
        symbol=symbol,
    )

    return {
        "etfs": etf_bundle["etfs"],
        "water_sources": etf_bundle["water_sources"],
        "cycle": cycle,
        "guidance": guidance,
        "news": news_bundle["news"],
        "within_30m_count": news_bundle["within_30m_count"],
        "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
    }
