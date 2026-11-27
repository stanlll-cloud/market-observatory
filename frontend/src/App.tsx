import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
} from 'lucide-react';
import { ChartPanel } from './components/ChartPanel';
import { IndicatorModal, type IndicatorPreset } from './components/IndicatorModal';
import { RadarPage } from './components/RadarPage';
import { CalendarPage } from './components/CalendarPage';
import { EtfPlanPage } from './components/EtfPlanPage';
import { CalculatorPage } from './components/CalculatorPage';
import type {
  AnalyzeResponse,
  CalendarResponse,
  Candle,
  EtfPlanResponse,
  LangType,
  LayerToggles,
  MaAlertRule,
  MaAlertsResponse,
  MacroIntelResponse,
  MarketType,
  MeasurePoint,
  PaperTradeState,
  PriceAlertItem,
  RadarItem,
  RadarResponse,
  RrToolState,
  SymbolItem,
  ViewMode,
} from './types';

const INTERVALS = [
  { key: '1m', zh: '1分', en: '1m' },
  { key: '5m', zh: '5分', en: '5m' },
  { key: '15m', zh: '15分', en: '15m' },
  { key: '30m', zh: '30分', en: '30m' },
  { key: '1h', zh: '1小时', en: '1H' },
  { key: '4h', zh: '4小时', en: '4H' },
  { key: '1d', zh: '日线', en: '1D' },
  { key: '1w', zh: '周线', en: '1W' },
];

const DEFAULT_FAVORITES = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'NVDA', 'AAPL', 'TSLA'];

