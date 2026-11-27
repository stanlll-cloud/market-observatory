"""
ma_alert_engine.py — 均线穿越自动监控与 Telegram / Webhook 推送引擎
====================================================================
支持任意美股 / ETF / 加密货币在不同周期（1h / 4h / 1d / 1w）对 EMA / SMA 均线（支持偏移%如 SMA200×0.98 = -2%）
发生上穿 / 下破 / 双向穿越时自动触发提醒，并通过 Telegram Bot 或自定义 Webhook 推送。
零额外三方依赖，完全复用 market_data 与 structure_engine。
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import httpx

from market_data import _detect_live_proxy, fetch_market_data
from structure_engine import _ema, _sma

CST_TZ = ZoneInfo("Asia/Shanghai")

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
ALERTS_FILE = DATA_DIR / "ma_alerts.json"
CHANNELS_FILE = DATA_DIR / "alert_channels.json"

_loop_task: Optional[asyncio.Task] = None
_stop_event = asyncio.Event()
_state_lock = asyncio.Lock()


def _load_dotenv_once() -> None:
    """读取项目根目录或 backend/.env 的可选通知配置（不覆盖已有进程环境变量）."""
    for env_path in (PROJECT_ROOT / ".env", BACKEND_DIR / ".env"):
        if not env_path.is_file():
            continue
        try:
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
        except Exception:
            pass


_load_dotenv_once()


def _now_cst_str() -> str:
    return datetime.now(CST_TZ).strftime("%Y-%m-%d %H:%M:%S CST")


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _load_state() -> Dict[str, Any]:
    raw = _read_json(ALERTS_FILE, {})
    if not isinstance(raw, dict):
        raw = {}
    rules = raw.get("rules")
    history = raw.get("history")
    return {
        "rules": rules if isinstance(rules, list) else [],
        "history": history if isinstance(history, list) else [],
        "last_scan_at": raw.get("last_scan_at") or "",
    }


def _save_state(state: Dict[str, Any]) -> None:
    if len(state.get("history", [])) > 50:
        state["history"] = state["history"][:50]
    _write_json(ALERTS_FILE, state)


def _get_channel_secrets() -> Dict[str, str]:
    saved = _read_json(CHANNELS_FILE, {})
    if not isinstance(saved, dict):
        saved = {}
    tg_token = (saved.get("telegram_bot_token") or os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    tg_chat = (saved.get("telegram_chat_id") or os.environ.get("TELEGRAM_CHAT_ID") or "").strip()
    webhook = (saved.get("webhook_url") or os.environ.get("WEBHOOK_URL") or "").strip()
    return {
        "telegram_bot_token": tg_token,
        "telegram_chat_id": tg_chat,
        "webhook_url": webhook,
    }


def _mask_val(val: str) -> str:
    if not val:
        return ""
    if len(val) <= 6:
        return "***"
    return f"{val[:3]}***{val[-4:]}"


def _channel_summary() -> Dict[str, Any]:
    sec = _get_channel_secrets()
    try:
        poll_sec = max(30, int(os.environ.get("MA_ALERT_POLL_SEC") or "180"))
    except ValueError:
        poll_sec = 180
    return {
        "telegram_configured": bool(sec["telegram_bot_token"] and sec["telegram_chat_id"]),
        "telegram_token_masked": _mask_val(sec["telegram_bot_token"]),
        "telegram_chat_id_masked": _mask_val(sec["telegram_chat_id"]),
        "webhook_configured": bool(sec["webhook_url"]),
        "webhook_masked": _mask_val(sec["webhook_url"]),
        "poll_sec": poll_sec,
    }


async def _post_json(url: str, payload: Dict[str, Any]) -> Tuple[bool, str]:
    proxy = _detect_live_proxy()
    last_err = ""
    for use_proxy in ([proxy, None] if proxy else [None]):
        try:
            async with httpx.AsyncClient(
                proxy=use_proxy,
                timeout=12.0,
                trust_env=False,
                follow_redirects=True,
            ) as client:
                resp = await client.post(url, json=payload)
                if 200 <= resp.status_code < 300:
                    return True, ""
                last_err = f"HTTP {resp.status_code}: {resp.text[:160]}"
        except Exception as exc:
            last_err = repr(exc)
    return False, last_err


async def _dispatch_notification(title: str, body: str, event_payload: Dict[str, Any]) -> Dict[str, Any]:
    sec = _get_channel_secrets()
    sent_channels: List[str] = []
    errors: List[str] = []

    if sec["telegram_bot_token"] and sec["telegram_chat_id"]:
        tg_url = f"https://api.telegram.org/bot{sec['telegram_bot_token']}/sendMessage"
        ok, err = await _post_json(
            tg_url,
            {
                "chat_id": sec["telegram_chat_id"],
                "text": f"{title}\n\n{body}",
                "disable_web_page_preview": True,
            },
        )
        if ok:
            sent_channels.append("telegram")
        else:
            errors.append(f"telegram: {err}")

    if sec["webhook_url"]:
        ok, err = await _post_json(
            sec["webhook_url"],
            {
                "title": title,
                "text": f"{title}\n{body}",
                "content": f"{title}\n{body}",
                "event": event_payload,
            },
        )
        if ok:
            sent_channels.append("webhook")
        else:
            errors.append(f"webhook: {err}")

    return {
        "ok": len(sent_channels) > 0,
        "sent_channels": sent_channels,
        "errors": errors,
    }


def _fmt_price(v: float) -> str:
    if v >= 1000:
        return f"${v:,.2f}"
    if v >= 10:
        return f"${v:.2f}"
    return f"${v:.4f}"


def _format_rule_label(rule: Dict[str, Any]) -> str:
    ma_name = f"{rule['ma_type'].upper()}{rule['period']}"
    offset = float(rule.get("offset_pct") or 0.0)
    if abs(offset) >= 0.01:
        mult = 1.0 + offset / 100.0
        ma_name = f"{ma_name}×{mult:.2f}"
    return ma_name


async def _evaluate_rule(rule: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """拉取最新 K 线并评估单条均线穿越规则；返回新触发事件 dict 或 None."""
    market = str(rule.get("market") or "us").lower()
    symbol = str(rule.get("symbol") or "").upper()
    interval = str(rule.get("interval") or "1d").lower()
    ma_type = str(rule.get("ma_type") or "sma").lower()
    period = max(2, min(250, int(rule.get("period") or 20)))
    offset_pct = float(rule.get("offset_pct") or 0.0)
    direction = str(rule.get("direction") or "both").lower()
    cooldown_min = max(1, int(rule.get("cooldown_min") or 240))

    res = await fetch_market_data(market=market, symbol=symbol, interval=interval, limit=260, force=True)
    if "error" in res or len(res.get("candles") or []) < max(5, period):
        return None

    candles = res["candles"]
    closes = [float(c["close"]) for c in candles]
    live_price = float((res.get("meta") or {}).get("price") or closes[-1])
    prev_close = float(closes[-2])

    ma_vals = _sma(closes, period) if ma_type == "sma" else _ema(closes, period)
    if len(ma_vals) < 2:
        return None

    curr_ma = float(ma_vals[-1])
    prev_ma = float(ma_vals[-2])
    mult = 1.0 + offset_pct / 100.0
    curr_trig = curr_ma * mult
    prev_trig = prev_ma * mult
    if curr_trig <= 0 or prev_trig <= 0:
        return None

    curr_side = "above" if live_price >= curr_trig else "below"
    prev_side = rule.get("last_side") or ("above" if prev_close >= prev_trig else "below")

    rule["last_price"] = round(live_price, 4)
    rule["last_ma"] = round(curr_ma, 4)
    rule["last_trigger_line"] = round(curr_trig, 4)
    rule["last_dist_pct"] = round((live_price - curr_trig) / curr_trig * 100.0, 2)
    rule["last_side"] = curr_side
    rule["last_checked_at"] = _now_cst_str()

    if not rule.get("enabled", True) or curr_side == prev_side:
        return None

    crossed_above = prev_side == "below" and curr_side == "above"
    crossed_below = prev_side == "above" and curr_side == "below"
    matched = (
        (direction == "cross_above" and crossed_above)
        or (direction == "cross_below" and crossed_below)
        or (direction == "both" and (crossed_above or crossed_below))
    )
    if not matched:
        return None

    now_ts = int(time.time())
    last_trig_ts = int(rule.get("last_triggered_ts") or 0)
    if now_ts - last_trig_ts < cooldown_min * 60:
        return None

    rule["last_triggered_ts"] = now_ts
    rule["last_triggered_at"] = _now_cst_str()

    action_emoji = "🚀" if crossed_above else "🚨"
    action_zh = "放量/收盘上穿" if crossed_above else "有效下破"
    ma_label = _format_rule_label(rule)
    tf_map = {"1h": "1小时", "4h": "4小时", "1d": "日线", "1w": "周线"}
    tf_zh = tf_map.get(interval, interval.upper())

    title = f"{action_emoji} 观势均线预警 · {symbol} {action_zh} {tf_zh} {ma_label}"
    lines = [
        f"标的：{symbol} ({market.upper()}) · 周期：{tf_zh}",
        f"现价：{_fmt_price(live_price)} vs 触发线：{_fmt_price(curr_trig)} ({rule['last_dist_pct']:+.2f}%)",
        f"参考 {ma_type.upper()}{period}：{_fmt_price(curr_ma)}",
    ]
    if rule.get("note"):
        lines.append(f"策略备注：{rule['note']}")
    lines.append(f"时间：{rule['last_checked_at']}")
    body = "\n".join(lines)

    event_obj = {
        "id": f"evt_{now_ts}_{uuid.uuid4().hex[:6]}",
        "rule_id": rule["id"],
        "symbol": symbol,
        "market": market,
        "interval": interval,
        "ma_label": ma_label,
        "crossed": "above" if crossed_above else "below",
        "price": round(live_price, 4),
        "trigger_line": round(curr_trig, 4),
        "title": title,
        "triggered_at": rule["last_checked_at"],
        "ts": now_ts,
    }
    dispatch_res = await _dispatch_notification(title, body, event_obj)
    event_obj["pushed_via"] = dispatch_res["sent_channels"]
    return event_obj


async def run_ma_alert_scan_now() -> Dict[str, Any]:
    """立即扫描全部启用规则并触发推送."""
    async with _state_lock:
        state = _load_state()
        rules = state["rules"]

    enabled_rules = [r for r in rules if r.get("enabled", True)]
    new_events: List[Dict[str, Any]] = []
    sem = asyncio.Semaphore(4)

    async def _run_one(r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        async with sem:
            try:
                return await _evaluate_rule(r)
            except Exception:
                return None

    results = await asyncio.gather(*(_run_one(r) for r in rules))
    for ev in results:
        if ev is not None:
            new_events.append(ev)

    async with _state_lock:
        fresh = _load_state()
        # 保留刚刚在扫描期间可能新增或删除的规则列表，仅合并已存在规则的检测状态
        by_id = {r["id"]: r for r in rules}
        merged_rules = []
        for cur in fresh["rules"]:
            upd = by_id.get(cur["id"])
            if upd:
                for k in (
                    "last_price",
                    "last_ma",
                    "last_trigger_line",
                    "last_dist_pct",
                    "last_side",
                    "last_checked_at",
                    "last_triggered_at",
                    "last_triggered_ts",
                ):
                    if k in upd:
                        cur[k] = upd[k]
            merged_rules.append(cur)
        fresh["rules"] = merged_rules
        if new_events:
            fresh["history"] = (new_events + fresh.get("history", []))[:50]
        fresh["last_scan_at"] = _now_cst_str()
        _save_state(fresh)

    return {
        "scanned": len(rules),
        "enabled": len(enabled_rules),
        "triggered": len(new_events),
        "events": new_events,
        "last_scan_at": _now_cst_str(),
    }


async def _poll_worker() -> None:
    # 延迟 20s 等主站与代理探测稳定后再开始定时巡检
    try:
        await asyncio.wait_for(_stop_event.wait(), timeout=20.0)
        return
    except asyncio.TimeoutError:
        pass

    while not _stop_event.is_set():
        try:
            state = _load_state()
            if state.get("rules"):
                await run_ma_alert_scan_now()
        except Exception:
            pass
        poll_sec = _channel_summary()["poll_sec"]
        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=float(poll_sec))
        except asyncio.TimeoutError:
            continue


def start_ma_alert_loop() -> None:
    global _loop_task
    _stop_event.clear()
    if _loop_task is None or _loop_task.done():
        _loop_task = asyncio.create_task(_poll_worker())


async def stop_ma_alert_loop() -> None:
    global _loop_task
    _stop_event.set()
    if _loop_task is not None and not _loop_task.done():
        _loop_task.cancel()
        try:
            await _loop_task
        except asyncio.CancelledError:
            pass
    _loop_task = None


async def list_ma_alerts() -> Dict[str, Any]:
    state = _load_state()
    return {
        "rules": state["rules"],
        "history": state["history"],
        "last_scan_at": state.get("last_scan_at") or "",
        "channels": _channel_summary(),
    }


async def add_ma_alert(payload: Dict[str, Any]) -> Dict[str, Any]:
    market = str(payload.get("market") or "us").lower()
    if market not in ("us", "crypto", "commodity"):
        market = "us"
    symbol = str(payload.get("symbol") or "").strip().upper()
    if not symbol:
        raise ValueError("symbol is required")
    interval = str(payload.get("interval") or "1d").lower()
    if interval not in ("1h", "4h", "1d", "1w"):
        interval = "1d"
    ma_type = str(payload.get("ma_type") or "sma").lower()
    if ma_type not in ("ema", "sma"):
        ma_type = "sma"
    period = max(2, min(250, int(payload.get("period") or 20)))
    direction = str(payload.get("direction") or "both").lower()
    if direction not in ("cross_above", "cross_below", "both"):
        direction = "both"
    offset_pct = round(max(-50.0, min(50.0, float(payload.get("offset_pct") or 0.0))), 2)
    cooldown_min = max(1, min(1440, int(payload.get("cooldown_min") or 240)))
    note = str(payload.get("note") or "").strip()[:120]

    async with _state_lock:
        state = _load_state()
        for existing in state["rules"]:
            if (
                existing.get("market") == market
                and existing.get("symbol") == symbol
                and existing.get("interval") == interval
                and existing.get("ma_type") == ma_type
                and int(existing.get("period") or 0) == period
                and existing.get("direction") == direction
                and abs(float(existing.get("offset_pct") or 0.0) - offset_pct) < 0.01
            ):
                existing["enabled"] = True
                if note:
                    existing["note"] = note
                _save_state(state)
                return {"rule": existing, "duplicate": True}

        rule = {
            "id": f"ma_{uuid.uuid4().hex[:8]}",
            "market": market,
            "symbol": symbol,
            "interval": interval,
            "ma_type": ma_type,
            "period": period,
            "direction": direction,
            "offset_pct": offset_pct,
            "enabled": True,
            "cooldown_min": cooldown_min,
            "last_side": None,
            "last_price": 0.0,
            "last_ma": 0.0,
            "last_trigger_line": 0.0,
            "last_dist_pct": 0.0,
            "last_checked_at": "",
            "last_triggered_at": None,
            "last_triggered_ts": 0,
            "note": note,
        }
        # 新建规则立即抓一次基线价与当前均线状态（不回溯触发历史）
        try:
            await _evaluate_rule(rule)
        except Exception:
            pass

        state["rules"].insert(0, rule)
        _save_state(state)
        return {"rule": rule, "duplicate": False}


async def toggle_ma_alert(rule_id: str, enabled: Optional[bool] = None) -> Dict[str, Any]:
    async with _state_lock:
        state = _load_state()
        for r in state["rules"]:
            if r["id"] == rule_id:
                r["enabled"] = (not r.get("enabled", True)) if enabled is None else bool(enabled)
                _save_state(state)
                return {"ok": True, "rule": r}
    return {"ok": False, "error": "rule not found"}


async def delete_ma_alert(rule_id: str) -> Dict[str, Any]:
    async with _state_lock:
        state = _load_state()
        before = len(state["rules"])
        state["rules"] = [r for r in state["rules"] if r["id"] != rule_id]
        if len(state["rules"]) == before:
            return {"ok": False, "error": "rule not found"}
        _save_state(state)
        return {"ok": True}


async def save_channel_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    cur = _read_json(CHANNELS_FILE, {})
    if not isinstance(cur, dict):
        cur = {}

    if "telegram_bot_token" in payload and str(payload["telegram_bot_token"]).strip():
        cur["telegram_bot_token"] = str(payload["telegram_bot_token"]).strip()
    if "telegram_chat_id" in payload and str(payload["telegram_chat_id"]).strip():
        cur["telegram_chat_id"] = str(payload["telegram_chat_id"]).strip()
    if "webhook_url" in payload:
        cur["webhook_url"] = str(payload["webhook_url"] or "").strip()

    _write_json(CHANNELS_FILE, cur)
    return {"ok": True, "channels": _channel_summary()}


async def send_test_notification() -> Dict[str, Any]:
    now_str = _now_cst_str()
    title = "✅ 观势 · 均线穿越自动推送测试成功"
    body = (
        "Telegram / Webhook 推送通道已打通。\n"
        f"后台每 {_channel_summary()['poll_sec']} 秒自动扫描均线穿越规则。\n"
        f"时间：{now_str}"
    )
    res = await _dispatch_notification(title, body, {"type": "test", "time": now_str})
    return {**res, "channels": _channel_summary()}
