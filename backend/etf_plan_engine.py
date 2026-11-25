"""
美股 ETF 月息养保证金 & 3 倍杠杆大盘择时引擎
===========================================
面向 $50,000 本金 + IBKR Pro 1.30x 温和杠杆实盘架构：
1. 实时拉取 QQQ / SPY 2年日线（含近 260 根可视 K 线 + 完整 SMA200 均线序列）
2. 实时计算大盘牛熊水位、EMA20/SMA60/SMA120/SMA200 分批买入触发价位
3. 严格输出 TQQQ / UPRO 右侧解锁与左侧纯现金三枪买点及三大清仓红线
4. 实时汇总 9 只核心与对比 ETF（QQQI, SPYI, SGOV, SPMO, QQQM, SCHD, TQQQ, UPRO, RSP）的报价与派息
"""

import asyncio
import math
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from market_data import (
    MarketDataCache,
    YAHOO_UA,
    _http_get_json,
    fetch_yahoo_klines,
    fetch_yahoo_realtime_quote,
)

ET_TZ = ZoneInfo("America/New_York")
CST_TZ = ZoneInfo("Asia/Shanghai")

_etf_plan_cache = MarketDataCache(ttl=120)
_fetch_lock = asyncio.Lock()

BENCHMARK_SYMBOLS = ("QQQ", "SPY")
PORTFOLIO_SYMBOLS = ("QQQI", "SPYI", "SPMO", "QQQM", "SCHD", "SGOV", "TQQQ", "UPRO", "RSP")
ALL_ETF_SYMBOLS = BENCHMARK_SYMBOLS + PORTFOLIO_SYMBOLS

