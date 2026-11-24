# 📈 观势 · Market Observatory

> **美股全天候（盘前 / 盘中 / 盘后）& 加密货币量化趋势看盘工作台**
>
> **双均线大势锁 (`EMA20/60/120`) · 均线扣抵推演 · 缠论自动中枢/买卖点/背驰 · 筹码峰 VPVR · 双图多周期联动 · 64 标的量化选股雷达 · 宏观与财报 IV 避雷日历**

[![Release](https://img.shields.io/github/v/release/stanlll-cloud/market-observatory?label=Release&color=10b981)](https://github.com/stanlll-cloud/market-observatory/releases/latest)
[![Platforms](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20iOS%20WebClip-0ea5e9)](#-%E4%B8%80%E9%94%AE%E4%B8%8B%E8%BD%BD%E6%A1%8C%E9%9D%A2%E7%89%88%E5%BC%80%E7%AE%B1%E5%8D%B3%E7%94%A8)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b.svg)](LICENSE)

---

## 📥 一键下载桌面版（免装 Python / Node，开箱即用）

桌面端已经将完整的 **FastAPI 量化计算引擎 + TradingView Lightweight Charts 前端** 全部打包进应用内部，下载后直接运行，行情直连你本机网络，无任何第三方中转或数据收集：

| 平台 | 安装包 | 说明 | 下载链接 |
| :--- | :--- | :--- | :--- |
| 🪟 **Windows 10 / 11** | `MarketObservatory-Win64.exe` | 单文件绿色版，双击即开独立桌面看盘窗（支持 `Ctrl +` / `-` 缩放） | [点击下载 Win64.exe](https://github.com/stanlll-cloud/market-observatory/releases/latest/download/MarketObservatory-Win64.exe) |
| 🪟 **Windows 便携包** | `MarketObservatory-Windows-x64.zip` | 含 `.exe` + 源码启动脚本 `start_windows.bat` + 说明文档 | [点击下载 Win64.zip](https://github.com/stanlll-cloud/market-observatory/releases/latest/download/MarketObservatory-Windows-x64.zip) |
| 🍎 **macOS (Apple Silicon)** | `MarketObservatory-Mac.dmg` | 原生 `WKWebView` 桌面壳，支持 `⌘1/2/3` 秒切面板与 `⌘+` / `⌘-` 无极缩放 | [点击下载 Mac.dmg](https://github.com/stanlll-cloud/market-observatory/releases/latest/download/MarketObservatory-Mac.dmg) |

> **系统首次运行放行提示**：
> - **Windows**：若出现 Microsoft Defender SmartScreen 提示，点 **「更多信息」→「仍要运行」** 即可。
> - **macOS**：将 `观势 Market Observatory` 拖入 `Applications`，首次打开若提示未公证，**右键点击 App →「打开」** 即可永久放行；也可在顶部菜单栏 `数据线路` 一键接入你自己的海外云端服务器。

---

## ✨ 核心武器库（为什么不直接用普通行情软件？）

### 1. 美股「盘前 / 盘中 / 盘后」1 分钟级真实成交价 + 加密货币 24H 实时流
- 解决普通免费 API 在美股盘前、盘后价格卡死在上日收盘价的问题，直接从 `1m includePrePost` 实时成交槽抽取真实价格，清晰标注 **`🌅 盘前实时` / `🟢 盘中实时` / `🌙 盘后实时` / `⚡ 24H实时`**。
- 加密货币直连 Binance 多节点自动竞速切换；美股直连 Yahoo Finance & Nasdaq。

### 2. 双均线趋势锁 (`EMA 20/60/120`) + 均线扣抵推演
- 采用红涨绿跌高对比配色，**3px 纯白 `EMA20`（生命线）** + **3px 亮金 `EMA60`（趋势中轴）** + **天蓝 `VWAP`**。
- **均线扣抵位置实时标记 (`📍20扣(低/高)` / `📍60扣(低/高)`)**：直接把 20 根、60 根前的扣抵锚点标在 K 线上，提前一眼预判接下来几根 K 线是「低位扣抵助涨」还是「高位扣抵拖累死叉」。
- **V3.2 大级别空头熔断锁**：4H / 日线大势空头排列时，强行锁死小周期抄底信号并提示「勿接飞刀，等反抽白线受阻再动作」。

### 3. 缠论全自动结构引擎（笔 · 线段 · 中枢 · 三买卖 · MACD 背驰）
- 纯 Python 后端毫秒级自动合并包含关系、识别顶底分型，实时画出 **笔、线段、震荡中枢区间 (`ZG / ZD`)**。
- 自动捕捉 **一买 / 二买 / 三买 / 一卖 / 二卖 / 三卖** 以及 **MACD 顶背 / 底背力度衰竭** 标签，并在主图给出主选/备选两条推演路径。

### 4. TradingView Pro 级盘面工具箱（开箱即用，免付费订阅）
- **📊 筹码峰 (VPVR) + 中文实战注释卡**：高 DPI 渲染 24 档多空成交量柱，标出 **`🎯 POC 庄家成本峰`**、`▲ VAH`、`▼ VAL` 并自动计算现价距离与 EMA20 共振关系；左下角内置**小白三步看盘注释卡片**。
- **🪟 双图多周期联动**：左右 50%/50% 分屏（例如左图 `15m/1h` 精准找买点 + 右图 `4h/1d` 死盯大势锁），支持十字光标与快捷切换。
- **📐 交互式多空盈亏尺 + 以损定量**：支持直接在 K 线上点选入场、止盈、止损价，实时计算 `R:R` 盈亏比与 **总资金 1.5% 风控建议仓位**。
- **⚖️ 强弱基准对比叠加**：支持叠加 **`BTC`** 或 **`QQQ`** 走势折线，一眼看清个股/山寨币是「独立领涨」还是「跟跌跑输」。
- **🔔 价格预警线 · 📏 Shift+点击测距 · ⌘K 全局命令面板 · `↑/↓` 键盘极速翻自选股 · 🎮 `$100,000` 模拟练手盘**。

### 5. 64 大核心资产量化雷达 + Finviz 板块热力图
- 一次性并发扫描 **美股七巨头、AI 算力半导体、加密货币概念股、核心指数 ETF & 主流加密币种（共 64 只标的）**。
- 内置 **VIX 恐慌期限结构监测 (`VIX / VIX3M`)** 与市场温度计，区分「右侧黄金坑」与「倒挂防接刀」，支持 **信号卡片视图 ⇄ Finviz 板块热力图视图** 一键切换。

### 6. 宏观核弹 & 美股重磅财报避雷日历
- 对接 Nasdaq 官方日历，自动剔除杂音数据，只保留真正砸盘/暴涨的 **7 类顶级美国宏观事件**（FOMC 利率决议、CPI、核心 PCE、非农、GDP/PPI/零售、初请失业金/ADP/ISM 等），精确换算为北京时间 (`CST`) 实时倒计时。
- 自动预警持仓标的是否处于 **未来数日财报窗口期**，防止期权买方遭遇财报后波动率暴跌的 **IV Crush 双杀**。

---

## 🌐 网络环境与跨境看盘 / 美股券商防风控建议

> **国内直连看盘说明**：由于数据源来自 **Binance**、**Yahoo Finance** 与 **Nasdaq**，在大陆网络环境下运行本工作台需要保持本地代理工具开启。
> **已内置「智能本地代理端口自动识别」**：程序会自动探测系统代理及常见本地端口（Clash `7890` / `7897`、V2RayN `10809` / `10808`、`1087` 等），并跳过已失效的死端口，**无需手动改一行代码，开着代理直接打开软件就能秒刷全市场实时行情**。

同时提醒：**千万不要用来路不明的免费公共万人节点，去登录盈透证券 (IBKR)、嘉信理财 (Charles Schwab)、币安 (Binance) 或 OKX**——脏 IP 频繁跳国家极易触发券商和交易所异地风控锁号。

分享我自己在用的稳定底层线路方案：

- **✈️ 自用跨境看盘专线机场推荐 — 搬瓦工官方自营 Just My Socks**
  👉 **官方直达通道**：[https://justmysocks.net/members/aff.php?aff=39372](https://justmysocks.net/members/aff.php?aff=39372)
  - 搬瓦工官方亲儿子，底层为 **电信 CN2 GIA / 联通 AS9929** 顶级回程专线，晚高峰看盘、美股开盘冲刺完全不卡顿。
  - 最大省心点在于 **IP 异常自动无缝秒换**，配合固定区域节点用来挂着 **观势** 看盘和登录海外券商，干净稳定极不易触发风控。

- **🖥️ 进阶玩家：自己搭一台 24H 私有云端看盘中枢 — 搬瓦工 BandwagonHost VPS**
  👉 **搬瓦工官方推荐通道**：[https://bandwagonhost.com/aff.php?aff=85048](https://bandwagonhost.com/aff.php?aff=85048)
  - 把本项目的 FastAPI + 前端直接跑在海外 VPS 上（内存占用仅 `~60MB`），配合工作台右上角「📲 下载App」里的 **iOS `.mobileconfig` 全屏桌面描述文件**，iPhone / Mac / Windows 无需本地挂代理，打开即全屏直连看盘。

---

## 🛠️ 源码本地运行（开发者模式）

### 方式 A：Windows 一键脚本运行
1. 克隆或下载本仓库源码；
2. 确认已安装 Python 3.10+；
3. 直接双击根目录下的 **`start_windows.bat`**，会自动创建 `.venv`、安装 `backend/requirements.txt` 并启动桌面独立窗口。

### 方式 B：macOS / Linux 运行
```bash
git clone https://github.com/stanlll-cloud/market-observatory.git
cd market-observatory
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# 仅启动服务 (内置已编译好的 frontend/dist，无需再装 Node.js):
cd backend && uvicorn main:app --host 127.0.0.1 --port 8766
```
然后浏览器访问 `http://127.0.0.1:8766` 即可使用。若需要开发修改前端界面，可再进入 `frontend/` 执行 `npm install && npm run dev`。

---

## ⚠️ 免责声明

本项目所有均线、缠论结构、VPVR 筹码分布、盈亏比测算及日历提示**仅作为个人量化技术分析与盘面复盘辅助工具**，不构成任何投资、期货或期权买卖建议。市场波动剧烈，交易盈亏自负。
