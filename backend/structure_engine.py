"""
structure_engine.py — 纯 Python 缠论与多因子结构分析引擎
支持无未来函数的任意 K 线切片（用于历史回放）。
"""

from typing import List, Dict, Any, Tuple
import math


def _ema(values: List[float], period: int) -> List[float]:
    if not values:
        return []
    k = 2.0 / (period + 1)
    result = [values[0]]
    for v in values[1:]:
        result.append(v * k + result[-1] * (1.0 - k))
    return result


def _sma(values: List[float], period: int) -> List[float]:
    if not values:
        return []
    out: List[float] = []
    acc = 0.0
    for i, v in enumerate(values):
        acc += v
        if i >= period:
            acc -= values[i - period]
        denom = period if i >= period - 1 else (i + 1)
        out.append(acc / denom)
    return out


def compute_vwap(candles: List[Dict[str, Any]], interval: str = "1h") -> Dict[str, Any]:
    """计算日内锚定 VWAP（1m~1h 按自然日重置）或 20 根滚动 VWAP（4h~1w）。"""
    if not candles:
        return {"line": [], "current": 0.0, "dist_pct": 0.0, "above": True}

    intraday = interval in ("1m", "5m", "15m", "30m", "1h")
    line: List[Dict[str, Any]] = []

    if intraday:
        cur_day = -1
        cum_pv = 0.0
        cum_v = 0.0
        for c in candles:
            day = int(c["time"]) // 86400
            if day != cur_day:
                cur_day = day
                cum_pv = 0.0
                cum_v = 0.0
            tp = (c["high"] + c["low"] + c["close"]) / 3.0
            vol = c.get("volume", 0.0) or 0.0
            if vol > 0:
                cum_pv += tp * vol
                cum_v += vol
                vwap_val = cum_pv / cum_v
            else:
                vwap_val = c["close"] if cum_v == 0 else (cum_pv / cum_v)
            line.append({"time": c["time"], "value": round(vwap_val, 4)})
    else:
        window = 20
        for i in range(len(candles)):
            sub = candles[max(0, i - window + 1) : i + 1]
            pv = 0.0
            vv = 0.0
            for c in sub:
                tp = (c["high"] + c["low"] + c["close"]) / 3.0
                vol = c.get("volume", 0.0) or 0.0
                pv += tp * vol
                vv += vol
            vwap_val = (pv / vv) if vv > 0 else candles[i]["close"]
            line.append({"time": candles[i]["time"], "value": round(vwap_val, 4)})

    last_vwap = line[-1]["value"] if line else candles[-1]["close"]
    last_close = candles[-1]["close"]
    dist_pct = ((last_close - last_vwap) / last_vwap * 100.0) if last_vwap else 0.0
    return {
        "line": line,
        "current": round(last_vwap, 4),
        "dist_pct": round(dist_pct, 2),
        "above": last_close >= last_vwap,
    }


def compute_dual_ma(
    candles: List[Dict[str, Any]],
    ma_type: str = "ema",
    fast_period: int = 20,
    slow_period: int = 60,
) -> Dict[str, Any]:
    if not candles:
        return {
            "ma_type": ma_type,
            "fast_period": fast_period,
            "slow_period": slow_period,
            "fast_line": [],
            "slow_line": [],
            "crosses": [],
            "fast_val": 0.0,
            "slow_val": 0.0,
            "spread_pct": 0.0,
            "trend": "neutral",
            "trend_label_zh": "数据不足",
            "trend_label_en": "Insufficient Data",
        }

    closes = [c["close"] for c in candles]
    fn = _sma if ma_type.lower() == "sma" else _ema
    fast_vals = fn(closes, max(2, fast_period))
    slow_vals = fn(closes, max(3, slow_period))

    fast_line = [{"time": c["time"], "value": round(v, 4)} for c, v in zip(candles, fast_vals)]
    slow_line = [{"time": c["time"], "value": round(v, 4)} for c, v in zip(candles, slow_vals)]

    crosses: List[Dict[str, Any]] = []
    for i in range(1, len(candles)):
        prev_diff = fast_vals[i - 1] - slow_vals[i - 1]
        curr_diff = fast_vals[i] - slow_vals[i]
        if prev_diff <= 0 < curr_diff:
            crosses.append({
                "time": candles[i]["time"],
                "price": round(candles[i]["low"], 4),
                "type": "golden",
                "label": f"金叉 {fast_period}/{slow_period}",
            })
        elif prev_diff >= 0 > curr_diff:
            crosses.append({
                "time": candles[i]["time"],
                "price": round(candles[i]["high"], 4),
                "type": "death",
                "label": f"死叉 {fast_period}/{slow_period}",
            })

    last_price = closes[-1]
    f_last = fast_vals[-1]
    s_last = slow_vals[-1]
    spread_pct = ((f_last - s_last) / s_last * 100.0) if s_last else 0.0
    dist_fast_pct = ((last_price - f_last) / f_last * 100.0) if f_last else 0.0

    if abs(spread_pct) < 0.35:
        trend = "tangled"
        label_zh = "麻绳缠绕 · 铁律空仓"
        label_en = "Tangled Chop · Stay Flat"
    elif f_last > s_last and -1.2 <= dist_fast_pct <= 1.2:
        trend = "pullback_buy"
        label_zh = "多头发散 · 回踩买点"
        label_en = "Bullish Pullback Buy"
    elif f_last > s_last and dist_fast_pct > 3.5:
        trend = "overextended"
        label_zh = "多头加速 · 勿追高"
        label_en = "Extended · Wait Pullback"
    elif f_last > s_last and last_price >= s_last:
        trend = "bullish"
        label_zh = "多头排列 · 均线上行"
        label_en = "Bullish Alignment"
    elif f_last > s_last:
        trend = "pullback"
        label_zh = "多头回踩 · 关注慢线"
        label_en = "Testing Slow MA"
    elif f_last < s_last and last_price <= f_last * 1.003:
        trend = "bearish"
        label_zh = "大势锁死 · 空头排列"
        label_en = "Bearish Lock · Stay Flat"
    else:
        trend = "rebound"
        label_zh = "空头反抽 · 承压观望"
        label_en = "Bearish Rebound"

    return {
        "ma_type": ma_type.lower(),
        "fast_period": fast_period,
        "slow_period": slow_period,
        "fast_line": fast_line,
        "slow_line": slow_line,
        "crosses": crosses[-10:],
        "fast_val": round(f_last, 4),
        "slow_val": round(s_last, 4),
        "spread_pct": round(spread_pct, 2),
        "dist_fast_pct": round(dist_fast_pct, 2),
        "trend": trend,
        "trend_label_zh": label_zh,
        "trend_label_en": label_en,
    }