# 每只 ETF 的静态结构化档案与兜底历史基线（实时价格、RSI、1Y涨幅、TTM分红由 Yahoo 实时刷新）
ETF_METADATA: Dict[str, Dict[str, Any]] = {
    "QQQI": {
        "name_zh": "NEOS 纳指高息月付 ETF",
        "layer": 1,
        "layer_name_zh": "月息造血层",
        "weight_pct": 12.0,
        "payout_freq": "monthly",
        "payout_freq_zh": "月付 (12次)",
        "fallback_ttm_div": 7.58,
        "fallback_price": 47.56,
        "cagr_3y_pct": None,
        "cagr_10y_pct": None,
        "history_note_zh": "2024成立 · 近1年+3.0%",
        "max_dd_10y_pct": -20.0,
        "maint_margin_pct": 25.0,
        "margin_allowed": True,
        "tax_note_zh": "当月按30%预扣，次年高比例ROC常自动退税",
        "role_zh": "主力月息造血机 · 首选月付抵息",
        "verdict": "core",
    },
    "SPYI": {
        "name_zh": "NEOS 标普500高息月付 ETF",
        "layer": 1,
        "layer_name_zh": "月息造血层",
        "weight_pct": 10.0,
        "payout_freq": "monthly",
        "payout_freq_zh": "月付 (12次)",
        "fallback_ttm_div": 6.32,
        "fallback_price": 49.49,
        "cagr_3y_pct": 14.4,
        "cagr_10y_pct": None,
        "history_note_zh": "2022成立 · 3年+14.4%",
        "max_dd_10y_pct": -16.5,
        "maint_margin_pct": 25.0,
        "margin_allowed": True,
        "tax_note_zh": "标普分散波动，同享高比例ROC税务优化",
        "role_zh": "标普月息搭档 · 降波动防单一科技回撤",
        "verdict": "core",
    },
    "SPMO": {
        "name_zh": "Invesco 标普500动量 ETF",
        "layer": 2,
        "layer_name_zh": "主升核心层",
        "weight_pct": 25.0,
        "payout_freq": "quarterly",
        "payout_freq_zh": "季付 (4次)",
        "fallback_ttm_div": 1.10,
        "fallback_price": 121.40,
        "cagr_3y_pct": 26.0,
        "cagr_10y_pct": 17.7,
        "history_note_zh": "3年+26.0% · 10年+17.7%",
        "max_dd_10y_pct": -30.9,
        "maint_margin_pct": 25.0,
        "margin_allowed": True,
        "tax_note_zh": "季付红利为主，核心靠净值主升复利",
        "role_zh": "无杠杆进攻之王 · 10年收益稳压大盘",
        "verdict": "core",
    },
    "QQQM": {
        "name_zh": "Invesco 纳指100低费长持 ETF",
        "layer": 2,
        "layer_name_zh": "主升核心层",
        "weight_pct": 25.0,
        "payout_freq": "quarterly",
        "payout_freq_zh": "季付 (4次)",
        "fallback_ttm_div": 1.32,
        "fallback_price": 262.56,
        "cagr_3y_pct": 18.6,
        "cagr_10y_pct": None,
        "history_note_zh": "费率0.15% · 3年+18.6%",
        "max_dd_10y_pct": -35.0,
        "maint_margin_pct": 25.0,
        "margin_allowed": True,
        "tax_note_zh": "低费率长持核心，少换手享复利",
        "role_zh": "纳指长持引擎 · 吃足AI与科技主升浪",
        "verdict": "core",
    },
    "SCHD": {
        "name_zh": "Schwab 高股息红利价值 ETF",
        "layer": 2,
        "layer_name_zh": "主升核心层",
        "weight_pct": 10.0,
        "payout_freq": "quarterly",
        "payout_freq_zh": "季付 (4次)",
        "fallback_ttm_div": 1.06,
        "fallback_price": 34.38,
        "cagr_3y_pct": 12.1,
        "cagr_10y_pct": 12.9,
        "history_note_zh": "10年+12.9% · 价值护盘",
        "max_dd_10y_pct": -33.4,
        "maint_margin_pct": 25.0,
        "margin_allowed": True,
        "tax_note_zh": "非美居民扣10%(条约)/30%，适合价值对冲",
        "role_zh": "红利价值压仓石 · 对冲科技股风格切换",
        "verdict": "hold",
    },
    "SGOV": {
        "name_zh": "iShares 0-3月超短美债 ETF",
        "layer": 3,
        "layer_name_zh": "美债防爆垫",
        "weight_pct": 10.0,
        "payout_freq": "monthly",
        "payout_freq_zh": "月付 (12次)",
        "fallback_ttm_div": 3.65,
        "fallback_price": 100.66,
        "cagr_3y_pct": 4.5,
        "cagr_10y_pct": None,
        "history_note_zh": "3年+4.5% · 零净值回撤",
        "max_dd_10y_pct": 0.0,
        "maint_margin_pct": 25.0,
        "margin_allowed": False,
        "tax_note_zh": "享QII利息免税优惠，严禁借5.38%保证金买入",
        "role_zh": "纯现金安全气囊 · 禁融资 · 暴跌砍半抄底",
        "verdict": "shield",
    },
    "TQQQ": {
        "name_zh": "ProShares 3倍做多纳指 ETF",
        "layer": 4,
        "layer_name_zh": "3x 战术奇兵",
        "weight_pct": 4.0,
        "payout_freq": "quarterly",
        "payout_freq_zh": "季付 (4次)",
        "fallback_ttm_div": 0.85,
        "fallback_price": 76.00,
        "cagr_3y_pct": 42.0,
        "cagr_10y_pct": 31.5,
        "history_note_zh": "高波动 · 仅限SMA200触发",
        "max_dd_10y_pct": -81.7,
        "maint_margin_pct": 75.0,
        "margin_allowed": False,
        "tax_note_zh": "IBKR维持保证金可高达75%，只准纯现金分批买",
        "role_zh": "3x纳指顺风加速枪 · 看QQQ大盘年线开闸",
        "verdict": "tactical",
    },
    "UPRO": {
        "name_zh": "ProShares 3倍做多标普500 ETF",
        "layer": 4,
        "layer_name_zh": "3x 战术奇兵",
        "weight_pct": 4.0,
        "payout_freq": "quarterly",
        "payout_freq_zh": "季付 (4次)",
        "fallback_ttm_div": 1.13,
        "fallback_price": 115.06,
        "cagr_3y_pct": 35.2,
        "cagr_10y_pct": 25.2,
        "history_note_zh": "3年+35.2% · 10年+25.2%",
        "max_dd_10y_pct": -76.8,
        "maint_margin_pct": 75.0,
        "margin_allowed": False,
        "tax_note_zh": "IBKR维持保证金75%-100%，严禁再加融资购买",
        "role_zh": "3x标普稳健奇兵 · 损耗较TQQQ更可控",
        "verdict": "tactical",
    },
    "RSP": {
        "name_zh": "Invesco 标普500等权重 ETF",
        "layer": 0,
        "layer_name_zh": "对比剔除项",
        "weight_pct": 0.0,
        "payout_freq": "quarterly",
        "payout_freq_zh": "季付 (4次)",
        "fallback_ttm_div": 3.18,
        "fallback_price": 211.81,
        "cagr_3y_pct": 14.9,
        "cagr_10y_pct": 11.4,
        "history_note_zh": "10年+11.4% · 跑输SPMO",
        "max_dd_10y_pct": -39.0,
        "maint_margin_pct": 25.0,
        "margin_allowed": True,
        "tax_note_zh": "收益跑输SPMO/SCHD且回撤更深(-39%)",
        "role_zh": "建议直接剔除 · 让出仓位给SPMO+SCHD",
        "verdict": "exclude",
    },
}


