"""
main.py — FastAPI 趋势判断工作台后端入口
"""

import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from market_data import fetch_market_data, fetch_live_tick, search_symbols, get_symbol_info
from structure_engine import analyze_structure, compute_dual_ma
from macro_intel import fetch_macro_intelligence
from radar_engine import start_radar_loop, stop_radar_loop, get_radar_snapshot


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_radar_loop()
    try:
        yield
    finally:
        await stop_radar_loop()


app = FastAPI(title="Market Observatory API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


SYMBOL_LABELS = {
    "BTCUSDT": {"name": "比特币 Bitcoin", "exchange": "Binance"},
    "ETHUSDT": {"name": "以太坊 Ethereum", "exchange": "Binance"},
    "SOLUSDT": {"name": "Solana", "exchange": "Binance"},
    "BNBUSDT": {"name": "BNB", "exchange": "Binance"},
    "XRPUSDT": {"name": "XRP", "exchange": "Binance"},
    "DOGEUSDT": {"name": "Dogecoin", "exchange": "Binance"},
    "SUIUSDT": {"name": "Sui", "exchange": "Binance"},
    "AAPL": {"name": "Apple Inc.", "exchange": "NASDAQ"},
    "NVDA": {"name": "NVIDIA Corp.", "exchange": "NASDAQ"},
    "TSLA": {"name": "Tesla Inc.", "exchange": "NASDAQ"},
    "SPY": {"name": "SPDR S&P 500", "exchange": "NYSE"},
    "QQQ": {"name": "Invesco QQQ", "exchange": "NASDAQ"},
    "MSFT": {"name": "Microsoft", "exchange": "NASDAQ"},
    "META": {"name": "Meta Platforms", "exchange": "NASDAQ"},
    "AMZN": {"name": "Amazon.com", "exchange": "NASDAQ"},
    "000001.SS": {"name": "上证指数", "exchange": "SSE"},
    "600519.SS": {"name": "贵州茅台", "exchange": "SSE"},
    "300750.SZ": {"name": "宁德时代", "exchange": "SZSE"},
    "002594.SZ": {"name": "比亚迪", "exchange": "SZSE"},
    "601318.SS": {"name": "中国平安", "exchange": "SSE"},
    "000858.SZ": {"name": "五粮液", "exchange": "SZSE"},
}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/symbols")
async def list_symbols(
    market: str = Query("crypto", description="crypto | us"),
    q: str = Query("", description="search query"),
):
    items = await search_symbols(market, q)
    return {"market": market, "symbols": items}


@app.get("/api/tick")
async def live_tick(
    market: str = Query("crypto"),
    symbol: str = Query("BTCUSDT"),
    interval: str = Query("1h"),
):
    return await fetch_live_tick(market=market, symbol=symbol, interval=interval)


@app.get("/api/macro")
async def macro_intel(
    market: str = Query("crypto"),
    symbol: str = Query("BTCUSDT"),
    force: int = Query(0, ge=0, le=1),
):
    return await fetch_macro_intelligence(market=market, symbol=symbol, force=bool(force))


import base64 as _b64
import html as _html
from pathlib import Path as _Path
from fastapi import Request as _Request, Response as _Response
from calendar_engine import fetch_calendar_data as _fetch_calendar_data, get_symbol_earnings_warning as _get_earnings_warning


@app.get("/api/radar")
async def radar_overview(force: int = Query(0, ge=0, le=1)):
    return await get_radar_snapshot(force=bool(force))


@app.get("/api/calendar")
async def macro_earnings_calendar(force: int = Query(0, ge=0, le=1)):
    return await _fetch_calendar_data(force=bool(force))


def _get_project_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def _load_touch_icon_b64() -> str:
    root = _get_project_root()
    candidates = [
        root / "frontend" / "dist" / "apple-touch-icon.png",
        root / "frontend" / "public" / "apple-touch-icon.png",
    ]
    for p in candidates:
        if p.exists() and p.is_file():
            return _b64.b64encode(p.read_bytes()).decode("ascii")
    return ""


@app.api_route("/api/ios-profile", methods=["GET", "HEAD"])
async def download_ios_webclip_profile(request: _Request):
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc).split(",")[0].strip()
    if host and "trycloudflare.com" in host:
        proto = "https"
    app_url = f"{proto}://{host}/" if host else "http://127.0.0.1:8766/"
    escaped_url = _html.escape(app_url, quote=True)

    icon_b64 = _load_touch_icon_b64()
    icon_block = f"\n\t\t\t<key>Icon</key>\n\t\t\t<data>{icon_b64}</data>" if icon_b64 else ""

    mobileconfig = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PayloadContent</key>
