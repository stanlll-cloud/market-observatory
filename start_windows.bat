@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.10+ 或直接下载免安装 Release 单文件版 (.exe)！
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] 首次运行，正在创建 Python 虚拟环境...
    python -m venv .venv
)

echo [2/3] 正在检查并安装后端依赖...
".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
".venv\Scripts\python.exe" -m pip install --quiet -r backend\requirements.txt

echo [3/3] 正在启动 观势 Market Observatory 桌面工作台...
".venv\Scripts\python.exe" windows-app\win_launcher.py
endlocal