def _compute_sma_series(closes: List[float], period: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(closes)
    if len(closes) < period or period <= 0:
        return out
    running = sum(closes[:period])
    out[period - 1] = running / period
    for i in range(period, len(closes)):
        running += closes[i] - closes[i - period]
        out[i] = running / period
    return out


def _compute_ema_series(closes: List[float], period: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(closes)
    if len(closes) < period or period <= 0:
        return out
    k = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    out[period - 1] = ema
    for i in range(period, len(closes)):
        ema = closes[i] * k + ema * (1.0 - k)
        out[i] = ema
    return out


def _compute_rsi_series(closes: List[float], period: int = 14) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    out[period] = 100.0 if avg_loss == 0 else 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))
    for i in range(period + 1, len(closes)):
        diff = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(diff, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-diff, 0.0)) / period
        out[i] = 100.0 if avg_loss == 0 else 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))
    return out


def _compute_max_drawdown(closes: List[float]) -> float:
    if not closes:
        return 0.0
    peak = closes[0]
    max_dd = 0.0
    for c in closes:
        if c > peak:
            peak = c
        if peak > 0:
            dd = (c - peak) / peak * 100.0
            if dd < max_dd:
                max_dd = dd
    return round(max_dd, 1)


async def _fetch_ttm_dividend(symbol: str, force: bool = False) -> Optional[float]:
    """轻量拉取近 2 年月度分红事件，汇总近 365 天 TTM 实发股息"""
    ckey = f"etf_div:{symbol}"
    if not force:
        cached = _etf_plan_cache.get(ckey)
        if cached is not None:
            return float(cached) if cached >= 0 else None

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=2y&interval=1mo&events=div"
    try:
        data = await _http_get_json(url, headers={"User-Agent": YAHOO_UA}, timeout=12.0)
        res = (data.get("chart") or {}).get("result") or []
        if not res:
            return None
        dividends = ((res[0].get("events") or {}).get("dividends") or {})
        if not dividends:
            return None
        cutoff = time.time() - 370 * 86400
        recent = [float(item.get("amount") or 0.0) for item in dividends.values() if float(item.get("date") or 0) >= cutoff]
        if not recent:
            all_vals = sorted(
                ((int(item.get("date") or 0), float(item.get("amount") or 0.0)) for item in dividends.values()),
                key=lambda x: x[0],
            )
            recent = [v for _, v in all_vals[-12:]]
        total = round(sum(recent), 4)
        _etf_plan_cache.set(ckey, total if total > 0 else -1.0)
        return total if total > 0 else None
    except Exception:
        stale = _etf_plan_cache.get_stale(ckey)
        if stale is not None and stale >= 0:
            return float(stale)
        return None


async def _fetch_symbol_bundle(symbol: str, need_div: bool = False, force: bool = False) -> Dict[str, Any]:
    """并发拉取单只 ETF 的实时报价、2年日线 K 线与可选 TTM 分红"""
    tasks = [
        fetch_yahoo_realtime_quote(symbol, force=force),
        fetch_yahoo_klines(symbol, "1d", limit=520, force=force),
    ]
    if need_div:
        tasks.append(_fetch_ttm_dividend(symbol, force=force))

    results = await asyncio.gather(*tasks, return_exceptions=True)
    quote = results[0] if isinstance(results[0], dict) else {}
    klines = results[1] if isinstance(results[1], list) else []
    ttm_div = results[2] if (need_div and len(results) > 2 and isinstance(results[2], (int, float))) else None

    klines = [dict(k) for k in klines if k.get("close")]
    live_price = float(quote.get("price") or 0.0)
    if klines and live_price > 0:
        last_bar = klines[-1]
        last_bar["close"] = live_price
        last_bar["high"] = max(float(last_bar["high"]), live_price)
        last_bar["low"] = min(float(last_bar["low"]), live_price)
    elif not live_price and klines:
        live_price = float(klines[-1]["close"])

    change_pct = float(quote.get("price_change_percent") or 0.0)
    if change_pct == 0.0 and len(klines) >= 2 and klines[-2]["close"] > 0:
        change_pct = round((live_price - float(klines[-2]["close"])) / float(klines[-2]["close"]) * 100.0, 2)

    return {
        "symbol": symbol,
        "quote": quote,
        "klines": klines,
        "price": round(live_price, 2) if live_price > 0 else 0.0,
        "change_pct": round(change_pct, 2),
        "ttm_div": float(ttm_div) if ttm_div is not None else None,
    }


