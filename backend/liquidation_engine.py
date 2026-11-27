"""
liquidation_engine.py — Hyperliquid 合约清算分布 & 清算热力图引擎
零认证直连 Hyperliquid 公开 Info API + Binance Top Trader 多空持仓比，计算上下方高密度清算磁吸墙与 36 档价格梯级热力图。
"""

import math
import time
from typing import Any, Dict, List, Optional, Tuple

from market_data import _get_client, cache, fetch_binance_klines


HL_INFO_URL = "https://api.hyperliquid.xyz/info"
BINANCE_LS_RATIO_URL = "https://fapi.binance.com/futures/data/topLongShortPositionRatio"

LEVERAGE_TIERS: List[Tuple[int, float]] = [
    (5, 0.10),
    (10, 0.24),
    (20, 0.30),
    (25, 0.20),
    (40, 0.16),
]


def _clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


async def _fetch_hl_meta_and_ctxs(force: bool = False) -> Optional[List[Any]]:
    ckey = "hl:meta_ctxs"
    if not force:
        hit = cache.get(ckey, ttl_override=20)
        if hit is not None:
            return hit

    client = _get_client()
    try:
        resp = await client.post(HL_INFO_URL, json={"type": "metaAndAssetCtxs"})
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list) and len(data) >= 2:
            cache.set(ckey, data)
            return data
    except Exception:
        pass

    return cache.get_stale(ckey)


def _resolve_hl_coin(
    symbol: str,
    universe: List[Dict[str, Any]],
) -> Tuple[Optional[int], str, float]:
    raw = symbol.strip().upper()
    for suffix in ("USDT", "USDC", "USD", "PERP", "-PERP"):
        if raw.endswith(suffix) and len(raw) > len(suffix):
            raw = raw[: -len(suffix)]
            break

    for idx, item in enumerate(universe):
        if str(item.get("name") or "").upper() == raw:
            return idx, str(item["name"]), 1.0

    k_name = f"K{raw}"
    for idx, item in enumerate(universe):
        if str(item.get("name") or "").upper() == k_name:
            return idx, str(item["name"]), 1000.0

    return None, raw, 1.0


async def _fetch_binance_ls_ratio(symbol: str, funding_1h: float) -> Tuple[float, float, str]:
    ckey = f"hl:ls:{symbol}"
    hit = cache.get(ckey, ttl_override=60)
    if hit is not None:
        return hit

    client = _get_client()
    try:
        resp = await client.get(
            BINANCE_LS_RATIO_URL,
            params={"symbol": symbol.upper(), "period": "1h", "limit": "1"},
        )
        if resp.status_code == 200:
            rows = resp.json()
            if isinstance(rows, list) and rows:
                long_r = float(rows[0].get("longAccount") or 0.5)
                long_r = _clamp(long_r, 0.25, 0.75)
                out = (round(long_r, 4), round(1.0 - long_r, 4), "binance_fapi")
                cache.set(ckey, out)
                return out
    except Exception:
        pass

    stale = cache.get_stale(ckey)
    if stale is not None:
        return stale

    # Fallback: infer skew smoothly from Hyperliquid hourly funding rate
    long_r = _clamp(0.50 + _clamp(funding_1h * 2500.0, -0.15, 0.15), 0.25, 0.75)
    return (round(long_r, 4), round(1.0 - long_r, 4), "hl_funding")


def _extract_top_peaks(
    bins: List[Dict[str, Any]],
    side: str,
    limit: int = 3,
) -> List[Dict[str, Any]]:
    candidates = [b for b in bins if b["side"] == side and b["liq_usd"] > 0]
    if not candidates:
        return []

    # Sort descending by liquidation USD, enforce non-adjacent separation (>= 2 bins apart in price)
    ranked = sorted(candidates, key=lambda x: x["liq_usd"], reverse=True)
    selected: List[Dict[str, Any]] = []
    min_gap_pct = 1.25
    for cand in ranked:
        if any(abs(cand["dist_pct"] - prev["dist_pct"]) < min_gap_pct for prev in selected):
            continue
        selected.append(
            {
                "price": cand["price"],
                "liq_usd": cand["liq_usd"],
                "dist_pct": cand["dist_pct"],
                "dominant_lev": cand["dominant_lev"],
                "side": side,
            }
        )
        if len(selected) >= limit:
            break

    return selected


def _round_px(val: float) -> float:
    if val >= 1000:
        return round(val, 1)
    if val >= 10:
        return round(val, 2)
    if val >= 0.1:
        return round(val, 4)
    return round(val, 6)


def _fmt_usd_compact(usd: float) -> str:
    if usd >= 1e9:
        return f"${usd / 1e9:.2f}B"
    if usd >= 1e6:
        return f"${usd / 1e6:.1f}M"
    if usd >= 1e3:
        return f"${usd / 1e3:.0f}K"
    return f"${usd:.0f}"


