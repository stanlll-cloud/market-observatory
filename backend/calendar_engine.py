import asyncio
import html
import re
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from market_data import MarketDataCache, US_CATALOG, YAHOO_UA, _http_get_json

ET_TZ = ZoneInfo("America/New_York")
CST_TZ = ZoneInfo("Asia/Shanghai")

NASDAQ_HEADERS = {
    "User-Agent": YAHOO_UA,
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}

US_CATALOG_MAP: Dict[str, Dict[str, Any]] = {x["symbol"].upper(): x for x in US_CATALOG}

_calendar_cache = MarketDataCache(ttl=900)
_fetch_lock = asyncio.Lock()

# Skip noisy low-impact or routine bank/auction releases
NOISE_EVENT_KEYWORDS = (
    "auction",
    "bill",
    "note",
    "bond",
    "redbook",
    "chicago fed",
    "richmond",
    "dallas fed",
    "kansas",
    "ny empire",
    "empire state",
    "philly fed",
    "house price",
    "s&p/cs",
    "hpi",
    "mortgage",
    "baker hughes",
    "api weekly",
    "wholesale",
    "leading index",
    "coincident",
    "treasury currency",
    "car registration",
    "cftc",
    "business inventories",
    "factory orders",
    "import price",
    "export price",
    "personal income",
    "personal spending",
    "trade balance",
    "building permits",
    "housing starts",
    "existing home sales",
    "new home sales",
    "pending home sales",
    "consumer credit",
    "crude oil",
    "eia",
    "gdpnow",
)

# Curated 7-category market-moving allowlist: (keywords, zh_name, impact, why_zh, playbook_zh)
CURATED_MACRO_RULES: List[Tuple[Tuple[str, ...], str, str, str, str]] = [
    (
        ("fomc rate", "fomc interest", "fed interest rate", "federal funds rate", "fomc statement", "fomc decision"),
        "美联储 FOMC 利率决议",
        "high",
        "全球资金总水龙头，直接决定美股与 BTC 中期牛熊",
        "公布瞬间上下剧烈插针！前30分钟空仓或降杠杆，等 02:30 鲍威尔讲话定调后再顺势做",
    ),
    (
        ("powell", "fomc minutes"),
        "美联储主席鲍威尔讲话 / 纪要",
        "high",
        "透露下次是否降息的口风，盘中极易引发急拉急砸",
        "讲话期间勿追涨杀跌，盯紧 15 分钟 EMA20 站稳方向后再进场",
    ),
    (
        ("core pce", "pce price", "personal consumption expenditures"),
        "美国核心 PCE 物价指数",
        "high",
        "美联储最看重的通胀指标，直接左右降息预期",
        "前15分钟防插针；公布值低于预期 = 利好大涨(看Call) ｜ 高于预期 = 利空砸盘(看Put)",
    ),
    (
        ("core cpi", "consumer price index", "cpi"),
        "美国 CPI 通胀数据",
        "high",
        "月度头号插针王，公布1秒内 BTC/纳指常剧烈波动 2%~5%",
        "公布前严禁重仓赌单边！低于预期利好做多，高于预期顺势看空或买Put对冲",
    ),
    (
        ("nonfarm", "non-farm", "unemployment rate"),
        "美国非农就业 & 失业率",
        "high",
        "检验美国经济是否衰退与美联储降息紧迫度的头号就业成绩单",
        "公布前15分钟停手观望，等第一根 15 分钟 K 线收完高/低点突破方向再顺势做",
    ),
    (
        ("gdp", "retail sales", "core ppi", "ppi", "durable goods"),
        "美国 GDP / 零售 / PPI 数据",
        "high",
        "衡量美国经济增速、消费活力与上游通胀，直接影响美股开盘强弱",
        "开盘前留意期指跳空方向，顺日线大均线低吸或反抽做空，忌逆势接飞刀",
    ),
    (
        ("initial jobless", "adp employment", "cb consumer confidence", "michigan consumer", "ism manufacturing", "ism services", "ism non-manufacturing"),
        "美国核心景气/就业指标",
        "medium",
        "美股盘前/盘中重要情绪催化剂，常带来短线变盘脉冲",
        "21:30 / 23:00 公布前后注意短线波动放大，不逆日线均线追单",
    ),
]