def compute_fibonacci_confluence(
    candles: List[Dict[str, Any]],
    dual_ma: Dict[str, Any],
    lookback: int = 120,
) -> Dict[str, Any]:
    window = candles[-lookback:] if len(candles) > lookback else candles
    if len(window) < 10:
        return {
            "direction": "up",
            "swing_high": 0.0,
            "swing_low": 0.0,
            "levels": [],
            "confluence": False,
            "match_label_zh": "样本不足",
            "match_label_en": "Insufficient data",
        }

    high_idx = max(range(len(window)), key=lambda i: window[i]["high"])
    low_idx = min(range(len(window)), key=lambda i: window[i]["low"])
    swing_high = window[high_idx]["high"]
    swing_low = window[low_idx]["low"]
    span = swing_high - swing_low
    if span <= 0:
        return {
            "direction": "up",
            "swing_high": round(swing_high, 4),
            "swing_low": round(swing_low, 4),
            "levels": [],
            "confluence": False,
            "match_label_zh": "无明显波段",
            "match_label_en": "No clear swing",
        }

    # 若低点在先、高点在后，说明主波段向上，回撤从高点往下算；反之从低点往上算反抽
    if low_idx < high_idx:
        direction = "up"
        levels = [
            {"ratio": "0.382", "price": round(swing_high - span * 0.382, 4)},
            {"ratio": "0.5", "price": round(swing_high - span * 0.5, 4)},
            {"ratio": "0.618", "price": round(swing_high - span * 0.618, 4)},
        ]
    else:
        direction = "down"
        levels = [
            {"ratio": "0.382", "price": round(swing_low + span * 0.382, 4)},
            {"ratio": "0.5", "price": round(swing_low + span * 0.5, 4)},
            {"ratio": "0.618", "price": round(swing_low + span * 0.618, 4)},
        ]

    fast_v = dual_ma.get("fast_val", 0.0)
    slow_v = dual_ma.get("slow_val", 0.0)
    matches = []
    for lv in levels:
        lp = lv["price"]
        if lp <= 0:
            continue
        if fast_v and abs(fast_v - lp) / lp <= 0.012:
            matches.append((lv["ratio"], "白线", "Fast MA"))
        elif slow_v and abs(slow_v - lp) / lp <= 0.012:
            matches.append((lv["ratio"], "黄线", "Slow MA"))

    if matches:
        ratio, ma_zh, ma_en = matches[0]
        return {
            "direction": direction,
            "swing_high": round(swing_high, 4),
            "swing_low": round(swing_low, 4),
            "levels": levels,
            "confluence": True,
            "match_label_zh": f"★ 黄金共振：{ratio} 与{ma_zh}重合",
            "match_label_en": f"★ Confluence: {ratio} aligns with {ma_en}",
        }

    return {
        "direction": direction,
        "swing_high": round(swing_high, 4),
        "swing_low": round(swing_low, 4),
        "levels": levels,
        "confluence": False,
        "match_label_zh": "未共振（常规走势，以双均线为准）",
        "match_label_en": "No MA alignment (follow Dual MA)",
    }


def detect_consolidation_regime(
    candles: List[Dict[str, Any]],
    dual_ma: Dict[str, Any],
    market: str = "crypto",
) -> Dict[str, Any]:
    """识别盘中实时状态：压力震荡(下跌中继) / 麻绳缠绕 / 支撑蓄势 / 单边趋势"""
    if len(candles) < 20 or not dual_ma.get("fast_line"):
        return {
            "state": "trend",
            "title_zh": "等待更多 K 线",
            "title_en": "Loading",
            "desc_zh": "数据加载中",
            "desc_en": "Loading",
            "range_pct": 0.0,
            "markers": [],
        }

    fast_line = dual_ma["fast_line"]
    slow_line = dual_ma["slow_line"]

    # 扫描最近一段历史中连续窄幅横盘区间，给图表打点
    markers: List[Dict[str, Any]] = []
    last_m_idx = -99
    for i in range(12, len(candles)):
        win = candles[i - 6 : i + 1]
        hi = max(c["high"] for c in win)
        lo = min(c["low"] for c in win)
        mid = (hi + lo) / 2.0 or 1.0
        rng_pct = (hi - lo) / mid * 100.0
        f_v = fast_line[i]["value"]
        s_v = slow_line[i]["value"]
        # 6根K线振幅收窄且在均线下方受压
        if rng_pct <= 2.4 and hi <= s_v * 1.005 and f_v < s_v and (i - last_m_idx) >= 10:
            markers.append({
                "time": candles[i]["time"],
                "type": "bear_chop",
                "label": "压力震荡",
            })
            last_m_idx = i

    # 当前最新盘中状态
    recent = candles[-7:]
    r_hi = max(c["high"] for c in recent)
    r_lo = min(c["low"] for c in recent)
    r_mid = (r_hi + r_lo) / 2.0 or 1.0
    cur_range_pct = round((r_hi - r_lo) / r_mid * 100.0, 2)

    ma_trend = dual_ma["trend"]
    spread = abs(dual_ma.get("spread_pct", 0.0))

    if ma_trend == "tangled" or spread < 0.35:
        return {
            "state": "tangled",
            "title_zh": "⚠️ 麻绳缠绕震荡",
            "title_en": "Tangled Chop",
            "desc_zh": f"白黄均线粘合（剪刀差 {dual_ma['spread_pct']:+.2f}%），近7根振幅 {cur_range_pct}%，无方向洗盘，铁律空仓！",
            "desc_en": f"MAs tangled ({dual_ma['spread_pct']:+.2f}%); stay flat.",
            "range_pct": cur_range_pct,
            "markers": markers[-6:],
        }

    if ma_trend in ("bearish", "rebound") and cur_range_pct <= 3.0:
        return {
            "state": "bear_chop",
            "title_zh": "⚠️ 压力震荡（下跌中继）",
            "title_en": "Bearish Consolidation",
            "desc_zh": f"被压在白/黄均线下方窄幅横盘（近7根振幅 {cur_range_pct}%），属于空头换手蓄力，谨防随时向下加速砸盘！",
            "desc_en": f"Tight chop below MAs ({cur_range_pct}%); watch for breakdown.",
            "range_pct": cur_range_pct,
            "markers": markers[-6:],
        }

    if ma_trend in ("pullback_buy", "bullish", "pullback") and cur_range_pct <= 3.0:
        return {
            "state": "bull_chop",
            "title_zh": "✅ 支撑蓄势震荡",
            "title_en": "Bullish Consolidation",
            "desc_zh": f"均线多头排列且在白线附近窄幅蓄势（振幅 {cur_range_pct}%），留意回踩企稳后的向上突破机会！",
            "desc_en": f"Tight consolidation above MA support ({cur_range_pct}%).",
            "range_pct": cur_range_pct,
            "markers": markers[-6:],
        }

    if ma_trend in ("bearish", "rebound"):
        bear_desc = (
            f"空头趋势展开中（近7根振幅 {cur_range_pct}%），现货/3x ETF 请持现金观望勿抄底；期权仅等反抽白线受阻买 Put。"
            if market == "us"
            else f"空头趋势展开中（近7根振幅 {cur_range_pct}%），勿盲目抄底，只等反抽白线受阻做空/买Put。"
        )
        return {
            "state": "bear_trend",
            "title_zh": "🔻 空头单边下行",
            "title_en": "Bearish Trend",
            "desc_zh": bear_desc,
            "desc_en": f"Downtrend active ({cur_range_pct}%); do not catch falling knives.",
            "range_pct": cur_range_pct,
            "markers": markers[-6:],
        }

    return {
        "state": "bull_trend",
        "title_zh": "🚀 多头趋势展开",
        "title_en": "Bullish Trend",
        "desc_zh": f"多头趋势运行中（近7根振幅 {cur_range_pct}%），白线在黄线上方，顺势持有/回踩白线低多。",
        "desc_en": f"Uptrend active ({cur_range_pct}%); buy pullbacks to fast MA.",
        "range_pct": cur_range_pct,
        "markers": markers[-6:],
    }


def compute_macd(candles: List[Dict[str, Any]], fast: int = 12, slow: int = 26, signal: int = 9) -> List[Dict[str, Any]]:
    if not candles:
        return []
    closes = [c["close"] for c in candles]
    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    dif = [f - s for f, s in zip(ema_fast, ema_slow)]
    dea = _ema(dif, signal)
    out = []
    for i, c in enumerate(candles):
        hist = (dif[i] - dea[i]) * 2.0
        out.append({
            "time": c["time"],
            "dif": round(dif[i], 4),
            "dea": round(dea[i], 4),
            "hist": round(hist, 4),
        })
    return out


