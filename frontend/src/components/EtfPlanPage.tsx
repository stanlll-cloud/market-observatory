import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ArrowLeft, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import type {
  EtfBenchmarkPlan,
  EtfLiveItem,
  EtfPlanResponse,
  LangType,
} from '../types';

interface Props {
  data: EtfPlanResponse | null;
  loading: boolean;
  lang: LangType;
  onRefresh: () => void;
  onBackToWorkbench: () => void;
  onJumpToSymbol: (symbol: string) => void;
}

interface EtfUserConfig {
  principalUsd: number;
  leverageRatio: number;
  x3Choice: 'split' | 'TQQQ' | 'UPRO' | 'none';
  heldQqqi: number;
  heldSchd: number;
  marginAprPct: number;
  taxPct: number;
}

const STORAGE_KEY = 'obs_etf_plan_cfg_v1';

const DEFAULT_CFG: EtfUserConfig = {
  principalUsd: 50000,
  leverageRatio: 1.3,
  x3Choice: 'split',
  heldQqqi: 40,
  heldSchd: 5,
  marginAprPct: 5.38,
  taxPct: 30,
};

function loadSavedCfg(): EtfUserConfig {
  if (typeof window === 'undefined') return DEFAULT_CFG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CFG;
    const parsed = JSON.parse(raw) as Partial<EtfUserConfig>;
    return {
      principalUsd: Math.max(1000, Number(parsed.principalUsd) || DEFAULT_CFG.principalUsd),
      leverageRatio: Math.min(2.0, Math.max(1.0, Number(parsed.leverageRatio) || DEFAULT_CFG.leverageRatio)),
      x3Choice:
        parsed.x3Choice === 'TQQQ' ||
        parsed.x3Choice === 'UPRO' ||
        parsed.x3Choice === 'none' ||
        parsed.x3Choice === 'split'
          ? parsed.x3Choice
          : DEFAULT_CFG.x3Choice,
      heldQqqi: Math.max(0, Number(parsed.heldQqqi ?? DEFAULT_CFG.heldQqqi)),
      heldSchd: Math.max(0, Number(parsed.heldSchd ?? DEFAULT_CFG.heldSchd)),
      marginAprPct: Math.min(15, Math.max(0, Number(parsed.marginAprPct ?? DEFAULT_CFG.marginAprPct))),
      taxPct: Math.min(40, Math.max(0, Number(parsed.taxPct ?? DEFAULT_CFG.taxPct))),
    };
  } catch {
    return DEFAULT_CFG;
  }
}