SPECIFIC_MACRO_ZH: List[Tuple[str, str]] = [
    ("core pce", "美国核心 PCE 通胀指标"),
    ("pce price", "美国 PCE 物价指数"),
    ("personal consumption expenditures", "美国 PCE 通胀数据"),
    ("core cpi", "美国核心 CPI 通胀"),
    ("consumer price index", "美国 CPI 通胀数据"),
    ("cpi", "美国 CPI 通胀数据"),
    ("nonfarm", "美国非农就业人数 (NFP)"),
    ("non-farm", "美国非农就业人数 (NFP)"),
    ("unemployment rate", "美国失业率"),
    ("fomc minutes", "美联储 FOMC 会议纪要"),
    ("powell", "美联储主席鲍威尔讲话"),
    ("gdp", "美国 GDP 经济增速"),
    ("retail sales", "美国零售销售月率"),
    ("core ppi", "美国核心 PPI 通胀"),
    ("ppi", "美国 PPI 生产者通胀"),
    ("durable goods", "美国耐用品订单"),
    ("initial jobless", "美国当周初请失业金"),
    ("adp employment", "美国 ADP 小非农就业"),
    ("cb consumer confidence", "美国谘商会消费者信心"),
    ("michigan consumer", "密歇根消费者信心指数"),
    ("ism manufacturing", "美国 ISM 制造业 PMI"),
    ("ism services", "美国 ISM 服务业 PMI"),
    ("ism non-manufacturing", "美国 ISM 非制造业 PMI"),
]


def _clean_val(raw: Optional[str]) -> str:
    """Decode HTML entities (incl. &nbsp; / \xa0), strip tags, normalize placeholders."""
    if raw is None:
        return ""
    text = html.unescape(str(raw)).replace("\xa0", " ").replace("&nbsp;", " ")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text or text.upper() in ("N/A", "NA", "-", "--"):
        return ""
    return text


def _match_curated_macro(event_name: str, country: str) -> Optional[Tuple[str, str, str, str]]:
    """Return (zh_name, impact, why_zh, playbook_zh) ONLY for high-signal US market movers."""
    if country != "United States":
        return None
    low = (event_name or "").lower().strip()
    if not low:
        return None

    # Exclude generic Fed speakers unless Chair Powell
    if any(w in low for w in ("speaks", "speech", "remarks", "testifies", "testimony")) and "powell" not in low:
        return None

    # Exclude noisy auctions / housing / regional surveys
    if any(k in low for k in NOISE_EVENT_KEYWORDS):
        return None

    # Exclude S&P Global flash duplicates if ISM/CPI etc. aren't involved
    if low.startswith("s&p global"):
        return None

    for kws, default_zh, impact, why_zh, playbook_zh in CURATED_MACRO_RULES:
        if any(k in low for k in kws):
            zh = default_zh
            for sp_kw, sp_zh in SPECIFIC_MACRO_ZH:
                if sp_kw in low:
                    zh = sp_zh
                    break
            # GDP / Retail Sales / Core PPI stay high; plain PPI / Durable goods medium
            real_impact = impact
            if kws[0] == "gdp" and not any(x in low for x in ("gdp", "retail sales", "core ppi")):
                real_impact = "medium"
            return zh, real_impact, why_zh, playbook_zh

    return None


def _parse_nasdaq_datetime(date_str: str, gmt_raw: str) -> Tuple[int, str, str, str, bool]:
    """Nasdaq's 'gmt' field carries US Eastern Time (HH:MM) or '24H'."""
    y, m, d = [int(x) for x in date_str.split("-")]
    time_s = _clean_val(gmt_raw)
    match = re.match(r"^(\d{1,2}):(\d{2})$", time_s)
    if match:
        hh, mm = int(match.group(1)), int(match.group(2))
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            dt_et = datetime(y, m, d, hh, mm, tzinfo=ET_TZ)
            dt_cst = dt_et.astimezone(CST_TZ)
            return (
                int(dt_et.timestamp()),
                dt_et.strftime("%H:%M"),
                dt_cst.strftime("%Y-%m-%d"),
                dt_cst.strftime("%H:%M"),
                False,
            )

    dt_et_all = datetime(y, m, d, 8, 30, tzinfo=ET_TZ)
    dt_cst_all = dt_et_all.astimezone(CST_TZ)
    return (
        int(dt_et_all.timestamp()),
        "全天",
        dt_cst_all.strftime("%Y-%m-%d"),
        "待定",
        True,
    )