def _line_points(klines: List[Dict[str, Any]], values: List[Optional[float]], start_idx: int) -> List[Dict[str, Any]]:
    pts: List[Dict[str, Any]] = []
    for idx in range(start_idx, len(klines)):
        v = values[idx]
        if v is not None and math.isfinite(v):
            pts.append({"time": int(klines[idx]["time"]), "value": round(float(v), 2)})
    return pts


def _build_benchmark_plan(symbol: str, bundle: Dict[str, Any]) -> Dict[str, Any]:
    klines = bundle["klines"]
    closes = [float(k["close"]) for k in klines]
    highs = [float(k["high"]) for k in klines]
    price = float(bundle["price"] or (closes[-1] if closes else 0.0))

    ema20_arr = _compute_ema_series(closes, 20)
    sma60_arr = _compute_sma_series(closes, 60)
    sma120_arr = _compute_sma_series(closes, 120)
    sma200_arr = _compute_sma_series(closes, 200)
    rsi14_arr = _compute_rsi_series(closes, 14)

    ema20 = float(ema20_arr[-1] or price)
    sma60 = float(sma60_arr[-1] or price)
    sma120 = float(sma120_arr[-1] or price)
    sma200 = float(sma200_arr[-1] or sma120 or price)
    rsi14 = float(rsi14_arr[-1] or 50.0)

    lookback_52w = highs[-252:] if len(highs) >= 252 else highs
    high_52w = float(max(lookback_52w)) if lookback_52w else price
    drawdown_pct = ((price - high_52w) / high_52w * 100.0) if high_52w > 0 else 0.0
    dist_sma200_pct = ((price - sma200) / sma200 * 100.0) if sma200 > 0 else 0.0
    dist_ema20_pct = ((price - ema20) / ema20 * 100.0) if ema20 > 0 else 0.0

    unlock_3x = round(sma200 * 1.03, 2)
    hard_stop_3x = round(sma200 * 0.98, 2)
    euphoria_t1 = round(sma200 * 1.18, 2)
    euphoria_t2 = round(sma200 * 1.25, 2)

    dd15_price = round(high_52w * 0.85, 2)
    dd25_price = round(high_52w * 0.75, 2)
    dd35_price = round(high_52w * 0.65, 2)

    if price >= sma200 and price >= sma60:
        zone_mode = "ma_bull"
        zone1_price = round(ema20, 2)
        zone2_price = round(sma60, 2)
        zone3_price = round(sma120, 2)
        zone4_price = round(sma200, 2)
        tranches = [
            {
                "id": 1,
                "pct": 40,
                "label_zh": "第 1 档 · 40% 底仓 / 回踩 EMA20",
                "desc_zh": "现价先配满月息造血机 + 核心底仓 40%，立即可用月息交保证金利息",
                "trigger_price": zone1_price,
                "triggered": price <= zone1_price * 1.015,
            },
            {
                "id": 2,
                "pct": 30,
                "label_zh": "第 2 档 · 30% 健康回踩季线 SMA60",
                "desc_zh": "大盘洗盘回踩 60 日线接货，低吸 SPMO / QQQM / SPYI",
                "trigger_price": zone2_price,
                "triggered": price <= zone2_price * 1.008,
            },
            {
                "id": 3,
                "pct": 20,
                "label_zh": "第 3 档 · 20% 半年线黄金坑 SMA120",
                "desc_zh": "中期深调打入强支撑半年线，扩大筹码安全垫",
                "trigger_price": zone3_price,
                "triggered": price <= zone3_price * 1.008,
            },
            {
                "id": 4,
                "pct": 10,
                "label_zh": "第 4 档 · 10% + 动用 SGOV 一半接年线",
                "desc_zh": "触及 SMA200 年线或高点 -15%，砍一半 SGOV 全力抄底大盘",
                "trigger_price": zone4_price,
                "triggered": price <= zone4_price * 1.01,
            },
        ]
    else:
        zone_mode = "dd_bear"
        zone1_price = round(price, 2)
        zone2_price = round(min(high_52w * 0.80, price * 0.95), 2)
        zone3_price = round(min(high_52w * 0.74, price * 0.89), 2)
        zone4_price = round(min(high_52w * 0.67, price * 0.82), 2)
        tranches = [
            {
                "id": 1,
                "pct": 40,
                "label_zh": "第 1 档 · 40% 现价折价建底仓",
                "desc_zh": "已处年线下方折价区，先配置 40% 月息(QQQI/SPYI)与核心(QQQM/SPMO)开始收息",
                "trigger_price": zone1_price,
                "triggered": True,
            },
            {
                "id": 2,
                "pct": 30,
                "label_zh": "第 2 档 · 30% 下探阶梯加仓 (-5%/高点-20%)",
                "desc_zh": "均线在上方压制期间勿追反弹，下方挂单接带血恐慌筹码",
                "trigger_price": zone2_price,
                "triggered": price <= zone2_price,
            },
            {
                "id": 3,
                "pct": 20,
                "label_zh": "第 3 档 · 20% 中期黄金坑 (-11%/高点-26%)",
                "desc_zh": "大盘深调进入低估区间，分批补厚 SPMO / QQQM / SCHD 筹码垫",
                "trigger_price": zone3_price,
                "triggered": price <= zone3_price,
            },
            {
                "id": 4,
                "pct": 10,
                "label_zh": "第 4 档 · 10% + SGOV 砍半极限抄底",
                "desc_zh": "崩至极度绝望区间，砍一半 SGOV 与末档资金重拳买入核心大盘",
                "trigger_price": zone4_price,
                "triggered": price <= zone4_price,
            },
        ]

    allow_3x_right_side = price >= unlock_3x and ema20 >= sma60
    hard_stop_triggered = price < hard_stop_3x

    if price < sma200 and drawdown_pct <= -15.0:
        regime_code = "BEAR_DEEP_CRASH"
        regime_label_zh = "熊市深跌区 · 启用3x左侧纯现金三枪"
        regime_label_en = "Deep Bear Crash · 3x Left-Side Cash Guns"
        regime_summary_zh = f"{symbol} 跌破年线且自52周高点回撤 {drawdown_pct:.1f}% ，禁用融资买3x，可用 SGOV 安全垫与纯现金按 -15% / -25% / -35% 分三枪抄底。"
    elif price < sma200:
        regime_code = "BEAR_WATCH"
        regime_label_zh = "年线下方偏空 · 停开3x右侧 · 仅定投核心"
        regime_label_en = "Below SMA200 · 3x Paused · Core Only"
        regime_summary_zh = f"{symbol} 位于 200 日年线 (${sma200:.2f}) 下方，触发3倍杠杆熔断观察，稳健仓按 EMA20/SMA120 逢低买 QQQM/SPMO/QQQI。"
    elif dist_sma200_pct >= 18.0 or rsi14 >= 75.0:
        regime_code = "BULL_OVERHEAT"
        regime_label_zh = "牛市主升过热 · 止盈锁利3x · 禁追高"
        regime_label_en = "Overheated Bull · Scale Out 3x"
        regime_summary_zh = f"{symbol} 偏离年线 +{dist_sma200_pct:.1f}% (RSI {rsi14:.0f})，适合将 3x 浮盈分批落袋换成 QQQM + QQQI 吃月息。"
    elif price <= ema20:
        regime_code = "BULL_PULLBACK"
        regime_label_zh = "牛市健康回踩 · 第1-2档分批低吸窗口"
        regime_label_en = "Bull Pullback · Tranche Add Window"
        regime_summary_zh = f"{symbol} 守住年线 (${sma200:.2f}) 并回踩 EMA20 (${ema20:.2f}) 一带，是 1.3x 核心配置与 3x 右侧低吸高性价比区。"
    else:
        regime_code = "BULL_HEALTHY"
        regime_label_zh = "年线多头健康 · 月息+核心稳步建仓"
        regime_label_en = "Healthy Bull · Monthly Income + Core"
        regime_summary_zh = f"{symbol} 高于年线 +{dist_sma200_pct:.1f}% ，大趋势向上；优先买满 QQQI/SPYI 收月息，其余资金挂在 EMA20/SMA60 等回踩。"

    visible_count = min(260, len(klines))
    start_idx = max(0, len(klines) - visible_count)
    visible_candles = [
        {
            "time": int(k["time"]),
            "open": round(float(k["open"]), 2),
            "high": round(float(k["high"]), 2),
            "low": round(float(k["low"]), 2),
            "close": round(float(k["close"]), 2),
            "volume": round(float(k["volume"]), 2),
        }
        for k in klines[start_idx:]
    ]

    quote = bundle.get("quote") or {}
    return {
        "symbol": symbol,
        "name_zh": "纳指 100 大盘基准 (QQQ)" if symbol == "QQQ" else "标普 500 大盘基准 (SPY)",
        "name_en": "Nasdaq-100 Benchmark (QQQ)" if symbol == "QQQ" else "S&P 500 Benchmark (SPY)",
        "price": round(price, 2),
        "change_pct": round(float(bundle.get("change_pct") or 0.0), 2),
        "session": quote.get("session") or "regular",
        "session_zh": quote.get("session_zh") or "美股日线",
        "ema20": round(ema20, 2),
        "sma60": round(sma60, 2),
        "sma120": round(sma120, 2),
        "sma200": round(sma200, 2),
        "rsi14": round(rsi14, 1),
        "high_52w": round(high_52w, 2),
        "drawdown_from_high_pct": round(drawdown_pct, 2),
        "dist_sma200_pct": round(dist_sma200_pct, 2),
        "dist_ema20_pct": round(dist_ema20_pct, 2),
        "unlock_3x_price": unlock_3x,
        "hard_stop_3x_price": hard_stop_3x,
        "euphoria_t1_price": euphoria_t1,
        "euphoria_t2_price": euphoria_t2,
        "zone1_price": zone1_price,
        "zone2_price": zone2_price,
        "zone3_price": zone3_price,
        "zone4_price": zone4_price,
        "zone_mode": zone_mode,
        "tranches": tranches,
        "dd15_price": dd15_price,
        "dd25_price": dd25_price,
        "dd35_price": dd35_price,
        "allow_3x_right_side": allow_3x_right_side,
        "hard_stop_triggered": hard_stop_triggered,
        "regime_code": regime_code,
        "regime_label_zh": regime_label_zh,
        "regime_label_en": regime_label_en,
        "regime_summary_zh": regime_summary_zh,
        "candles": visible_candles,
        "ema20_line": _line_points(klines, ema20_arr, start_idx),
        "sma60_line": _line_points(klines, sma60_arr, start_idx),
        "sma120_line": _line_points(klines, sma120_arr, start_idx),
        "sma200_line": _line_points(klines, sma200_arr, start_idx),
    }