def _merge_containment(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """K线包含处理，保留原始索引和时间戳用于定位极值。"""
    if len(candles) < 2:
        return [{"idx": i, **c} for i, c in enumerate(candles)]

    merged: List[Dict[str, Any]] = []
    direction = 1  # 1=up, -1=down
    for i, c in enumerate(candles):
        item = {
            "idx": i,
            "time": c["time"],
            "high": c["high"],
            "low": c["low"],
            "open": c["open"],
            "close": c["close"],
        }
        if not merged:
            merged.append(item)
            continue

        prev = merged[-1]
        is_contained = (
            (prev["high"] >= item["high"] and prev["low"] <= item["low"]) or
            (item["high"] >= prev["high"] and item["low"] <= prev["low"])
        )
        if is_contained:
            if direction >= 0:
                new_high = max(prev["high"], item["high"])
                new_low = max(prev["low"], item["low"])
                use_cur = item["high"] >= prev["high"]
            else:
                new_high = min(prev["high"], item["high"])
                new_low = min(prev["low"], item["low"])
                use_cur = item["low"] <= prev["low"]
            prev["high"] = new_high
            prev["low"] = new_low
            if use_cur:
                prev["idx"] = item["idx"]
                prev["time"] = item["time"]
        else:
            if item["high"] > prev["high"] and item["low"] > prev["low"]:
                direction = 1
            elif item["high"] < prev["high"] and item["low"] < prev["low"]:
                direction = -1
            merged.append(item)
    return merged


def _detect_fractals(merged: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    fractals: List[Dict[str, Any]] = []
    for i in range(1, len(merged) - 1):
        p, c, n = merged[i - 1], merged[i], merged[i + 1]
        if c["high"] > p["high"] and c["high"] > n["high"] and c["low"] > p["low"] and c["low"] > n["low"]:
            fractals.append({
                "merged_idx": i,
                "index": c["idx"],
                "time": c["time"],
                "price": c["high"],
                "type": "top",
            })
        elif c["low"] < p["low"] and c["low"] < n["low"] and c["high"] < p["high"] and c["high"] < n["high"]:
            fractals.append({
                "merged_idx": i,
                "index": c["idx"],
                "time": c["time"],
                "price": c["low"],
                "type": "bottom",
            })
    return fractals


def _build_strokes(fractals: List[Dict[str, Any]], candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(fractals) < 2:
        return []

    selected: List[Dict[str, Any]] = [fractals[0]]
    for f in fractals[1:]:
        last = selected[-1]
        if f["type"] == last["type"]:
            # 同向分型取更极值
            if (f["type"] == "top" and f["price"] > last["price"]) or (
                f["type"] == "bottom" and f["price"] < last["price"]
            ):
                selected[-1] = f
        else:
            # 异向分型需满足至少间隔4根原始K线且价格合理
            if f["index"] - last["index"] >= 4:
                if (last["type"] == "bottom" and f["price"] > last["price"]) or (
                    last["type"] == "top" and f["price"] < last["price"]
                ):
                    selected.append(f)

    strokes: List[Dict[str, Any]] = []
    for i in range(len(selected) - 1):
        a, b = selected[i], selected[i + 1]
        strokes.append({
            "start_idx": a["index"],
            "end_idx": b["index"],
            "start_time": a["time"],
            "end_time": b["time"],
            "start_price": round(a["price"], 4),
            "end_price": round(b["price"], 4),
            "direction": "up" if b["price"] > a["price"] else "down",
        })
    return strokes


def _build_segments(strokes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """简化特征序列线段划分：至少3笔且突破前同向极值时延续，否则转向。"""
    if len(strokes) < 3:
        return []

    segments: List[Dict[str, Any]] = []
    seg_start = strokes[0]
    cur_dir = strokes[0]["direction"]
    cur_extreme = strokes[0]["end_price"]
    cur_end = strokes[0]

    i = 1
    while i < len(strokes):
        s = strokes[i]
        if s["direction"] == cur_dir:
            if (cur_dir == "up" and s["end_price"] >= cur_extreme) or (
                cur_dir == "down" and s["end_price"] <= cur_extreme
            ):
                cur_extreme = s["end_price"]
                cur_end = s
            else:
                # 未创新高/新低，检查下一笔是否反向破坏前段特征
                if i + 1 < len(strokes):
                    nxt = strokes[i + 1]
                    if (cur_dir == "up" and nxt["end_price"] < s["start_price"] * 0.998) or (
                        cur_dir == "down" and nxt["end_price"] > s["start_price"] * 1.002
                    ):
                        segments.append({
                            "start_time": seg_start["start_time"],
                            "end_time": cur_end["end_time"],
                            "start_price": seg_start["start_price"],
                            "end_price": cur_end["end_price"],
                            "direction": cur_dir,
                        })
                        seg_start = s
                        cur_dir = s["direction"]
                        cur_extreme = s["end_price"]
                        cur_end = s
        i += 1

    segments.append({
        "start_time": seg_start["start_time"],
        "end_time": cur_end["end_time"],
        "start_price": seg_start["start_price"],
        "end_price": cur_end["end_price"],
        "direction": cur_dir,
    })
    return segments


def _build_centers(strokes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """连续3笔重叠区间构成中枢 (ZG = min(highs), ZD = max(lows))。"""
    if len(strokes) < 3:
        return []

    centers: List[Dict[str, Any]] = []
    i = 0
    while i <= len(strokes) - 3:
        s1, s2, s3 = strokes[i], strokes[i + 1], strokes[i + 2]
        h1, l1 = max(s1["start_price"], s1["end_price"]), min(s1["start_price"], s1["end_price"])
        h2, l2 = max(s2["start_price"], s2["end_price"]), min(s2["start_price"], s2["end_price"])
        h3, l3 = max(s3["start_price"], s3["end_price"]), min(s3["start_price"], s3["end_price"])

        zg = min(h1, h2, h3)
        zd = max(l1, l2, l3)
        if zg > zd:
            gg = max(h1, h2, h3)
            dd = min(l1, l2, l3)
            end_time = s3["end_time"]
            j = i + 3
            while j < len(strokes):
                sj = strokes[j]
                hj, lj = max(sj["start_price"], sj["end_price"]), min(sj["start_price"], sj["end_price"])
                if lj <= zg and hj >= zd:
                    gg = max(gg, hj)
                    dd = min(dd, lj)
                    end_time = sj["end_time"]
                    j += 1
                else:
                    break
            centers.append({
                "start_time": s1["start_time"],
                "end_time": end_time,
                "zg": round(zg, 4),
                "zd": round(zd, 4),
                "gg": round(gg, 4),
                "dd": round(dd, 4),
                "level": "笔中枢",
            })
            i = j
        else:
            i += 1
    return centers


def _detect_signals(strokes: List[Dict[str, Any]], macd: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """基于相邻同向笔的 MACD 柱面积/峰值对比识别顶底背驰历史信号。"""
    if len(strokes) < 4 or not macd:
        return []

    signals: List[Dict[str, Any]] = []
    for i in range(2, len(strokes)):
        prev_s = strokes[i - 2]
        curr_s = strokes[i]
        if prev_s["direction"] != curr_s["direction"]:
            continue

        prev_hist = [abs(m["hist"]) for m in macd[prev_s["start_idx"]: prev_s["end_idx"] + 1]]
        curr_hist = [abs(m["hist"]) for m in macd[curr_s["start_idx"]: curr_s["end_idx"] + 1]]
        if not prev_hist or not curr_hist:
            continue

        prev_power = sum(prev_hist)
        curr_power = sum(curr_hist)

        if curr_s["direction"] == "up" and curr_s["end_price"] > prev_s["end_price"] and curr_power < prev_power * 0.85:
            signals.append({
                "time": curr_s["end_time"],
                "price": curr_s["end_price"],
                "type": "top_div",
                "label": "顶背力度减弱",
            })
        elif curr_s["direction"] == "down" and curr_s["end_price"] < prev_s["end_price"] and curr_power < prev_power * 0.85:
            signals.append({
                "time": curr_s["end_time"],
                "price": curr_s["end_price"],
                "type": "bottom_div",
                "label": "底背力度衰竭",
            })
    return signals[-12:]


def _compute_similar_samples(candles: List[Dict[str, Any]], window: int = 15, horizon: int = 12) -> Dict[str, Any]:
    if len(candles) < window + horizon + 20:
        return {"count": 0, "up_pct": 33, "flat_pct": 34, "down_pct": 33, "horizon": horizon}

    def _norm_returns(seq: List[Dict[str, Any]]) -> List[float]:
        base = seq[0]["close"] or 1.0
        return [(c["close"] - base) / base for c in seq]

    target = _norm_returns(candles[-window:])
    t_norm = math.sqrt(sum(x * x for x in target)) or 1e-9

    matches: List[float] = []
    limit_idx = len(candles) - window - horizon
    for i in range(0, limit_idx, 2):
        cand = _norm_returns(candles[i: i + window])
        c_norm = math.sqrt(sum(x * x for x in cand)) or 1e-9
        cos_sim = sum(a * b for a, b in zip(target, cand)) / (t_norm * c_norm)
        if cos_sim >= 0.78:
            future_ret = (candles[i + window + horizon - 1]["close"] - candles[i + window - 1]["close"]) / (
                candles[i + window - 1]["close"] or 1.0
            )
            matches.append(future_ret)

    if not matches:
        return {"count": 0, "up_pct": 33, "flat_pct": 34, "down_pct": 33, "horizon": horizon}

    up = sum(1 for r in matches if r > 0.008)
    down = sum(1 for r in matches if r < -0.008)
    flat = len(matches) - up - down
    n = len(matches)
    up_pct = round(up / n * 100)
    down_pct = round(down / n * 100)
    flat_pct = max(0, 100 - up_pct - down_pct)
    return {
        "count": n,
        "up_pct": up_pct,
        "flat_pct": flat_pct,
        "down_pct": down_pct,
        "horizon": horizon,
    }


def _build_trade_plans(
    candles: List[Dict[str, Any]],
    centers: List[Dict[str, Any]],
    strokes: List[Dict[str, Any]],
    dual_ma: Dict[str, Any] = None,
) -> Dict[str, Any]:
    last_c = candles[-1]
    price = last_c["close"]
    last_t = last_c["time"]
    dt = (candles[-1]["time"] - candles[-2]["time"]) if len(candles) >= 2 else 3600

    recent_high = max(c["high"] for c in candles[-40:])
    recent_low = min(c["low"] for c in candles[-40:])
    span = max(recent_high - recent_low, price * 0.015)

    zg = centers[-1]["zg"] if centers else price + span * 0.25
    zd = centers[-1]["zd"] if centers else price - span * 0.25
    mid = (zg + zd) / 2.0

    # 多头计划（锚定现价或近端支撑，避免区间过宽）
    b_anchor = zd if abs(zd - price) / (price or 1.0) < 0.04 else price
    b_entry_low = round(min(b_anchor * 0.992, price * 0.992), 4)
    b_entry_high = round(max(b_anchor * 1.005, price * 1.003), 4)
    b_stop = round(max(min(recent_low, b_entry_low) * 0.988, price * 0.95), 4)
    b_t1 = round(max(zg if zg > price else price * 1.02, price * 1.018), 4)
    b_t2 = round(max(b_t1 * 1.022, price * 1.04), 4)
    b_triggered = b_entry_low <= price <= b_entry_high or price > zd

    # 空头计划（锚定现价或近端压力，避免区间过宽）
    s_anchor = zg if abs(zg - price) / (price or 1.0) < 0.04 else price
    s_entry_low = round(min(s_anchor * 0.995, price * 0.997), 4)
    s_entry_high = round(max(s_anchor * 1.008, price * 1.008), 4)
    s_stop = round(min(max(recent_high, s_entry_high) * 1.012, price * 1.05), 4)
    s_t1 = round(min(zd if zd < price else price * 0.98, price * 0.982), 4)
    s_t2 = round(min(s_t1 * 0.978, price * 0.96), 4)
    s_triggered = s_entry_low <= price <= s_entry_high or price < zg

    def _make_path(target_1: float, target_2: float, alt_target: float) -> Dict[str, List[Dict[str, Any]]]:
        primary = [
            {"time": last_t, "value": round(price, 4)},
            {"time": last_t + dt * 3, "value": round((price + mid) / 2.0, 4)},
            {"time": last_t + dt * 7, "value": target_1},
            {"time": last_t + dt * 12, "value": target_2},
        ]
        secondary = [
            {"time": last_t, "value": round(price, 4)},
            {"time": last_t + dt * 4, "value": round(mid, 4)},
            {"time": last_t + dt * 10, "value": alt_target},
        ]
        return {"primary": primary, "secondary": secondary}

    ma_trend = dual_ma.get("trend", "") if dual_ma else ""
    bull_locked = ma_trend in ("bearish", "rebound", "tangled")
    bull_status = (
        "大势锁死 · 禁止抄底"
        if ma_trend in ("bearish", "rebound")
        else ("缠绕震荡 · 观望" if ma_trend == "tangled" else ("已触发" if b_triggered else "等待触发"))
    )

    return {
        "bull_plan": {
            "side": "bull",
            "status": bull_status,
            "locked": bull_locked,
            "entry_low": b_entry_low,
            "entry_high": b_entry_high,
            "t1": b_t1,
            "t2": b_t2,
            "stop_loss": b_stop,
            "projection_paths": _make_path(b_t1, b_t2, b_stop),
        },
        "bear_plan": {
            "side": "bear",
            "status": "已触发" if s_triggered else "等待触发",
            "entry_low": s_entry_low,
            "entry_high": s_entry_high,
            "t1": s_t1,
            "t2": s_t2,
            "stop_loss": s_stop,
            "projection_paths": _make_path(s_t1, s_t2, s_stop),
        },
    }


def _build_buy_advice(
    candles: List[Dict[str, Any]],
    dual_ma: Dict[str, Any],
    bull_pct: int,
    last_center: Any,
    signals: List[Dict[str, Any]],
    plans: Dict[str, Any],
    interval: str = "1h",
) -> Dict[str, Any]:
    price = candles[-1]["close"]
    ma_trend = dual_ma["trend"]
    ma_name = f"{dual_ma['ma_type'].upper()}{dual_ma['fast_period']}/{dual_ma['slow_period']}"
    bull_plan = plans["bull_plan"]

    score = 0
    reasons_zh: List[str] = []
    reasons_en: List[str] = []

    # 1. 双均线大势锁 + 麻绳区过滤 + 回踩买点
    fast_v = dual_ma["fast_val"]
    slow_v = dual_ma["slow_val"]
    if ma_trend == "tangled":
        score -= 10
        reasons_zh.append(f"{ma_name} 处于麻绳缠绕区（剪刀差仅 {dual_ma['spread_pct']:+.2f}%），铁律空仓防磨损")
        reasons_en.append(f"{ma_name} tangled in chop ({dual_ma['spread_pct']:+.2f}%); stay flat")
    elif ma_trend == "pullback_buy":
        score += 45
        reasons_zh.append(f"{ma_name} 多头发散且回踩快线 ({fast_v}) 附近，触发「回踩确认买点」")
        reasons_en.append(f"{ma_name} bullish pullback near fast MA ({fast_v}); ideal entry zone")
    elif ma_trend == "overextended":
        score += 10
        reasons_zh.append(f"{ma_name} 多头但乖离率偏高（+{dual_ma.get('dist_fast_pct', 0):.2f}%），勿追高，等回踩快线")
        reasons_en.append(f"{ma_name} overextended (+{dual_ma.get('dist_fast_pct', 0):.2f}%); wait for pullback")
    elif ma_trend == "bullish":
        score += 32
        reasons_zh.append(f"{ma_name} 呈多头排列，大势锁解锁（剪刀差 {dual_ma['spread_pct']:+.2f}%）")
        reasons_en.append(f"{ma_name} bullishly aligned; trend lock open ({dual_ma['spread_pct']:+.2f}%)")
    elif ma_trend == "pullback":
        score += 15
        reasons_zh.append(f"{ma_name} 回踩测试慢线 ({slow_v}) 支撑，有效守住再考虑分批")
        reasons_en.append(f"{ma_name} testing slow MA ({slow_v}) support")
    elif ma_trend == "rebound":
        score -= 25
        reasons_zh.append(f"{ma_name} 处于空头大势锁下的反抽，任何反弹一律不追")
        reasons_en.append(f"{ma_name} bearish lock rebound; do not chase")
    else:
        score -= 45
        reasons_zh.append(f"{ma_name} 空头大势锁死（快线 < 慢线），100% 空仓观望")
        reasons_en.append(f"{ma_name} bearish trend lock (Fast < Slow); 100% flat")

    # 2. 缠论结构偏向与中枢位置
    if bull_pct >= 60:
        score += 30
        reasons_zh.append(f"多空结构倾向偏多（{bull_pct}%），结构共振较强")
        reasons_en.append(f"Structure bias strongly bullish ({bull_pct}%)")
    elif bull_pct >= 52:
        score += 15
        reasons_zh.append(f"结构略偏多（{bull_pct}%），可结合回踩确认")
        reasons_en.append(f"Structure mildly bullish ({bull_pct}%)")
    else:
        score -= 20
        reasons_zh.append(f"空方结构占优（多方仅 {bull_pct}%），等待右侧企稳信号")
        reasons_en.append(f"Bearish structure dominant (Bull {bull_pct}%); wait for reversal")

    if last_center:
        if price > last_center["zg"]:
            score += 15
            reasons_zh.append(f"价格位于中枢上沿 ZG ({last_center['zg']}) 上方，关注三买回踩")
            reasons_en.append(f"Price above center ZG ({last_center['zg']}); watch 3rd-buy retest")
        elif price < last_center["zd"]:
            score -= 15
            reasons_zh.append(f"价格跌破中枢下沿 ZD ({last_center['zd']})，谨防延续下探")
            reasons_en.append(f"Price below center ZD ({last_center['zd']}); downside risk")
        else:
            reasons_zh.append(f"价格在中枢区间 ({last_center['zd']} - {last_center['zg']}) 内震荡")
            reasons_en.append(f"Consolidating inside center ({last_center['zd']} - {last_center['zg']})")

    # 3. 近期背驰信号加减分
    if signals:
        last_sig = signals[-1]
        if last_sig["type"] == "bottom_div":
            score += 15
            reasons_zh.append("近期出现底背驰力度衰竭信号，存在反弹/反转预期")
            reasons_en.append("Recent bottom divergence detected; rebound potential")
        elif last_sig["type"] == "top_div":
            score -= 15
            reasons_zh.append("近期出现顶背驰力度减弱信号，注意追高风险")
            reasons_en.append("Recent top divergence detected; avoid chasing highs")

    confidence = max(12, min(94, 50 + score))

    # 硬性大势锁与麻绳缠绕保护 + V3.2 暴跌熔断防接飞刀
    crash_lock = False
    if interval in ("4h", "1d", "1w") and len(candles) >= 4:
        ref3 = candles[-4]["close"]
        ret_3 = ((price - ref3) / ref3 * 100.0) if ref3 else 0.0
        last_high = candles[-1]["high"]
        flush_pct = ((price - last_high) / last_high * 100.0) if last_high else 0.0
        if ret_3 <= -10.0 or flush_pct <= -6.0:
            crash_lock = True
            reasons_zh.insert(0, f"触发 V3.2 暴跌熔断（3K跌幅 {ret_3:+.1f}% / 冲高回落 {flush_pct:+.1f}%），严禁左侧接飞刀")
            reasons_en.insert(0, f"V3.2 Crash Breaker active ({ret_3:+.1f}% / flush {flush_pct:+.1f}%); no catching knives")

    if crash_lock:
        action, action_zh, action_en = "AVOID", "暴跌熔断 · 禁接飞刀", "CRASH LOCK · NO KNIFE"
        pos_zh, pos_en = "建议 0% 空仓冷却（触发暴跌熔断锁，等右侧止跌放量阳线）", "0% Cash (Crash Breaker Cooldown)"
    elif ma_trend in ("bearish", "rebound"):
        action, action_zh, action_en = "AVOID", "大势锁死 · 空仓", "BEAR LOCK · FLAT"
        pos_zh, pos_en = "建议 0% 空仓观望（绝不逆势抄底）", "0% Cash (Strict Trend Lock)"
    elif ma_trend == "tangled":
        action, action_zh, action_en = "WAIT", "缠绕震荡 · 观望", "CHOP · WAIT"
        pos_zh, pos_en = "建议 0% 空仓等待均线发散开口", "0% Cash (Wait for Expansion)"
    elif ma_trend == "overextended":
        action, action_zh, action_en = "WAIT", "勿追高 · 等回踩", "WAIT PULLBACK"
        pos_zh, pos_en = f"等回踩 {fast_v} 附近再分批介入", f"Wait pullback near {fast_v}"
    elif score >= 45:
        action, action_zh, action_en = "BUY", "建议买入", "BUY"
        pos_zh, pos_en = "建议 40%-50%（盈利+15%先锁一半，底仓移动保本）", "40%-50% (Lock 50% at +15%)"
    elif score >= 15:
        action, action_zh, action_en = "ACCUMULATE", "逢低分批", "ACCUMULATE"
        pos_zh, pos_en = f"建议 20%-30%（贴近 {fast_v} 轻仓试多）", f"20%-30% near {fast_v}"
    else:
        action, action_zh, action_en = "WAIT", "观望等待", "WAIT"
        pos_zh, pos_en = "建议 0%-10%（等待结构共振）", "0%-10% (Wait confirmation)"

    if action == "AVOID":
        confidence = min(confidence, 35)
    elif action == "WAIT":
        confidence = min(confidence, 55)

    ma_entry_low = round(min(fast_v * 0.995, bull_plan["entry_low"]), 4)
    ma_entry_high = round(max(fast_v * 1.003, price if ma_trend == "pullback_buy" else fast_v * 1.003), 4)
    ma_stop = round(min(slow_v * 0.99, bull_plan["stop_loss"]), 4) if slow_v else bull_plan["stop_loss"]

    entry_ref = (ma_entry_low + ma_entry_high) / 2.0 if ma_entry_high else price
    raw_stop_dist = abs(entry_ref - ma_stop) / entry_ref * 100.0 if entry_ref else 5.0
    stop_dist_pct = round(max(1.2, min(20.0, raw_stop_dist)), 2)
    risk_parity_pct = 0.0 if action in ("AVOID", "WAIT") else min(25.0, round(1.5 / max(stop_dist_pct / 100.0, 0.015), 1))

    return {
        "action": action,
        "action_zh": action_zh,
        "action_en": action_en,
        "confidence": confidence,
        "position_zh": pos_zh,
        "position_en": pos_en,
        "entry_low": ma_entry_low,
        "entry_high": ma_entry_high,
        "target_price": bull_plan["t1"],
        "stop_loss": ma_stop,
        "stop_dist_pct": stop_dist_pct,
        "risk_parity_pct": risk_parity_pct,
        "crash_lock": crash_lock,
        "reasons_zh": reasons_zh[:3],
        "reasons_en": reasons_en[:3],
    }


def _round_strike(price: float, side: str) -> float:
    """按标的价格粒度自动计算平值/浅虚值1档参考行权价"""
    if price >= 20000:
        step = 1000.0
    elif price >= 1000:
        step = 50.0
    elif price >= 100:
        step = 5.0
    elif price >= 10:
        step = 1.0
    else:
        step = 0.5
    if side == "CALL":
        return round(math.ceil(price / step) * step, 2)
    return round(math.floor(price / step) * step, 2)


def _build_options_advice(
    candles: List[Dict[str, Any]],
    dual_ma: Dict[str, Any],
    market: str = "crypto",
) -> Dict[str, Any]:
    price = candles[-1]["close"]
    ma_trend = dual_ma["trend"]
    fast_v = dual_ma["fast_val"]
    slow_v = dual_ma["slow_val"]
    dist_fast = dual_ma.get("dist_fast_pct", 0.0)
    dte_zh = "7~14 天到期（避开末日期权）" if market == "crypto" else "30~45 天到期（避开时间衰减）"
    dte_en = "7-14 DTE" if market == "crypto" else "30-45 DTE"

    if ma_trend == "tangled":
        return {
            "signal": "NO_TRADE",
            "signal_zh": "禁止买期权 · 防时间归零",
            "signal_en": "NO OPTIONS · CHOP",
            "direction": "NONE",
            "strike": _round_strike(price, "CALL"),
            "dte_zh": dte_zh,
            "dte_en": dte_en,
            "entry_trigger_zh": "等待白线/黄线张口发散后再入场",
            "entry_trigger_en": "Wait for MA expansion before buying options",
            "size_zh": "0% 空仓观望（横盘 Theta 每天掉血）",
            "size_en": "0% Cash (Theta decay in chop)",
            "rule_zh": "均线麻绳缠绕期买期权最容易两边亏时间价值，坚决空仓等方向。",
            "rule_en": "Avoid buying options during tangled chop.",
        }

    if ma_trend in ("pullback_buy", "bullish"):
        side = "CALL"
        strike = _round_strike(price * 1.01, "CALL")
        trigger_low = round(fast_v * 0.994, 2)
        trigger_high = round(fast_v * 1.008, 2)
        return {
            "signal": "BUY_CALL",
            "signal_zh": "可买 Call（看涨期权）",
            "signal_en": "BUY CALL",
            "direction": side,
            "strike": strike,
            "dte_zh": dte_zh,
            "dte_en": dte_en,
            "entry_trigger_zh": f"回踩白线 {trigger_low} - {trigger_high} 企稳买入",
            "entry_trigger_en": f"Buy Call near {trigger_low} - {trigger_high}",
            "size_zh": "总资金 2%~5%（浅虚值/平值，Delta 0.45 左右）",
            "size_en": "2%-5% capital (ATM / 1-step OTM)",
            "rule_zh": f"权利金 +50%~100% 先卖一半回本；若标的有效跌破黄线 ({slow_v}) 或亏损 -40% 止损。",
            "rule_en": f"Take half at +50-100%; stop if underlying breaks {slow_v}.",
        }

    if ma_trend == "overextended":
        strike = _round_strike(fast_v * 1.01, "CALL")
        return {
            "signal": "WAIT_IV",
            "signal_zh": "勿追 Call · 等回踩白线买",
            "signal_en": "WAIT PULLBACK FOR CALL",
            "direction": "CALL",
            "strike": strike,
            "dte_zh": dte_zh,
            "dte_en": dte_en,
            "entry_trigger_zh": f"等待回踩白线 {fast_v} 附近再买 Call",
            "entry_trigger_en": f"Wait pullback to {fast_v} for Call",
            "size_zh": "0% 等待（暴涨后 IV 偏高，追高易被双杀）",
            "size_en": "0% Wait (High IV after spike)",
            "rule_zh": "急涨后隐含波动率太贵，等回踩白线降温时买 Call 性价比最高。",
            "rule_en": "Wait for IV cool-off on pullback to fast MA.",
        }

    # 空头方向：区分「反抽白线买 Put」vs「跌太远勿追 Put」
    strike = _round_strike(price * 0.99, "PUT")
    if -1.8 <= dist_fast <= 1.5:
        trigger_low = round(fast_v * 0.99, 2)
        trigger_high = round(fast_v * 1.01, 2)
        return {
            "signal": "BUY_PUT",
            "signal_zh": "可买 Put（看跌期权）",
            "signal_en": "BUY PUT",
            "direction": "PUT",
            "strike": strike,
            "dte_zh": dte_zh,
            "dte_en": dte_en,
            "entry_trigger_zh": f"反抽白线 {trigger_low} - {trigger_high} 受阻买入 Put",
            "entry_trigger_en": f"Buy Put on rejection near {trigger_low} - {trigger_high}",
            "size_zh": "总资金 2%~5%（浅虚值/平值，Delta -0.45 左右）",
            "size_en": "2%-5% capital (ATM / 1-step OTM Put)",
            "rule_zh": f"权利金 +50%~100% 先卖一半回本；若标的站回黄线 ({slow_v}) 上方或亏损 -40% 止损。",
            "rule_en": f"Take half at +50-100%; stop if underlying reclaims {slow_v}.",
        }

    return {
        "signal": "WAIT_IV",
        "signal_zh": "勿追 Put · 等反抽白线买",
        "signal_en": "WAIT BOUNCE FOR PUT",
        "direction": "PUT",
        "strike": _round_strike(fast_v * 0.99, "PUT"),
        "dte_zh": dte_zh,
        "dte_en": dte_en,
        "entry_trigger_zh": f"等反抽到白线 {fast_v} 附近受阻再买 Put",
        "entry_trigger_en": f"Wait bounce to {fast_v} to buy Put",
        "size_zh": f"0% 等待（当前偏离白线 {dist_fast:+.2f}%，跌太远买 Put 权利金太贵）",
        "size_en": f"0% Wait ({dist_fast:+.2f}% below fast MA)",
        "rule_zh": "暴跌远离白线后买 Put 极易遇到反弹暴亏，耐心等反抽白线受阻再出手。",
        "rule_en": "Do not chase Puts far below fast MA; wait for bounce.",
    }


def _compute_atr14(candles: List[Dict[str, Any]], period: int = 14) -> List[float]:
    if not candles:
        return []
    tr_vals: List[float] = []
    for i, c in enumerate(candles):
        h = float(c["high"])
        l = float(c["low"])
        if i == 0:
            tr_vals.append(max(0.0, h - l))
        else:
            pc = float(candles[i - 1]["close"])
            tr_vals.append(max(h - l, abs(h - pc), abs(l - pc)))
    return _sma(tr_vals, period)


def detect_absorption_signals(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    识别主力吸筹 / 诱多派发与插针扫损（基于成交量放大、影线拒绝比率与收盘收回位置）.
    """
    n = len(candles)
    if n < 22:
        return []

    atr14 = _compute_atr14(candles, 14)
    vol_sma20 = _sma([float(c.get("volume", 0.0) or 0.0) for c in candles], 20)
    raw_events: List[Dict[str, Any]] = []

    for i in range(20, n):
        c = candles[i]
        high = float(c["high"])
        low = float(c["low"])
        op = float(c["open"])
        cl = float(c["close"])
        rng = high - low
        atr_v = atr14[i] if i < len(atr14) else 0.0
        if rng <= 0.0 or rng < 0.55 * atr_v:
            continue

        vol = float(c.get("volume", 0.0) or 0.0)
        avg_vol = max(vol_sma20[i] if i < len(vol_sma20) else 0.0, 1e-9)
        vol_ratio = vol / avg_vol if avg_vol > 1e-9 else 1.0

        lower_wick = min(op, cl) - low
        upper_wick = high - max(op, cl)
        lower_pct = lower_wick / rng
        upper_pct = upper_wick / rng
        close_loc = (cl - low) / rng

        prev_slice = candles[max(0, i - 15):i]
        prior_low = min(float(x["low"]) for x in prev_slice)
        prior_high = max(float(x["high"]) for x in prev_slice)
        bull_sweep = (low < prior_low) and (cl > prior_low)
        bear_sweep = (high > prior_high) and (cl < prior_high)

        cand: Dict[str, Any] | None = None
        if (vol_ratio >= 1.25 or bull_sweep) and lower_pct >= 0.42 and close_loc >= 0.55:
            score = (
                min(1.0, max(0.0, (vol_ratio - 0.9) / 1.6)) * 40.0
                + min(1.0, lower_pct / 0.72) * 30.0
                + min(1.0, close_loc / 0.85) * 20.0
                + (10.0 if bull_sweep else 0.0)
            )
            if score >= 68.0:
                grade = "A" if score >= 78.0 else "B"
                label = (
                    "🧲扫损吸筹A" if (bull_sweep and grade == "A")
                    else ("🧲扫损吸筹" if bull_sweep else ("🧲主力吸筹A" if grade == "A" else "🧲下影承接"))
                )
                label_en = (
                    "Sweep Absorb A" if (bull_sweep and grade == "A")
                    else ("Sweep Absorb" if bull_sweep else ("Bull Absorb A" if grade == "A" else "Bull Absorb"))
                )
                cand = {
                    "_idx": i,
                    "time": c["time"],
                    "price": round(low, 4),
                    "type": "bull_absorb",
                    "grade": grade,
                    "score": round(score, 1),
                    "vol_ratio": round(vol_ratio, 2),
                    "sweep": bull_sweep,
                    "label": label,
                    "label_en": label_en,
                }
        elif (vol_ratio >= 1.25 or bear_sweep) and upper_pct >= 0.42 and (1.0 - close_loc) >= 0.55:
            score = (
                min(1.0, max(0.0, (vol_ratio - 0.9) / 1.6)) * 40.0
                + min(1.0, upper_pct / 0.72) * 30.0
                + min(1.0, (1.0 - close_loc) / 0.85) * 20.0
                + (10.0 if bear_sweep else 0.0)
            )
            if score >= 68.0:
                grade = "A" if score >= 78.0 else "B"
                label = (
                    "🔨诱多扫损A" if (bear_sweep and grade == "A")
                    else ("🔨诱多扫损" if bear_sweep else ("🔨主力派发A" if grade == "A" else "🔨上影派发"))
                )
                label_en = (
                    "Sweep Dist A" if (bear_sweep and grade == "A")
                    else ("Sweep Dist" if bear_sweep else ("Bear Dist A" if grade == "A" else "Bear Dist"))
                )
                cand = {
                    "_idx": i,
                    "time": c["time"],
                    "price": round(high, 4),
                    "type": "bear_absorb",
                    "grade": grade,
                    "score": round(score, 1),
                    "vol_ratio": round(vol_ratio, 2),
                    "sweep": bear_sweep,
                    "label": label,
                    "label_en": label_en,
                }

        if cand is not None:
            merged_idx = -1
            for k in range(len(raw_events) - 1, -1, -1):
                if cand["_idx"] - raw_events[k]["_idx"] > 3:
                    break
                if raw_events[k]["type"] == cand["type"]:
                    merged_idx = k
                    break
            if merged_idx >= 0:
                if cand["score"] > raw_events[merged_idx]["score"]:
                    raw_events[merged_idx] = cand
            else:
                raw_events.append(cand)

    out: List[Dict[str, Any]] = []
    for ev in raw_events[-16:]:
        ev_clean = {k: v for k, v in ev.items() if k != "_idx"}
        out.append(ev_clean)
    return out


def detect_fvg_zones(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    识别尚未完全回补的机构失衡缺口 (Fair Value Gap)，并实时裁剪已回补部分。
    """
    n = len(candles)
    if n < 18:
        return []

    atr14 = _compute_atr14(candles, 14)
    last_price = float(candles[-1]["close"])
    bull_zones: List[Dict[str, Any]] = []
    bear_zones: List[Dict[str, Any]] = []

    start_scan = max(15, n - 140)
    for i in range(start_scan, n):
        c0 = candles[i - 2]
        c1 = candles[i - 1]
        c2 = candles[i]
        atr_v = max(atr14[i - 1] if i - 1 < len(atr14) else 0.0, float(c1["close"]) * 0.001)
        disp_body = abs(float(c1["close"]) - float(c1["open"]))
        if disp_body < 0.55 * atr_v:
            continue

        # Bullish FVG: c2.low > c0.high
        if float(c2["low"]) > float(c0["high"]):
            orig_top = float(c2["low"])
            orig_bottom = float(c0["high"])
            total_h = orig_top - orig_bottom
            if total_h < 0.22 * atr_v:
                continue
            cur_top = orig_top
            mitigated = False
            for j in range(i + 1, n):
                j_low = float(candles[j]["low"])
                if j_low <= orig_bottom:
                    mitigated = True
                    break
                if j_low < cur_top:
                    cur_top = j_low
            rem_h = cur_top - orig_bottom
            if not mitigated and rem_h >= 0.08 * atr_v:
                fill_pct = max(0.0, min(99.0, (orig_top - cur_top) / max(total_h, 1e-9) * 100.0))
                mid = (cur_top + orig_bottom) / 2.0
                bull_zones.append({
                    "type": "bull",
                    "start_time": c1["time"],
                    "start_index": i - 1,
                    "top": round(cur_top, 4),
                    "bottom": round(orig_bottom, 4),
                    "orig_top": round(orig_top, 4),
                    "orig_bottom": round(orig_bottom, 4),
                    "ce_mid": round((orig_top + orig_bottom) / 2.0, 4),
                    "fill_pct": round(fill_pct, 1),
                    "dist_pct": round((mid - last_price) / max(last_price, 1e-9) * 100.0, 2),
                })

        # Bearish FVG: c2.high < c0.low
        elif float(c2["high"]) < float(c0["low"]):
            orig_top = float(c0["low"])
            orig_bottom = float(c2["high"])
            total_h = orig_top - orig_bottom
            if total_h < 0.22 * atr_v:
                continue
            cur_bottom = orig_bottom
            mitigated = False
            for j in range(i + 1, n):
                j_high = float(candles[j]["high"])
                if j_high >= orig_top:
                    mitigated = True
                    break
                if j_high > cur_bottom:
                    cur_bottom = j_high
            rem_h = orig_top - cur_bottom
            if not mitigated and rem_h >= 0.08 * atr_v:
                fill_pct = max(0.0, min(99.0, (cur_bottom - orig_bottom) / max(total_h, 1e-9) * 100.0))
                mid = (orig_top + cur_bottom) / 2.0
                bear_zones.append({
                    "type": "bear",
                    "start_time": c1["time"],
                    "start_index": i - 1,
                    "top": round(orig_top, 4),
                    "bottom": round(cur_bottom, 4),
                    "orig_top": round(orig_top, 4),
                    "orig_bottom": round(orig_bottom, 4),
                    "ce_mid": round((orig_top + orig_bottom) / 2.0, 4),
                    "fill_pct": round(fill_pct, 1),
                    "dist_pct": round((mid - last_price) / max(last_price, 1e-9) * 100.0, 2),
                })

    bull_zones.sort(key=lambda z: abs((z["top"] + z["bottom"]) / 2.0 - last_price))
    bear_zones.sort(key=lambda z: abs((z["top"] + z["bottom"]) / 2.0 - last_price))
    selected = bull_zones[:3] + bear_zones[:3]
    selected.sort(key=lambda z: z["start_time"])
    return selected


def analyze_structure(
    candles: List[Dict[str, Any]],
    ma_type: str = "ema",
    ma_fast: int = 20,
    ma_slow: int = 60,
    market: str = "crypto",
    interval: str = "1h",
) -> Dict[str, Any]:
    if len(candles) < 10:
        return {
            "fractals": [],
            "strokes": [],
            "segments": [],
            "centers": [],
            "signals": [],
            "macd": [],
            "absorption": [],
            "fvg_zones": [],
            "dual_ma": compute_dual_ma(candles, ma_type, ma_fast, ma_slow),
            "vwap": compute_vwap(candles, interval),
            "buy_advice": None,
            "options_advice": None,
            "bias": {
                "bull_pct": 50,
                "bear_pct": 50,
                "factors": [
                    {"key": "center_pos", "label": "中枢位置", "label_en": "Center Pos", "score": 0},
                    {"key": "segment_dir", "label": "线段方向", "label_en": "Segment Dir", "score": 0},
                    {"key": "latest_stroke", "label": "最近笔", "label_en": "Last Stroke", "score": 0},
                    {"key": "macd_momentum", "label": "MACD动量", "label_en": "MACD Mom", "score": 0},
                ],
            },
            "overview": {
                "stroke_count": 0,
                "segment_count": 0,
                "center_count": 0,
                "zg": 0,
                "zd": 0,
                "summary_zh": "样本数据不足，等待更多 K 线加载。",
                "summary_en": "Insufficient candles for structural analysis.",
            },
            "plans": None,
            "similar_samples": {"count": 0, "up_pct": 33, "flat_pct": 34, "down_pct": 33, "horizon": 12},
        }

    macd = compute_macd(candles)
    dual_ma = compute_dual_ma(candles, ma_type, ma_fast, ma_slow)
    merged = _merge_containment(candles)
    fractals = _detect_fractals(merged)
    strokes = _build_strokes(fractals, candles)
    segments = _build_segments(strokes)
    centers = _build_centers(strokes)
    signals = _detect_signals(strokes, macd)

    last_price = candles[-1]["close"]
    last_center = centers[-1] if centers else None
    last_seg = segments[-1] if segments else None
    last_stroke = strokes[-1] if strokes else None
    last_macd = macd[-1] if macd else {"dif": 0, "dea": 0, "hist": 0}

    # 4因子打分 (-30 ~ +30)
    center_score = 0
    if last_center:
        mid = (last_center["zg"] + last_center["zd"]) / 2.0
        half = max((last_center["zg"] - last_center["zd"]) / 2.0, mid * 0.005)
        raw_pos = (last_price - mid) / half * 18.0
        center_score = int(max(-30, min(30, round(raw_pos))))

    seg_score = 16 if (last_seg and last_seg["direction"] == "up") else (-16 if last_seg else 0)
    stroke_score = 14 if (last_stroke and last_stroke["direction"] == "up") else (-14 if last_stroke else 0)

    hist_norm = (last_macd["hist"] / (last_price or 1.0)) * 4000.0
    macd_score = int(max(-30, min(30, round(hist_norm))))

    total_score = center_score + seg_score + stroke_score + macd_score
    bull_pct = int(max(15, min(85, round(50 + total_score * 0.32))))
    bear_pct = 100 - bull_pct

    if last_center:
        if last_price > last_center["zg"]:
            sum_zh = "价格运行于中枢上沿上方，关注次级别离开后的回踩确认。"
            sum_en = "Price above center ZG; watch for pullback confirmation."
        elif last_price < last_center["zd"]:
            sum_zh = "价格跌破中枢下沿，关注次级别反抽是否形成三卖。"
            sum_en = "Price below center ZD; watch for weak rebound resistance."
        else:
            sum_zh = "观察中枢震荡与次级别离开后的回试。"
            sum_en = "Consolidating inside center; watch breakout and retest."
    else:
        sum_zh = "暂未形成完整三笔重叠中枢，跟踪当前笔延续力度。"
        sum_en = "No complete 3-stroke center yet; tracking current stroke momentum."

    plans = _build_trade_plans(candles, centers, strokes, dual_ma)
    similar = _compute_similar_samples(candles)
    buy_advice = _build_buy_advice(candles, dual_ma, bull_pct, last_center, signals, plans, interval=interval)
    options_advice = _build_options_advice(candles, dual_ma, market=market)
    fibonacci = compute_fibonacci_confluence(candles, dual_ma)
    regime = detect_consolidation_regime(candles, dual_ma, market=market)
    vwap = compute_vwap(candles, interval)
    absorption = detect_absorption_signals(candles)
    fvg_zones = detect_fvg_zones(candles)

    return {
        "fractals": [{"index": f["index"], "time": f["time"], "price": round(f["price"], 4), "type": f["type"]} for f in fractals],
        "strokes": strokes,
        "segments": segments,
        "centers": centers,
        "signals": signals,
        "absorption": absorption,
        "fvg_zones": fvg_zones,
        "macd": macd,
        "dual_ma": dual_ma,
        "vwap": vwap,
        "fibonacci": fibonacci,
        "regime": regime,
        "buy_advice": buy_advice,
        "options_advice": options_advice,
        "bias": {
            "bull_pct": bull_pct,
            "bear_pct": bear_pct,
            "factors": [
                {"key": "center_pos", "label": "中枢位置", "label_en": "Center Pos", "score": center_score},
                {"key": "segment_dir", "label": "线段方向", "label_en": "Segment Dir", "score": seg_score},
                {"key": "latest_stroke", "label": "最近笔", "label_en": "Last Stroke", "score": stroke_score},
                {"key": "macd_momentum", "label": "MACD动量", "label_en": "MACD Mom", "score": macd_score},
            ],
        },
        "overview": {
            "stroke_count": len(strokes),
            "segment_count": len(segments),
            "center_count": len(centers),
            "zg": last_center["zg"] if last_center else 0,
            "zd": last_center["zd"] if last_center else 0,
            "summary_zh": sum_zh,
            "summary_en": sum_en,
        },
        "plans": plans,
        "similar_samples": similar,
    }