def _parse_market_cap(raw: Optional[str]) -> Tuple[int, str]:
    s = _clean_val(raw).replace(",", "").replace("$", "")
    if not s:
        return 0, ""
    mult = 1.0
    upper = s.upper()
    if upper.endswith("T"):
        mult = 1_000_000_000_000.0
        s = upper[:-1]
    elif upper.endswith("B"):
        mult = 1_000_000_000.0
        s = upper[:-1]
    elif upper.endswith("M"):
        mult = 1_000_000.0
        s = upper[:-1]
    try:
        val = int(float(s) * mult)
    except Exception:
        return 0, _clean_val(raw)
    if val >= 1_000_000_000_000:
        return val, f"${val / 1_000_000_000_000:.2f}T"
    if val >= 1_000_000_000:
        return val, f"${val / 1_000_000_000:.1f}B"
    if val >= 1_000_000:
        return val, f"${val / 1_000_000:.0f}M"
    return val, f"${val:,}"


def _parse_earnings_time(raw: Optional[str]) -> Tuple[str, str, str]:
    t = _clean_val(raw).lower()
    if "pre" in t or "bmo" in t:
        return "BMO", "盘前", "Pre-Market"
    if "after" in t or "amc" in t:
        return "AMC", "盘后", "After-Hours"
    return "TNS", "盘后/待定", "TBA"


async def _fetch_day_econ(date_str: str, sem: asyncio.Semaphore) -> List[Dict[str, Any]]:
    async with sem:
        data = await _http_get_json(
            "https://api.nasdaq.com/api/calendar/economicevents",
            params={"date": date_str},
            headers=NASDAQ_HEADERS,
        )
    if not isinstance(data, dict):
        return []
    rows = ((data.get("data") or {}).get("rows")) or []
    if not isinstance(rows, list):
        return []

    out: List[Dict[str, Any]] = []
    seen = set()
    for r in rows:
        if not isinstance(r, dict):
            continue
        country = _clean_val(r.get("country"))
        event_name = _clean_val(r.get("eventName"))
        matched = _match_curated_macro(event_name, country)
        if not matched:
            continue

        zh_name, impact, why_zh, playbook_zh = matched
        ts, et_time, cst_date, cst_time, all_day = _parse_nasdaq_datetime(date_str, r.get("gmt"))
        actual = _clean_val(r.get("actual"))
        consensus = _clean_val(r.get("consensus"))
        previous = _clean_val(r.get("previous"))

        # Collapse YoY/MoM duplicates for same release time & Chinese topic
        dedup_key = (date_str, et_time, zh_name)
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        out.append({
            "id": f"econ:{date_str}:{et_time}:{len(out)}",
            "date": date_str,
            "et_time": et_time,
            "cst_date": cst_date,
            "cst_time": cst_time,
            "timestamp": ts,
            "all_day": all_day,
            "country": country,
            "country_label": "🇺🇸 美国",
            "event": event_name,
            "event_zh": zh_name,
            "impact": impact,
            "actual": actual,
            "consensus": consensus,
            "previous": previous,
            "why_zh": why_zh,
            "playbook_zh": playbook_zh,
            "description": _clean_val(r.get("description"))[:180],
        })
    return out