def _approx_3x_price(curr_3x: float, curr_bench: float, target_bench: float) -> float:
    """按 3 倍复利近似折算大盘点位对应的 3x ETF 参考价（保证跨深度下跌单调递减，实盘以大盘点位为准）"""
    if curr_3x <= 0 or curr_bench <= 0 or target_bench <= 0:
        return round(max(curr_3x, 1.0), 2)
    ratio = target_bench / curr_bench
    est = curr_3x * (ratio ** 2.85)
    return round(max(est, 0.5), 2)


def _build_3x_timing(
    sym_3x: str,
    bundle_3x: Dict[str, Any],
    bench: Dict[str, Any],
) -> Dict[str, Any]:
    klines = bundle_3x["klines"]
    closes = [float(k["close"]) for k in klines]
    highs = [float(k["high"]) for k in klines]
    meta = ETF_METADATA[sym_3x]
    price_3x = float(bundle_3x["price"] or (closes[-1] if closes else meta["fallback_price"]))
    rsi14_3x = float((_compute_rsi_series(closes, 14)[-1]) or 50.0)
    high_52w_3x = float(max(highs[-252:] if len(highs) >= 252 else highs)) if highs else price_3x
    dd_3x = ((price_3x - high_52w_3x) / high_52w_3x * 100.0) if high_52w_3x > 0 else 0.0

    b_sym = bench["symbol"]
    b_price = float(bench["price"])
    b_sma200 = float(bench["sma200"])
    b_ema20 = float(bench["ema20"])
    b_sma60 = float(bench["sma60"])
    b_high_52w = float(bench["high_52w"])

    above_sma200 = b_price > b_sma200
    breakout_unlocked = bool(bench["allow_3x_right_side"])
    if breakout_unlocked:
        status_code = "BULL_OPEN"
        status_zh = "右侧已开闸 · 回踩EMA20轻仓分批"
    elif above_sma200:
        status_code = "BUFFER_ZONE"
        status_zh = "站上年线缓冲区 · 待 +3% 站稳开闸"
    else:
        status_code = "BEAR_LOCKED"
        status_zh = "年线熔断锁定 · 禁右侧 · 等左侧三枪"

    return {
        "symbol": sym_3x,
        "name_zh": meta["name_zh"],
        "benchmark_symbol": b_sym,
        "price": round(price_3x, 2),
        "change_pct": round(float(bundle_3x.get("change_pct") or 0.0), 2),
        "rsi14": round(rsi14_3x, 1),
        "high_52w": round(high_52w_3x, 2),
        "drawdown_pct": round(dd_3x, 2),
        "benchmark_price": b_price,
        "benchmark_sma200": b_sma200,
        "benchmark_ema20": b_ema20,
        "benchmark_sma60": b_sma60,
        "benchmark_dist_sma200_pct": bench["dist_sma200_pct"],
        "above_sma200": above_sma200,
        "breakout_unlocked": breakout_unlocked,
        "status_code": status_code,
        "status_zh": status_zh,
        "right_side_breakout": {
            "benchmark_trigger": bench["unlock_3x_price"],
            "est_3x_price": _approx_3x_price(price_3x, b_price, bench["unlock_3x_price"]),
            "pct_share": 50,
            "rule_zh": f"{b_sym} 连续 2 日收盘站上 SMA200×1.03 (${bench['unlock_3x_price']:.2f})，且 EMA20 > SMA60，先开半仓 50%",
        },
        "right_side_pullback": {
            "benchmark_trigger": b_ema20,
            "est_3x_price": _approx_3x_price(price_3x, b_price, b_ema20),
            "pct_share": 50,
            "rule_zh": f"多头趋势中回踩 {b_sym} EMA20 (${b_ema20:.2f}) 不破止跌，补齐余下 50% 奇兵仓位",
        },
        "left_side_guns": [
            {
                "gun": 1,
                "label_zh": "第1枪 · 恐慌初现 (30%)",
                "dd_label": "-15%",
                "pct_share": 30,
                "benchmark_trigger": bench["dd15_price"],
                "est_3x_price": _approx_3x_price(price_3x, b_price, bench["dd15_price"]),
                "triggered": b_price <= bench["dd15_price"],
                "rule_zh": f"{b_sym} 自52周高点回撤 -15% (${bench['dd15_price']:.2f})，动用纯现金打第1枪",
            },
            {
                "gun": 2,
                "label_zh": "第2枪 · 深度杀跌 (40%)",
                "dd_label": "-25%",
                "pct_share": 40,
                "benchmark_trigger": bench["dd25_price"],
                "est_3x_price": _approx_3x_price(price_3x, b_price, bench["dd25_price"]),
                "triggered": b_price <= bench["dd25_price"],
                "rule_zh": f"{b_sym} 跌至 -25% (${bench['dd25_price']:.2f})，可砍 SGOV 一半接血筹",
            },
            {
                "gun": 3,
                "label_zh": "第3枪 · 极度绝望 (30%)",
                "dd_label": "-35%",
                "pct_share": 30,
                "benchmark_trigger": bench["dd35_price"],
                "est_3x_price": _approx_3x_price(price_3x, b_price, bench["dd35_price"]),
                "triggered": b_price <= bench["dd35_price"],
                "rule_zh": f"{b_sym} 崩至 -35% (${bench['dd35_price']:.2f})，打完最后一发只待长牛修复",
            },
        ],
        "exit_rules": [
            {
                "type": "hard_stop",
                "title_zh": "1. 硬性熔断止损线（防震荡损耗）",
                "trigger_zh": f"{b_sym} 连续 2 日收盘跌破 SMA200×0.98 (${bench['hard_stop_3x_price']:.2f})",
                "est_3x_price": _approx_3x_price(price_3x, b_price, bench["hard_stop_3x_price"]),
                "action_zh": "100% 清仓 3x ETF 切回 SGOV 吃利息，绝不在年线下方带血死扛",
            },
            {
                "type": "euphoria_trim",
                "title_zh": "2. 主升浪移动分批止盈（锁利归母）",
                "trigger_zh": f"持仓浮盈 +22%/+30%，或 {b_sym} 偏离年线 +18% (${bench['euphoria_t1_price']:.2f}) / RSI≥76",
                "est_3x_price": _approx_3x_price(price_3x, b_price, bench["euphoria_t1_price"]),
                "action_zh": "分两批兑现 50%~100% 利润，利润永久滚入 QQQM + QQQI 扩大底盘",
            },
            {
                "type": "bear_rebound",
                "title_zh": "3. 熊市左侧抢反弹快出线",
                "trigger_zh": f"年线下方三枪吃到的筹码，反抽至 {b_sym} SMA60 (${b_sma60:.2f}) ~ SMA200 (${b_sma200:.2f})",
                "est_3x_price": _approx_3x_price(price_3x, b_price, b_sma60),
                "action_zh": "反弹获利 +25%~+40% 即清仓还库 SGOV，绝不把熊市反弹当牛市恋战",
            },
        ],
        "benchmark_52w_high": b_high_52w,
    }


