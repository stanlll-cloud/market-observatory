"""
win_launcher.py — 观势 · Market Observatory 跨平台桌面启动与独立引擎入口

支持三种模式:
  1. 默认桌面模式: 启动嵌入式 FastAPI 引擎并以无边框独立窗口打开工作台 (Windows Edge/Chrome --app)
  2. --server-only: 仅前台运行本地服务 (供 macOS 原生 .app 子进程托管)
  3. --headless-check: CI / 本地冒烟自检，验证 /api/health 与 / 页面返回 200 后安全退出
"""

from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Optional


def _get_app_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def _get_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        target = base / "MarketObservatory"
    else:
        target = Path.home() / ".market-observatory"
    target.mkdir(parents=True, exist_ok=True)
    return target


def _ensure_std_streams() -> None:
    """In PyInstaller --noconsole mode stdout/stderr are None; redirect to a log file so uvicorn never crashes."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        log_path = _get_data_dir() / "observatory.log"
        log_fh = open(log_path, "a", encoding="utf-8", buffering=1)
        if sys.stdout is None:
            sys.stdout = log_fh
        if sys.stderr is None:
            sys.stderr = log_fh
    except Exception:
        devnull = open(os.devnull, "w", encoding="utf-8")
        if sys.stdout is None:
            sys.stdout = devnull
        if sys.stderr is None:
            sys.stderr = devnull


def _no_proxy_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _check_health(port: int, timeout: float = 0.8) -> bool:
    url = f"http://127.0.0.1:{port}/api/health"
    try:
        with _no_proxy_opener().open(url, timeout=timeout) as resp:
            if resp.status != 200:
                return False
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("status") == "ok"
    except Exception:
        return False


def _pick_free_port(preferred_start: int = 8766, preferred_end: int = 8799) -> int:
    for port in range(preferred_start, preferred_end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _prepare_backend_import():
    root = _get_app_root()
    backend_dir = root / "backend"
    if backend_dir.is_dir() and str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    import main as backend_main  # noqa: E402
    return backend_main.app


def _start_threaded_server(port: int):
    import uvicorn

    asgi_app = _prepare_backend_import()

    class ThreadedUvicornServer(uvicorn.Server):
        def install_signal_handlers(self) -> None:
            # Signal handlers must only be registered on the main thread
            return

    config = uvicorn.Config(
        asgi_app,
        host="127.0.0.1",
        port=port,
        log_config=None,
        access_log=False,
        log_level="warning",
    )
    server = ThreadedUvicornServer(config)
    thread = threading.Thread(target=server.run, name="observatory-uvicorn", daemon=True)
    thread.start()
    return server, thread


def _wait_for_health(port: int, timeout_sec: float = 12.0) -> bool:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if _check_health(port, timeout=0.6):
            return True
        time.sleep(0.15)
    return False


def _run_headless_check() -> int:
    port = _pick_free_port(18766, 18900)
    server, thread = _start_threaded_server(port)
    try:
        if not _wait_for_health(port, timeout_sec=12.0):
            print("SELF_TEST_FAIL: health check timed out", file=sys.stderr)
            return 1

        opener = _no_proxy_opener()
        with opener.open(f"http://127.0.0.1:{port}/", timeout=5.0) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            if resp.status != 200 or "<title>" not in body.lower():
                print(f"SELF_TEST_FAIL: unexpected root status={resp.status}", file=sys.stderr)
                return 1

        print("SELF_TEST_OK")
        return 0
    finally:
        server.should_exit = True
        thread.join(timeout=3.0)


def _run_server_only(port: int) -> int:
    import uvicorn

    asgi_app = _prepare_backend_import()
    config = uvicorn.Config(
        asgi_app,
        host="127.0.0.1",
        port=port,
        log_config=None,
        access_log=False,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    server.run()
    return 0


def _find_chromium_app_browser() -> Optional[str]:
    candidates = []
    if sys.platform == "win32":
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        local = os.environ.get("LOCALAPPDATA", "")
        candidates.extend([
            os.path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
            os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
            os.path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
            os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
        ])
    for name in ("msedge", "msedge.exe", "google-chrome", "chrome", "chrome.exe"):
        found = shutil.which(name)
        if found:
            candidates.append(found)

    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def _open_tk_control_window(url: str, port: int) -> None:
    try:
        import tkinter as tk
    except Exception:
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1.0)
        except KeyboardInterrupt:
            return

    root = tk.Tk()
    root.title("观势 · Market Observatory")
    root.geometry("420x220")
    root.resizable(False, False)
    root.configure(bg="#060f0c")

    try:
        ico_path = _get_app_root() / "windows-app" / "app.ico"
        if ico_path.is_file() and sys.platform == "win32":
            root.iconbitmap(str(ico_path))
    except Exception:
        pass

    title_lbl = tk.Label(
        root,
        text="观势 · Market Observatory",
        font=("Microsoft YaHei UI", 14, "bold"),
        fg="#f1f5f9",
        bg="#060f0c",
    )
    title_lbl.pack(pady=(22, 6))

    sub_lbl = tk.Label(
        root,
        text=f"本地量化看盘引擎运行中 · http://127.0.0.1:{port}",
        font=("Microsoft YaHei UI", 9),
        fg="#34d399",
        bg="#060f0c",
    )
    sub_lbl.pack(pady=(0, 6))

    hint_lbl = tk.Label(
        root,
        text="关闭此小窗将同步停止本地行情服务",
        font=("Microsoft YaHei UI", 9),
        fg="#93b5a9",
        bg="#060f0c",
    )
    hint_lbl.pack(pady=(0, 18))

    btn_frame = tk.Frame(root, bg="#060f0c")
    btn_frame.pack()

    open_btn = tk.Button(
        btn_frame,
        text="打开看盘工作台",
        command=lambda: webbrowser.open(url),
        font=("Microsoft YaHei UI", 10, "bold"),
        fg="#ffffff",
        bg="#059669",
        activebackground="#10b981",
        activeforeground="#ffffff",
        relief="flat",
        padx=16,
        pady=7,
        cursor="hand2",
    )
    open_btn.pack(side="left", padx=8)

    quit_btn = tk.Button(
        btn_frame,
        text="退出并关闭服务",
        command=root.destroy,
        font=("Microsoft YaHei UI", 10),
        fg="#e2e8f0",
        bg="#1e293b",
        activebackground="#334155",
        activeforeground="#ffffff",
        relief="flat",
        padx=14,
        pady=7,
        cursor="hand2",
    )
    quit_btn.pack(side="left", padx=8)

    root.mainloop()


def _run_desktop_gui() -> int:
    started_server = None
    server_thread = None

    if _check_health(8766, timeout=0.6):
        port = 8766
    else:
        port = _pick_free_port(8766, 8799)
        started_server, server_thread = _start_threaded_server(port)
        if not _wait_for_health(port, timeout_sec=12.0):
            if started_server is not None:
                started_server.should_exit = True
            return 1

    url = f"http://127.0.0.1:{port}/"
    try:
        browser = _find_chromium_app_browser()
        if browser:
            profile_dir = _get_data_dir() / "WindowProfile"
            profile_dir.mkdir(parents=True, exist_ok=True)
            cmd = [
                browser,
                f"--app={url}",
                f"--user-data-dir={profile_dir}",
                "--window-size=1480,920",
                "--no-first-run",
                "--no-default-browser-check",
            ]
            t0 = time.monotonic()
            proc = subprocess.Popen(cmd)
            proc.wait()
            elapsed = time.monotonic() - t0
            # Edge/Chrome can exit quickly if handing off to an existing process
            if elapsed < 2.5 and started_server is not None:
                _open_tk_control_window(url, port)
        else:
            webbrowser.open(url)
            if started_server is not None:
                _open_tk_control_window(url, port)
        return 0
    finally:
        if started_server is not None:
            started_server.should_exit = True
        if server_thread is not None:
            server_thread.join(timeout=3.0)


def main() -> int:
    multiprocessing.freeze_support()
    os.environ.setdefault("PYTHONUTF8", "1")
    _ensure_std_streams()

    parser = argparse.ArgumentParser(description="Market Observatory Desktop Launcher")
    parser.add_argument("--headless-check", action="store_true", help="Run smoke self-test and exit")
    parser.add_argument("--server-only", action="store_true", help="Run embedded backend server only")
    parser.add_argument("--port", type=int, default=8766, help="Server port for --server-only")
    args = parser.parse_args()

    if args.headless_check:
        return _run_headless_check()
    if args.server_only:
        return _run_server_only(args.port)
    return _run_desktop_gui()


if __name__ == "__main__":
    raise SystemExit(main())