async def _fetch_day_earnings(date_str: str, today_date: datetime, sem: asyncio.Semaphore) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    async with sem:
        data = await _http_get_json(
            "https://api.nasdaq.com/api/calendar/earnings",
            params={"date": date_str},
            headers=NASDAQ_HEADERS,
        )
    if not isinstance(data, dict):
        return [], []
    rows = ((data.get("data") or {}).get("rows")) or []
    if not isinstance(rows, list):
        return [], []

    target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    days_until = (target_date - today_date.date()).days

    curated: List[Dict[str, Any]] = []
    index_items: List[Dict[str, Any]] = []

    for r in rows:
        if not isinstance(r, dict):
            continue
        symbol = _clean_val(r.get("symbol")).upper()
        if not symbol:
            continue
        cap_val, cap_fmt = _parse_market_cap(r.get("marketCap"))
        cat_info = US_CATALOG_MAP.get(symbol)
        in_watchlist = cat_info is not None

        if not in_watchlist and cap_val < 2_000_000_000:
            continue

        slot, slot_zh, slot_en = _parse_earnings_time(r.get("time"))
        comp_name = _clean_val(r.get("name")) or symbol
        item = {
            "symbol": symbol,
            "name": cat_info["name"] if cat_info else comp_name,
            "company_name": comp_name,
            "sector": cat_info.get("sector", "") if cat_info else "",
            "sector_en": cat_info.get("sector_en", "") if cat_info else "",
            "in_watchlist": in_watchlist,
            "date": date_str,
            "days_until": days_until,
            "time_slot": slot,
            "time_label_zh": slot_zh,
            "time_label_en": slot_en,
            "market_cap": cap_val,
            "market_cap_fmt": cap_fmt or "-",
            "eps_forecast": _clean_val(r.get("epsForecast")) or "待预测",
            "last_year_eps": _clean_val(r.get("lastYearEPS")) or "-",
            "fiscal_quarter": _clean_val(r.get("fiscalQuarterEnding")) or "-",
            "iv_crush_risk": 0 <= days_until <= 7,
            "playbook_zh": (
                "财报开奖瞬间期权隐含波动率(IV)常大幅跳水（IV Crush），"
                "单腿买Call/Put极易猜对方向也亏钱！建议落袋避险或等次日趋势走稳再做右侧。"
            ),
        }
        index_items.append(item)

        # Curated display list: Watchlist stocks OR mega-caps ($15B+)
        if in_watchlist or cap_val >= 15_000_000_000:
            curated.append(item)

    return curated, index_items