async def fetch_hyperliquid_liquidation(
    symbol: str,
    interval: str = "1h",
    force: bool = False,
) -> Dict[str, Any]:
    sym_upper = symbol.strip().upper()
    ckey = f"hl:liq:{sym_upper}"
    if not force:
        hit = cache.get(ckey, ttl_override=25)
        if hit is not None:
            return hit

    meta_pack = await _fetch_hl_meta_and_ctxs(force=force)
    if not meta_pack:
        return {
            "supported": False,
            "symbol": sym_upper,
            "reason": "Hyperliquid API 暂不可用",
            "reason_en": "Hyperliquid API temporarily unavailable",
            "bins": [],
            "upper_clusters": [],
            "lower_clusters": [],
        }

    universe = meta_pack[0].get("universe", []) if isinstance(meta_pack[0], dict) else []
    ctxs = meta_pack[1] if len(meta_pack) > 1 and isinstance(meta_pack[1], list) else []
    coin_idx, hl_coin, price_scale = _resolve_hl_coin(sym_upper, universe)

    if coin_idx is None or coin_idx >= len(ctxs):
        return {
            "supported": False,
            "symbol": sym_upper,
            "hl_coin": hl_coin,
            "reason": f"Hyperliquid 暂未上线 {hl_coin} 永续合约",
            "reason_en": f"{hl_coin} perp is not listed on Hyperliquid",
            "bins": [],
            "upper_clusters": [],
            "lower_clusters": [],
        }

    u_item = universe[coin_idx]
    ctx = ctxs[coin_idx]
    max_leverage = max(2, int(u_item.get("maxLeverage") or 20))
    hl_mark_px = float(ctx.get("markPx") or ctx.get("midPx") or 0.0)
    hl_oracle_px = float(ctx.get("oraclePx") or hl_mark_px)
    oi_coins = float(ctx.get("openInterest") or 0.0)
    day_vlm_usd = float(ctx.get("dayNtlVlm") or 0.0)
    funding_1h = float(ctx.get("funding") or 0.0)

    if hl_mark_px <= 0:
        return {
            "supported": False,
            "symbol": sym_upper,
            "hl_coin": hl_coin,
            "reason": f"{hl_coin} 标记价格无效",
            "reason_en": f"Invalid mark price for {hl_coin}",
            "bins": [],
            "upper_clusters": [],
            "lower_clusters": [],
        }

    # Normalize prices to match Binance chart scale (handles kPEPE -> PEPE /1000 cleanly)
    mark_px = hl_mark_px / price_scale
    oracle_px = hl_oracle_px / price_scale
    oi_usd = oi_coins * hl_mark_px
    funding_8h_pct = funding_1h * 8.0 * 100.0
    funding_ann_pct = funding_1h * 24.0 * 365.0 * 100.0

    # Fetch L/S ratio & recent 1h klines concurrently
    long_ratio, short_ratio, ls_source = await _fetch_binance_ls_ratio(sym_upper, funding_1h)
    try:
        klines = await fetch_binance_klines(sym_upper, "1h", limit=120, force=False)
    except Exception:
        klines = []

    if len(klines) >= 5:
        mark_px = float(klines[-1]["close"]) if mark_px <= 0 else mark_px

    band_low = mark_px * 0.88
    band_high = mark_px * 1.12
    num_bins = 36
    step = (band_high - band_low) / num_bins

    active_tiers = [(lev, w) for lev, w in LEVERAGE_TIERS if lev <= max_leverage]
    if not active_tiers:
        active_tiers = [(max_leverage, 1.0)]
    tier_weight_sum = sum(w for _, w in active_tiers)
    active_tiers = [(lev, w / tier_weight_sum) for lev, w in active_tiers]

    # Hyperliquid maintenance margin is half of max-leverage initial margin fraction
    mmr = 1.0 / (2.0 * max(max_leverage, 2))

    raw_usd = [0.0] * num_bins
    lev_usd: List[Dict[int, float]] = [{} for _ in range(num_bins)]

    if klines:
        samples: List[Tuple[float, float]] = []
        n_k = len(klines)
        for idx, bar in enumerate(klines):
            tp = (float(bar["high"]) + float(bar["low"]) + float(bar["close"])) / 3.0
            vol = max(float(bar.get("volume") or 1.0), 1e-6)
            recency = 0.35 + 0.65 * ((idx + 1) / n_k)
            samples.append((tp, vol * recency))
    else:
        # Smooth Gaussian synthetic entry profile around mark price if klines unavailable
        samples = [
            (
                mark_px * (1.0 + offset),
                math.exp(-((offset / 0.025) ** 2)),
            )
            for offset in (-0.05, -0.03, -0.015, -0.005, 0.0, 0.005, 0.015, 0.03, 0.05)
        ]

    total_sample_w = sum(w for _, w in samples) or 1.0
    long_pool_usd = oi_usd * long_ratio
    short_pool_usd = oi_usd * short_ratio

    for entry_px, sw in samples:
        share = sw / total_sample_w
        for lev, lw in active_tiers:
            # Long liquidation level
            long_liq = entry_px * (1.0 - (1.0 / lev) + mmr)
            if band_low <= long_liq < mark_px:
                b_idx = min(num_bins - 1, max(0, int((long_liq - band_low) / step)))
                amt = long_pool_usd * share * lw
                raw_usd[b_idx] += amt
                lev_usd[b_idx][lev] = lev_usd[b_idx].get(lev, 0.0) + amt

            # Short liquidation level
            short_liq = entry_px * (1.0 + (1.0 / lev) - mmr)
            if mark_px < short_liq <= band_high:
                b_idx = min(num_bins - 1, max(0, int((short_liq - band_low) / step)))
                amt = short_pool_usd * share * lw
                raw_usd[b_idx] += amt
                lev_usd[b_idx][lev] = lev_usd[b_idx].get(lev, 0.0) + amt

    max_bin_usd = max(raw_usd) if any(raw_usd) else 1.0
    bins: List[Dict[str, Any]] = []
    upper_total_usd = 0.0
    lower_total_usd = 0.0

    # Iterate high-to-low so UI ladder naturally renders top (shorts) -> bottom (longs)
    for b_idx in range(num_bins - 1, -1, -1):
        p_lo = band_low + b_idx * step
        p_hi = p_lo + step
        p_mid = (p_lo + p_hi) * 0.5
        usd = raw_usd[b_idx]
        side = "short_liq" if p_mid >= mark_px else "long_liq"
        dist_pct = ((p_mid - mark_px) / mark_px * 100.0) if mark_px else 0.0

        dom_lev = max_leverage
        if lev_usd[b_idx]:
            dom_lev = max(lev_usd[b_idx].items(), key=lambda kv: kv[1])[0]

        if side == "short_liq":
            upper_total_usd += usd
        else:
            lower_total_usd += usd

        bins.append(
            {
                "price": _round_px(p_mid),
                "price_low": _round_px(p_lo),
                "price_high": _round_px(p_hi),
                "side": side,
                "liq_usd": round(usd, 0),
                "intensity": round(_clamp(usd / max_bin_usd, 0.0, 1.0), 3),
                "dist_pct": round(dist_pct, 2),
                "dominant_lev": int(dom_lev),
            }
        )

    upper_clusters = _extract_top_peaks(bins, "short_liq", limit=3)
    lower_clusters = _extract_top_peaks(bins, "long_liq", limit=3)

    comb_total = upper_total_usd + lower_total_usd
    imbalance_pct = round((upper_total_usd / comb_total * 100.0) if comb_total > 0 else 50.0, 1)

    top_up = upper_clusters[0] if upper_clusters else None
    top_dn = lower_clusters[0] if lower_clusters else None

    if top_up and top_dn:
        if top_up["liq_usd"] > top_dn["liq_usd"] * 1.15:
            summary_zh = (
                f"上方 {top_up['price']:,} ({top_up['dist_pct']:+.1f}%) 堆积 {_fmt_usd_compact(top_up['liq_usd'])} 空头清算墙，存在向上猎杀流动性磁吸"
            )
            summary_en = (
                f"Heavier short liq cluster above at {top_up['price']:,} ({top_up['dist_pct']:+.1f}%, {_fmt_usd_compact(top_up['liq_usd'])})"
            )
        elif top_dn["liq_usd"] > top_up["liq_usd"] * 1.15:
            summary_zh = (
                f"下方 {top_dn['price']:,} ({top_dn['dist_pct']:+.1f}%) 堆积 {_fmt_usd_compact(top_dn['liq_usd'])} 多头清算墙，谨防下杀插针扫损"
            )
            summary_en = (
                f"Heavier long liq cluster below at {top_dn['price']:,} ({top_dn['dist_pct']:+.1f}%, {_fmt_usd_compact(top_dn['liq_usd'])})"
            )
        else:
            summary_zh = (
                f"上下清算较均衡：上方 {top_up['price']:,} ({top_up['dist_pct']:+.1f}%) vs 下方 {top_dn['price']:,} ({top_dn['dist_pct']:+.1f}%)"
            )
            summary_en = (
                f"Balanced liq pools: {top_up['price']:,} above vs {top_dn['price']:,} below"
            )
    else:
        summary_zh = f"Hyperliquid 持仓总规模 {_fmt_usd_compact(oi_usd)}，等待更密集清算区形成"
        summary_en = f"Hyperliquid OI {_fmt_usd_compact(oi_usd)}"

    out = {
        "supported": True,
        "symbol": sym_upper,
        "hl_coin": hl_coin,
        "interval": interval,
        "mark_price": _round_px(mark_px),
        "oracle_price": _round_px(oracle_px),
        "open_interest_usd": round(oi_usd, 0),
        "day_volume_usd": round(day_vlm_usd, 0),
        "max_leverage": max_leverage,
        "funding_8h_pct": round(funding_8h_pct, 4),
        "funding_ann_pct": round(funding_ann_pct, 2),
        "long_ratio": long_ratio,
        "short_ratio": short_ratio,
        "ls_source": ls_source,
        "upper_total_usd": round(upper_total_usd, 0),
        "lower_total_usd": round(lower_total_usd, 0),
        "imbalance_pct": imbalance_pct,
        "upper_clusters": upper_clusters,
        "lower_clusters": lower_clusters,
        "bins": bins,
        "summary_zh": summary_zh,
        "summary_en": summary_en,
        "updated_ts": int(time.time()),
    }
    cache.set(ckey, out)
    return out