const fmtPrice = (v: number) => {
  if (!v) return '0.00';
  if (v >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
};

export function App() {
  const [lang, setLang] = useState<LangType>('zh');
  const [market, setMarket] = useState<MarketType>('crypto');
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [interval, setIntervalVal] = useState<string>('1h');
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('obs_favorites');
      return saved ? JSON.parse(saved) : DEFAULT_FAVORITES;
    } catch {
      return DEFAULT_FAVORITES;
    }
  });

  // Bidirectional View Mode + Radar + Calendar State
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'workbench';
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'radar') return 'radar';
    if (v === 'calendar') return 'calendar';
    if (v === 'etf_plan') return 'etf_plan';
    if (v === 'calculator') return 'calculator';
    return 'workbench';
  });
  const [radarData, setRadarData] = useState<RadarResponse | null>(null);
  const [radarLoading, setRadarLoading] = useState<boolean>(false);
  const [calendarData, setCalendarData] = useState<CalendarResponse | null>(null);
  const [calendarLoading, setCalendarLoading] = useState<boolean>(false);
  const [etfPlanData, setEtfPlanData] = useState<EtfPlanResponse | null>(null);
  const [etfPlanLoading, setEtfPlanLoading] = useState<boolean>(false);
  const [displayMenuOpen, setDisplayMenuOpen] = useState<boolean>(false);
  const [uiZoomPct, setUiZoomPct] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('obs_ui_zoom_pct'));
      return Number.isFinite(saved) && saved >= 60 && saved <= 200 ? saved : 100;
    } catch {
      return 100;
    }
  });
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>(() =>
    typeof window !== 'undefined'
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 1440, h: 900 }
  );
  const [sideMarketFilter, setSideMarketFilter] = useState<'all' | 'crypto' | 'us' | 'fav'>('all');
  const [sideStrategy, setSideStrategy] = useState<
    'all' | 'resilient_leader' | 'golden_pit' | 'bear_short_put' | 'ma_squeeze'
  >('all');
  const [sideSector, setSideSector] = useState<string>('all');
  const [symbolOrder, setSymbolOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('obs_symbol_order_v1');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('obs_symbol_order_v1', JSON.stringify(symbolOrder));
    } catch {
      // ignore storage errors
    }
  }, [symbolOrder]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<'above' | 'below'>('above');

  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [macroData, setMacroData] = useState<MacroIntelResponse | null>(null);
  const [newsFilter, setNewsFilter] = useState<'all' | '30m'>('all');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef<boolean>(false);
  loadingRef.current = loading;

  const DEFAULT_LAYERS: LayerToggles = {
    macro: true,
    plan: true,
    dual_ma: true,
    ma5: false,
    ma10: false,
    ma20: false,
    ma60: false,
    ma120: false,
    ma200: false,
    boll: false,
    volume: true,
    macd: true,
    bull_band: false,
    vwap: false,
    vpvr: false,
    fvg: false,
    absorption: false,
    deduct: true,
    compare: false,
    fib: false,
    regime: true,
    strokes: false,
    segments: false,
    centers: false,
    signals: false,
    projection: false,
    fractals: false,
  };

  const [layers, setLayers] = useState<LayerToggles>(() => {
    try {
      const saved = localStorage.getItem('obs_chart_layers_v2');
      if (saved) return { ...DEFAULT_LAYERS, ...JSON.parse(saved) };
    } catch {
      // ignore storage errors
    }
    return DEFAULT_LAYERS;
  });
  useEffect(() => {
    try {
      localStorage.setItem('obs_chart_layers_v2', JSON.stringify(layers));
    } catch {
      // ignore storage errors
    }
  }, [layers]);

  const [rightTab, setRightTab] = useState<'trade' | 'structure' | 'news'>('trade');
  const [indicatorModalOpen, setIndicatorModalOpen] = useState<boolean>(false);

  const toggleLayer = useCallback((key: keyof LayerToggles) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const openIndicatorsModal = useCallback(() => {
    setIndicatorModalOpen(true);
  }, []);

  const applyIndicatorPreset = useCallback((preset: IndicatorPreset) => {
    if (preset === 'clean') {
      setLayers((p) => ({
        ...p,
        macro: true,
        plan: true,
        dual_ma: true,
        ma5: false,
        ma10: false,
        ma20: false,
        ma60: false,
        ma120: false,
        ma200: false,
        boll: false,
        volume: true,
        macd: true,
        bull_band: false,
        deduct: true,
        regime: true,
        vwap: false,
        vpvr: false,
        fvg: false,
        absorption: false,
        fib: false,
        strokes: false,
        segments: false,
        centers: false,
        signals: false,
        projection: false,
        fractals: false,
      }));
    } else if (preset === 'bull20w') {
      setIntervalVal('1w');
      setLayers((p) => ({
        ...p,
        macro: true,
        regime: true,
        bull_band: true,
        dual_ma: false,
        volume: true,
        macd: true,
        vpvr: false,
        fvg: false,
        absorption: false,
        strokes: false,
        segments: false,
        centers: false,
        signals: false,
        projection: false,
      }));
    } else if (preset === 'smart_money') {
      setLayers((p) => ({
        ...p,
        macro: true,
        dual_ma: true,
        bull_band: false,
        volume: true,
        macd: true,
        vpvr: true,
        fvg: true,
        absorption: true,
        vwap: true,
        plan: true,
        strokes: false,
        segments: false,
        centers: false,
      }));
    } else if (preset === 'chanlun') {
      setLayers((p) => ({
        ...p,
        macro: true,
        dual_ma: true,
        bull_band: false,
        volume: true,
        macd: true,
        strokes: true,
        segments: true,
        centers: true,
        signals: true,
        projection: true,
        fib: true,
      }));
    } else if (preset === 'naked') {
      setLayers((p) => ({
        ...p,
        dual_ma: false,
        ma5: false,
        ma10: false,
        ma20: false,
        ma60: false,
        ma120: false,
        ma200: false,
        boll: false,
        volume: true,
        macd: false,
        bull_band: false,
        vwap: false,
        vpvr: false,
        fvg: false,
        absorption: false,
        deduct: false,
        compare: false,
        fib: false,
        regime: false,
        plan: false,
        strokes: false,
        segments: false,
        centers: false,
        signals: false,
        projection: false,
        fractals: false,
      }));
    }
  }, []);

  // Dual MA Config (persisted in localStorage)
  const [maConfig, setMaConfig] = useState<{ type: 'ema' | 'sma'; fast: number; slow: number }>(() => {
    try {
      const saved = localStorage.getItem('obs_dual_ma');
      return saved ? JSON.parse(saved) : { type: 'ema', fast: 20, slow: 60 };
    } catch {
      return { type: 'ema', fast: 20, slow: 60 };
    }
  });
  useEffect(() => {
    localStorage.setItem('obs_dual_ma', JSON.stringify(maConfig));
  }, [maConfig]);

  const [activePlanSide, setActivePlanSide] = useState<'bull' | 'bear'>('bull');

  // Mobile Portrait & Landscape Responsive States
  const [mobileTab, setMobileTab] = useState<'chart' | 'intel' | 'symbols'>('chart');
  const [chartExpanded, setChartExpanded] = useState<boolean>(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState<boolean>(false);
  const [macroExpanded, setMacroExpanded] = useState<boolean>(false);

  // Historical Replay State
  const [replayIndex, setReplayIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playTimerRef = useRef<number | null>(null);

  // Dual-Chart Multi-Timeframe Sync State
  const [dualChartMode, setDualChartMode] = useState<boolean>(false);
  const [secondaryInterval, setSecondaryInterval] = useState<string>('4h');
  const [secondaryData, setSecondaryData] = useState<AnalyzeResponse | null>(null);
  const [secondaryLoading, setSecondaryLoading] = useState<boolean>(false);

  // TradingView Compare Overlay, Risk-Reward Ruler, Shift Measure & Cmd+K Spotlight
  const [compareCandles, setCompareCandles] = useState<Candle[]>([]);
  const [rrTool, setRrTool] = useState<RrToolState>({
    enabled: false,
    side: 'LONG',
    entry: 0,
    stop: 0,
    target: 0,
    capital: 10000,
    riskPct: 1.5,
    pickField: null,
  });
  const [measureMode, setMeasureMode] = useState<boolean>(false);
  const [measurePts, setMeasurePts] = useState<MeasurePoint[]>([]);
  const [cmdKOpen, setCmdKOpen] = useState<boolean>(false);
  const [cmdKQuery, setCmdKQuery] = useState<string>('');
  const [cmdKIdx, setCmdKIdx] = useState<number>(0);

  // Interactive Chart Price Alerts (localStorage persisted + WebAudio chime)
  const [alerts, setAlerts] = useState<PriceAlertItem[]>(() => {
    try {
      const saved = localStorage.getItem('obs_price_alerts_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [alertsOpen, setAlertsOpen] = useState<boolean>(false);
  const [pickAlertMode, setPickAlertMode] = useState<boolean>(false);
  const [alertPriceInput, setAlertPriceInput] = useState<string>('');
  const [alertDirInput, setAlertDirInput] = useState<'above' | 'below'>('above');
  const [alertToast, setAlertToast] = useState<{ id: string; text: string } | null>(null);
  const alertsRef = useRef<PriceAlertItem[]>(alerts);
  alertsRef.current = alerts;

  // MA Crossover Auto-Push State (Server-backed Telegram / Webhook)
  const [alertTab, setAlertTab] = useState<'price' | 'ma'>('ma');
  const [maAlertsData, setMaAlertsData] = useState<MaAlertsResponse | null>(null);
  const [maAlertInterval, setMaAlertInterval] = useState<'1h' | '4h' | '1d' | '1w'>('1d');
  const [maAlertType, setMaAlertType] = useState<'ema' | 'sma'>('sma');
  const [maAlertPeriod, setMaAlertPeriod] = useState<number>(200);
  const [maAlertDir, setMaAlertDir] = useState<'cross_above' | 'cross_below' | 'both'>('both');
  const [maAlertOffset, setMaAlertOffset] = useState<string>('0');
  const [maAlertBusy, setMaAlertBusy] = useState<boolean>(false);
  const [maAlertMsg, setMaAlertMsg] = useState<string>('');
  const [channelCfgOpen, setChannelCfgOpen] = useState<boolean>(false);
  const [tgTokenInput, setTgTokenInput] = useState<string>('');
  const [tgChatInput, setTgChatInput] = useState<string>('');
  const [webhookInput, setWebhookInput] = useState<string>('');
  const lastMaEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('obs_price_alerts_v1', JSON.stringify(alerts));
    } catch {
      // ignore storage errors
    }
  }, [alerts]);

  // Paper Trading Trainer State (works live & during Replay)
  const DEFAULT_PAPER: PaperTradeState = {
    balance: 100000,
    realizedPnl: 0,
    tradesCount: 0,
    position: null,
  };
  const [paperOpen, setPaperOpen] = useState<boolean>(false);
  const [paperState, setPaperState] = useState<PaperTradeState>(() => {
    try {
      const saved = localStorage.getItem('obs_paper_state_v1');
      return saved ? JSON.parse(saved) : { balance: 100000, realizedPnl: 0, tradesCount: 0, position: null };
    } catch {
      return { balance: 100000, realizedPnl: 0, tradesCount: 0, position: null };
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('obs_paper_state_v1', JSON.stringify(paperState));
    } catch {
      // ignore
    }
  }, [paperState]);

  const playAlertChime = useCallback(() => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = ctx.currentTime + idx * 0.09;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.38);
      });
    } catch {
      // ignore audio context block
    }
  }, []);

  const checkPriceAlerts = useCallback(
    (mkt: MarketType, sym: string, price: number) => {
      if (!price || price <= 0) return;
      const list = alertsRef.current;
      const triggered: PriceAlertItem[] = [];
      for (const a of list) {
        if (!a.active || a.market !== mkt || a.symbol !== sym) continue;
        const hit =
          (a.direction === 'above' && price >= a.targetPrice) ||
          (a.direction === 'below' && price <= a.targetPrice);
        if (hit) triggered.push(a);
      }
      if (!triggered.length) return;
      const hitIds = new Set(triggered.map((x) => x.id));
      const now = Date.now();
      setAlerts((prev) =>
        prev.map((x) => (hitIds.has(x.id) ? { ...x, active: false, triggeredAt: now } : x))
      );
      playAlertChime();
      const first = triggered[0];
      const msg = `${first.symbol} ${first.direction === 'above' ? '突破上穿' : '跌破下穿'} ${fmtPrice(first.targetPrice)}（现价 ${fmtPrice(price)}）`;
      setAlertToast({ id: first.id, text: msg });
      window.setTimeout(() => {
        setAlertToast((cur) => (cur?.id === first.id ? null : cur));
      }, 6500);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('观势 · 价格预警触发', { body: msg });
        } catch {
          // ignore
        }
      }
    },
    [playAlertChime]
  );

  const loadMaAlerts = useCallback(
    async (notifyNew = false) => {
      try {
        const res = await fetch('/api/ma-alerts');
        const json: MaAlertsResponse = await res.json();
        if (json && Array.isArray(json.rules)) {
          setMaAlertsData(json);
          const latest = json.history?.[0];
          if (latest) {
            if (notifyNew && lastMaEventIdRef.current && latest.id !== lastMaEventIdRef.current) {
              playAlertChime();
              setAlertToast({ id: latest.id, text: latest.title });
              window.setTimeout(() => {
                setAlertToast((cur) => (cur?.id === latest.id ? null : cur));
              }, 7500);
            }
            lastMaEventIdRef.current = latest.id;
          }
        }
      } catch {
        // ignore transient poll errors
      }
    },
    [playAlertChime]
  );

  useEffect(() => {
    const t = window.setTimeout(() => loadMaAlerts(false), 1500);
    const id = window.setInterval(() => loadMaAlerts(true), 60000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [loadMaAlerts]);

  const handleAddMaRule = async (override?: Partial<{
    market: 'us' | 'crypto';
    symbol: string;
    interval: '1h' | '4h' | '1d' | '1w';
    ma_type: 'ema' | 'sma';
    period: number;
    direction: 'cross_above' | 'cross_below' | 'both';
    offset_pct: number;
    note: string;
  }>) => {
    setMaAlertBusy(true);
    setMaAlertMsg('');
    try {
      const body = {
        market: override?.market ?? market,
        symbol: override?.symbol ?? symbol,
        interval: override?.interval ?? maAlertInterval,
        ma_type: override?.ma_type ?? maAlertType,
        period: override?.period ?? maAlertPeriod,
        direction: override?.direction ?? maAlertDir,
        offset_pct: override?.offset_pct ?? (parseFloat(maAlertOffset) || 0),
        note: override?.note ?? '',
      };
      const res = await fetch('/api/ma-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const dataRes = await res.json();
      await loadMaAlerts(false);
      setMaAlertMsg(
        dataRes?.duplicate
          ? `已激活现有规则：${body.symbol} ${body.interval.toUpperCase()} ${body.ma_type.toUpperCase()}${body.period}`
          : `已添加巡检：${body.symbol} ${body.interval.toUpperCase()} ${body.ma_type.toUpperCase()}${body.period}`
      );
    } catch {
      setMaAlertMsg('添加规则失败，请检查后端连接');
    } finally {
      setMaAlertBusy(false);
    }
  };

  const handleToggleMaRule = async (rule: MaAlertRule) => {
    await fetch(`/api/ma-alerts/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    await loadMaAlerts(false);
  };

  const handleDeleteMaRule = async (ruleId: string) => {
    await fetch(`/api/ma-alerts/${ruleId}`, { method: 'DELETE' });
    await loadMaAlerts(false);
  };

  const handleScanMaNow = async () => {
    setMaAlertBusy(true);
    setMaAlertMsg('正在扫描全部均线穿越规则...');
    try {
      const res = await fetch('/api/ma-alerts/check-now', { method: 'POST' });
      const json = await res.json();
      await loadMaAlerts(true);
      setMaAlertMsg(`扫描完成：共 ${json.enabled ?? 0} 条启用规则，触发 ${json.triggered ?? 0} 条`);
    } catch {
      setMaAlertMsg('扫描失败');
    } finally {
      setMaAlertBusy(false);
    }
  };

  const handleTestMaPush = async () => {
    setMaAlertBusy(true);
    setMaAlertMsg('正在发送测试推送...');
    try {
      const res = await fetch('/api/ma-alerts/test', { method: 'POST' });
      const json = await res.json();
      setMaAlertMsg(
        json.ok
          ? `✅ 测试推送成功 (${(json.sent_channels || []).join(', ')})`
          : `⚠️ 尚未配置推送通道或发送失败：${(json.errors || []).join('; ') || '请先配置 Telegram / Webhook'}`
      );
    } catch {
      setMaAlertMsg('测试推送请求异常');
    } finally {
      setMaAlertBusy(false);
    }
  };

  const handleSaveChannelCfg = async () => {
    setMaAlertBusy(true);
    try {
      const res = await fetch('/api/ma-alerts/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_bot_token: tgTokenInput,
          telegram_chat_id: tgChatInput,
          webhook_url: webhookInput,
        }),
      });
      const json = await res.json();
      await loadMaAlerts(false);
      setTgTokenInput('');
      setTgChatInput('');
      setMaAlertMsg(json.ok ? '✅ 推送通道已保存生效' : '保存失败');
    } finally {
      setMaAlertBusy(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('obs_favorites', JSON.stringify(favorites));
  }, [favorites]);

  type NativeBridgeWin = Window & {
    __IS_OBS_MAC_APP?: boolean;
    __onNativeZoom?: (pct: number) => void;
    __switchObsView?: (mode: ViewMode) => void;
    __openCmdK?: () => void;
    webkit?: {
      messageHandlers?: {
        obsNative?: { postMessage: (msg: unknown) => void };
      };
    };
  };

  const isMacNative =
    typeof window !== 'undefined' &&
    Boolean(
      (window as NativeBridgeWin).__IS_OBS_MAC_APP ||
        (window as NativeBridgeWin).webkit?.messageHandlers?.obsNative
    );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as NativeBridgeWin;
    win.__onNativeZoom = (pct: number) => {
      const clamped = Math.max(60, Math.min(200, Math.round(pct)));
      setUiZoomPct(clamped);
      try {
        localStorage.setItem('obs_ui_zoom_pct', String(clamped));
      } catch {
        // ignore
      }
    };
    const onResize = () => {
      setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (win.__onNativeZoom) delete win.__onNativeZoom;
    };
  }, []);

  const changeUiZoom = useCallback(
    (nextPct: number) => {
      const clamped = Math.max(70, Math.min(160, Math.round(nextPct / 5) * 5));
      setUiZoomPct(clamped);
      try {
        localStorage.setItem('obs_ui_zoom_pct', String(clamped));
      } catch {
        // ignore
      }
      const win = window as NativeBridgeWin;
      const bridge = win.webkit?.messageHandlers?.obsNative;
      if (bridge) {
        bridge.postMessage({ action: 'setZoom', pct: clamped });
      } else {
        window.setTimeout(() => window.dispatchEvent(new Event('resize')), 40);
      }
    },
    []
  );

  const applyResolutionPreset = useCallback((width: number, height: number, maximize = false) => {
    const win = window as NativeBridgeWin;
    const bridge = win.webkit?.messageHandlers?.obsNative;
    if (bridge) {
      bridge.postMessage({ action: 'setResolution', width, height, maximize });
      setDisplayMenuOpen(false);
    }
  }, []);

  const toggleFavorite = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) =>
      prev.includes(sym) ? prev.filter((x) => x !== sym) : [...prev, sym]
    );
  };

  const switchViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setPickAlertMode(false);
    try {
      const url = new URL(window.location.href);
      if (mode === 'radar') url.searchParams.set('view', 'radar');
      else if (mode === 'calendar') url.searchParams.set('view', 'calendar');
      else if (mode === 'etf_plan') url.searchParams.set('view', 'etf_plan');
      else if (mode === 'calculator') url.searchParams.set('view', 'calculator');
      else url.searchParams.delete('view');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore history errors
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as NativeBridgeWin;
    win.__switchObsView = switchViewMode;
    win.__openCmdK = () => {
      setCmdKOpen((v) => !v);
      setCmdKQuery('');
      setCmdKIdx(0);
    };
    return () => {
      if (win.__switchObsView) delete win.__switchObsView;
      if (win.__openCmdK) delete win.__openCmdK;
    };
  }, [switchViewMode]);

  const loadCalendar = useCallback(async (force = false) => {
    if (force) setCalendarLoading(true);
    try {
      const res = await fetch(`/api/calendar${force ? '?force=1' : ''}`);
      const json: CalendarResponse = await res.json();
      if (json && Array.isArray(json.economic_events)) {
        setCalendarData(json);
      }
    } catch {
      // ignore transient calendar fetch errors
    } finally {
      if (force) setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => loadCalendar(false), 1200);
    const id = window.setInterval(() => loadCalendar(false), 300000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [loadCalendar]);

  useEffect(() => {
    if (viewMode === 'calendar' && !calendarData) {
      loadCalendar(true);
    }
  }, [viewMode, calendarData, loadCalendar]);

  const loadEtfPlan = useCallback(async (force = false) => {
    if (force) setEtfPlanLoading(true);
    try {
      const res = await fetch(`/api/etf-plan${force ? '?force=1' : ''}`);
      const json: EtfPlanResponse = await res.json();
      if (json && json.benchmarks && Array.isArray(json.etfs)) {
        setEtfPlanData(json);
      }
    } catch {
      // ignore transient etf plan fetch errors
    } finally {
      if (force) setEtfPlanLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => loadEtfPlan(false), 1800);
    const id = window.setInterval(() => loadEtfPlan(false), 180000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [loadEtfPlan]);

  useEffect(() => {
    if (viewMode === 'etf_plan' && !etfPlanData) {
      loadEtfPlan(true);
    }
  }, [viewMode, etfPlanData, loadEtfPlan]);

  // Load Radar Snapshot on mount + every 30s (retry fast if cold-start empty)
  const loadRadar = useCallback(async (force = false) => {
    if (force) setRadarLoading(true);
    try {
      const res = await fetch(`/api/radar${force ? '?force=1' : ''}`);
      const json: RadarResponse = await res.json();
      if (json && json.vix_futures) {
        setRadarData(json);
      }
    } catch {
      // ignore transient radar fetch errors
    } finally {
      if (force) setRadarLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRadar(false);
    const id = window.setInterval(() => loadRadar(false), 30000);
    return () => window.clearInterval(id);
  }, [loadRadar]);

  useEffect(() => {
    if (radarData && radarData.items.length === 0) {
      const retry = window.setTimeout(() => loadRadar(false), 3500);
      return () => window.clearTimeout(retry);
    }
  }, [radarData, loadRadar]);

  // Fallback symbol search only when needed (unlisted custom symbols or cold start)
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q && radarData && radarData.items.length > 0) return;
    let active = true;
    const targetMkt: MarketType =
      sideMarketFilter === 'us'
        ? 'us'
        : sideMarketFilter === 'crypto'
        ? 'crypto'
        : market;
    const timer = window.setTimeout(() => {
      fetch(`/api/symbols?market=${targetMkt}&q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((res) => {
          if (active && res.symbols) {
            setSymbols(res.symbols);
          }
        })
        .catch(() => {});
    }, q ? 160 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [market, sideMarketFilter, searchQuery, radarData]);

  // Fetch chart + structural analysis with AbortController (zero race/lag on rapid switch)
  const loadAnalysis = useCallback(
    async (
      m: MarketType,
      sym: string,
      iv: string,
      rIdx: number,
      ma: { type: 'ema' | 'sma'; fast: number; slow: number },
      silent = false,
      force = false
    ) => {
      let ctrl: AbortController | null = null;
      if (!silent) {
        analyzeAbortRef.current?.abort();
        ctrl = new AbortController();
        analyzeAbortRef.current = ctrl;
        setLoading(true);
        setErrorMsg('');
      }
      try {
        const res = await fetch(
          `/api/analyze?market=${m}&symbol=${encodeURIComponent(sym)}&interval=${iv}&limit=300&replay_index=${rIdx}&ma_type=${ma.type}&ma_fast=${ma.fast}&ma_slow=${ma.slow}${force ? '&force=1' : ''}`,
          ctrl ? { signal: ctrl.signal } : undefined
        );
        const json: AnalyzeResponse = await res.json();
        if (json.error) {
          if (!silent) setErrorMsg(json.error);
        } else {
          setData(json);
          if (!silent) {
            if (json.analysis.buy_advice?.action === 'AVOID') {
              setActivePlanSide('bear');
            } else if (json.analysis.bias.bull_pct >= 50) {
              setActivePlanSide('bull');
            } else {
              setActivePlanSide('bear');
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (!silent) setErrorMsg(String(err));
      } finally {
        if (!silent && ctrl && analyzeAbortRef.current === ctrl) {
          setLoading(false);
        }
      }
    },
    []
  );

  const loadMacro = useCallback(async (m: MarketType, sym: string, force = false) => {
    try {
      const res = await fetch(
        `/api/macro?market=${m}&symbol=${encodeURIComponent(sym)}${force ? '&force=1' : ''}`
      );
      const json: MacroIntelResponse = await res.json();
      if (json && json.etfs) {
        setMacroData(json);
      }
    } catch {
      // ignore transient macro fetch errors
    }
  }, []);

  useEffect(() => {
    loadAnalysis(market, symbol, interval, replayIndex, maConfig, false);
  }, [market, symbol, interval, replayIndex, maConfig, loadAnalysis]);

  useEffect(() => {
    loadMacro(market, symbol);
  }, [market, symbol, loadMacro]);

  // 2.5s 秒级实时行情 Tick 刷新(仅在看盘台开启，切换到雷达/日历时零功耗暂停!)
  useEffect(() => {
    if (replayIndex >= 0 || viewMode !== 'workbench') return;

    let tickBusy = false;
    const tickId = window.setInterval(async () => {
      if (tickBusy || loadingRef.current) return;
      tickBusy = true;
      try {
        const res = await fetch(
          `/api/tick?market=${market}&symbol=${encodeURIComponent(symbol)}&interval=${interval}`
        );
        const tick = await res.json();
        if (tick.error || !tick.price) return;
        checkPriceAlerts(market, symbol, Number(tick.price));
        setData((prev) => {
          if (
            !prev ||
            !prev.candles.length ||
            loadingRef.current ||
            prev.meta.symbol !== symbol ||
            (prev.meta.interval && prev.meta.interval !== interval)
          ) {
            return prev;
          }
          const candles = [...prev.candles];
          const last = candles[candles.length - 1];
          if (tick.candle) {
            if (tick.candle.time === last.time) {
              candles[candles.length - 1] = tick.candle;
            } else if (tick.candle.time > last.time) {
              candles.push(tick.candle);
            }
          } else {
            candles[candles.length - 1] = {
              ...last,
              close: tick.price,
              high: Math.max(last.high, tick.price),
              low: Math.min(last.low, tick.price),
            };
          }
          return {
            ...prev,
            meta: {
              ...prev.meta,
              price: tick.price,
              price_change: tick.price_change,
              price_change_percent: tick.price_change_percent,
              ...(tick.session ? { session: tick.session } : {}),
              ...(tick.session_zh ? { session_zh: tick.session_zh } : {}),
              ...(tick.session_en ? { session_en: tick.session_en } : {}),
            },
            candles,
          };
        });
      } catch {
        // ignore transient network errors on live tick
      } finally {
        tickBusy = false;
      }
    }, 2500);

    const fullId = window.setInterval(() => {
      loadAnalysis(market, symbol, interval, -1, maConfig, true);
    }, 45000);

    const macroId = window.setInterval(() => {
      loadMacro(market, symbol);
    }, 45000);

    return () => {
      window.clearInterval(tickId);
      window.clearInterval(fullId);
      window.clearInterval(macroId);
    };
  }, [replayIndex, viewMode, market, symbol, interval, maConfig, loadAnalysis, loadMacro]);

  // Dual-Chart Secondary Timeframe Sync Fetcher
  useEffect(() => {
    if (!dualChartMode || viewMode !== 'workbench') return;
    const ctrl = new AbortController();
    setSecondaryLoading(true);
    fetch(
      `/api/analyze?market=${market}&symbol=${encodeURIComponent(symbol)}&interval=${secondaryInterval}&limit=300&replay_index=-1&ma_type=${maConfig.type}&ma_fast=${maConfig.fast}&ma_slow=${maConfig.slow}`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((json: AnalyzeResponse) => {
        if (!ctrl.signal.aborted && !json.error) {
          setSecondaryData(json);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setSecondaryLoading(false);
      });
    return () => ctrl.abort();
  }, [dualChartMode, viewMode, market, symbol, secondaryInterval, maConfig]);

  // Benchmark Compare Fetcher (BTC for Crypto, QQQ for US)
  const compareTarget = useMemo(() => {
    if (market === 'crypto') {
      return { mkt: 'crypto' as const, sym: symbol === 'BTCUSDT' ? 'ETHUSDT' : 'BTCUSDT' };
    }
    return { mkt: 'us' as const, sym: symbol === 'QQQ' ? 'SPY' : 'QQQ' };
  }, [market, symbol]);

  useEffect(() => {
    if (!layers.compare || viewMode !== 'workbench') {
      setCompareCandles([]);
      return;
    }
    const ctrl = new AbortController();
    fetch(
      `/api/analyze?market=${compareTarget.mkt}&symbol=${encodeURIComponent(compareTarget.sym)}&interval=${interval}&limit=300&replay_index=-1`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((json: AnalyzeResponse) => {
        if (!ctrl.signal.aborted && Array.isArray(json.candles)) {
          setCompareCandles(json.candles);
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [layers.compare, viewMode, compareTarget, interval]);

  const toggleRrTool = useCallback(() => {
    setRrTool((prev) => {
      if (prev.enabled) return { ...prev, enabled: false, pickField: null };
      const px = data?.meta.price || (data?.candles.length ? data.candles[data.candles.length - 1].close : 0);
      const adv = data?.analysis.buy_advice;
      const isBear = adv?.action === 'AVOID' || activePlanSide === 'bear';
      const entry = px > 0 ? Number(px.toFixed(px >= 100 ? 2 : 3)) : 100;
      const stop = isBear ? Number((entry * 1.045).toFixed(entry >= 100 ? 2 : 3)) : Number((entry * 0.955).toFixed(entry >= 100 ? 2 : 3));
      const target = isBear ? Number((entry * 0.89).toFixed(entry >= 100 ? 2 : 3)) : Number((entry * 1.11).toFixed(entry >= 100 ? 2 : 3));
      return {
        ...prev,
        enabled: true,
        side: isBear ? 'SHORT' : 'LONG',
        entry: adv && adv.entry_low > 0 && !isBear ? adv.entry_high : entry,
        stop: adv && adv.stop_loss > 0 && !isBear ? adv.stop_loss : stop,
        target: adv && adv.target_price > 0 && !isBear ? adv.target_price : target,
        pickField: null,
      };
    });
  }, [data, activePlanSide]);

  const handlePickRrPrice = useCallback((p: number) => {
    setRrTool((prev) => {
      if (!prev.pickField) return prev;
      return { ...prev, [prev.pickField]: p, pickField: null };
    });
  }, []);

  const handlePickMeasurePoint = useCallback((pt: MeasurePoint) => {
    setMeasurePts((prev) => (prev.length === 1 ? [prev[0], pt] : [pt]));
  }, []);

  const handleAddAlert = (customPrice?: number, customDir?: 'above' | 'below') => {
    const num = customPrice ?? parseFloat(alertPriceInput);
    if (!Number.isFinite(num) || num <= 0) return;
    const curP = data?.meta?.price || 0;
    const dir = customDir || (curP > 0 ? (num >= curP ? 'above' : 'below') : alertDirInput);
    const item: PriceAlertItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      market,
      symbol,
      targetPrice: num,
      direction: dir,
      createdAt: Date.now(),
      active: true,
    };
    setAlerts((prev) => [item, ...prev.slice(0, 39)]);
    setAlertPriceInput('');
    setPickAlertMode(false);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    setAlertToast({
      id: item.id,
      text: `${lang === 'zh' ? '已设定' : 'Alert set'}: ${symbol} ${dir === 'above' ? '≥' : '≤'} ${fmtPrice(num)}`,
    });
    window.setTimeout(() => {
      setAlertToast((cur) => (cur?.id === item.id ? null : cur));
    }, 3200);
  };

  // Replay auto-play timer
  useEffect(() => {
    if (!isPlaying || !data) {
      if (playTimerRef.current) window.clearInterval(playTimerRef.current);
      return;
    }
    const total = data.total_candles || 500;
    playTimerRef.current = window.setInterval(() => {
      setReplayIndex((prev) => {
        const cur = prev < 0 ? Math.max(50, Math.floor(total * 0.5)) : prev;
        if (cur >= total - 1) {
          setIsPlaying(false);
          return -1;
        }
        return cur + 1;
      });
    }, 900);

    return () => {
      if (playTimerRef.current) window.clearInterval(playTimerRef.current);
    };
  }, [isPlaying, data?.total_candles]);

  const selectAsset = useCallback(
    (m: MarketType, sym: string) => {
      setIsPlaying(false);
      setReplayIndex(-1);
      setMarket(m);
      setSymbol(sym);
      setMobileTab('chart');
      switchViewMode('workbench');
    },
    [switchViewMode]
  );

  // 0ms Instant Sidebar Catalog (powered by preloaded radar items + fallback custom symbols)
  const sideSectors = useMemo(() => {
    const src = radarData?.items ?? [];
    const set = new Set<string>();
    for (const it of src) {
      if (sideMarketFilter === 'us' && it.market !== 'us') continue;
      if (sideMarketFilter === 'crypto' && it.market !== 'crypto') continue;
      if (sideMarketFilter === 'fav' && !favorites.includes(it.symbol)) continue;
      if (it.sector) set.add(it.sector);
    }
    return Array.from(set);
  }, [radarData, sideMarketFilter, favorites]);

  const displayedSideItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const baseItems: RadarItem[] =
      radarData && radarData.items.length > 0
        ? radarData.items
        : symbols.map((s) => ({
            symbol: s.symbol,
            market: s.market,
            name: s.name,
            exchange: s.exchange,
            sector: s.sector || '',
            sector_en: s.sector_en || '',
            alias: '',
            price: 0,
            change_pct: 0,
            rvol: 1,
            rsi14: 50,
            atr_pct: 0,
            ema20: 0,
            ema60: 0,
            sma120: 0,
            ma_spread_pct: 0,
            dist_ema20_pct: 0,
            rs_20d: 0,
            in_fib_pit: false,
            right_side_bounce: false,
            crash_lock: false,
            is_squeeze: false,
            is_resilient: false,
            setup: 'watch',
            setup_zh: '',
            setup_en: '',
            tags: ['watch'],
            radar_score: 50,
            entry_ref: 0,
            target_ref: 0,
            stop_ref: 0,
            stop_dist_pct: 0,
            risk_parity_pct: 0,
          }));

    const out = baseItems.filter((it) => {
      if (sideMarketFilter === 'crypto' && it.market !== 'crypto') return false;
      if (sideMarketFilter === 'us' && it.market !== 'us') return false;
      if (sideMarketFilter === 'fav' && !favorites.includes(it.symbol)) return false;

      if (sideStrategy !== 'all') {
        const hitPrimary = it.setup === sideStrategy;
        const hitTag = it.tags?.includes(sideStrategy);
        if (!hitPrimary && !hitTag) return false;
      }

      if (sideSector !== 'all' && it.sector !== sideSector) return false;

      if (q) {
        const hay = `${it.symbol} ${it.name} ${it.sector} ${it.alias}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (q) {
      for (const s of symbols) {
        if (!out.some((x) => x.symbol === s.symbol && x.market === s.market)) {
          out.push({
            symbol: s.symbol,
            market: s.market,
            name: s.name,
            exchange: s.exchange,
            sector: s.sector || '检索',
            sector_en: s.sector_en || 'Search',
            alias: '',
            price: 0,
            change_pct: 0,
            rvol: 1,
            rsi14: 50,
            atr_pct: 0,
            ema20: 0,
            ema60: 0,
            sma120: 0,
            ma_spread_pct: 0,
            dist_ema20_pct: 0,
            rs_20d: 0,
            in_fib_pit: false,
            right_side_bounce: false,
            crash_lock: false,
            is_squeeze: false,
            is_resilient: false,
            setup: 'watch',
            setup_zh: '自定义',
            setup_en: 'Custom',
            tags: ['watch'],
            radar_score: 40,
            entry_ref: 0,
            target_ref: 0,
            stop_ref: 0,
            stop_dist_pct: 0,
            risk_parity_pct: 0,
          });
        }
      }
    }
    if (symbolOrder.length > 0) {
      const orderMap = new Map(symbolOrder.map((k, idx) => [k, idx]));
      const indexed = out.map((item, origIdx) => ({
        item,
        origIdx,
        rank: orderMap.get(`${item.market}:${item.symbol}`) ?? Number.MAX_SAFE_INTEGER,
      }));
      indexed.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.origIdx - b.origIdx));
      return indexed.map((x) => x.item);
    }
    return out;
  }, [radarData, symbols, sideMarketFilter, sideStrategy, sideSector, searchQuery, favorites, symbolOrder]);

  const reorderSideItem = useCallback(
    (fromKey: string, toKey: string, pos: 'above' | 'below') => {
      if (!fromKey || !toKey || fromKey === toKey) return;
      const visKeys = displayedSideItems.map((it) => `${it.market}:${it.symbol}`);
      setSymbolOrder((prev) => {
        const base = prev.length ? [...prev] : [...visKeys];
        for (const k of visKeys) {
          if (!base.includes(k)) base.push(k);
        }
        const fromIdx = base.indexOf(fromKey);
        if (fromIdx < 0) return base;
        base.splice(fromIdx, 1);
        const toIdx = base.indexOf(toKey);
        if (toIdx < 0) {
          base.push(fromKey);
        } else {
          base.splice(pos === 'below' ? toIdx + 1 : toIdx, 0, fromKey);
        }
        return base;
      });
    },
    [displayedSideItems]
  );

  // Cmd+K Quick Search Palette Items + Global ArrowUp/ArrowDown Flipper + Escape
  type CmdKEntry =
    | { kind: 'asset'; id: string; title: string; sub: string; badge: string; market: MarketType; symbol: string }
    | { kind: 'tf'; id: string; title: string; sub: string; badge: string; interval: string }
    | { kind: 'action'; id: string; title: string; sub: string; badge: string; run: () => void };

  const cmdKResults = useMemo<CmdKEntry[]>(() => {
    const q = cmdKQuery.trim().toLowerCase();
    const entries: CmdKEntry[] = [];

    const actions: CmdKEntry[] = [
      {
        kind: 'action',
        id: 'act:radar',
        title: '⚡ 打开量化选股 / 热力图雷达',
        sub: '查看 64 标的评分、板块资金热力图与 MACD 强弱',
        badge: '视图 ⌘2',
        run: () => switchViewMode('radar'),
      },
      {
        kind: 'action',
        id: 'act:cal',
        title: '🛡️ 打开防插针 · 财报避雷日历',
        sub: '查看美联储、PCE/CPI 宏观倒计时与美股大票财报',
        badge: '视图 ⌘3',
        run: () => switchViewMode('calendar'),
      },
      {
        kind: 'action',
        id: 'act:etf',
        title: '🏦 打开美股 ETF 投资计划',
        sub: 'QQQ/SPY 大盘 SMA200 择时、月息养保证金与 TQQQ/UPRO 出入点',
        badge: '视图 ⌘4',
        run: () => switchViewMode('etf_plan'),
      },
      {
        kind: 'action',
        id: 'act:calc',
        title: '🧮 打开合约仓位与加仓计算器',
        sub: '以损定量开单、逆势 1.5x/马丁生死线 & 顺势浮盈滚仓推演',
        badge: '视图 ⌘5',
        run: () => switchViewMode('calculator'),
      },
      {
        kind: 'action',
        id: 'act:dual',
        title: dualChartMode ? '🪟 关闭双图联动' : '🪟 开启多周期双图联动',
        sub: '左右并排同时看小周期买点与大周期趋势',
        badge: '看盘',
        run: () => {
          switchViewMode('workbench');
          setDualChartMode((v) => !v);
        },
      },
      {
        kind: 'action',
        id: 'act:bull_band',
        title: layers.bull_band ? '🌈 隐藏牛熊20带 (EMA20+MA20)' : '🌈 显示牛熊20带 (EMA20+MA20)',
        sub: '周线/日线双20均线支撑云带（自动判断上方拐头向上）',
        badge: '图层',
        run: () => setLayers((p) => ({ ...p, bull_band: !p.bull_band })),
      },
      {
        kind: 'action',
        id: 'act:vpvr',
        title: layers.vpvr ? '💡 隐藏右侧筹码分布峰 (VPVR)' : '💡 显示右侧筹码分布峰 (VPVR)',
        sub: 'POC 庄家成本峰、70% 价值区与看盘注释',
        badge: '图层',
        run: () => setLayers((p) => ({ ...p, vpvr: !p.vpvr })),
      },
      {
        kind: 'action',
        id: 'act:fvg',
        title: layers.fvg ? '📦 隐藏机构失衡缺口 (FVG)' : '📦 显示机构失衡缺口 (FVG)',
        sub: '自动标注未回补多空真空带（补满自动消失）',
        badge: '图层',
        run: () => setLayers((p) => ({ ...p, fvg: !p.fvg })),
      },
      {
        kind: 'action',
        id: 'act:absorption',
        title: layers.absorption ? '🧲 隐藏主力吸筹与扫损信号' : '🧲 显示主力吸筹与扫损信号',
        sub: '放量长影线承接、假跌破扫损与诱多派发标记',
        badge: '图层',
        run: () => setLayers((p) => ({ ...p, absorption: !p.absorption })),
      },
      {
        kind: 'action',
        id: 'act:compare',
        title: layers.compare ? '📉 关闭 BTC/QQQ 强弱叠加线' : '📈 叠加 BTC / QQQ 强弱对比线',
        sub: '同屏对比当前标的跑赢还是跑输大盘基准',
        badge: '图层',
        run: () => setLayers((p) => ({ ...p, compare: !p.compare })),
      },
    ];

    const tfs: Extract<CmdKEntry, { kind: 'tf' }>[] = INTERVALS.map((iv) => ({
      kind: 'tf',
      id: `tf:${iv.key}`,
      title: `⏱️ 切换周期：${iv.zh} (${iv.en})`,
      sub: '立刻刷新当前标的 K 线周期',
      badge: iv.key.toUpperCase(),
      interval: iv.key,
    }));

    const assetSrc = radarData?.items?.length ? radarData.items : displayedSideItems;
    const assets: CmdKEntry[] = assetSrc.map((it) => ({
      kind: 'asset',
      id: `asset:${it.market}:${it.symbol}`,
      title: `${it.symbol} · ${it.name}`,
      sub: `${it.sector || it.market.toUpperCase()} · ${it.change_pct >= 0 ? '+' : ''}${it.change_pct.toFixed(2)}% · 评分 ${it.radar_score}`,
      badge: it.market === 'crypto' ? '₿ 加密' : '$ 美股',
      market: it.market,
      symbol: it.symbol,
    }));

    if (!q) {
      entries.push(...assets.slice(0, 8), ...tfs.slice(0, 4), ...actions);
      return entries;
    }

    for (const a of assets) {
      if (`${a.title} ${a.sub}`.toLowerCase().includes(q)) entries.push(a);
    }
    for (const t of tfs) {
      if (`${t.title} ${t.interval}`.toLowerCase().includes(q)) entries.push(t);
    }
    for (const act of actions) {
      if (`${act.title} ${act.sub}`.toLowerCase().includes(q)) entries.push(act);
    }
    if (entries.length === 0 && /^[a-z0-9.\-]{1,12}$/i.test(q)) {
      const upper = q.toUpperCase();
      const guessedMkt: MarketType = upper.endsWith('USDT') ? 'crypto' : 'us';
      entries.push({
        kind: 'asset',
        id: `custom:${upper}`,
        title: `直接加载 ${upper}`,
        sub: `从 ${guessedMkt === 'crypto' ? '币安' : '美股 Yahoo'} 实时拉取 K 线分析`,
        badge: '直达',
        market: guessedMkt,
        symbol: upper,
      });
    }
    return entries.slice(0, 14);
  }, [cmdKQuery, radarData, displayedSideItems, dualChartMode, layers.vpvr, layers.compare, switchViewMode]);

  const runCmdKEntry = useCallback(
    (entry: CmdKEntry) => {
      if (entry.kind === 'asset') {
        selectAsset(entry.market, entry.symbol);
      } else if (entry.kind === 'tf') {
        setIsPlaying(false);
        setReplayIndex(-1);
        setIntervalVal(entry.interval);
        switchViewMode('workbench');
      } else {
        entry.run();
      }
      setCmdKOpen(false);
    },
    [selectAsset, switchViewMode]
  );

  // Global keyboard shortcuts: Cmd/Ctrl+K Palette, ArrowUp/ArrowDown instant ticker flip, Esc cancel
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdKOpen((v) => !v);
        setCmdKQuery('');
        setCmdKIdx(0);
        return;
      }
      if (e.key === 'Escape') {
        if (cmdKOpen) setCmdKOpen(false);
        if (displayMenuOpen) setDisplayMenuOpen(false);
        if (indicatorModalOpen) setIndicatorModalOpen(false);
        if (alertsOpen) setAlertsOpen(false);
        setPickAlertMode(false);
        setMeasureMode(false);
        setMeasurePts([]);
        setRrTool((prev) => (prev.pickField ? { ...prev, pickField: null } : prev));
        return;
      }

      if (viewMode !== 'workbench' || cmdKOpen || displayMenuOpen) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase() || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!displayedSideItems.length) return;
        e.preventDefault();
        const curIdx = displayedSideItems.findIndex((x) => x.symbol === symbol && x.market === market);
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const nextIdx =
          curIdx < 0
            ? 0
            : (curIdx + delta + displayedSideItems.length) % displayedSideItems.length;
        const nxt = displayedSideItems[nextIdx];
        if (nxt) {
          selectAsset(nxt.market, nxt.symbol);
          window.requestAnimationFrame(() => {
            document.querySelector('.symbol-item.active')?.scrollIntoView({ block: 'nearest' });
          });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode, cmdKOpen, displayMenuOpen, alertsOpen, displayedSideItems, symbol, market, selectAsset]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      if (displayedSideItems.length > 0) {
        selectAsset(displayedSideItems[0].market, displayedSideItems[0].symbol);
      } else if (symbols.length > 0) {
        selectAsset(symbols[0].market, symbols[0].symbol);
      } else {
        selectAsset(
          sideMarketFilter === 'us' ? 'us' : market,
          searchQuery.trim().toUpperCase()
        );
      }
    }
  };

  const totalCandles = data?.total_candles || 500;
  const currentReplayPos = replayIndex >= 0 ? replayIndex + 1 : totalCandles;
  const isReplaying = replayIndex >= 0 && replayIndex < totalCandles - 1;

  const oppCount = radarData
    ? radarData.counts.golden_pit +
      radarData.counts.bear_short_put +
      radarData.counts.ma_squeeze +
      radarData.counts.resilient_leader
    : 0;

  const bias = data?.analysis.bias;
  const overview = data?.analysis.overview;
  const sim = data?.analysis.similar_samples;

  return (
    <div
      className={`app-shell view-${viewMode} tab-${mobileTab}${chartExpanded ? ' chart-expanded' : ''}${
        mobileToolsOpen ? ' tools-open' : ''
      }`}
      data-web-zoom={isMacNative ? 'native' : 'web'}
      style={
        !isMacNative && uiZoomPct !== 100
          ? ({ '--obs-ui-zoom': String(uiZoomPct / 100) } as React.CSSProperties)
          : undefined
      }
    >
      {/* Top Bar */}
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-logo">
            <Activity size={18} />
          </div>
          <span className="brand-zh">观势</span>
          <span className="brand-sep">/</span>
          <span className="brand-en">MARKET OBSERVATORY</span>

          <div className="view-switcher">
            <button
              type="button"
              className={`vs-btn ${viewMode === 'workbench' ? 'active' : ''}`}
              onClick={() => switchViewMode('workbench')}
            >
              <span>{lang === 'zh' ? '深度看盘台' : 'Workbench'}</span>
            </button>
            <button
              type="button"
              className={`vs-btn radar ${viewMode === 'radar' ? 'active' : ''}`}
              onClick={() => switchViewMode('radar')}
            >
              <span>{lang === 'zh' ? '量化选股雷达' : 'Quant Radar'}</span>
              {oppCount > 0 && <span className="vs-badge">{oppCount}</span>}
            </button>
            <button
              type="button"
              className={`vs-btn calendar ${viewMode === 'calendar' ? 'active' : ''}`}
              onClick={() => switchViewMode('calendar')}
            >
              <span>{lang === 'zh' ? '避雷日历' : 'Calendar'}</span>
              {(calendarData?.urgent_48h_count ?? 0) > 0 && (
                <span className="vs-badge cal">{calendarData?.urgent_48h_count}</span>
              )}
            </button>
            <button
              type="button"
              className={`vs-btn etf-plan ${viewMode === 'etf_plan' ? 'active' : ''}`}
              onClick={() => switchViewMode('etf_plan')}
            >
              <span>{lang === 'zh' ? '美股 ETF 计划' : 'ETF Plan'}</span>
            </button>
            <button
              type="button"
              className={`vs-btn calculator ${viewMode === 'calculator' ? 'active' : ''}`}
              onClick={() => switchViewMode('calculator')}
            >
              <span>{lang === 'zh' ? '仓位计算' : 'Calc'}</span>
            </button>
          </div>
        </div>

        {/* Topbar Compact Global Futures / VIX / Thermometer Pills */}
        {radarData && (
          <div className="topbar-global-pills">
            {radarData.vix_futures.nq.price > 0 && (
              <button
                type="button"
                className="tg-pill"
                onClick={() => switchViewMode('radar')}
                title="24H 纳指100期货"
              >
                <span>NQ</span>
                <b className={radarData.vix_futures.nq.change_pct >= 0 ? 'bull' : 'bear'}>
                  {radarData.vix_futures.nq.change_pct >= 0 ? '+' : ''}
                  {radarData.vix_futures.nq.change_pct.toFixed(2)}%
                </b>
              </button>
            )}
            <button
              type="button"
              className={`tg-pill vix-${radarData.vix_futures.state.toLowerCase()}`}
              onClick={() => switchViewMode('radar')}
              title={radarData.vix_futures.desc_zh}
            >
              <span>
                VIX {radarData.vix_futures.vix_spot || '--'}
              </span>
            </button>
          </div>
        )}

        <div className="top-actions">
          <div className="display-scale-wrap">
            <button
              type="button"
              className={`btn-display-scale ${displayMenuOpen ? 'active' : ''}`}
              onClick={() => setDisplayMenuOpen((v) => !v)}
              title={lang === 'zh' ? '调整界面缩放 (⌘+ / ⌘-) 与窗口分辨率' : 'Zoom & Resolution Settings'}
            >
              <span>{uiZoomPct}%</span>
            </button>

            {displayMenuOpen && (
              <>
                <div
                  className="display-popover-backdrop"
                  onClick={() => setDisplayMenuOpen(false)}
                />
                <div className="display-settings-popover">
                  <div className="dsp-section">
                    <div className="dsp-head">
                      <span>{lang === 'zh' ? '界面缩放 (⌘+ / ⌘- / ⌘0)' : 'Display Zoom'}</span>
                      <b>{uiZoomPct}%</b>
                    </div>
                    <div className="dsp-zoom-controls">
                      <button
                        type="button"
                        className="dsp-step-btn"
                        onClick={() => changeUiZoom(uiZoomPct - 10)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="dsp-reset-btn"
                        onClick={() => changeUiZoom(100)}
                      >
                        {lang === 'zh' ? '重置 100%' : 'Reset 100%'}
                      </button>
                      <button
                        type="button"
                        className="dsp-step-btn"
                        onClick={() => changeUiZoom(uiZoomPct + 10)}
                      >
                        +
                      </button>
                    </div>
                    <div className="dsp-presets">
                      {[80, 90, 100, 110, 125, 140].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          className={`dsp-pill ${uiZoomPct === pct ? 'active' : ''}`}
                          onClick={() => changeUiZoom(pct)}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="dsp-divider" />

                  <div className="dsp-section">
                    <div className="dsp-head">
                      <span>{lang === 'zh' ? '窗口分辨率' : 'Window Resolution'}</span>
                      <span className="dsp-res-val">
                        {viewportSize.w} × {viewportSize.h}
                      </span>
                    </div>
                    {isMacNative ? (
                      <div className="dsp-res-grid">
                        {[
                          { label: '1280 × 800', w: 1280, h: 800, max: false },
                          { label: '1440 × 900', w: 1440, h: 900, max: false },
                          { label: '1728 × 1080 (2K)', w: 1728, h: 1080, max: false },
                          { label: '2200 × 1280 (4K)', w: 2200, h: 1280, max: false },
                          { label: lang === 'zh' ? '⛶ 铺满屏幕' : '⛶ Fill Screen', w: 0, h: 0, max: true },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className="dsp-res-btn"
                            onClick={() => applyResolutionPreset(preset.w, preset.h, preset.max)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="dsp-web-note">
                        {lang === 'zh'
                          ? '桌面客户端支持一键切换窗口分辨率；网页端可直接按 ⌘+ / ⌘- 原生缩放，或用上方百分比微调面板大小。'
                          : 'Use ⌘+ / ⌘- for native zoom, or pick a % scale above.'}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            className="btn-refresh"
            onClick={() => {
              if (viewMode === 'radar') {
                loadRadar(true);
              } else if (viewMode === 'calendar') {
                loadCalendar(true);
              } else if (viewMode === 'etf_plan') {
                loadEtfPlan(true);
              } else {
                loadAnalysis(market, symbol, interval, replayIndex, maConfig, false, true);
                loadMacro(market, symbol, true);
                loadRadar(true);
              }
            }}
            disabled={loading || radarLoading || calendarLoading || etfPlanLoading}
          >
            <RefreshCw
              size={14}
              className={loading || radarLoading || calendarLoading || etfPlanLoading ? 'spin' : ''}
            />
            <span>{lang === 'zh' ? '刷新行情' : 'Refresh'}</span>
          </button>

          <div className="lang-switch">
            <button
              className={lang === 'zh' ? 'active' : ''}
              onClick={() => setLang('zh')}
            >
              中文
            </button>
            <button
              className={lang === 'en' ? 'active' : ''}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>
        </div>
      </header>

      {viewMode === 'radar' && (
        <RadarPage
          radar={radarData}
          loading={radarLoading}
          lang={lang}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onSelectSymbol={selectAsset}
          onRefresh={() => loadRadar(true)}
          onBackToChart={() => switchViewMode('workbench')}
        />
      )}
      {viewMode === 'calendar' && (
        <CalendarPage
          data={calendarData}
          loading={calendarLoading}
          lang={lang}
          onRefresh={() => loadCalendar(true)}
          onBackToWorkbench={() => switchViewMode('workbench')}
          onJumpToSymbol={(sym) => {
            setIsPlaying(false);
            setReplayIndex(-1);
            setMarket('us');
            setSymbol(sym);
            switchViewMode('workbench');
            setMobileTab('chart');
          }}
        />
      )}
      {viewMode === 'etf_plan' && (
        <EtfPlanPage
          data={etfPlanData}
          loading={etfPlanLoading}
          lang={lang}
          onRefresh={() => loadEtfPlan(true)}
          onBackToWorkbench={() => switchViewMode('workbench')}
          onJumpToSymbol={(sym) => {
            setIsPlaying(false);
            setReplayIndex(-1);
            setMarket('us');
            setSymbol(sym);
            setIntervalVal('1d');
            switchViewMode('workbench');
            setMobileTab('chart');
          }}
        />
      )}
      {viewMode === 'calculator' && (
        <CalculatorPage
          lang={lang}
          currentMarket={market}
          currentSymbol={symbol}
          currentPrice={data?.meta.price || 0}
          onBackToWorkbench={() => switchViewMode('workbench')}
        />
      )}
      <div
        className="workspace-body"
        style={{ display: viewMode === 'workbench' ? undefined : 'none' }}
      >
          {/* Left Sidebar (0ms memory-powered screener + custom search) */}
          <aside className="left-sidebar">
            <div className="side-market-tabs">
              {(
                [
                  ['all', lang === 'zh' ? '全部' : 'All'],
                  ['crypto', lang === 'zh' ? '₿ 加密' : 'Crypto'],
                  ['us', lang === 'zh' ? '$ 美股' : 'US'],
                  ['fav', lang === 'zh' ? `自选 ${favorites.length}` : `Fav ${favorites.length}`],
                ] as ['all' | 'crypto' | 'us' | 'fav', string][]
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  className={sideMarketFilter === k ? 'active' : ''}
                  onClick={() => {
                    setSideMarketFilter(k);
                    setSideSector('all');
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="side-strat-pills">
              {(
                [
                  ['all', lang === 'zh' ? '全部' : 'All'],
                  ['resilient_leader', '抗跌'],
                  ['golden_pit', '黄金坑'],
                  ['bear_short_put', '空·Put'],
                  ['ma_squeeze', '粘合'],
                ] as [typeof sideStrategy, string][]
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  className={sideStrategy === k ? 'active' : ''}
                  onClick={() => setSideStrategy(k)}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="side-filter-row">
              <select
                className="side-sector-select"
                value={sideSector}
                onChange={(e) => setSideSector(e.target.value)}
              >
                <option value="all">{lang === 'zh' ? '全部赛道' : 'All Sectors'}</option>
                {sideSectors.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="side-radar-jump"
                onClick={() => switchViewMode('radar')}
                title={lang === 'zh' ? '打开全屏量化选股雷达' : 'Open Quant Radar'}
              >
                雷达
              </button>
            </div>

            <div className="search-box" style={{ marginTop: 0, marginBottom: 8 }}>
              <Search size={13} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={lang === 'zh' ? '0ms 搜代码/美光/大饼...' : 'Search name or symbol...'}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  title="Clear"
                >
                  ×
                </button>
              )}
            </div>

            {symbolOrder.length > 0 && (
              <div className="side-order-bar">
                <span>{lang === 'zh' ? '已自定义排序' : 'Custom Order'}</span>
                <button
                  type="button"
                  className="side-order-reset"
                  onClick={() => setSymbolOrder([])}
                >
                  {lang === 'zh' ? '恢复默认' : 'Reset'}
                </button>
              </div>
            )}

            <div className="symbol-list">
              {displayedSideItems.map((item) => {
                const isFav = favorites.includes(item.symbol);
                const isActive = item.symbol === symbol && item.market === market;
                const isUp = item.change_pct >= 0;
                const rowKey = `${item.market}:${item.symbol}`;
                const isDragging = dragKey === rowKey;
                const isOverAbove = dragOverKey === rowKey && dragOverPos === 'above';
                const isOverBelow = dragOverKey === rowKey && dragOverPos === 'below';
                return (
                  <div
                    key={rowKey}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', rowKey);
                      setDragKey(rowKey);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pos: 'above' | 'below' =
                        e.clientY - rect.top < rect.height / 2 ? 'above' : 'below';
                      if (dragOverKey !== rowKey || dragOverPos !== pos) {
                        setDragOverKey(rowKey);
                        setDragOverPos(pos);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragKey || e.dataTransfer.getData('text/plain');
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pos: 'above' | 'below' =
                        e.clientY - rect.top < rect.height / 2 ? 'above' : 'below';
                      if (from && from !== rowKey) {
                        reorderSideItem(from, rowKey, pos);
                      }
                      setDragKey(null);
                      setDragOverKey(null);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDragOverKey(null);
                    }}
                    className={`symbol-item ${isActive ? 'active' : ''}${
                      isDragging ? ' dragging' : ''
                    }${isOverAbove ? ' drag-over-above' : ''}${
                      isOverBelow ? ' drag-over-below' : ''
                    }`}
                    onClick={() => selectAsset(item.market, item.symbol)}
                  >
                    <span
                      className="sym-drag-handle"
                      title={lang === 'zh' ? '按住拖动调整排序' : 'Drag to reorder'}
                    >
                      <GripVertical size={12} />
                    </span>
                    <div className="sym-badge">
                      {item.market === 'crypto' ? '₿' : '$'}
                    </div>
                    <div className="sym-info">
                      <div className="sym-code-row">
                        <span className="sym-code">{item.symbol}</span>
                        {item.setup && item.setup !== 'watch' && (
                          <span className={`sym-setup-tag setup-${item.setup}`}>
                            {item.setup === 'golden_pit'
                              ? '坑'
                              : item.setup === 'bear_short_put'
                              ? '空'
                              : item.setup === 'resilient_leader'
                              ? '强'
                              : item.setup === 'ma_squeeze'
                              ? '粘'
                              : item.setup === 'crash_knife'
                              ? '熔'
                              : '升'}
                          </span>
                        )}
                      </div>
                      <div className="sym-name">{item.name}</div>
                    </div>
                    <div className="sym-price-col">
                      {item.price > 0 && (
                        <>
                          <div className="sym-px">{fmtPrice(item.price)}</div>
                          <div className={`sym-pct ${isUp ? 'bull' : 'bear'}`}>
                            {isUp ? '+' : ''}
                            {item.change_pct.toFixed(2)}%
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      className={`star-btn ${isFav ? 'fav' : ''}`}
                      onClick={(e) => toggleFavorite(item.symbol, e)}
                      title="Favorite"
                    >
                      <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="sidebar-footer">
              <div className="slogan-en">OBSERVE. DEFINE. ACT.</div>
              <div className="slogan-zh">
                {lang === 'zh'
                  ? '全池秒切换 · 顺大势抓右侧'
                  : 'Zero-latency multi-market radar.'}
              </div>
              <div className="version-tag">研究终端 v2.0 · Quant Radar</div>
            </div>
          </aside>

        {/* Center Chart Area */}
        <main className="center-stage">
          {/* Symbol Live Header */}
          <div className="symbol-header">
            <div
              className="sh-left"
              onClick={() =>
                setMobileTab((prev) => (prev === 'symbols' ? 'chart' : 'symbols'))
              }
              title={lang === 'zh' ? '点击切换标的' : 'Switch Symbol'}
            >
              <div className="sh-avatar">{symbol.slice(0, 1)}</div>
              <div>
                <div className="sh-title">
                  <span>{data?.meta.symbol || symbol}</span>
                  <span className="mobile-switch-hint">
                    {lang === 'zh' ? '切换 ▾' : 'Switch ▾'}
                  </span>
                  <Star
                    size={15}
                    className={`sh-star ${favorites.includes(symbol) ? 'fav' : ''}`}
                    fill={favorites.includes(symbol) ? 'currentColor' : 'none'}
                    onClick={(e) => toggleFavorite(symbol, e)}
                  />
                </div>
                <div className="sh-sub">
                  {data?.meta.name || symbol} · {data?.meta.exchange || market.toUpperCase()}
                </div>
              </div>
            </div>

            {/* Mobile Landscape Quick Switcher */}
            <div className="landscape-switcher">
              <button
                onClick={() => switchViewMode('radar')}
                className="ls-radar-btn"
              >
                ⚡{lang === 'zh' ? '雷达' : 'Radar'}
              </button>
              <button
                className={mobileTab === 'chart' && !chartExpanded ? 'active' : ''}
                onClick={() => {
                  setChartExpanded(false);
                  setMobileTab('chart');
                }}
              >
                {lang === 'zh' ? 'K线' : 'Chart'}
              </button>
              <button
                className={mobileTab === 'intel' ? 'active' : ''}
                onClick={() => {
                  setChartExpanded(false);
                  setMobileTab('intel');
                }}
              >
                {lang === 'zh' ? '建议·快讯' : 'Intel'}
                {macroData && macroData.within_30m_count > 0 && (
                  <span className="ls-badge">{macroData.within_30m_count}</span>
                )}
              </button>
              <button
                className={mobileTab === 'symbols' ? 'active' : ''}
                onClick={() => {
                  setChartExpanded(false);
                  setMobileTab('symbols');
                }}
              >
                {lang === 'zh' ? '搜标的' : 'Symbols'}
              </button>
              <button
                className={mobileToolsOpen ? 'active' : ''}
                onClick={() => setMobileToolsOpen((v) => !v)}
              >
                {lang === 'zh' ? '图层' : 'Tools'}
              </button>
              <button
                className={chartExpanded ? 'active' : ''}
                onClick={() => setChartExpanded((v) => !v)}
              >
                {chartExpanded
                  ? lang === 'zh'
                    ? '退出全屏'
                    : 'Exit'
                  : lang === 'zh'
                  ? '全屏'
                  : 'Full'}
              </button>
              <button
                onClick={() => {
                  loadAnalysis(market, symbol, interval, replayIndex, maConfig, false, true);
                  loadMacro(market, symbol, true);
                  loadRadar(true);
                }}
                disabled={loading}
                title={lang === 'zh' ? '强制刷新实时行情' : 'Force Refresh'}
              >
                <RefreshCw size={11} className={loading ? 'spin' : ''} />
              </button>
            </div>

            <div className="sh-right">
              <div className="sh-price-row">
                {data?.meta.session_zh && (
                  <span className={`sh-session-pill sess-${data.meta.session || 'closed'}`}>
                    {lang === 'zh' ? data.meta.session_zh : (data.meta.session_en || data.meta.session_zh)}
                  </span>
                )}
                <div className="sh-price">{fmtPrice(data?.meta.price || 0)}</div>
              </div>
              <div
                className={`sh-chg ${
                  (data?.meta.price_change_percent || 0) >= 0 ? 'bull' : 'bear'
                }`}
              >
                {(data?.meta.price_change_percent || 0) >= 0 ? '+' : ''}
                {(data?.meta.price_change_percent || 0).toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Timeframe Bar + Pro Multi-Chart / Alerts / Paper Trading Toggles */}
          <div className="toolbar-row">
            <div className="tf-group">
              {INTERVALS.map((iv) => (
                <button
                  key={iv.key}
                  className={`tf-btn ${interval === iv.key ? 'active' : ''}`}
                  onClick={() => {
                    setIsPlaying(false);
                    setReplayIndex(-1);
                    setIntervalVal(iv.key);
                  }}
                >
                  {lang === 'zh' ? iv.zh : iv.en}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`btn-fx-indicators ${indicatorModalOpen ? 'active' : ''}`}
              onClick={openIndicatorsModal}
              title={lang === 'zh' ? '统一管理均线(MA5~200)、布林带、成交量、VPVR、缠论等全部指标' : 'Indicators Library'}
            >
              <span className="fx-icon">fx</span>
              <span>{lang === 'zh' ? '指标' : 'Indicators'}</span>
              <span className="fx-count">
                {Object.values(layers).filter(Boolean).length}
              </span>
            </button>

            <div className="pro-tools-group">
              <button
                type="button"
                className={`pro-tool-btn ${dualChartMode ? 'active' : ''}`}
                onClick={() => {
                  if (!dualChartMode && secondaryInterval === interval) {
                    const nextSec =
                      interval === '1m' || interval === '5m' || interval === '15m'
                        ? '4h'
                        : interval === '1h'
                        ? '1d'
                        : interval === '4h'
                        ? '1d'
                        : '1h';
                    setSecondaryInterval(nextSec);
                  }
                  setDualChartMode((v) => !v);
                }}
                title={lang === 'zh' ? '开启大小周期双图同屏对比' : 'Dual-Chart Multi-Timeframe'}
              >
                {lang === 'zh' ? '双图联动' : 'Dual'}
              </button>
              <button
                type="button"
                className={`pro-tool-btn alert-btn ${alertsOpen || pickAlertMode ? 'active' : ''}`}
                onClick={() => {
                  const next = !alertsOpen;
                  setAlertsOpen(next);
                  if (next) loadMaAlerts(false);
                }}
                title={lang === 'zh' ? '价格预警线与均线穿越自动推送 (Telegram/Webhook)' : 'Price & MA Crossover Alerts'}
              >
                {lang === 'zh' ? '预警' : 'Alerts'}
                {(alerts.filter((a) => a.active && a.market === market && a.symbol === symbol).length +
                  (maAlertsData?.rules.filter((r) => r.enabled).length ?? 0)) >
                  0 && (
                  <span className="ptb-badge">
                    {alerts.filter((a) => a.active && a.market === market && a.symbol === symbol).length +
                      (maAlertsData?.rules.filter((r) => r.enabled).length ?? 0)}
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`pro-tool-btn ${rrTool.enabled ? 'active' : ''}`}
                onClick={toggleRrTool}
                title={lang === 'zh' ? 'TradingView 盈亏比尺与 1.5% 仓位计算器' : 'Risk/Reward Position Tool'}
              >
                {lang === 'zh' ? '盈亏尺' : 'R:R'}
              </button>
              <button
                type="button"
                className={`pro-tool-btn ${measureMode || measurePts.length > 0 ? 'active' : ''}`}
                onClick={() => {
                  if (measureMode || measurePts.length > 0) {
                    setMeasureMode(false);
                    setMeasurePts([]);
                  } else {
                    setPickAlertMode(false);
                    setMeasureMode(true);
                  }
                }}
                title={lang === 'zh' ? '测距尺 (或按住 Shift 直接点击K线两处)' : 'Measure (or Shift+Click)'}
              >
                {lang === 'zh' ? '测距' : 'Measure'}
              </button>
              <button
                type="button"
                className="pro-tool-btn"
                onClick={() => {
                  setCmdKOpen(true);
                  setCmdKQuery('');
                  setCmdKIdx(0);
                }}
                title={lang === 'zh' ? '⌘K 快速搜索标的/切换周期 · ↑↓ 方向键极速翻票' : '⌘K Command Palette'}
              >
                ⌘K {lang === 'zh' ? '秒切' : 'Jump'}
              </button>
              <button
                type="button"
                className={`pro-tool-btn paper-btn ${paperOpen ? 'active' : ''}`}
                onClick={() => setPaperOpen((v) => !v)}
                title={lang === 'zh' ? 'K线回放 / 实时模拟交易练习' : 'Replay Paper Trading'}
              >
                {lang === 'zh' ? '模拟练手' : 'Paper'}
              </button>
            </div>
          </div>

          {/* Floating Chart Price Alerts & MA Crossover Push Drawer */}
          {alertsOpen && (
            <div className="alerts-drawer">
              <div className="ad-tabs">
                <button
                  type="button"
                  className={`ad-tab ${alertTab === 'ma' ? 'active' : ''}`}
                  onClick={() => setAlertTab('ma')}
                >
                  📡 {lang === 'zh' ? '均线穿越自动推送' : 'MA Cross Push'}
                  {(maAlertsData?.rules.filter((r) => r.enabled).length ?? 0) > 0 && (
                    <span className="ad-tab-cnt">
                      {maAlertsData?.rules.filter((r) => r.enabled).length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`ad-tab ${alertTab === 'price' ? 'active' : ''}`}
                  onClick={() => setAlertTab('price')}
                >
                  📍 {symbol} {lang === 'zh' ? '价格金线' : 'Price Line'}
                  {alerts.filter((a) => a.active && a.market === market && a.symbol === symbol).length > 0 && (
                    <span className="ad-tab-cnt">
                      {alerts.filter((a) => a.active && a.market === market && a.symbol === symbol).length}
                    </span>
                  )}
                </button>
                <div className="ad-tabs-right">
                  {maAlertsData?.channels && (
                    <span
                      className={`ad-ch-pill ${
                        maAlertsData.channels.telegram_configured || maAlertsData.channels.webhook_configured
                          ? 'ok'
                          : 'warn'
                      }`}
                    >
                      {maAlertsData.channels.telegram_configured
                        ? `TG 已连 (${maAlertsData.channels.telegram_chat_id_masked})`
                        : maAlertsData.channels.webhook_configured
                        ? 'Webhook 已连'
                        : '仅站内提醒 · 未绑TG'}
                    </span>
                  )}
                  <button type="button" className="ad-close-x" onClick={() => setAlertsOpen(false)}>
                    ×
                  </button>
                </div>
              </div>

              {alertTab === 'price' ? (
                <>
                  <div className="ad-row">
                    <span className="ad-title">
                      🔔 {symbol} {lang === 'zh' ? '价格预警线' : 'Price Alerts'}
                    </span>
                    <select
                      className="ad-select"
                      value={alertDirInput}
                      onChange={(e) => setAlertDirInput(e.target.value as 'above' | 'below')}
                    >
                      <option value="above">{lang === 'zh' ? '上穿 ≥' : 'Above ≥'}</option>
                      <option value="below">{lang === 'zh' ? '下破 ≤' : 'Below ≤'}</option>
                    </select>
                    <input
                      type="number"
                      step="any"
                      className="ad-input"
                      value={alertPriceInput}
                      onChange={(e) => setAlertPriceInput(e.target.value)}
                      placeholder={data?.meta.price ? fmtPrice(data.meta.price) : '目标价...'}
                    />
                    <button type="button" className="ad-btn primary" onClick={() => handleAddAlert()}>
                      {lang === 'zh' ? '➕ 添加金线' : '➕ Add'}
                    </button>
                    <button
                      type="button"
                      className={`ad-btn pick ${pickAlertMode ? 'active' : ''}`}
                      onClick={() => {
                        setPickAlertMode((v) => !v);
                        setAlertsOpen(false);
                      }}
                    >
                      {pickAlertMode
                        ? lang === 'zh'
                          ? '取消点图'
                          : 'Cancel Pick'
                        : lang === 'zh'
                        ? '🎯 点图直接设价'
                        : '🎯 Click Chart'}
                    </button>
                  </div>
                  <div className="ad-list">
                    {alerts.filter((a) => a.market === market && a.symbol === symbol).length === 0 ? (
                      <span className="ad-empty">
                        {lang === 'zh'
                          ? '当前标的暂无预警。输入价格或点「🎯 点图直接设价」后点击K线任意位置。'
                          : 'No alerts for this symbol yet.'}
                      </span>
                    ) : (
                      alerts
                        .filter((a) => a.market === market && a.symbol === symbol)
                        .map((al) => (
                          <div key={al.id} className={`ad-chip ${al.active ? 'active' : 'triggered'}`}>
                            <span>
                              {al.direction === 'above' ? '↑ 上穿' : '↓ 下破'} {fmtPrice(al.targetPrice)}
                              {!al.active ? (lang === 'zh' ? ' (已触发)' : ' (Hit)') : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => setAlerts((prev) => prev.filter((x) => x.id !== al.id))}
                            >
                              ×
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </>
              ) : (
                <div className="ma-alert-panel">
                  <div className="ma-preset-pills">
                    <span className="map-lbl">一键策略模板:</span>
                    <button
                      type="button"
                      className="map-btn"
                      disabled={maAlertBusy}
                      onClick={() =>
                        handleAddMaRule({
                          market: 'us',
                          symbol: 'QQQ',
                          interval: '1d',
                          ma_type: 'sma',
                          period: 200,
                          direction: 'cross_below',
                          offset_pct: -2,
                          note: '3x ETF 硬止损切 SGOV',
                        })
                      }
                    >
                      + QQQ 破SMA200×0.98
                    </button>
                    <button
                      type="button"
                      className="map-btn"
                      disabled={maAlertBusy}
                      onClick={() =>
                        handleAddMaRule({
                          market: 'us',
                          symbol: 'QQQ',
                          interval: '1d',
                          ma_type: 'sma',
                          period: 200,
                          direction: 'cross_above',
                          offset_pct: 3,
                          note: '3x 右侧开闸',
                        })
                      }
                    >
                      + QQQ 站SMA200×1.03
                    </button>
                    <button
                      type="button"
                      className="map-btn"
                      disabled={maAlertBusy}
                      onClick={() =>
                        handleAddMaRule({
                          market: 'crypto',
                          symbol: 'BTCUSDT',
                          interval: '1d',
                          ma_type: 'ema',
                          period: 20,
                          direction: 'both',
                          offset_pct: 0,
                          note: 'BTC 日线生命线穿越',
                        })
                      }
                    >
                      + BTC 穿日线EMA20
                    </button>
                    <button
                      type="button"
                      className="map-btn"
                      disabled={maAlertBusy}
                      onClick={() =>
                        handleAddMaRule({
                          market,
                          symbol,
                          interval: '1w',
                          ma_type: 'ema',
                          period: 20,
                          direction: 'both',
                          offset_pct: 0,
                          note: '20W 牛熊支撑带突破',
                        })
                      }
                    >
                      + {symbol} 20W牛熊带
                    </button>
                  </div>

                  <div className="ad-row">
                    <span className="ad-sym-pill">{symbol}</span>
                    <select
                      className="ad-select"
                      value={maAlertInterval}
                      onChange={(e) => setMaAlertInterval(e.target.value as '1h' | '4h' | '1d' | '1w')}
                    >
                      <option value="1h">1小时</option>
                      <option value="4h">4小时</option>
                      <option value="1d">日线</option>
                      <option value="1w">周线</option>
                    </select>
                    <select
                      className="ad-select"
                      value={maAlertType}
                      onChange={(e) => setMaAlertType(e.target.value as 'ema' | 'sma')}
                    >
                      <option value="sma">MA (SMA)</option>
                      <option value="ema">EMA</option>
                    </select>
                    <select
                      className="ad-select"
                      value={maAlertPeriod}
                      onChange={(e) => setMaAlertPeriod(Number(e.target.value) || 20)}
                    >
                      <option value={20}>20线</option>
                      <option value={50}>50线</option>
                      <option value={60}>60线</option>
                      <option value={100}>100线</option>
                      <option value={120}>120线</option>
                      <option value={200}>200年线</option>
                    </select>
                    <select
                      className="ad-select"
                      value={maAlertDir}
                      onChange={(e) =>
                        setMaAlertDir(e.target.value as 'cross_above' | 'cross_below' | 'both')
                      }
                    >
                      <option value="both">双向穿越</option>
                      <option value="cross_above">仅上穿突破</option>
                      <option value="cross_below">仅下破预警</option>
                    </select>
                    <input
                      type="number"
                      step="0.5"
                      className="ad-input sm"
                      value={maAlertOffset}
                      onChange={(e) => setMaAlertOffset(e.target.value)}
                      title="偏移% (例如 -2 代表 0.98倍, +3 代表 1.03倍)"
                      placeholder="偏移%"
                    />
                    <button
                      type="button"
                      className="ad-btn primary"
                      disabled={maAlertBusy}
                      onClick={() => handleAddMaRule()}
                    >
                      ➕ 开启自动巡检
                    </button>
                    <button
                      type="button"
                      className="ad-btn"
                      disabled={maAlertBusy}
                      onClick={handleScanMaNow}
                    >
                      🔄 立即扫描
                    </button>
                    <button
                      type="button"
                      className="ad-btn"
                      disabled={maAlertBusy}
                      onClick={handleTestMaPush}
                    >
                      📨 测试推送
                    </button>
                    <button
                      type="button"
                      className={`ad-btn ${channelCfgOpen ? 'active' : ''}`}
                      onClick={() => setChannelCfgOpen((v) => !v)}
                    >
                      ⚙️ 通道配置
                    </button>
                  </div>

                  {maAlertMsg && <div className="ma-alert-msg">{maAlertMsg}</div>}

                  {channelCfgOpen && (
                    <div className="ma-ch-cfg">
                      <input
                        type="password"
                        className="ad-input wide"
                        placeholder="Telegram Bot Token (留空保持现有)"
                        value={tgTokenInput}
                        onChange={(e) => setTgTokenInput(e.target.value)}
                      />
                      <input
                        type="text"
                        className="ad-input"
                        placeholder="Telegram Chat ID"
                        value={tgChatInput}
                        onChange={(e) => setTgChatInput(e.target.value)}
                      />
                      <input
                        type="text"
                        className="ad-input wide"
                        placeholder="或填写飞书/Discord/Bark Webhook URL"
                        value={webhookInput}
                        onChange={(e) => setWebhookInput(e.target.value)}
                      />
                      <button
                        type="button"
                        className="ad-btn primary"
                        disabled={maAlertBusy}
                        onClick={handleSaveChannelCfg}
                      >
                        保存推送通道
                      </button>
                    </div>
                  )}

                  <div className="ma-rule-list">
                    {(maAlertsData?.rules || []).length === 0 ? (
                      <span className="ad-empty">
                        暂无均线穿越监控规则。点上方模板一键启用，或用下拉框添加当前标的（后台每{' '}
                        {maAlertsData?.channels?.poll_sec ?? 180} 秒自动扫描推送）。
                      </span>
                    ) : (
                      (maAlertsData?.rules || []).map((r) => (
                        <div key={r.id} className={`ma-rule-chip ${r.enabled ? 'on' : 'off'}`}>
                          <button
                            type="button"
                            className="mr-toggle"
                            onClick={() => handleToggleMaRule(r)}
                            title={r.enabled ? '点击暂停' : '点击启用'}
                          >
                            {r.enabled ? '🟢' : '⏸️'}
                          </button>
                          <span className="mr-main">
                            <b>{r.symbol}</b> {r.interval.toUpperCase()} {r.ma_type.toUpperCase()}
                            {r.period}
                            {Math.abs(r.offset_pct) >= 0.01
                              ? `×${(1 + r.offset_pct / 100).toFixed(2)}`
                              : ''}{' '}
                            · {r.direction === 'cross_above' ? '↑上穿' : r.direction === 'cross_below' ? '↓下破' : '⇅双向'}
                          </span>
                          {r.last_trigger_line > 0 && (
                            <span className={`mr-stat ${r.last_dist_pct >= 0 ? 'bull' : 'bear'}`}>
                              线 {fmtPrice(r.last_trigger_line)} ({r.last_dist_pct >= 0 ? '+' : ''}
                              {r.last_dist_pct.toFixed(2)}%)
                            </span>
                          )}
                          {r.note && <span className="mr-note">{r.note}</span>}
                          <button
                            type="button"
                            className="mr-del"
                            onClick={() => handleDeleteMaRule(r.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Risk-Reward Ruler Interactive Bar */}
          {rrTool.enabled && (() => {
            const riskDist = Math.abs(rrTool.entry - rrTool.stop);
            const rewDist = Math.abs(rrTool.target - rrTool.entry);
            const rrVal = riskDist > 0 ? rewDist / riskDist : 0;
            const maxRiskUsd = rrTool.capital * (rrTool.riskPct / 100);
            const suggestQty = riskDist > 0 ? maxRiskUsd / riskDist : 0;
            const suggestNotional = suggestQty * rrTool.entry;
            return (
              <div className="rr-control-bar">
                <div className="rr-side-btns">
                  <button
                    type="button"
                    className={`rr-side-btn long ${rrTool.side === 'LONG' ? 'active' : ''}`}
                    onClick={() =>
                      setRrTool((p) => ({
                        ...p,
                        side: 'LONG',
                        stop: Number((p.entry * 0.955).toFixed(p.entry >= 100 ? 2 : 3)),
                        target: Number((p.entry * 1.11).toFixed(p.entry >= 100 ? 2 : 3)),
                      }))
                    }
                  >
                    多头尺
                  </button>
                  <button
                    type="button"
                    className={`rr-side-btn short ${rrTool.side === 'SHORT' ? 'active' : ''}`}
                    onClick={() =>
                      setRrTool((p) => ({
                        ...p,
                        side: 'SHORT',
                        stop: Number((p.entry * 1.045).toFixed(p.entry >= 100 ? 2 : 3)),
                        target: Number((p.entry * 0.89).toFixed(p.entry >= 100 ? 2 : 3)),
                      }))
                    }
                  >
                    空头尺
                  </button>
                </div>

                <label className="rr-field">
                  <span>入场</span>
                  <input
                    type="number"
                    step="any"
                    value={rrTool.entry}
                    onChange={(e) => setRrTool((p) => ({ ...p, entry: Number(e.target.value) || 0 }))}
                  />
                  <button
                    type="button"
                    className={`rr-pick-btn ${rrTool.pickField === 'entry' ? 'active' : ''}`}
                    onClick={() => setRrTool((p) => ({ ...p, pickField: p.pickField === 'entry' ? null : 'entry' }))}
                    title="点图改入场价"
                  >
                    🎯
                  </button>
                </label>

                <label className="rr-field">
                  <span>止损</span>
                  <input
                    type="number"
                    step="any"
                    value={rrTool.stop}
                    onChange={(e) => setRrTool((p) => ({ ...p, stop: Number(e.target.value) || 0 }))}
                  />
                  <button
                    type="button"
                    className={`rr-pick-btn ${rrTool.pickField === 'stop' ? 'active' : ''}`}
                    onClick={() => setRrTool((p) => ({ ...p, pickField: p.pickField === 'stop' ? null : 'stop' }))}
                    title="点图改止损价"
                  >
                    🎯
                  </button>
                </label>

                <label className="rr-field">
                  <span>止盈</span>
                  <input
                    type="number"
                    step="any"
                    value={rrTool.target}
                    onChange={(e) => setRrTool((p) => ({ ...p, target: Number(e.target.value) || 0 }))}
                  />
                  <button
                    type="button"
                    className={`rr-pick-btn ${rrTool.pickField === 'target' ? 'active' : ''}`}
                    onClick={() => setRrTool((p) => ({ ...p, pickField: p.pickField === 'target' ? null : 'target' }))}
                    title="点图改止盈价"
                  >
                    🎯
                  </button>
                </label>

                <label className="rr-field cap">
                  <span>本金$</span>
                  <input
                    type="number"
                    value={rrTool.capital}
                    onChange={(e) => setRrTool((p) => ({ ...p, capital: Math.max(100, Number(e.target.value) || 10000) }))}
                  />
                </label>

                <div className="rr-summary-pills">
                  <span className={`rr-ratio-pill ${rrVal >= 2 ? 'good' : 'weak'}`}>
                    盈亏比 {rrVal.toFixed(2)} : 1 {rrVal < 2 ? '(偏低<2:1)' : '(合格)'}
                  </span>
                  <span className="rr-size-pill">
                    1.5%风控配仓: ${suggestNotional.toFixed(0)} ({suggestQty.toFixed(suggestQty >= 10 ? 1 : 3)} 份)
                  </span>
                  <button
                    type="button"
                    className="sec-close-btn"
                    onClick={() => setRrTool((p) => ({ ...p, enabled: false, pickField: null }))}
                  >
                    × 关闭
                  </button>
                </div>
              </div>
            );
          })()}

          {/* 全部指标图层、双均线参数与常用组合均已整合至顶部工具栏「fx 指标」库 */}

          {errorMsg && <div className="error-banner">{errorMsg}</div>}

          {/* 宏观 ETF 资金流向 & 防插针指引条 */}
          {layers.macro && macroData && (
            <div
              className={`macro-strip wick-${macroData.guidance.wick_level}${
                macroExpanded ? ' macro-expanded' : ''
              }`}
            >
              <div className="etf-pills-row">
                <span className="etf-strip-tag">
                  {lang === 'zh' ? '美股ETF风向' : 'US ETF Flows'}
                </span>
                <div className="etf-pills-scroll">
                  {macroData.etfs.map((etf) => {
                    const isUp = etf.change_pct >= 0;
                    return (
                      <button
                        key={etf.symbol}
                        className={`etf-pill ${etf.flow_state}`}
                        onClick={() => {
                          setIsPlaying(false);
                          setReplayIndex(-1);
                          setMarket('us');
                          setSymbol(etf.symbol);
                          setMobileTab('chart');
                        }}
                        title={`${etf.symbol} ${etf.label_zh} | ${etf.flow_zh} | RVol ${etf.rvol}x`}
                      >
                        <span className="ep-sym">{etf.symbol}</span>
                        <span className={`ep-chg ${isUp ? 'bull' : 'bear'}`}>
                          {isUp ? '+' : ''}
                          {etf.change_pct.toFixed(2)}%
                        </span>
                        <span className="ep-flow">
                          {lang === 'zh' ? etf.flow_zh : etf.flow_en}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="macro-toggle-btn"
                  onClick={() => setMacroExpanded((v) => !v)}
                >
                  {macroExpanded
                    ? lang === 'zh'
                      ? '收起 ▴'
                      : 'Less ▴'
                    : lang === 'zh'
                    ? '指引 ▾'
                    : 'Guide ▾'}
                </button>
                <div className="water-pill" title={macroData.water_sources.fed_liquidity_zh}>
                  <span>
                    {lang === 'zh'
                      ? `${macroData.water_sources.btc_etf_flow_zh} · ${macroData.water_sources.fed_liquidity_zh}`
                      : `${macroData.water_sources.btc_etf_flow_en} · ${macroData.water_sources.fed_liquidity_en}`}
                  </span>
                </div>
              </div>

              {macroExpanded && (
                <div className="macro-guidance-box">
                  {macroData.cycle.squeeze_warning_zh && (
                    <div className="mg-squeeze">
                      {lang === 'zh'
                        ? macroData.cycle.squeeze_warning_zh
                        : macroData.cycle.squeeze_warning_en}
                    </div>
                  )}
                  <div className="mg-cols">
                    <div className="mg-wick">
                      {lang === 'zh'
                        ? macroData.guidance.wick_warning_zh
                        : macroData.guidance.wick_warning_en}
                    </div>
                    <div className="mg-buy">
                      {lang === 'zh'
                        ? macroData.guidance.buy_method_zh
                        : macroData.guidance.buy_method_en}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chart & Overlay (Single or Dual-Chart Sync) */}
          <div className={dualChartMode ? 'dual-chart-grid' : 'single-chart-wrap'}>
            {dualChartMode ? (
              <div className="primary-chart-pane">
                <div className="pri-chart-head">
                  <span className="pri-chart-title">
                    🎯 {lang === 'zh' ? '主图找买点' : 'Entry TF'} · {symbol}
                  </span>
                  <div className="sec-tf-pills">
                    {['5m', '15m', '1h', '4h', '1d'].map((iv) => (
                      <button
                        key={iv}
                        type="button"
                        className={`sec-tf-btn ${interval === iv ? 'active' : ''}`}
                        onClick={() => {
                          setIsPlaying(false);
                          setReplayIndex(-1);
                          setIntervalVal(iv);
                        }}
                      >
                        {iv.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <ChartPanel
                  data={data}
                  interval={interval}
                  layers={layers}
                  lang={lang}
                  activePlanSide={activePlanSide}
                  onChangePlanSide={setActivePlanSide}
                  chartExpanded={chartExpanded}
                  onToggleExpand={() => setChartExpanded((v) => !v)}
                  loading={loading}
                  alerts={alerts}
                  pickAlertMode={pickAlertMode}
                  onPickAlertPrice={(p) => handleAddAlert(p)}
                  paperPosition={
                    paperState.position && (!paperState.position.symbol || paperState.position.symbol === symbol)
                      ? paperState.position
                      : null
                  }
                  visible={viewMode === 'workbench'}
                  layoutKey={`${viewMode}-${dualChartMode}-${chartExpanded}`}
                  compareCandles={compareCandles}
                  compareSymbol={compareTarget.sym}
                  rrTool={rrTool}
                  onPickRrPrice={handlePickRrPrice}
                  measureMode={measureMode}
                  measurePts={measurePts}
                  onPickMeasurePoint={handlePickMeasurePoint}
                  onClearMeasure={() => {
                    setMeasurePts([]);
                    setMeasureMode(false);
                  }}
                />
              </div>
            ) : (
              <ChartPanel
                data={data}
                interval={interval}
                layers={layers}
                lang={lang}
                activePlanSide={activePlanSide}
                onChangePlanSide={setActivePlanSide}
                chartExpanded={chartExpanded}
                onToggleExpand={() => setChartExpanded((v) => !v)}
                loading={loading}
                alerts={alerts}
                pickAlertMode={pickAlertMode}
                onPickAlertPrice={(p) => handleAddAlert(p)}
                paperPosition={
                  paperState.position && (!paperState.position.symbol || paperState.position.symbol === symbol)
                    ? paperState.position
                    : null
                }
                visible={viewMode === 'workbench'}
                layoutKey={`${viewMode}-${dualChartMode}-${chartExpanded}`}
                compareCandles={compareCandles}
                compareSymbol={compareTarget.sym}
                rrTool={rrTool}
                onPickRrPrice={handlePickRrPrice}
                measureMode={measureMode}
                measurePts={measurePts}
                onPickMeasurePoint={handlePickMeasurePoint}
                onClearMeasure={() => {
                  setMeasurePts([]);
                  setMeasureMode(false);
                }}
                onToggleLayer={toggleLayer}
                onOpenIndicators={openIndicatorsModal}
              />
            )}
            {dualChartMode && (
              <div className="secondary-chart-pane">
                <div className="sec-chart-head">
                  <span className="sec-chart-title">
                    🧭 {lang === 'zh' ? '副图定大势' : 'Trend TF'} · {symbol}
                  </span>
                  <div className="sec-tf-pills">
                    {['15m', '1h', '4h', '1d', '1w'].map((iv) => (
                      <button
                        key={iv}
                        type="button"
                        className={`sec-tf-btn ${secondaryInterval === iv ? 'active' : ''}`}
                        onClick={() => setSecondaryInterval(iv)}
                      >
                        {iv.toUpperCase()}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="sec-close-btn"
                      onClick={() => setDualChartMode(false)}
                      title={lang === 'zh' ? '关闭双图联动' : 'Close Dual Chart'}
                    >
                      × {lang === 'zh' ? '关闭' : 'Close'}
                    </button>
                  </div>
                </div>
                <ChartPanel
                  data={secondaryData}
                  interval={secondaryInterval}
                  layers={layers}
                  lang={lang}
                  activePlanSide={activePlanSide}
                  onChangePlanSide={setActivePlanSide}
                  loading={secondaryLoading}
                  alerts={alerts}
                  compact
                  visible={viewMode === 'workbench' && dualChartMode}
                  layoutKey={`${viewMode}-${dualChartMode}-${chartExpanded}-${secondaryInterval}`}
                />
              </div>
            )}
          </div>

          {/* Mobile Quick Decision Strip */}
          {data?.analysis.buy_advice && (
            <div
              className="mobile-quick-advice"
              onClick={() => setMobileTab('intel')}
            >
              <span
                className={`mqa-badge ${data.analysis.buy_advice.action.toLowerCase()}`}
              >
                {lang === 'zh'
                  ? data.analysis.buy_advice.action_zh
                  : data.analysis.buy_advice.action_en}
              </span>
              {data.analysis.options_advice && (
                <span className="mqa-opt">
                  {lang === 'zh'
                    ? data.analysis.options_advice.signal_zh
                    : data.analysis.options_advice.signal_en}
                </span>
              )}
              <span className="mqa-link">
                {lang === 'zh' ? '查看详情·快讯 ›' : 'Details & News ›'}
              </span>
            </div>
          )}

          {/* Historical Replay Paper Trading Bar */}
          {paperOpen && (() => {
            const markPrice =
              (data?.candles.length ? data.candles[data.candles.length - 1].close : 0) ||
              data?.meta.price ||
              0;
            const pos = paperState.position;
            const sameSymPos = pos && (!pos.symbol || pos.symbol === symbol);
            const unrealPnl =
              pos && sameSymPos && markPrice > 0
                ? pos.side === 'LONG'
                  ? (markPrice - pos.entryPrice) * pos.qty
                  : (pos.entryPrice - markPrice) * pos.qty
                : 0;
            const totalEquity = paperState.balance + unrealPnl;

            const closeCurrent = (prev: PaperTradeState, execPrice: number) => {
              if (!prev.position || !execPrice) return prev;
              const p = prev.position;
              const pnl =
                p.side === 'LONG'
                  ? (execPrice - p.entryPrice) * p.qty
                  : (p.entryPrice - execPrice) * p.qty;
              return {
                balance: Number((prev.balance + pnl).toFixed(2)),
                realizedPnl: Number((prev.realizedPnl + pnl).toFixed(2)),
                tradesCount: prev.tradesCount + 1,
                position: null,
              };
            };

            const openSide = (side: 'LONG' | 'SHORT') => {
              if (!markPrice || markPrice <= 0) return;
              setPaperState((prev) => {
                let next = prev;
                if (prev.position && prev.position.symbol === symbol) {
                  next = closeCurrent(prev, markPrice);
                } else if (prev.position && prev.position.symbol !== symbol) {
                  return prev;
                }
                const qty = Number(((next.balance * 0.25) / markPrice).toFixed(markPrice >= 100 ? 4 : 2));
                if (qty <= 0) return next;
                return {
                  ...next,
                  position: {
                    symbol,
                    side,
                    qty,
                    entryPrice: markPrice,
                    entryTime: Date.now(),
                  },
                };
              });
            };

            return (
              <div className="paper-trade-bar">
                <div className="ptb-stats">
                  <span className="ptb-title">🎮 {lang === 'zh' ? '模拟练手盘' : 'Paper'}</span>
                  <span>
                    {lang === 'zh' ? '总净值' : 'Equity'}: <b>${totalEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}</b>
                  </span>
                  <span>
                    {lang === 'zh' ? '已实现' : 'Realized'}:{' '}
                    <b className={paperState.realizedPnl >= 0 ? 'bull' : 'bear'}>
                      {paperState.realizedPnl >= 0 ? '+' : ''}
                      ${paperState.realizedPnl.toFixed(0)}
                    </b>
                  </span>
                  {pos ? (
                    sameSymPos ? (
                      <span className="ptb-pos">
                        {pos.side === 'LONG' ? '多' : '空'} {pos.qty} @ {fmtPrice(pos.entryPrice)} ·{' '}
                        <b className={unrealPnl >= 0 ? 'bull' : 'bear'}>
                          {unrealPnl >= 0 ? '+' : ''}
                          ${unrealPnl.toFixed(1)}
                        </b>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="ptb-jump-pos"
                        onClick={() => pos.symbol && setSymbol(pos.symbol)}
                      >
                        {lang === 'zh' ? `持仓在 ${pos.symbol} (点击切换)` : `Pos in ${pos.symbol}`}
                      </button>
                    )
                  ) : (
                    <span className="ptb-flat">{lang === 'zh' ? '空仓待命' : 'Flat'}</span>
                  )}
                </div>
                <div className="ptb-actions">
                  <button
                    type="button"
                    className="ptb-btn long"
                    onClick={() => openSide('LONG')}
                    disabled={!!(pos && !sameSymPos)}
                  >
                    {lang === 'zh' ? '做多 25%' : 'Long 25%'}
                  </button>
                  <button
                    type="button"
                    className="ptb-btn short"
                    onClick={() => openSide('SHORT')}
                    disabled={!!(pos && !sameSymPos)}
                  >
                    {lang === 'zh' ? '做空 25%' : 'Short 25%'}
                  </button>
                  <button
                    type="button"
                    className="ptb-btn close"
                    onClick={() => setPaperState((prev) => closeCurrent(prev, markPrice))}
                    disabled={!sameSymPos}
                  >
                    {lang === 'zh' ? '全平落袋' : 'Close'}
                  </button>
                  <button
                    type="button"
                    className="ptb-btn reset"
                    onClick={() => setPaperState(DEFAULT_PAPER)}
                  >
                    {lang === 'zh' ? '重置 $100K' : 'Reset'}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Bottom Historical Replay Bar */}
          <div className="replay-bar">
            <button
              className="replay-btn"
              onClick={() => {
                if (!isPlaying && !isReplaying) {
                  setReplayIndex(Math.max(50, Math.floor(totalCandles * 0.5)));
                }
                setIsPlaying((p) => !p);
              }}
              title={isPlaying ? 'Pause' : 'Play Replay'}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>

            <button
              className="replay-btn"
              onClick={() => {
                setIsPlaying(false);
                setReplayIndex((prev) => {
                  const cur = prev < 0 ? totalCandles - 1 : prev;
                  return Math.max(40, cur - 1);
                });
              }}
              title="Step Back"
            >
              <ChevronLeft size={15} />
            </button>

            <button
              className="replay-btn"
              onClick={() => {
                setIsPlaying(false);
                setReplayIndex((prev) => {
                  if (prev < 0) return -1;
                  const nxt = prev + 1;
                  return nxt >= totalCandles - 1 ? -1 : nxt;
                });
              }}
              title="Step Forward"
            >
              <ChevronRight size={15} />
            </button>

            <span className="replay-tag">
              {isReplaying
                ? lang === 'zh'
                  ? '正在回放'
                  : 'Replaying'
                : lang === 'zh'
                ? '最新状态'
                : 'Latest'}
            </span>

            <input
              type="range"
              className="replay-slider"
              min={40}
              max={Math.max(41, totalCandles - 1)}
              value={Math.min(currentReplayPos - 1, totalCandles - 1)}
              onChange={(e) => {
                setIsPlaying(false);
                const val = Number(e.target.value);
                setReplayIndex(val >= totalCandles - 1 ? -1 : val);
              }}
            />

            <span className="replay-count">
              {currentReplayPos} / {totalCandles}
            </span>

            <button
              className="btn-latest"
              onClick={() => {
                setIsPlaying(false);
                setReplayIndex(-1);
              }}
              disabled={!isReplaying}
            >
              <RotateCcw size={12} />
              <span>{lang === 'zh' ? '回到最新' : 'Latest'}</span>
            </button>
          </div>
        </main>

        {/* Right Quantitative Panel (3-Tab Clean View) */}
        <aside className="right-sidebar">
          <div className="rs-tabs">
            <button
              type="button"
              className={`rs-tab ${rightTab === 'trade' ? 'active' : ''}`}
              onClick={() => setRightTab('trade')}
            >
              {lang === 'zh' ? '决策' : 'Decision'}
            </button>
            <button
              type="button"
              className={`rs-tab ${rightTab === 'structure' ? 'active' : ''}`}
              onClick={() => setRightTab('structure')}
            >
              {lang === 'zh' ? '期权/结构' : 'Structure'}
            </button>
            <button
              type="button"
              className={`rs-tab ${rightTab === 'news' ? 'active' : ''}`}
              onClick={() => setRightTab('news')}
            >
              {lang === 'zh' ? '快讯' : 'News'}
              {(macroData?.within_30m_count ?? 0) > 0 && (
                <span className="rs-tab-badge">{macroData?.within_30m_count}</span>
              )}
            </button>
          </div>

          {rightTab === 'trade' && (
            <>
              {/* Card 0: 购买建议 & 双均线系统 */}
              {data?.analysis.buy_advice && (
            <div className={`panel-card advice-card ${data.analysis.buy_advice.action.toLowerCase()}`}>
              <div className="card-header">
                <span>{lang === 'zh' ? '购买建议 · 均线共振' : 'Buy Advice · Dual MA'}</span>
                <span className="advice-conf">
                  {lang === 'zh' ? '综合评分' : 'Score'} {data.analysis.buy_advice.confidence}
                </span>
              </div>

              <div className="advice-hero">
                <span className={`advice-badge ${data.analysis.buy_advice.action.toLowerCase()}`}>
                  {lang === 'zh'
                    ? data.analysis.buy_advice.action_zh
                    : data.analysis.buy_advice.action_en}
                </span>
                {data.analysis.dual_ma && (
                  <span className="ma-trend-pill">
                    {lang === 'zh'
                      ? data.analysis.dual_ma.trend_label_zh
                      : data.analysis.dual_ma.trend_label_en}
                  </span>
                )}
              </div>

              <div className="advice-pos">
                {lang === 'zh'
                  ? data.analysis.buy_advice.position_zh
                  : data.analysis.buy_advice.position_en}
              </div>

              {data.analysis.earnings_warning && (
                <div className="earnings-iv-warn">
                  {lang === 'zh'
                    ? data.analysis.earnings_warning.warning_zh
                    : data.analysis.earnings_warning.warning_en}
                </div>
              )}

              <div className="advice-levels">
                <div className="al-item">
                  <span>{lang === 'zh' ? '买入区' : 'Buy Zone'}</span>
                  <b>
                    {fmtPrice(data.analysis.buy_advice.entry_low)} -{' '}
                    {fmtPrice(data.analysis.buy_advice.entry_high)}
                  </b>
                </div>
                <div className="al-item">
                  <span>{lang === 'zh' ? '目标 / 止损' : 'T1 / SL'}</span>
                  <b>
                    <span className="bull">{fmtPrice(data.analysis.buy_advice.target_price)}</span>
                    {' / '}
                    <span className="bear">{fmtPrice(data.analysis.buy_advice.stop_loss)}</span>
                  </b>
                </div>
                {data.analysis.buy_advice.risk_parity_pct !== undefined && (
                  <div className="al-item">
                    <span>{lang === 'zh' ? '1.5% 风险平价仓位上限' : '1.5% Risk-Parity Cap'}</span>
                    <b className={data.analysis.buy_advice.crash_lock ? 'bear' : 'bull'}>
                      {data.analysis.buy_advice.risk_parity_pct}%
                      {data.analysis.buy_advice.stop_dist_pct
                        ? ` (${lang === 'zh' ? '止损距' : 'SL'} ${data.analysis.buy_advice.stop_dist_pct}%)`
                        : ''}
                    </b>
                  </div>
                )}
              </div>

              <ul className="advice-reasons">
                {(lang === 'zh'
                  ? data.analysis.buy_advice.reasons_zh
                  : data.analysis.buy_advice.reasons_en
                ).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>

              {/* 大周期大势锁 + 小白 3 步对照 */}
              <div className="beginner-guide">
                <div className="bg-title">
                  {lang === 'zh' ? '小白 3 步核对清单' : '3-Step Checklist'}
                </div>
                {data.analysis.htf_lock && (
                  <div className={`htf-row ${data.analysis.htf_lock.locked ? 'locked' : 'open'}`}>
                    <span>
                      ① {data.analysis.htf_lock.interval_zh}
                      {lang === 'zh' ? '大势锁' : ' HTF Lock'}
                    </span>
                    <b>
                      {data.analysis.htf_lock.locked
                        ? lang === 'zh'
                          ? '锁死 (白线<黄线)'
                          : 'LOCKED'
                        : lang === 'zh'
                        ? '已解锁 (白线>黄线)'
                        : 'OPEN'}
                    </b>
                  </div>
                )}
                <div className="htf-row">
                  <span>② {lang === 'zh' ? '白线 vs 黄线' : 'Fast vs Slow'}</span>
                  <b>
                    {data.analysis.dual_ma && data.analysis.dual_ma.fast_val >= data.analysis.dual_ma.slow_val
                      ? lang === 'zh'
                        ? '白线在上 (多头)'
                        : 'White > Yellow'
                      : lang === 'zh'
                      ? '白线在下 (空头)'
                      : 'White < Yellow'}
                  </b>
                </div>
                {data.analysis.fibonacci && (
                  <div className={`htf-row ${data.analysis.fibonacci.confluence ? 'open' : ''}`}>
                    <span>③ {lang === 'zh' ? '斐波那契共振' : 'Fib Confluence'}</span>
                    <b style={{ color: data.analysis.fibonacci.confluence ? '#c084fc' : undefined }}>
                      {lang === 'zh'
                        ? data.analysis.fibonacci.match_label_zh
                        : data.analysis.fibonacci.match_label_en}
                    </b>
                  </div>
                )}
                <div className="bg-tip">
                  {lang === 'zh'
                    ? data.analysis.buy_advice.action === 'BUY' ||
                      data.analysis.buy_advice.action === 'ACCUMULATE'
                      ? '④ 操作：回踩白线附近可分批买，跌破黄线止损；赚15%先卖一半，剩下一半保本拿波段。'
                      : '④ 操作：大势未解锁前只看不买，等白线真正站上黄线且回踩不破再出手！'
                    : '④ Rule: Only buy pullbacks to white MA when HTF is open; otherwise stay flat.'}
                </div>
              </div>
            </div>
          )}

          {/* Card 0.3: 宏观牛熊四步曲 · 日线 SMA 20/60/120 扣抵系统 */}
          {macroData?.cycle?.ready && (
            <div className={`panel-card cycle-card ${macroData.cycle.permission_state}`}>
              <div className="card-header">
                <span>{lang === 'zh' ? '牛熊四步曲 · 日线扣抵' : 'Bull/Bear 4-Step · Daily'}</span>
                <span className="tag-pill">
                  {macroData.cycle.completed_steps} / 4
                </span>
              </div>

              <div className={`cycle-perm ${macroData.cycle.permission_state}`}>
                {lang === 'zh'
                  ? macroData.cycle.permission_zh
                  : macroData.cycle.permission_en}
              </div>

              <div className="cycle-smas">
                <div className="cs-item">
                  <span>SMA20</span>
                  <b>{fmtPrice(macroData.cycle.sma20)}</b>
                </div>
                <div className="cs-item">
                  <span>SMA60</span>
                  <b>{fmtPrice(macroData.cycle.sma60)}</b>
                </div>
                <div className="cs-item">
                  <span>SMA120</span>
                  <b>{fmtPrice(macroData.cycle.sma120)}</b>
                </div>
              </div>

              <div className="cycle-meta-row">
                <span>
                  {lang === 'zh' ? '20日扣抵: ' : '20D Deduct: '}
                  <b>
                    {lang === 'zh'
                      ? macroData.cycle.deduct_label_zh
                      : macroData.cycle.deduct_label_en}
                  </b>
                </span>
                <span>
                  {lang === 'zh' ? '20/60粘合: ' : 'Gap: '}
                  <b>{macroData.cycle.gap_20_60_pct}%</b>
                </span>
              </div>

              <div className="cycle-steps">
                {macroData.cycle.steps.map((st) => (
                  <div key={st.id} className={`c-step ${st.done ? 'done' : ''}`}>
                    <span className="c-dot">{st.done ? '✓' : st.id}</span>
                    <span>{lang === 'zh' ? st.label_zh : st.label_en}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
            </>
          )}

          {rightTab === 'structure' && data?.analysis.options_advice && (
            <div
              className={`panel-card options-card ${data.analysis.options_advice.signal.toLowerCase()}`}
            >
              <div className="card-header">
                <span>{lang === 'zh' ? '期权购买建议 · 买入点' : 'Options Buying Advice'}</span>
                <span className="tag-pill">
                  {data.analysis.options_advice.direction === 'CALL'
                    ? 'CALL 看涨'
                    : data.analysis.options_advice.direction === 'PUT'
                    ? 'PUT 看跌'
                    : lang === 'zh'
                    ? '观望'
                    : 'FLAT'}
                </span>
              </div>

              <div className="advice-hero">
                <span
                  className={`advice-badge ${
                    data.analysis.options_advice.signal === 'BUY_CALL'
                      ? 'buy'
                      : data.analysis.options_advice.signal === 'BUY_PUT'
                      ? 'avoid'
                      : 'wait'
                  }`}
                >
                  {lang === 'zh'
                    ? data.analysis.options_advice.signal_zh
                    : data.analysis.options_advice.signal_en}
                </span>
              </div>

              <div className="advice-levels">
                <div className="al-item">
                  <span>{lang === 'zh' ? '建议买入点' : 'Entry Trigger'}</span>
                  <b className="opt-trigger">
                    {lang === 'zh'
                      ? data.analysis.options_advice.entry_trigger_zh
                      : data.analysis.options_advice.entry_trigger_en}
                  </b>
                </div>
                <div className="al-item">
                  <span>{lang === 'zh' ? '参考行权价' : 'Ref Strike'}</span>
                  <b>${fmtPrice(data.analysis.options_advice.strike)}</b>
                </div>
                <div className="al-item">
                  <span>{lang === 'zh' ? '建议到期日' : 'Expiry (DTE)'}</span>
                  <b>
                    {lang === 'zh'
                      ? data.analysis.options_advice.dte_zh
                      : data.analysis.options_advice.dte_en}
                  </b>
                </div>
              </div>

              <div className="advice-pos" style={{ marginBottom: 4 }}>
                {lang === 'zh'
                  ? data.analysis.options_advice.size_zh
                  : data.analysis.options_advice.size_en}
              </div>
              <div className="overview-summary" style={{ marginTop: 2 }}>
                {lang === 'zh'
                  ? data.analysis.options_advice.rule_zh
                  : data.analysis.options_advice.rule_en}
              </div>

              {data.analysis.earnings_warning && (
                <div className="earnings-iv-warn">
                  {lang === 'zh'
                    ? data.analysis.earnings_warning.warning_zh
                    : data.analysis.earnings_warning.warning_en}
                </div>
              )}
            </div>
          )}

          {/* Card 0.8: 实时大新闻 · 半小时市场动向 */}
          {rightTab === 'news' && macroData && (
            <div className="panel-card news-card">
              <div className="card-header">
                <span>{lang === 'zh' ? '实时快讯 · 市场动向' : 'Live Breaking News'}</span>
                <span className="news-30m-badge">
                  {lang === 'zh'
                    ? `近30分 ${macroData.within_30m_count} 条`
                    : `${macroData.within_30m_count} in 30m`}
                </span>
              </div>

              <div className="news-filter-row">
                <button
                  className={newsFilter === 'all' ? 'active' : ''}
                  onClick={() => setNewsFilter('all')}
                >
                  {lang === 'zh' ? '全部快讯' : 'All'}
                </button>
                <button
                  className={newsFilter === '30m' ? 'active' : ''}
                  onClick={() => setNewsFilter('30m')}
                >
                  {lang === 'zh' ? '半小时 / 重磅' : '30m / High'}
                </button>
                <span className="news-updated">{macroData.updated_at}</span>
              </div>

              <div className="news-list">
                {macroData.news
                  .filter((n) =>
                    newsFilter === '30m'
                      ? n.is_within_30m || n.importance === 'high'
                      : true
                  )
                  .map((n) => (
                    <div
                      key={n.id}
                      className={`news-item ${n.is_within_30m ? 'fresh-30m' : ''} ${n.importance}`}
                    >
                      <div className="ni-meta">
                        <span className={`ni-age ${n.is_within_30m ? 'hot' : ''}`}>
                          {lang === 'zh' ? n.age_label_zh : n.age_label_en} ({n.time_str})
                        </span>
                        <span className={`ni-tag ${n.sentiment}`}>
                          {lang === 'zh' ? n.tag_zh : n.tag_en}
                        </span>
                      </div>
                      <div className="ni-text">{n.text}</div>
                    </div>
                  ))}
                {macroData.news.filter((n) =>
                  newsFilter === '30m'
                    ? n.is_within_30m || n.importance === 'high'
                    : true
                ).length === 0 && (
                  <div className="overview-summary">
                    {lang === 'zh'
                      ? '近 30 分钟暂无突发重磅快讯，可切换「全部快讯」查看最新市场动态。'
                      : 'No high-impact flashes in the last 30m.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {rightTab === 'structure' && (
            <>
              {/* Card 1: Multi-factor Bias */}
              <div className="panel-card">
            <div className="card-header">
              <span>{lang === 'zh' ? '多空结构倾向' : 'Directional Bias'}</span>
              <span className="card-sub">
                {lang === 'zh' ? '结构偏向 · 非胜率' : 'Bias · Not Win Rate'}
              </span>
            </div>

            <div className="bias-pcts">
              <div>
                <div className="pct-lbl">{lang === 'zh' ? '多方' : 'Bull'}</div>
                <div className="pct-val bull">{bias?.bull_pct ?? 50}%</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="pct-lbl">{lang === 'zh' ? '空方' : 'Bear'}</div>
                <div className="pct-val bear">{bias?.bear_pct ?? 50}%</div>
              </div>
            </div>

            <div className="bias-bar">
              <div
                className="bias-fill-bull"
                style={{ width: `${bias?.bull_pct ?? 50}%` }}
              />
              <div
                className="bias-fill-bear"
                style={{ width: `${bias?.bear_pct ?? 50}%` }}
              />
            </div>

            <div className="factors-list">
              {(bias?.factors || []).map((f) => {
                const pos = f.score >= 0;
                const widthPct = Math.min(100, Math.abs(f.score) / 30 * 100);
                return (
                  <div key={f.key} className="factor-row">
                    <span className="f-name">
                      {lang === 'zh' ? f.label : f.label_en}
                    </span>
                    <div className="f-track">
                      <div
                        className={`f-fill ${pos ? 'bull' : 'bear'}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className={`f-score ${pos ? 'bull' : 'bear'}`}>
                      {pos ? `+${f.score}` : f.score}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Card 2: Structure Overview */}
          <div className="panel-card">
            <div className="card-header">
              <span>{lang === 'zh' ? '结构概览' : 'Structure Overview'}</span>
              <span className="tag-pill">
                {lang === 'zh' ? '笔中枢' : 'Center'}
              </span>
            </div>

            <div className="metrics-grid">
              <div className="m-box">
                <div className="m-lbl">{lang === 'zh' ? '有效笔' : 'Strokes'}</div>
                <div className="m-num">{overview?.stroke_count ?? 0}</div>
              </div>
              <div className="m-box">
                <div className="m-lbl">{lang === 'zh' ? '线段' : 'Segments'}</div>
                <div className="m-num">{overview?.segment_count ?? 0}</div>
              </div>
              <div className="m-box">
                <div className="m-lbl">{lang === 'zh' ? '中枢' : 'Centers'}</div>
                <div className="m-num">{overview?.center_count ?? 0}</div>
              </div>
            </div>

            <div className="zg-zd-rows">
              <div className="z-row">
                <span>{lang === 'zh' ? '中枢上沿 ZG' : 'Center High ZG'}</span>
                <b>{fmtPrice(overview?.zg || 0)}</b>
              </div>
              <div className="z-row">
                <span>{lang === 'zh' ? '中枢下沿 ZD' : 'Center Low ZD'}</span>
                <b>{fmtPrice(overview?.zd || 0)}</b>
              </div>
            </div>

            <div className="overview-summary">
              {lang === 'zh' ? overview?.summary_zh : overview?.summary_en}
            </div>
          </div>

          {/* Card 3: Similar Historical Samples */}
          <div className="panel-card">
            <div className="card-header">
              <span>{lang === 'zh' ? '相似样本结果' : 'Similar Samples'}</span>
              <span className="card-sub">n = {sim?.count ?? 0}</span>
            </div>

            <div className="sim-desc">
              {lang === 'zh'
                ? `相似走势之后 ${sim?.horizon ?? 12} 根K线分布`
                : `Distribution next ${sim?.horizon ?? 12} bars`}
            </div>

            <div className="sim-bar">
              <div className="sim-up" style={{ width: `${sim?.up_pct ?? 33}%` }} />
              <div className="sim-flat" style={{ width: `${sim?.flat_pct ?? 34}%` }} />
              <div className="sim-down" style={{ width: `${sim?.down_pct ?? 33}%` }} />
            </div>

            <div className="sim-legend">
              <span className="bull">
                ● {lang === 'zh' ? '上涨' : 'Up'} {sim?.up_pct ?? 33}%
              </span>
              <span className="muted">
                ● {lang === 'zh' ? '震荡' : 'Flat'} {sim?.flat_pct ?? 34}%
              </span>
              <span className="bear">
                ● {lang === 'zh' ? '下跌' : 'Down'} {sim?.down_pct ?? 33}%
              </span>
            </div>

            {(sim?.count ?? 0) < 20 && (
              <div className="sim-warn">
                {lang === 'zh'
                  ? '⚠ 样本不足20个，比例仅供观察'
                  : '⚠ Fewer than 20 samples; for reference only'}
              </div>
            )}
          </div>
            </>
          )}
        </aside>
        </div>

      {/* Mobile Portrait Bottom Navigation Bar (5 Tabs incl. Radar & Calendar) */}
      <nav className="mobile-bottom-nav">
        <button
          className={`mbn-btn ${viewMode === 'radar' ? 'active' : ''}`}
          onClick={() => switchViewMode('radar')}
        >
          <span className="mbn-ico">
            ⚡
            {oppCount > 0 && <span className="mbn-badge">{oppCount}</span>}
          </span>
          <span>{lang === 'zh' ? '雷达' : 'Radar'}</span>
        </button>
        <button
          className={`mbn-btn ${viewMode === 'workbench' && mobileTab === 'chart' ? 'active' : ''}`}
          onClick={() => {
            switchViewMode('workbench');
            setMobileTab('chart');
          }}
        >
          <span className="mbn-ico">📈</span>
          <span>{lang === 'zh' ? 'K线' : 'Chart'}</span>
        </button>
        <button
          className={`mbn-btn ${viewMode === 'calendar' ? 'active' : ''}`}
          onClick={() => switchViewMode('calendar')}
        >
          <span className="mbn-ico">
            🛡️
            {(calendarData?.urgent_48h_count ?? 0) > 0 && (
              <span className="mbn-badge cal">{calendarData?.urgent_48h_count}</span>
            )}
          </span>
          <span>{lang === 'zh' ? '避雷' : 'Guard'}</span>
        </button>
        <button
          className={`mbn-btn ${viewMode === 'etf_plan' ? 'active' : ''}`}
          onClick={() => switchViewMode('etf_plan')}
        >
          <span className="mbn-ico">🏦</span>
          <span>{lang === 'zh' ? 'ETF' : 'ETF'}</span>
        </button>
        <button
          className={`mbn-btn ${viewMode === 'calculator' ? 'active' : ''}`}
          onClick={() => switchViewMode('calculator')}
        >
          <span className="mbn-ico">🧮</span>
          <span>{lang === 'zh' ? '仓位' : 'Calc'}</span>
        </button>
        <button
          className={`mbn-btn ${viewMode === 'workbench' && mobileTab === 'intel' ? 'active' : ''}`}
          onClick={() => {
            switchViewMode('workbench');
            setChartExpanded(false);
            setMobileTab('intel');
          }}
        >
          <span className="mbn-ico">
            🧭
            {macroData && macroData.within_30m_count > 0 && (
              <span className="mbn-badge">{macroData.within_30m_count}</span>
            )}
          </span>
          <span>{lang === 'zh' ? '建议' : 'Intel'}</span>
        </button>
        <button
          className={`mbn-btn ${viewMode === 'workbench' && mobileTab === 'symbols' ? 'active' : ''}`}
          onClick={() => {
            switchViewMode('workbench');
            setChartExpanded(false);
            setMobileTab('symbols');
          }}
        >
          <span className="mbn-ico">🔍</span>
          <span>{lang === 'zh' ? '自选' : 'List'}</span>
        </button>
      </nav>

      {/* Price Alert Triggered Toast */}
      {alertToast && (
        <div className="alert-toast" onClick={() => setAlertToast(null)}>
          <span>🔔 {alertToast.text}</span>
          <button type="button">×</button>
        </div>
      )}

      {/* Cmd+K TradingView Quick Command Palette */}
      {cmdKOpen && (
        <div className="cmdk-backdrop" onClick={() => setCmdKOpen(false)}>
          <div className="cmdk-card" onClick={(e) => e.stopPropagation()}>
            <div className="cmdk-input-row">
              <span className="cmdk-ico">⌘K</span>
              <input
                type="text"
                autoFocus
                value={cmdKQuery}
                onChange={(e) => {
                  setCmdKQuery(e.target.value);
                  setCmdKIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCmdKIdx((i) => (cmdKResults.length ? (i + 1) % cmdKResults.length : 0));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCmdKIdx((i) =>
                      cmdKResults.length ? (i - 1 + cmdKResults.length) % cmdKResults.length : 0
                    );
                  } else if (e.key === 'Enter' && cmdKResults[cmdKIdx]) {
                    e.preventDefault();
                    runCmdKEntry(cmdKResults[cmdKIdx]);
                  }
                }}
                placeholder="输入代码/中文名 (如 NVDA / 大饼) 或周期 (4H / 日线) 或工具..."
              />
              <button type="button" onClick={() => setCmdKOpen(false)}>
                ESC
              </button>
            </div>
            <div className="cmdk-list">
              {cmdKResults.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  className={`cmdk-item ${idx === cmdKIdx ? 'active' : ''}`}
                  onMouseEnter={() => setCmdKIdx(idx)}
                  onClick={() => runCmdKEntry(item)}
                >
                  <div className="cmdk-item-main">
                    <span className="cmdk-item-title">{item.title}</span>
                    <span className="cmdk-item-sub">{item.sub}</span>
                  </div>
                  <span className="cmdk-item-badge">{item.badge}</span>
                </button>
              ))}
            </div>
            <div className="cmdk-foot">
              <span>↑ / ↓ 选择 · Enter 秒切</span>
              <span>平时在看盘台直接按 ↑ / ↓ 方向键也能 0 延迟翻下一只票</span>
            </div>
          </div>
        </div>
      )}

      <IndicatorModal
        open={indicatorModalOpen}
        onClose={() => setIndicatorModalOpen(false)}
        lang={lang}
        layers={layers}
        onToggleLayer={toggleLayer}
        onApplyPreset={applyIndicatorPreset}
        maConfig={maConfig}
        onChangeMaConfig={setMaConfig}
        compareSymbol={compareTarget.sym}
      />
    </div>
  );
}

export default App;