def _build_etf_live_item(symbol: str, bundle: Dict[str, Any]) -> Dict[str, Any]:
    meta = ETF_METADATA[symbol]
    klines = bundle["klines"]
    closes = [float(k["close"]) for k in klines]
    price = float(bundle["price"] or (closes[-1] if closes else meta["fallback_price"]))

    # 近1年（约252交易日）实时价格涨幅
    ref_idx = max(0, len(closes) - 252)
    ret_1y_pct: Optional[float] = None
    if len(closes) > 30 and closes[ref_idx] > 0:
        ret_1y_pct = round((price - closes[ref_idx]) / closes[ref_idx] * 100.0, 1)

    live_dd = _compute_max_drawdown(closes) if closes else 0.0
    max_dd = round(min(live_dd, float(meta["max_dd_10y_pct"])), 1)

    ttm_div = float(bundle["ttm_div"]) if bundle.get("ttm_div") else float(meta["fallback_ttm_div"])
    # 防止 Yahoo 对部分月息标的分红事件短缺或拆股造成极端失真，落入合理兜底
    if price > 0:
        raw_yield = ttm_div / price * 100.0
        if raw_yield < 0.1 or raw_yield > 35.0:
            ttm_div = float(meta["fallback_ttm_div"])
            raw_yield = ttm_div / price * 100.0
    else:
        raw_yield = 0.0

    quote = bundle.get("quote") or {}
    return {
        "symbol": symbol,
        "name_zh": meta["name_zh"],
        "layer": meta["layer"],
        "layer_name_zh": meta["layer_name_zh"],
        "weight_pct": meta["weight_pct"],
        "price": round(price, 2),
        "change_pct": round(float(bundle.get("change_pct") or 0.0), 2),
        "session_zh": quote.get("session_zh") or "日线收盘",
        "payout_freq": meta["payout_freq"],
        "payout_freq_zh": meta["payout_freq_zh"],
        "ttm_div_usd": round(ttm_div, 2),
        "ttm_yield_pct": round(raw_yield, 2),
        "return_1y_pct": ret_1y_pct,
        "cagr_3y_pct": meta["cagr_3y_pct"],
        "cagr_10y_pct": meta["cagr_10y_pct"],
        "history_note_zh": meta["history_note_zh"],
        "max_dd_pct": max_dd,
        "maint_margin_pct": meta["maint_margin_pct"],
        "margin_allowed": meta["margin_allowed"],
        "tax_note_zh": meta["tax_note_zh"],
        "role_zh": meta["role_zh"],
        "verdict": meta["verdict"],
    }