async def fetch_calendar_data(force: bool = False) -> Dict[str, Any]:
    """Fetch curated 6-day macro防插针 & major US earnings避雷 calendar."""
    cache_key = "macro_earnings_calendar_v2"
    if not force:
        cached = _calendar_cache.get(cache_key)
        if cached is not None:
            return cached

    async with _fetch_lock:
        if not force:
            cached = _calendar_cache.get(cache_key)
            if cached is not None:
                return cached

        now_et = datetime.now(ET_TZ)
        dates = [(now_et + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6)]
        sem = asyncio.Semaphore(3)

        try:
            econ_tasks = [_fetch_day_econ(d, sem) for d in dates]
            earn_tasks = [_fetch_day_earnings(d, now_et, sem) for d in dates]
            results = await asyncio.gather(*econ_tasks, *earn_tasks, return_exceptions=True)

            econ_raw = results[: len(dates)]
            earn_raw = results[len(dates):]

            econ_events: List[Dict[str, Any]] = []
            for day_list in econ_raw:
                if isinstance(day_list, list):
                    econ_events.extend(day_list)

            earnings: List[Dict[str, Any]] = []
            all_index_earnings: List[Dict[str, Any]] = []
            for pair in earn_raw:
                if isinstance(pair, tuple) and len(pair) == 2:
                    curated_list, idx_list = pair
                    earnings.extend(curated_list)
                    all_index_earnings.extend(idx_list)

            impact_rank = {"high": 0, "medium": 1, "low": 2}
            econ_events.sort(key=lambda e: (e["timestamp"], impact_rank.get(e["impact"], 3)))
            earnings.sort(key=lambda e: (e["days_until"], not e["in_watchlist"], -e["market_cap"]))

            now_ts = int(time.time())
            future_timed = [e for e in econ_events if not e["all_day"] and e["timestamp"] > now_ts]
            high_future = [e for e in future_timed if e["impact"] == "high"]
            med_future = [e for e in future_timed if e["impact"] == "medium"]
            next_event = (
                high_future[0]
                if high_future
                else (med_future[0] if med_future else (future_timed[0] if future_timed else None))
            )

            by_symbol: Dict[str, Dict[str, Any]] = {}
            for item in all_index_earnings:
                sym = item["symbol"]
                if sym not in by_symbol:
                    by_symbol[sym] = item

            urgent_econ = sum(
                1 for e in econ_events if not e["all_day"] and 0 <= (e["timestamp"] - now_ts) <= 172800
            )
            urgent_watch_earn = sum(
                1 for e in earnings if e["in_watchlist"] and 0 <= e["days_until"] <= 1
            )

            now_cst = datetime.now(CST_TZ).strftime("%H:%M:%S")
            payload = {
                "dates": dates,
                "today_et": dates[0],
                "updated_at": now_cst,
                "ts": now_ts,
                "econ_count": len(econ_events),
                "high_impact_count": sum(1 for e in econ_events if e["impact"] == "high"),
                "urgent_48h_count": urgent_econ + urgent_watch_earn,
                "earnings_count": len(earnings),
                "watchlist_earnings_count": sum(1 for e in earnings if e["in_watchlist"]),
                "next_high_impact": next_event,
                "economic_events": econ_events,
                "earnings": earnings,
                "by_symbol": by_symbol,
            }

            if econ_events or all_index_earnings:
                _calendar_cache.set(cache_key, payload)
                return payload

            stale = _calendar_cache.get_stale(cache_key)
            if stale is not None:
                return stale
            return payload
        except Exception as exc:
            stale = _calendar_cache.get_stale(cache_key)
            if stale is not None:
                return stale
            return {
                "dates": dates,
                "today_et": dates[0],
                "updated_at": datetime.now(CST_TZ).strftime("%H:%M:%S"),
                "ts": int(time.time()),
                "econ_count": 0,
                "high_impact_count": 0,
                "urgent_48h_count": 0,
                "earnings_count": 0,
                "watchlist_earnings_count": 0,
                "next_high_impact": None,
                "economic_events": [],
                "earnings": [],
                "by_symbol": {},
                "error": str(exc)[:180],
            }


async def get_symbol_earnings_warning(symbol: str) -> Optional[Dict[str, Any]]:
    """Fast O(1) lookup for upcoming earnings & IV Crush warning for /api/analyze."""
    sym = (symbol or "").strip().upper()
    if not sym:
        return None
    cached = _calendar_cache.get("macro_earnings_calendar_v2") or _calendar_cache.get_stale("macro_earnings_calendar_v2")
    if cached is None:
        try:
            cached = await asyncio.wait_for(fetch_calendar_data(), timeout=2.2)
        except Exception:
            return None

    item = (cached.get("by_symbol") or {}).get(sym)
    if not item or item.get("days_until", 99) < 0 or item.get("days_until", 99) > 10:
        return None

    days = int(item["days_until"])
    day_text_zh = "今日" if days == 0 else f"{days} 天后"
    slot_zh = item.get("time_label_zh", "待定")
    slot_en = item.get("time_slot", "TNS")

    return {
        "symbol": sym,
        "date": item["date"],
        "days_until": days,
        "time_slot": slot_en,
        "time_label_zh": slot_zh,
        "eps_forecast": item.get("eps_forecast", "-"),
        "iv_crush_risk": bool(item.get("iv_crush_risk")),
        "warning_zh": (
            f"⚠️ 距 {sym} 财报仅 {day_text_zh}（{item['date']} {slot_zh}，预期EPS {item.get('eps_forecast', '-')}）· "
            "期权隐含波动率处于高位，谨防财报后 IV Crush 波动率杀，买单腿 Call/Put 需降仓防双杀！"
        ),
        "warning_en": (
            f"Earnings in {days}d ({item['date']} {slot_en}, Est EPS {item.get('eps_forecast', '-')}) · "
            "High IV Crush risk on single-leg options."
        ),
    }