\t<array>
\t\t<dict>
\t\t\t<key>FullScreen</key>
\t\t\t<true/>{icon_block}
\t\t\t<key>IgnoreManifestScope</key>
\t\t\t<false/>
\t\t\t<key>IsRemovable</key>
\t\t\t<true/>
\t\t\t<key>Label</key>
\t\t\t<string>观势看盘</string>
\t\t\t<key>PayloadDescription</key>
\t\t\t<string>观势 Market Observatory 桌面独立看盘应用</string>
\t\t\t<key>PayloadDisplayName</key>
\t\t\t<string>观势看盘</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>com.observatory.app.webclip</string>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.webClip.managed</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>8E42B910-5F3C-4B21-9A08-7731D9E5A101</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>Precomposed</key>
\t\t\t<true/>
\t\t\t<key>URL</key>
\t\t\t<string>{escaped_url}</string>
\t\t</dict>
\t</array>
\t<key>PayloadDescription</key>
\t<string>一键将「观势 · Market Observatory」安装为 iPhone / iPad 主屏幕全屏独立 App</string>
\t<key>PayloadDisplayName</key>
\t<string>观势看盘 · Market Observatory</string>
\t<key>PayloadIdentifier</key>
\t<string>com.observatory.app.profile</string>
\t<key>PayloadOrganization</key>
\t<string>Market Observatory</string>
\t<key>PayloadRemovalDisallowed</key>
\t<false/>
\t<key>PayloadType</key>
\t<string>Configuration</string>
\t<key>PayloadUUID</key>
\t<string>8E42B910-5F3C-4B21-9A08-7731D9E5A100</string>
\t<key>PayloadVersion</key>
\t<integer>1</integer>
</dict>
</plist>
"""
    return _Response(
        content=mobileconfig.encode("utf-8"),
        media_type="application/x-apple-aspen-config",
        headers={
            "Content-Disposition": 'attachment; filename="MarketObservatory.mobileconfig"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/analyze")
async def analyze(
    market: str = Query("crypto"),
    symbol: str = Query("BTCUSDT"),
    interval: str = Query("1h"),
    limit: int = Query(500, ge=50, le=800),
    replay_index: int = Query(-1),
    ma_type: str = Query("ema"),
    ma_fast: int = Query(20, ge=2, le=250),
    ma_slow: int = Query(60, ge=3, le=500),
    force: int = Query(0, ge=0, le=1),
):
    # 大周期大势锁自动核验 (Crypto 看 4H, 美股看 1D) — 与主K线并发拉取提速50%
    htf_interval = None
    if replay_index < 0:
        if market == "crypto" and interval in ("1m", "5m", "15m", "30m", "1h"):
            htf_interval = "4h"
        elif market == "us" and interval not in ("1d", "1w"):
            htf_interval = "1d"

    primary_task = fetch_market_data(
        market=market,
        symbol=symbol,
        interval=interval,
        limit=limit,
        replay_index=replay_index,
        force=bool(force),
    )
    if htf_interval:
        htf_task = fetch_market_data(
            market=market,
            symbol=symbol,
            interval=htf_interval,
            limit=150,
            replay_index=-1,
            force=bool(force),
        )
        data, htf_data = await asyncio.gather(primary_task, htf_task, return_exceptions=True)
        if isinstance(data, Exception):
            data = {"error": str(data), "meta": {"symbol": symbol, "price": 0, "price_change": 0, "price_change_percent": 0, "source": "error"}, "candles": [], "total_candles": 0}
        if isinstance(htf_data, Exception):
            htf_data = None
    else:
        data = await primary_task
        htf_data = None

    if "error" in data:
        data["meta"]["interval"] = interval
        data["meta"]["market"] = market
        return {**data, "analysis": analyze_structure([], ma_type=ma_type, ma_fast=ma_fast, ma_slow=ma_slow, market=market, interval=interval)}

    candles = data["candles"]
    analysis = analyze_structure(candles, ma_type=ma_type, ma_fast=ma_fast, ma_slow=ma_slow, market=market, interval=interval)

    htf_lock = None
    if htf_interval and isinstance(htf_data, dict):
        try:
            if "error" not in htf_data and len(htf_data.get("candles", [])) >= 20:
                htf_ma = compute_dual_ma(htf_data["candles"], ma_type=ma_type, fast_period=ma_fast, slow_period=ma_slow)
                locked = htf_ma["trend"] in ("bearish", "rebound", "tangled")
                htf_lock = {
                    "interval": htf_interval,
                    "interval_zh": "4小时" if htf_interval == "4h" else "日线",
                    "locked": locked,
                    "trend": htf_ma["trend"],
                    "label_zh": htf_ma["trend_label_zh"],
                    "label_en": htf_ma["trend_label_en"],
                    "fast_val": htf_ma["fast_val"],
                    "slow_val": htf_ma["slow_val"],
                }
                if locked and analysis.get("buy_advice") and analysis["buy_advice"]["action"] in ("BUY", "ACCUMULATE"):
                    analysis["buy_advice"]["action"] = "WAIT"
                    analysis["buy_advice"]["action_zh"] = f"{htf_lock['interval_zh']}大势未解锁 · 观望"
                    analysis["buy_advice"]["action_en"] = f"{htf_interval.upper()} Locked · Wait"
                    analysis["buy_advice"]["position_zh"] = f"建议 0% 空仓（{htf_lock['interval_zh']}白线仍在黄线下方，小周期只当反弹）"
                    analysis["buy_advice"]["position_en"] = f"0% Cash ({htf_interval.upper()} MA still bearish)"
                    analysis["buy_advice"]["risk_parity_pct"] = 0.0
                if locked and analysis.get("options_advice") and analysis["options_advice"]["signal"] == "BUY_CALL":
                    analysis["options_advice"]["signal"] = "WAIT_IV"
                    analysis["options_advice"]["signal_zh"] = f"{htf_lock['interval_zh']}锁死 · 勿逆势买 Call"
                    analysis["options_advice"]["signal_en"] = f"{htf_interval.upper()} Locked · No Call"
                    analysis["options_advice"]["size_zh"] = f"0% 观望（{htf_lock['interval_zh']}仍为空头排列，逆势买 Call 极易归零）"
        except Exception:
            pass
    else:
        cur_ma = analysis.get("dual_ma")
        if cur_ma:
            htf_lock = {
                "interval": interval,
                "interval_zh": "4小时" if interval == "4h" else ("日线" if interval == "1d" else interval),
                "locked": cur_ma["trend"] in ("bearish", "rebound", "tangled"),
                "trend": cur_ma["trend"],
                "label_zh": cur_ma["trend_label_zh"],
                "label_en": cur_ma["trend_label_en"],
                "fast_val": cur_ma["fast_val"],
                "slow_val": cur_ma["slow_val"],
            }
    analysis["htf_lock"] = htf_lock

    info = get_symbol_info(data["meta"]["symbol"]) or SYMBOL_LABELS.get(data["meta"]["symbol"], {})
    data["meta"]["name"] = info.get("name", data["meta"]["symbol"])
    data["meta"]["exchange"] = info.get("exchange", data["meta"].get("source", "").upper())
    data["meta"]["interval"] = interval
    data["meta"]["market"] = market
    if info.get("sector"):
        data["meta"]["sector"] = info.get("sector")
        data["meta"]["sector_en"] = info.get("sector_en", "")

    if market == "us":
        earnings_warn = await _get_earnings_warning(data["meta"]["symbol"])
        if earnings_warn:
            analysis["earnings_warning"] = earnings_warn

    return {
        "meta": data["meta"],
        "candles": candles,
        "total_candles": data["total_candles"],
        "macd": analysis.pop("macd", []),
        "analysis": analysis,
    }


DIST_DIR = _get_project_root() / "frontend" / "dist"
if DIST_DIR.is_dir():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
async def serve_spa(full_path: str):
    if full_path.startswith("api/") or full_path == "api":
        raise HTTPException(status_code=404, detail="API route not found")
    if not DIST_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Frontend dist not built")

    candidate = (DIST_DIR / full_path).resolve()
    if (
        full_path
        and str(candidate).startswith(str(DIST_DIR.resolve()))
        and candidate.is_file()
    ):
        return FileResponse(candidate)

    index_file = DIST_DIR / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(index_file, headers={"Cache-Control": "no-cache"})