async def fetch_etf_plan_data(force: bool = False) -> Dict[str, Any]:
    """获取美股 ETF 实盘配置与 QQQ/SPY 大盘择时完整快照"""
    ckey = "etf_plan:snapshot"
    if not force:
        cached = _etf_plan_cache.get(ckey)
        if cached is not None:
            return cached

    async with _fetch_lock:
        if not force:
            cached = _etf_plan_cache.get(ckey)
            if cached is not None:
                return cached

        # 限制并发数避免 Yahoo Finance 限流
        sem = asyncio.Semaphore(5)

        async def _guarded(sym: str) -> Tuple[str, Dict[str, Any]]:
            need_div = sym in PORTFOLIO_SYMBOLS
            async with sem:
                bundle = await _fetch_symbol_bundle(sym, need_div=need_div, force=force)
                return sym, bundle

        pairs = await asyncio.gather(*(_guarded(s) for s in ALL_ETF_SYMBOLS))
        bundles = dict(pairs)

        benchmarks: Dict[str, Dict[str, Any]] = {}
        for b_sym in BENCHMARK_SYMBOLS:
            benchmarks[b_sym] = _build_benchmark_plan(b_sym, bundles[b_sym])

        leveraged_timing = {
            "TQQQ": _build_3x_timing("TQQQ", bundles["TQQQ"], benchmarks["QQQ"]),
            "UPRO": _build_3x_timing("UPRO", bundles["UPRO"], benchmarks["SPY"]),
        }

        etfs = [_build_etf_live_item(sym, bundles[sym]) for sym in PORTFOLIO_SYMBOLS]

        now_cst = datetime.now(CST_TZ)
        now_et = datetime.now(ET_TZ)
        qqq_quote = bundles["QQQ"].get("quote") or {}

        payload = {
            "updated_at": now_cst.strftime("%Y-%m-%d %H:%M CST"),
            "updated_ts": int(time.time()),
            "et_date": qqq_quote.get("today_et_date") or now_et.strftime("%Y-%m-%d"),
            "market_session": {
                "session": qqq_quote.get("session") or "regular",
                "session_zh": qqq_quote.get("session_zh") or "美股交易日",
                "session_en": qqq_quote.get("session_en") or "US Market",
            },
            "ibkr_margin_apr_pct": 5.38,
            "w8ben_tax_pct": 30.0,
            "defaults": {
                "principal_usd": 50000,
                "leverage_ratio": 1.30,
                "x3_choice": "split",
                "held_shares": {"QQQI": 40, "SCHD": 5},
            },
            "benchmarks": benchmarks,
            "leveraged_timing": leveraged_timing,
            "etfs": etfs,
        }

        _etf_plan_cache.set(ckey, payload)
        return payload