function fmtUsd(val: number, digits = 0): string {
  if (!Number.isFinite(val)) return '$0';
  const sign = val < 0 ? '-' : '';
  return `${sign}$${Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function effectiveWeightPct(item: EtfLiveItem, x3Choice: EtfUserConfig['x3Choice']): number {
  if (item.verdict === 'exclude') return 0;
  if (item.symbol === 'SPMO' && x3Choice === 'none') return 29;
  if (item.symbol === 'QQQM' && x3Choice === 'none') return 29;
  if (item.symbol === 'TQQQ') {
    if (x3Choice === 'TQQQ') return 8;
    if (x3Choice === 'split') return 4;
    return 0;
  }
  if (item.symbol === 'UPRO') {
    if (x3Choice === 'UPRO') return 8;
    if (x3Choice === 'split') return 4;
    return 0;
  }
  return item.weight_pct;
}

export const EtfPlanPage = memo(function EtfPlanPage({
  data,
  loading,
  lang,
  onRefresh,
  onBackToWorkbench,
  onJumpToSymbol,
}: Props) {
  const isZh = lang === 'zh';
  const [cfg, setCfg] = useState<EtfUserConfig>(loadSavedCfg);
  const [benchSym, setBenchSym] = useState<'QQQ' | 'SPY'>('QQQ');
  const [hoverBar, setHoverBar] = useState<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);

  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {
      // ignore storage errors
    }
  }, [cfg]);

  const activeBench: EtfBenchmarkPlan | null = data?.benchmarks?.[benchSym] ?? null;

  // 渲染大盘基准（QQQ / SPY）日线 K 线 + 4 条均线 + 操作水平价位线
  useEffect(() => {
    const container = chartWrapRef.current;
    if (!container || !activeBench || activeBench.candles.length === 0) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e16' },
        textColor: 'rgba(235, 240, 250, 0.58)',
        fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
        fontSize: 11,
      },
      localization: {
        timeFormatter: (t: Time) => {
          if (typeof t !== 'number') return String(t);
          const d = new Date(t * 1000);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate()
          ).padStart(2, '0')}`;
        },
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.045)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.045)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(10, 132, 255, 0.48)', width: 1, style: LineStyle.Dashed },
        horzLine: { color: 'rgba(10, 132, 255, 0.48)', width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.09)',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.09)',
        timeVisible: false,
        rightOffset: 10,
        minBarSpacing: 2.2,
        tickMarkFormatter: (t: Time, tickMarkType: TickMarkType) => {
          if (typeof t !== 'number') return String(t);
          const d = new Date(t * 1000);
          if (tickMarkType === TickMarkType.Year) return `${d.getFullYear()}年`;
          if (tickMarkType === TickMarkType.Month) return `${d.getMonth() + 1}月`;
          return `${d.getMonth() + 1}/${d.getDate()}`;
        },
      },
      width: container.clientWidth || 720,
      height: container.clientHeight || 380,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ff3b5c',
      downColor: '#00e5a3',
      borderUpColor: '#ff3b5c',
      borderDownColor: '#00e5a3',
      wickUpColor: '#ff3b5c',
      wickDownColor: '#00e5a3',
    });

    candleSeries.setData(
      activeBench.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    const maDefs = [
      { pts: activeBench.ema20_line, color: '#f8fafc', width: 1 as const, title: 'EMA20' },
      { pts: activeBench.sma60_line, color: '#f5c451', width: 1 as const, title: 'SMA60' },
      { pts: activeBench.sma120_line, color: '#38bdf8', width: 1 as const, title: 'SMA120' },
      { pts: activeBench.sma200_line, color: '#e879f9', width: 2 as const, title: 'SMA200 年线' },
    ];
    for (const ma of maDefs) {
      if (!ma.pts?.length) continue;
      const s = chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: ma.width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(ma.pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }

    // 关键操作价位水平触发线（牛市显示均线档，熊市/深调显示下方折价分批接筹档）
    const isBearZones = activeBench.zone_mode === 'dd_bear';
    const zoneColors = [
      'rgba(248, 250, 252, 0.72)',
      'rgba(245, 196, 81, 0.85)',
      'rgba(56, 189, 248, 0.85)',
      'rgba(232, 121, 249, 0.85)',
    ];
    const zonePriceLines: Array<{ price: number; color: string; style: LineStyle; title: string }> =
      activeBench.tranches?.length
        ? activeBench.tranches
            .filter((t) => !(isBearZones && t.id === 1))
            .map((t, idx) => ({
              price: t.trigger_price,
              color: zoneColors[Math.min(idx + (isBearZones ? 1 : 0), zoneColors.length - 1)],
              style: LineStyle.Dotted,
              title: isBearZones
                ? `${t.id}档${t.pct}% 加仓 ($${t.trigger_price})`
                : `${t.id}档${t.pct}% ($${t.trigger_price})`,
            }))
        : [
            {
              price: activeBench.zone1_price,
              color: 'rgba(248, 250, 252, 0.72)',
              style: LineStyle.Dotted,
              title: `1档40% EMA20 ($${activeBench.zone1_price})`,
            },
            {
              price: activeBench.zone2_price,
              color: 'rgba(245, 196, 81, 0.85)',
              style: LineStyle.Dotted,
              title: `2档30% SMA60 ($${activeBench.zone2_price})`,
            },
            {
              price: activeBench.zone3_price,
              color: 'rgba(56, 189, 248, 0.85)',
              style: LineStyle.Dotted,
              title: `3档20% SMA120 ($${activeBench.zone3_price})`,
            },
          ];

    const priceLines: Array<{ price: number; color: string; style: LineStyle; title: string }> = [
      {
        price: activeBench.euphoria_t1_price,
        color: '#f59e0b',
        style: LineStyle.Dashed,
        title: `3x止盈锁利 ($${activeBench.euphoria_t1_price})`,
      },
      {
        price: activeBench.unlock_3x_price,
        color: '#34d399',
        style: LineStyle.Dashed,
        title: `3x右侧开闸 ($${activeBench.unlock_3x_price})`,
      },
      {
        price: activeBench.hard_stop_3x_price,
        color: '#ff3b5c',
        style: LineStyle.Dashed,
        title: `3x硬熔断线 ($${activeBench.hard_stop_3x_price})`,
      },
      ...zonePriceLines,
    ];

    const createdLines: IPriceLine[] = [];
    for (const pl of priceLines) {
      if (!pl.price || !Number.isFinite(pl.price)) continue;
      createdLines.push(
        candleSeries.createPriceLine({
          price: pl.price,
          color: pl.color,
          lineWidth: 1,
          lineStyle: pl.style,
          axisLabelVisible: true,
          title: pl.title,
        })
      );
    }

    const last = activeBench.candles[activeBench.candles.length - 1];
    if (last) {
      const ld = new Date(last.time * 1000);
      setHoverBar({
        date: `${ld.getFullYear()}-${String(ld.getMonth() + 1).padStart(2, '0')}-${String(
          ld.getDate()
        ).padStart(2, '0')}`,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || typeof param.time !== 'number') return;
      const bar = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (bar) {
        const d = new Date(param.time * 1000);
        setHoverBar({
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate()
          ).padStart(2, '0')}`,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        });
      }
    });

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w > 100 && h > 150) {
          chart.applyOptions({ width: w, height: h });
        }
      }
    });
    ro.observe(container);

    return () => {
      createdLines.length = 0;
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [activeBench]);

  // 核心仓位与现金流实时测算
  const portfolioCalc = useMemo(() => {
    const etfs = data?.etfs ?? [];
    const totalAssets = cfg.principalUsd * cfg.leverageRatio;
    const marginDebt = Math.max(0, totalAssets - cfg.principalUsd);
    const monthlyInterest = (marginDebt * (cfg.marginAprPct / 100)) / 12;

    const rows = etfs.map((item) => {
      const wPct = effectiveWeightPct(item, cfg.x3Choice);
      const targetUsd = totalAssets * (wPct / 100);
      const heldShares =
        item.symbol === 'QQQI' ? cfg.heldQqqi : item.symbol === 'SCHD' ? cfg.heldSchd : 0;
      const heldUsd = heldShares * item.price;
      const netBuyUsd = Math.max(0, targetUsd - heldUsd);
      const targetShares = item.price > 0 ? targetUsd / item.price : 0;
      const netBuyShares = item.price > 0 ? netBuyUsd / item.price : 0;
      const annualDivGross = targetUsd * (item.ttm_yield_pct / 100);
      const monthlyDivGross = annualDivGross / 12;
      return {
        ...item,
        effWeightPct: wPct,
        targetUsd,
        heldShares,
        heldUsd,
        netBuyUsd,
        targetShares,
        netBuyShares,
        monthlyDivGross,
      };
    });

    const monthlyOnlyGross = rows
      .filter((r) => r.payout_freq === 'monthly' && r.effWeightPct > 0)
      .reduce((s, r) => s + r.monthlyDivGross, 0);
    const allDivMonthlyGross = rows
      .filter((r) => r.effWeightPct > 0)
      .reduce((s, r) => s + r.monthlyDivGross, 0);

    const taxMult = 1 - cfg.taxPct / 100;
    const monthlyOnlyNet = monthlyOnlyGross * taxMult;
    const allDivMonthlyNet = allDivMonthlyGross * taxMult;

    const grossCov = monthlyInterest > 0 ? monthlyOnlyGross / monthlyInterest : 99;
    const netCov = monthlyInterest > 0 ? monthlyOnlyNet / monthlyInterest : 99;

    // 压力测试：-25% 中级回调 vs -45% 史诗股灾 (-80% 3x杠杆)
    const calcStress = (coreDrop: number, incomeDrop: number, x3Drop: number) => {
      let survAssets = 0;
      let maintReq = 0;
      for (const r of rows) {
        if (r.targetUsd <= 0) continue;
        let drop = coreDrop;
        if (r.symbol === 'SGOV') drop = 0;
        else if (r.layer === 1) drop = incomeDrop;
        else if (r.layer === 4) drop = x3Drop;
        const surv = r.targetUsd * (1 - drop);
        survAssets += surv;
        maintReq += surv * (r.maint_margin_pct / 100);
      }
      const netEquity = survAssets - marginDebt;
      const excessLiq = netEquity - maintReq;
      return { survAssets, netEquity, maintReq, excessLiq };
    };

    const stressNow = calcStress(0, 0, 0);
    const stressMid = calcStress(0.25, 0.2, 0.58);
    const stressCrash = calcStress(0.45, 0.35, 0.8);

    const totalNetBuyUsd = rows.reduce((s, r) => s + r.netBuyUsd, 0);

    return {
      totalAssets,
      marginDebt,
      monthlyInterest,
      rows,
      monthlyOnlyGross,
      monthlyOnlyNet,
      allDivMonthlyGross,
      allDivMonthlyNet,
      grossCov,
      netCov,
      stressNow,
      stressMid,
      stressCrash,
      totalNetBuyUsd,
    };
  }, [data, cfg]);

  // 基准对应分批挂单清单（仅涵盖第 1+2 层非杠杆核心与月息仓位，3x 奇兵由下方专项引擎独立择时）
  const tranchePlan = useMemo(() => {
    if (!activeBench) return [];
    const activeRows = portfolioCalc.rows.filter(
      (r) => r.effWeightPct > 0 && r.netBuyUsd > 0 && r.layer !== 4 && r.symbol !== 'SGOV'
    );
    const sideSyms =
      benchSym === 'QQQ' ? ['QQQI', 'QQQM'] : ['SPYI', 'SPMO', 'SCHD'];
    const sideRows = activeRows.filter((r) => sideSyms.includes(r.symbol));
    const basePool = sideRows.length > 0 ? sideRows : activeRows;

    const specs = activeBench.tranches?.length
      ? activeBench.tranches.map((t) => ({
          id: t.id,
          pct: t.pct,
          title: t.label_zh,
          benchTrigger: t.trigger_price,
          desc: t.desc_zh,
          triggered: t.triggered,
        }))
      : [
          {
            id: 1,
            pct: 40,
            title: '第 1 档 · 40% 底仓即刻建仓 / 回踩 EMA20',
            benchTrigger: activeBench.zone1_price,
            desc: '现价先配满月息造血机 + 核心底仓 40%，立即可用月息交保证金利息',
            triggered: activeBench.price <= activeBench.zone1_price * 1.015,
          },
          {
            id: 2,
            pct: 30,
            title: '第 2 档 · 30% 健康回踩季线 SMA60',
            benchTrigger: activeBench.zone2_price,
            desc: '大盘洗盘回踩 60 日线接货，低吸 SPMO / QQQM / SPYI',
            triggered: activeBench.price <= activeBench.zone2_price * 1.008,
          },
          {
            id: 3,
            pct: 20,
            title: '第 3 档 · 20% 半年线黄金坑 SMA120',
            benchTrigger: activeBench.zone3_price,
            desc: '中期深调打入强支撑半年线，扩大筹码安全垫',
            triggered: activeBench.price <= activeBench.zone3_price * 1.008,
          },
          {
            id: 4,
            pct: 10,
            title: '第 4 档 · 10% + 动用 SGOV 一半接年线血筹',
            benchTrigger: activeBench.zone4_price,
            desc: '触及 SMA200 年线或高点 -15%，砍一半 SGOV 全力抄底大盘',
            triggered: activeBench.price <= activeBench.zone4_price * 1.01,
          },
        ];

    const totalPoolUsd = activeRows.reduce((s, r) => s + r.netBuyUsd, 0);

    return specs.map((sp) => {
      const trancheUsd = totalPoolUsd * (sp.pct / 100);
      const breakdown = basePool
        .map((r) => {
          const usd = r.netBuyUsd * (sp.pct / 100);
          const shares = r.price > 0 ? Math.max(0, Math.round(usd / r.price)) : 0;
          return { symbol: r.symbol, usd, shares };
        })
        .filter((b) => b.usd >= 50);
      return { ...sp, trancheUsd, breakdown };
    });
  }, [activeBench, benchSym, portfolioCalc.rows]);

  const x3BudgetTotal = portfolioCalc.totalAssets * (cfg.x3Choice === 'none' ? 0 : 0.08);
  const x3BudgetEach =
    cfg.x3Choice === 'split'
      ? x3BudgetTotal / 2
      : cfg.x3Choice === 'none'
      ? 0
      : x3BudgetTotal;

  return (
    <div className="etf-plan-page">
      <div className="etf-plan-inner">
        {/* 顶部返回与状态栏 */}
        <div className="radar-top-head">
          <div className="rth-left">
            <button type="button" className="btn-back-chart" onClick={onBackToWorkbench}>
              <ArrowLeft size={14} />
              <span>{isZh ? '返回主看盘' : 'Back to Chart'}</span>
            </button>
            <div className="radar-title-badge">
              <span>🏦</span>
              <span>
                {isZh
                  ? '美股 ETF 投资计划 · 月息养保证金 + 大盘 SMA200 择时引擎'
                  : 'US ETF Margin & SMA200 Timing Plan'}
              </span>
            </div>
            {data?.et_date && (
              <span className="etf-session-chip">
                美东 {data.et_date} · {data.market_session?.session_zh}
              </span>
            )}
          </div>

          <div className="rth-right">
            <span className="radar-sync-time">
              {data?.updated_at ? `更新: ${data.updated_at}` : '等待同步...'}
            </span>
            <button
              type="button"
              className="btn-back-chart"
              onClick={() => setCfg(DEFAULT_CFG)}
              title="恢复默认 $50,000 / 1.30x 参数"
            >
              <RotateCcw size={13} />
              <span>重置参数</span>
            </button>
            <button type="button" className="btn-refresh" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              <span>{loading ? '刷新中...' : '刷新实时报价'}</span>
            </button>
          </div>
        </div>

        {/* 1. 实盘参数调节台 + 4大核心指标卡 */}
        <section className="etf-hero-panel">
          <div className="etf-controls-bar">
            <div className="etf-ctrl-group">
              <label>投入本金 (USD)</label>
              <div className="etf-preset-row">
                {[10000, 30000, 50000, 100000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`etf-chip ${cfg.principalUsd === v ? 'active' : ''}`}
                    onClick={() => setCfg((p) => ({ ...p, principalUsd: v }))}
                  >
                    ${(v / 1000).toFixed(0)}k
                  </button>
                ))}
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={cfg.principalUsd}
                  onChange={(e) =>
                    setCfg((p) => ({
                      ...p,
                      principalUsd: Math.max(1000, Number(e.target.value) || 50000),
                    }))
                  }
                  className="etf-num-input"
                />
              </div>
            </div>

            <div className="etf-ctrl-group">
              <label>盈透杠杆倍数 (IBKR 融资 {cfg.marginAprPct}%)</label>
              <div className="etf-preset-row">
                {[
                  { r: 1.0, label: '1.0x 零融资' },
                  { r: 1.2, label: '1.2x 稳健' },
                  { r: 1.3, label: '1.3x 甜点(推荐)' },
                  { r: 1.5, label: '1.5x 进取' },
                ].map((opt) => (
                  <button
                    key={opt.r}
                    type="button"
                    className={`etf-chip ${Math.abs(cfg.leverageRatio - opt.r) < 0.01 ? 'active' : ''}`}
                    onClick={() => setCfg((p) => ({ ...p, leverageRatio: opt.r }))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="etf-ctrl-group">
              <label>3倍奇兵配置 (严控 ≤8%)</label>
              <div className="etf-preset-row">
                {[
                  { k: 'split' as const, label: '各半 TQQQ4%+UPRO4%' },
                  { k: 'TQQQ' as const, label: '单押 TQQQ 8%' },
                  { k: 'UPRO' as const, label: '单押 UPRO 8%' },
                  { k: 'none' as const, label: '0% 关3x(回核心)' },
                ].map((opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    className={`etf-chip ${cfg.x3Choice === opt.k ? 'active' : ''}`}
                    onClick={() => setCfg((p) => ({ ...p, x3Choice: opt.k }))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="etf-ctrl-group compact">
              <label>已有持仓扣减 (股)</label>
              <div className="etf-held-inputs">
                <span>
                  QQQI
                  <input
                    type="number"
                    min={0}
                    value={cfg.heldQqqi}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, heldQqqi: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="etf-num-input sm"
                  />
                </span>
                <span>
                  SCHD
                  <input
                    type="number"
                    min={0}
                    value={cfg.heldSchd}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, heldSchd: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="etf-num-input sm"
                  />
                </span>
              </div>
            </div>
          </div>

          {/* 4大汇总卡片 */}
          <div className="etf-kpi-grid">
            <div className="etf-kpi-card">
              <div className="ekc-label">目标总持仓 / 保证金借款</div>
              <div className="ekc-val">{fmtUsd(portfolioCalc.totalAssets)}</div>
              <div className="ekc-sub">
                本金 {fmtUsd(cfg.principalUsd)} + 借款{' '}
                <strong className="gold">{fmtUsd(portfolioCalc.marginDebt)}</strong> (待新买{' '}
                {fmtUsd(portfolioCalc.totalNetBuyUsd)})
              </div>
            </div>

            <div className="etf-kpi-card">
              <div className="ekc-label">月付股息 vs 盈透月息 ({cfg.marginAprPct}%)</div>
              <div className="ekc-val emerald">
                {fmtUsd(portfolioCalc.monthlyOnlyNet, 1)}/月
                <span className="ekc-badge">
                  {portfolioCalc.marginDebt > 0
                    ? `净覆盖 ${portfolioCalc.netCov.toFixed(2)}x`
                    : '零利息全净赚'}
                </span>
              </div>
              <div className="ekc-sub">
                税前月息 {fmtUsd(portfolioCalc.monthlyOnlyGross, 1)} · 应付利息{' '}
                <strong>{fmtUsd(portfolioCalc.monthlyInterest, 2)}/月</strong>（含ROC退税后覆盖{' '}
                {portfolioCalc.marginDebt > 0 ? `${portfolioCalc.grossCov.toFixed(2)}x` : '∞'}）
              </div>
            </div>

            <div className="etf-kpi-card">
              <div className="ekc-label">股灾 -45% (3x跌80%) 强平耐受压测</div>
              <div className={`ekc-val ${portfolioCalc.stressCrash.excessLiq > 0 ? 'emerald' : 'danger'}`}>
                剩余可用余量 +{fmtUsd(portfolioCalc.stressCrash.excessLiq)}
              </div>
              <div className="ekc-sub">
                暴跌后净权益 {fmtUsd(portfolioCalc.stressCrash.netEquity)} vs 维持保证金{' '}
                {fmtUsd(portfolioCalc.stressCrash.maintReq)}（零强平风险）
              </div>
            </div>

            <div className="etf-kpi-card">
              <div className="ekc-label">QQQ / SPY 年线 (SMA200) 牛熊水闸</div>
              <div className="ekc-bench-pills">
                {(['QQQ', 'SPY'] as const).map((sym) => {
                  const b = data?.benchmarks?.[sym];
                  if (!b) return null;
                  const bull = b.price >= b.sma200;
                  return (
                    <div key={sym} className={`ekc-bpill ${bull ? 'bull' : 'bear'}`}>
                      <strong>{sym}</strong>
                      <span>${b.price.toFixed(2)}</span>
                      <span>
                        年线 {b.dist_sma200_pct >= 0 ? '+' : ''}
                        {b.dist_sma200_pct.toFixed(1)}%
                      </span>
                      <em>{b.allow_3x_right_side ? '3x开闸' : bull ? '缓冲区' : '3x熔断'}</em>
                    </div>
                  );
                })}
              </div>
              <div className="ekc-sub">
                铁律：大盘收盘有效跌破 SMA200×0.98 立即砍掉 3x ETF 切回 SGOV
              </div>
            </div>
          </div>
        </section>

        {/* 2. 大盘实时 K 线基准图 + 分批挂单实战买点清单 */}
        <section className="etf-bench-grid">
          <div className="etf-bench-chart-card">
            <div className="ebc-head">
              <div className="ebc-tabs">
                {(['QQQ', 'SPY'] as const).map((sym) => {
                  const b = data?.benchmarks?.[sym];
                  return (
                    <button
                      key={sym}
                      type="button"
                      className={`ebc-tab ${benchSym === sym ? 'active' : ''}`}
                      onClick={() => setBenchSym(sym)}
                    >
                      <span>{sym === 'QQQ' ? 'QQQ 纳指100大盘线' : 'SPY 标普500大盘线'}</span>
                      {b && (
                        <strong className={b.change_pct >= 0 ? 'up' : 'dn'}>
                          ${b.price.toFixed(2)} ({b.change_pct >= 0 ? '+' : ''}
                          {b.change_pct.toFixed(2)}%)
                        </strong>
                      )}
                    </button>
                  );
                })}
              </div>
              {activeBench && (
                <span
                  className={`ebc-regime-pill ${
                    activeBench.regime_code.startsWith('BEAR')
                      ? 'bear'
                      : activeBench.regime_code === 'BULL_OVERHEAT'
                      ? 'warn'
                      : 'bull'
                  }`}
                >
                  {activeBench.regime_label_zh}
                </span>
              )}
            </div>

            {activeBench && (
              <>
                <div className="ebc-verdict-banner">{activeBench.regime_summary_zh}</div>

                <div className="ebc-ohlc-bar">
                  <span>
                    📅 {hoverBar?.date || '--'} 开 ${hoverBar?.open?.toFixed(2) ?? '--'} 高 $
                    {hoverBar?.high?.toFixed(2) ?? '--'} 低 ${hoverBar?.low?.toFixed(2) ?? '--'} 收 $
                    {hoverBar?.close?.toFixed(2) ?? '--'}
                  </span>
                  <span className="ebc-ma-legend">
                    <i className="dot ema20" /> EMA20 ${activeBench.ema20.toFixed(2)}
                    <i className="dot sma60" /> SMA60 ${activeBench.sma60.toFixed(2)}
                    <i className="dot sma120" /> SMA120 ${activeBench.sma120.toFixed(2)}
                    <i className="dot sma200" /> SMA200年线 ${activeBench.sma200.toFixed(2)}
                    <i className="dot rsi" /> RSI14: {activeBench.rsi14.toFixed(1)}
                  </span>
                </div>
              </>
            )}

            <div className="ebc-canvas-wrap" ref={chartWrapRef}>
              {(!activeBench || activeBench.candles.length === 0) && (
                <div className="ebc-loading">正在加载 {benchSym} 2年日线 K 线与 200 日均线...</div>
              )}
            </div>
          </div>

          {/* 右侧：分批建仓执行挂单表 */}
          <div className="etf-tranche-card">
            <div className="etc-head">
              <h3>📍 {benchSym} 联动分批买入清单（挂单实操）</h3>
              <span>按大盘回踩位置逐档成交</span>
            </div>

            <div className="etc-list">
              {tranchePlan.map((t) => (
                <div key={t.id} className={`etc-row ${t.triggered ? 'triggered' : ''}`}>
                  <div className="etc-row-top">
                    <span className="etc-title">{t.title}</span>
                    <span className={`etc-trig-badge ${t.triggered ? 'on' : ''}`}>
                      {benchSym} @ ${t.benchTrigger.toFixed(2)} ·{' '}
                      {t.triggered ? '已触及可买' : '挂单等待'}
                    </span>
                  </div>
                  <div className="etc-row-desc">{t.desc}</div>
                  <div className="etc-row-bottom">
                    <span className="etc-amt">本档预算 {fmtUsd(t.trancheUsd)}</span>
                    <div className="etc-shares-pills">
                      {t.breakdown.map((b) => (
                        <span key={b.symbol} className="etc-share-pill">
                          {b.symbol} ~{b.shares}股 ({fmtUsd(b.usd)})
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. 3 倍杠杆 ETF (TQQQ / UPRO) 专享进出场择时攻略 */}
        <section className="etf-3x-section">
          <div className="etf-section-head">
            <div>
              <h2>⚡ 3 倍杠杆奇兵（TQQQ / UPRO）专享进出场铁律</h2>
              <p>
                当前总预算控制在总资产 ≤8%（{fmtUsd(x3BudgetTotal)}
                {cfg.x3Choice === 'split' ? `，TQQQ/UPRO 各 ${fmtUsd(x3BudgetEach)}` : ''}
                ），严禁再借保证金买 3x ETF
              </p>
            </div>
            <div className="etf-3x-rule-pill">
              <ShieldAlert size={14} />
              <span>看大盘 SMA200 开关做单 · 破年线×0.98 必切回 SGOV</span>
            </div>
          </div>

          <div className="etf-3x-grid">
            {(['TQQQ', 'UPRO'] as const).map((sym) => {
              const t3 = data?.leveraged_timing?.[sym];
              if (!t3) return null;
              const isSelected =
                cfg.x3Choice === 'split' || cfg.x3Choice === sym;
              const estShares =
                t3.price > 0 && isSelected ? Math.round(x3BudgetEach / t3.price) : 0;

              return (
                <div key={sym} className={`etf-3x-card ${!isSelected ? 'dimmed' : ''}`}>
                  <div className="e3c-top">
                    <div>
                      <div className="e3c-title-row">
                        <strong className="e3c-sym">{sym}</strong>
                        <span className="e3c-price">${t3.price.toFixed(2)}</span>
                        <span className={t3.change_pct >= 0 ? 'up' : 'dn'}>
                          {t3.change_pct >= 0 ? '+' : ''}
                          {t3.change_pct.toFixed(2)}%
                        </span>
                        <span className={`e3c-status ${t3.status_code}`}>{t3.status_zh}</span>
                      </div>
                      <div className="e3c-meta">
                        锚定 {t3.benchmark_symbol} (${t3.benchmark_price.toFixed(2)}) · 距年线{' '}
                        {t3.benchmark_dist_sma200_pct >= 0 ? '+' : ''}
                        {t3.benchmark_dist_sma200_pct.toFixed(1)}% · RSI14 {t3.rsi14.toFixed(1)} ·
                        52周高点回撤 {t3.drawdown_pct.toFixed(1)}%
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-kline-jump"
                      onClick={() => onJumpToSymbol(sym)}
                    >
                      看{sym} K线 →
                    </button>
                  </div>

                  {isSelected && (
                    <div className="e3c-budget-bar">
                      分配资金：<strong>{fmtUsd(x3BudgetEach)}</strong>（约{' '}
                      <strong>{estShares} 股</strong>，只用自有现金分批执行）
                    </div>
                  )}

                  <div className="e3c-sub-block">
                    <div className="e3c-sub-title bull">📈 A. 右侧顺风开仓（大盘高于年线启用）</div>
                    <div className="e3c-step">
                      <span>
                        ① 站稳年线×1.03 开半仓50% ({t3.benchmark_symbol} ≥ $
                        {t3.right_side_breakout.benchmark_trigger.toFixed(2)} / 约当{sym} ~$
                        {t3.right_side_breakout.est_3x_price.toFixed(2)})
                      </span>
                      <p>{t3.right_side_breakout.rule_zh}</p>
                    </div>
                    <div className="e3c-step">
                      <span>
                        ② 回踩 EMA20 补余下50% ({t3.benchmark_symbol} ~ $
                        {t3.right_side_pullback.benchmark_trigger.toFixed(2)} / 约当{sym} ~$
                        {t3.right_side_pullback.est_3x_price.toFixed(2)})
                      </span>
                      <p>{t3.right_side_pullback.rule_zh}</p>
                    </div>
                  </div>

                  <div className="e3c-sub-block">
                    <div className="e3c-sub-title left">
                      🎯 B. 左侧纯现金“三枪”暴跌抄底（熊市跌破年线后专用）
                    </div>
                    <div className="e3c-guns">
                      {t3.left_side_guns.map((g) => (
                        <div key={g.gun} className={`e3c-gun-item ${g.triggered ? 'triggered' : ''}`}>
                          <div className="egi-top">
                            <div className="egi-head-row">
                              <strong>{g.label_zh}</strong>
                              {g.triggered && <em className="egi-trig-pill">已进击球区</em>}
                            </div>
                            <span>
                              {t3.benchmark_symbol} ${g.benchmark_trigger.toFixed(2)} · {sym} ~$
                              {g.est_3x_price.toFixed(2)}
                            </span>
                          </div>
                          <div className="egi-desc">{g.rule_zh}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="e3c-sub-block">
                    <div className="e3c-sub-title exit">🚨 C. 铁血卖出 / 止损换仓三大红线</div>
                    {t3.exit_rules.map((er) => (
                      <div key={er.type} className={`e3c-exit-row ${er.type}`}>
                        <div className="eer-head">
                          <strong>{er.title_zh}</strong>
                          <span>
                            参考 {sym} ~${er.est_3x_price.toFixed(2)}
                          </span>
                        </div>
                        <div className="eer-trig">触发：{er.trigger_zh}</div>
                        <div className="eer-act">动作：{er.action_zh}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 4. 四层实盘配置明细全表（含 7+1 实测与对比剔除项 RSP） */}
        <section className="etf-table-section">
          <div className="etf-section-head">
            <div>
              <h2>📊 四层实盘配置全表（Yahoo Finance 实时报价 · 精准股数清单）</h2>
              <p>
                先通过第 1 层 QQQI+SPYI 月息覆盖盈透利息，再拿第 2 层 SPMO+QQQM 复利主升，第 3 层 SGOV 防爆
              </p>
            </div>
          </div>

          <div className="etf-table-wrap">
            <table className="etf-table">
              <thead>
                <tr>
                  <th>标的 / 定位分层</th>
                  <th>实时现价</th>
                  <th>派息与 TTM 股息率</th>
                  <th>长周期复权 / 10Y最大回撤</th>
                  <th>目标权重 & 金额</th>
                  <th>已持 / 净需新买股数</th>
                  <th>保证金与税务要点</th>
                  <th>主图看盘</th>
                </tr>
              </thead>
              <tbody>
                {portfolioCalc.rows.map((r) => (
                  <tr key={r.symbol} className={`row-verdict-${r.verdict}`}>
                    <td>
                      <div className="et-sym-cell">
                        <span className={`et-layer-badge l${r.layer}`}>{r.layer_name_zh}</span>
                        <strong>{r.symbol}</strong>
                        <small>{r.name_zh}</small>
                      </div>
                    </td>
                    <td>
                      <div className="et-num-main">${r.price.toFixed(2)}</div>
                      <div className={`et-num-sub ${r.change_pct >= 0 ? 'up' : 'dn'}`}>
                        {r.change_pct >= 0 ? '+' : ''}
                        {r.change_pct.toFixed(2)}%
                      </div>
                    </td>
                    <td>
                      <div className="et-num-main emerald">{r.ttm_yield_pct.toFixed(2)}%</div>
                      <div className="et-num-sub">
                        {r.payout_freq_zh} · ${r.ttm_div_usd.toFixed(2)}/年
                      </div>
                    </td>
                    <td>
                      <div className="et-num-main">{r.history_note_zh}</div>
                      <div className="et-num-sub">
                        1Y {r.return_1y_pct !== null ? `${r.return_1y_pct >= 0 ? '+' : ''}${r.return_1y_pct}%` : '--'} · 最大回撤 {r.max_dd_pct}%
                      </div>
                    </td>
                    <td>
                      {r.effWeightPct > 0 ? (
                        <>
                          <div className="et-num-main">{r.effWeightPct}%</div>
                          <div className="et-num-sub">{fmtUsd(r.targetUsd)}</div>
                        </>
                      ) : (
                        <span className="et-exclude-tag">剔除不配 0%</span>
                      )}
                    </td>
                    <td>
                      {r.effWeightPct > 0 ? (
                        <>
                          <div className="et-buy-shares">
                            净买 <strong>{Math.round(r.netBuyShares)} 股</strong> ({fmtUsd(r.netBuyUsd)})
                          </div>
                          <div className="et-num-sub">
                            {r.heldShares > 0
                              ? `已持 ${r.heldShares}股 (${fmtUsd(r.heldUsd)}) / 目标 ${Math.round(
                                  r.targetShares
                                )}股`
                              : `目标 ${Math.round(r.targetShares)} 股`}
                          </div>
                        </>
                      ) : (
                        <span className="et-num-sub">建议置换给 SPMO + SCHD</span>
                      )}
                    </td>
                    <td>
                      <div className="et-tax-cell">
                        <span
                          className={`et-margin-tag ${
                            r.verdict === 'exclude' ? 'ban' : r.margin_allowed ? 'ok' : 'ban'
                          }`}
                        >
                          {r.verdict === 'exclude'
                            ? '对比淘汰项'
                            : r.margin_allowed
                            ? '可作核心底仓'
                            : '严禁融资买入'}
                        </span>
                        <small>{r.role_zh}</small>
                        <small className="muted">{r.tax_note_zh}</small>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-kline-jump sm"
                        onClick={() => onJumpToSymbol(r.symbol)}
                      >
                        看K线
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 5. 底部双栏：月息养息账本 & 股灾压力测试表 */}
        <section className="etf-stress-grid">
          <div className="etf-ledger-card">
            <h3>💵 月度收息 vs 盈透融资利息对账单</h3>
            <div className="elc-meter">
              <div className="elc-meter-row">
                <span>每月应付 IBKR 利息 ({fmtUsd(portfolioCalc.marginDebt)} × {cfg.marginAprPct}% / 12)</span>
                <strong className="danger">-{fmtUsd(portfolioCalc.monthlyInterest, 2)}/月</strong>
              </div>
              <div className="elc-meter-row">
                <span>第1+3层 月付ETF 税前总月息 (QQQI + SPYI + SGOV)</span>
                <strong className="emerald">+{fmtUsd(portfolioCalc.monthlyOnlyGross, 2)}/月</strong>
              </div>
              <div className="elc-meter-row">
                <span>扣 {cfg.taxPct}% W-8BEN 预扣税后当月实到手</span>
                <strong className="emerald">+{fmtUsd(portfolioCalc.monthlyOnlyNet, 2)}/月</strong>
              </div>
              <div className="elc-meter-row total">
                <span>当月净结余（交完盈透利息后还能攒下）</span>
                <strong className="gold">
                  +{fmtUsd(portfolioCalc.monthlyOnlyNet - portfolioCalc.monthlyInterest, 2)}/月
                </strong>
              </div>
            </div>
            <p className="elc-note">
              若把季度派息的 SCHD / SPMO / QQQM 平摊到每月，全部组合税前月均分红{' '}
              <strong>{fmtUsd(portfolioCalc.allDivMonthlyGross, 1)}/月</strong>（税后{' '}
              {fmtUsd(portfolioCalc.allDivMonthlyNet, 1)}/月）。次年 2–3 月盈透通常还会退回部分 QQQI/SPYI 的 ROC 及 SGOV 的 QII 预扣税。
            </p>
          </div>

          <div className="etf-ledger-card">
            <h3>🛡️ 盈透维持保证金与极端股灾强平压力测试</h3>
            <table className="etf-stress-table">
              <thead>
                <tr>
                  <th>压力情景</th>
                  <th>组合净值</th>
                  <th>净权益 (减借款)</th>
                  <th>维持保证金线</th>
                  <th>安全余量 (Excess Liq)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>当前正常态</td>
                  <td>{fmtUsd(portfolioCalc.stressNow.survAssets)}</td>
                  <td>{fmtUsd(portfolioCalc.stressNow.netEquity)}</td>
                  <td>{fmtUsd(portfolioCalc.stressNow.maintReq)}</td>
                  <td className="emerald">+{fmtUsd(portfolioCalc.stressNow.excessLiq)} 安全</td>
                </tr>
                <tr>
                  <td>中级回撤 -25% (3x跌58%)</td>
                  <td>{fmtUsd(portfolioCalc.stressMid.survAssets)}</td>
                  <td>{fmtUsd(portfolioCalc.stressMid.netEquity)}</td>
                  <td>{fmtUsd(portfolioCalc.stressMid.maintReq)}</td>
                  <td className={portfolioCalc.stressMid.excessLiq > 0 ? 'emerald' : 'danger'}>
                    {fmtUsd(portfolioCalc.stressMid.excessLiq)} {portfolioCalc.stressMid.excessLiq > 0 ? '稳健' : '预警'}
                  </td>
                </tr>
                <tr>
                  <td>史诗股灾 -45% (3x跌80%)</td>
                  <td>{fmtUsd(portfolioCalc.stressCrash.survAssets)}</td>
                  <td>{fmtUsd(portfolioCalc.stressCrash.netEquity)}</td>
                  <td>{fmtUsd(portfolioCalc.stressCrash.maintReq)}</td>
                  <td className={portfolioCalc.stressCrash.excessLiq > 0 ? 'emerald' : 'danger'}>
                    {fmtUsd(portfolioCalc.stressCrash.excessLiq)}{' '}
                    {portfolioCalc.stressCrash.excessLiq > 0 ? '零强平' : '降杠杆'}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="elc-note">
              按正则 ETF 25% 维持保证金 + 3x 杠杆 ETF 75% 高担保比率保守测算；若触发大盘年线×0.98止损切回 SGOV，安全垫会进一步增厚。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
});
