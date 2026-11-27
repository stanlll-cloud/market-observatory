import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { LangType, MarketType } from '../types';

interface Props {
  lang: LangType;
  currentMarket: MarketType;
  currentSymbol: string;
  currentPrice: number;
  onBackToWorkbench: () => void;
}

type CalcTab = 'pos' | 'scale' | 'roll';
type FeePresetKey = 'binance_ref' | 'binance_std' | 'okx' | 'bitget' | 'bybit';

interface CalcPersistedCfg {
  tab: CalcTab;
  side: 'LONG' | 'SHORT';
  equityUsd: number;
  riskPct: number;
  leverage: number;
  feePreset: FeePresetKey;
  feePct: number;
  scalePoolUsd: number;
  scaleLeverage: number;
  scaleGuns: number;
  scaleMult: number;
  scaleSpacing: 'widening' | 'uniform';
  scaleStepPct: number;
  rollInitUsd: number;
  rollLeverage: number;
  rollMovePct: number;
  rollReinvestPct: 50 | 100;
  rollStages: number;
}

const STORAGE_KEY = 'obs_calc_cfg_v1';

const FEE_PRESETS: Record<FeePresetKey, { label: string; ratePct: number }> = {
  binance_ref: { label: 'Binance 返佣 0.04%', ratePct: 0.04 },
  binance_std: { label: 'Binance 标准 0.05%', ratePct: 0.05 },
  okx: { label: 'OKX 0.05%', ratePct: 0.05 },
  bybit: { label: 'Bybit 0.055%', ratePct: 0.055 },
  bitget: { label: 'Bitget 0.06%', ratePct: 0.06 },
};

const QUICK_TICKERS: Array<{ market: MarketType; symbol: string }> = [
  { market: 'crypto', symbol: 'BTCUSDT' },
  { market: 'crypto', symbol: 'ETHUSDT' },
  { market: 'crypto', symbol: 'SOLUSDT' },
  { market: 'us', symbol: 'NVDA' },
  { market: 'us', symbol: 'QQQ' },
  { market: 'commodity', symbol: 'GC=F' },
  { market: 'commodity', symbol: 'CL=F' },
];

const WIDENING_STEPS = [0, 6, 14, 24, 36, 48];

const DEFAULT_CFG: CalcPersistedCfg = {
  tab: 'pos',
  side: 'LONG',
  equityUsd: 10000,
  riskPct: 1.5,
  leverage: 3,
  feePreset: 'binance_std',
  feePct: 0.05,
  scalePoolUsd: 10000,
  scaleLeverage: 3,
  scaleGuns: 4,
  scaleMult: 1.5,
  scaleSpacing: 'widening',
  scaleStepPct: 6,
  rollInitUsd: 1000,
  rollLeverage: 3,
  rollMovePct: 15,
  rollReinvestPct: 50,
  rollStages: 4,
};

function loadCfg(): CalcPersistedCfg {
  if (typeof window === 'undefined') return DEFAULT_CFG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CFG;
    const p = JSON.parse(raw) as Partial<CalcPersistedCfg>;
    return {
      tab: p.tab === 'scale' || p.tab === 'roll' || p.tab === 'pos' ? p.tab : DEFAULT_CFG.tab,
      side: p.side === 'SHORT' ? 'SHORT' : 'LONG',
      equityUsd: Math.max(100, Number(p.equityUsd) || DEFAULT_CFG.equityUsd),
      riskPct: Math.min(25, Math.max(0.1, Number(p.riskPct) || DEFAULT_CFG.riskPct)),
      leverage: Math.min(125, Math.max(1, Number(p.leverage) || DEFAULT_CFG.leverage)),
      feePreset: p.feePreset && p.feePreset in FEE_PRESETS ? p.feePreset : DEFAULT_CFG.feePreset,
      feePct: Math.min(1, Math.max(0, Number(p.feePct ?? DEFAULT_CFG.feePct))),
      scalePoolUsd: Math.max(100, Number(p.scalePoolUsd) || DEFAULT_CFG.scalePoolUsd),
      scaleLeverage: Math.min(50, Math.max(1, Number(p.scaleLeverage) || DEFAULT_CFG.scaleLeverage)),
      scaleGuns: Math.min(6, Math.max(2, Number(p.scaleGuns) || DEFAULT_CFG.scaleGuns)),
      scaleMult: Math.min(5, Math.max(1, Number(p.scaleMult) || DEFAULT_CFG.scaleMult)),
      scaleSpacing: p.scaleSpacing === 'uniform' ? 'uniform' : 'widening',
      scaleStepPct: Math.min(30, Math.max(1, Number(p.scaleStepPct) || DEFAULT_CFG.scaleStepPct)),
      rollInitUsd: Math.max(50, Number(p.rollInitUsd) || DEFAULT_CFG.rollInitUsd),
      rollLeverage: Math.min(50, Math.max(1, Number(p.rollLeverage) || DEFAULT_CFG.rollLeverage)),
      rollMovePct: Math.min(200, Math.max(2, Number(p.rollMovePct) || DEFAULT_CFG.rollMovePct)),
      rollReinvestPct: p.rollReinvestPct === 100 ? 100 : 50,
      rollStages: Math.min(8, Math.max(2, Number(p.rollStages) || DEFAULT_CFG.rollStages)),
    };
  } catch {
    return DEFAULT_CFG;
  }
}

function fmtUsd(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '$0';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function fmtPx(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '--';
  if (v >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 10) return v.toFixed(2);
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

function roundPx(v: number): number {
  if (v >= 1000) return Number(v.toFixed(2));
  if (v >= 10) return Number(v.toFixed(2));
  if (v >= 1) return Number(v.toFixed(3));
  return Number(v.toFixed(4));
}

export const CalculatorPage = memo(function CalculatorPage({
  lang,
  currentMarket,
  currentSymbol,
  currentPrice,
  onBackToWorkbench,
}: Props) {
  const isZh = lang === 'zh';
  const [cfg, setCfg] = useState<CalcPersistedCfg>(loadCfg);
  const [activeMkt, setActiveMkt] = useState<MarketType>(currentMarket);
  const [activeSym, setActiveSym] = useState<string>(currentSymbol);
  const [livePx, setLivePx] = useState<number>(currentPrice > 0 ? currentPrice : 60000);
  const [tickLoading, setTickLoading] = useState<boolean>(false);

  const initBase = currentPrice > 0 ? currentPrice : 60000;
  const [entryPrice, setEntryPrice] = useState<number>(() => roundPx(initBase));
  const [stopPrice, setStopPrice] = useState<number>(() =>
    roundPx(cfg.side === 'LONG' ? initBase * 0.965 : initBase * 1.035)
  );
  const [targetPrice, setTargetPrice] = useState<number>(() =>
    roundPx(cfg.side === 'LONG' ? initBase * 1.08 : initBase * 0.92)
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {
      // ignore storage errors
    }
  }, [cfg]);

  const applyNewEntryPrice = useCallback(
    (px: number, side: 'LONG' | 'SHORT') => {
      if (!px || px <= 0) return;
      setLivePx(px);
      setEntryPrice(roundPx(px));
      setStopPrice(roundPx(side === 'LONG' ? px * 0.965 : px * 1.035));
      setTargetPrice(roundPx(side === 'LONG' ? px * 1.08 : px * 0.92));
    },
    []
  );

  const fetchLivePrice = useCallback(
    async (mkt: MarketType, sym: string) => {
      setActiveMkt(mkt);
      setActiveSym(sym);
      setTickLoading(true);
      try {
        const res = await fetch(
          `/api/tick?market=${mkt}&symbol=${encodeURIComponent(sym)}&interval=1h`
        );
        const json = await res.json();
        const p = Number(json?.price || 0);
        if (p > 0) {
          applyNewEntryPrice(p, cfg.side);
        }
      } catch {
        // keep current price on network blip
      } finally {
        setTickLoading(false);
      }
    },
    [applyNewEntryPrice, cfg.side]
  );

  // Sync when workbench symbol changes and matches current price
  useEffect(() => {
    if (currentPrice > 0 && currentSymbol) {
      setActiveMkt(currentMarket);
      setActiveSym(currentSymbol);
      applyNewEntryPrice(currentPrice, cfg.side);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSymbol, currentMarket]);

  const handleSideChange = (nextSide: 'LONG' | 'SHORT') => {
    setCfg((p) => ({ ...p, side: nextSide }));
    const base = entryPrice > 0 ? entryPrice : livePx;
    if (base > 0) {
      setStopPrice(roundPx(nextSide === 'LONG' ? base * 0.965 : base * 1.035));
      setTargetPrice(roundPx(nextSide === 'LONG' ? base * 1.08 : base * 0.92));
    }
  };

  // 1. 以损定量计算
  const posResult = useMemo(() => {
    const feeRate = cfg.feePct / 100;
    const stopDist = Math.abs(entryPrice - stopPrice);
    const rewardDist = Math.abs(targetPrice - entryPrice);
    const lossPerUnit = stopDist + (entryPrice + stopPrice) * feeRate;
    const profitPerUnit = rewardDist - (entryPrice + targetPrice) * feeRate;
    const maxRiskUsd = cfg.equityUsd * (cfg.riskPct / 100);
    const qty = lossPerUnit > 0 && entryPrice > 0 ? maxRiskUsd / lossPerUnit : 0;
    const notionalUsd = qty * entryPrice;
    const reqMarginUsd = cfg.leverage > 0 ? notionalUsd / cfg.leverage : notionalUsd;
    const effLeverage = cfg.equityUsd > 0 ? notionalUsd / cfg.equityUsd : 0;
    const roundTripFeeUsd = qty * (entryPrice + stopPrice) * feeRate;
    const netProfitUsd = qty * profitPerUnit;
    const rrRatio = maxRiskUsd > 0 ? netProfitUsd / maxRiskUsd : 0;

    const maint = 0.005;
    const estLiqPrice =
      entryPrice > 0
        ? cfg.side === 'LONG'
          ? Math.max(0, entryPrice * (1 - 1 / cfg.leverage + maint))
          : entryPrice * (1 + 1 / cfg.leverage - maint)
        : 0;

    const stopValid =
      cfg.side === 'LONG'
        ? stopPrice > 0 && stopPrice < entryPrice
        : stopPrice > entryPrice;
    const tpValid =
      cfg.side === 'LONG'
        ? targetPrice > entryPrice
        : targetPrice > 0 && targetPrice < entryPrice;
    const stopBeforeLiq =
      cfg.side === 'LONG' ? stopPrice > estLiqPrice : estLiqPrice <= 0 || stopPrice < estLiqPrice;
    const marginOk = reqMarginUsd <= cfg.equityUsd;
    const rrOk = rrRatio >= 1.5;
    const levOk = effLeverage <= 5;

    return {
      qty,
      notionalUsd,
      reqMarginUsd,
      effLeverage,
      maxRiskUsd,
      roundTripFeeUsd,
      netProfitUsd,
      rrRatio,
      estLiqPrice,
      stopPct: entryPrice > 0 ? (stopDist / entryPrice) * 100 : 0,
      tpPct: entryPrice > 0 ? (rewardDist / entryPrice) * 100 : 0,
      checks: [
        { ok: stopValid && tpValid, label: stopValid && tpValid ? '多空止损/止盈方向正确' : '请检查止损/止盈价与方向是否匹配' },
        { ok: stopBeforeLiq, label: stopBeforeLiq ? '止损位在强平价之前（不会先爆仓）' : '⚠️ 止损已超过强平价，开单必爆！请降杠杆或收紧止损' },
        { ok: marginOk, label: marginOk ? `所需保证金 ${fmtUsd(reqMarginUsd, 0)} ≤ 账户总额` : `⚠️ 保证金 ${fmtUsd(reqMarginUsd, 0)} 超出本金，需提高杠杆或缩小止损金额` },
        { ok: rrOk, label: rrOk ? `净盈亏比 1 : ${rrRatio.toFixed(2)}（合格 ≥ 1.5）` : `净盈亏比 1 : ${rrRatio.toFixed(2)} 偏低，建议拉高赔率再出手` },
        { ok: levOk, label: levOk ? `实际账户杠杆 ${effLeverage.toFixed(2)}x（稳健 ≤ 5x）` : `实际账户杠杆 ${effLeverage.toFixed(2)}x 偏高，防插针滑点` },
      ],
    };
  }, [cfg, entryPrice, stopPrice, targetPrice]);

  // 2. 逆势分批摊平 / 马丁生死推演
  const scaleResult = useMemo(() => {
    const base = entryPrice > 0 ? entryPrice : 100;
    const n = cfg.scaleGuns;
    const weights: number[] = [];
    for (let i = 0; i < n; i++) {
      weights.push(Math.pow(cfg.scaleMult, i));
    }
    const weightSum = weights.reduce((s, w) => s + w, 0);
    const maint = 0.005;

    let cumMargin = 0;
    let cumNotional = 0;
    let cumQty = 0;

    const rows = weights.map((w, idx) => {
      const offsetPct =
        cfg.scaleSpacing === 'widening'
          ? WIDENING_STEPS[idx] ?? idx * cfg.scaleStepPct * 1.4
          : idx * cfg.scaleStepPct;
      const trigPrice =
        cfg.side === 'LONG' ? base * (1 - offsetPct / 100) : base * (1 + offsetPct / 100);
      const gunMargin = cfg.scalePoolUsd * (w / weightSum);
      const gunNotional = gunMargin * cfg.scaleLeverage;
      const gunQty = trigPrice > 0 ? gunNotional / trigPrice : 0;

      cumMargin += gunMargin;
      cumNotional += gunNotional;
      cumQty += gunQty;
      const avgEntry = cumQty > 0 ? cumNotional / cumQty : trigPrice;
      const reboundPct = trigPrice > 0 ? (Math.abs(avgEntry - trigPrice) / trigPrice) * 100 : 0;

      // Cross-margin liquidation price backed by full scalePoolUsd
      let liqPrice = 0;
      if (cfg.side === 'LONG') {
        liqPrice = cumNotional > cfg.scalePoolUsd ? (cumNotional - cfg.scalePoolUsd) / (cumQty * (1 - maint)) : 0;
      } else {
        liqPrice = (cumNotional + cfg.scalePoolUsd) / (cumQty * (1 + maint));
      }

      const distFromFirstPct =
        liqPrice > 0 && base > 0 ? ((liqPrice - base) / base) * 100 : cfg.side === 'LONG' ? -100 : 999;

      return {
        gun: idx + 1,
        weightSharePct: (w / weightSum) * 100,
        offsetPct,
        trigPrice,
        gunMargin,
        cumMargin,
        cumNotional,
        avgEntry,
        reboundPct,
        liqPrice,
        distFromFirstPct,
      };
    });

    const lastRow = rows[rows.length - 1];
    const gun1SharePct = rows[0]?.weightSharePct ?? 0;
    const crashBufPct = Math.abs(lastRow?.distFromFirstPct ?? 0);
    const recTotalStop =
      lastRow && base > 0
        ? cfg.side === 'LONG'
          ? lastRow.trigPrice * 0.94
          : lastRow.trigPrice * 1.06
        : 0;

    return {
      rows,
      gun1SharePct,
      finalAvg: lastRow?.avgEntry ?? base,
      finalReboundPct: lastRow?.reboundPct ?? 0,
      finalLiqPrice: lastRow?.liqPrice ?? 0,
      crashBufPct,
      recTotalStop,
      isHighDanger: cfg.scaleMult >= 2.5 || (cfg.scaleLeverage >= 5 && crashBufPct < 35),
    };
  }, [cfg, entryPrice]);

  // 3. 顺势浮盈滚仓推演
  const rollResult = useMemo(() => {
    const base = entryPrice > 0 ? entryPrice : 100;
    const feeRate = cfg.feePct / 100;
    const moveDec = cfg.rollMovePct / 100;
    let curPrice = base;
    let curMargin = cfg.rollInitUsd;
    let lockedProfit = 0;

    const rows = [];
    for (let s = 1; s <= cfg.rollStages; s++) {
      const nextPrice =
        cfg.side === 'LONG' ? curPrice * (1 + moveDec) : curPrice * (1 - moveDec);
      const notional = curMargin * cfg.rollLeverage;
      const qty = curPrice > 0 ? notional / curPrice : 0;
      const grossProfit = notional * moveDec;
      const feeCost = qty * (curPrice + nextPrice) * feeRate;
      const netProfit = Math.max(0, grossProfit - feeCost);
      const kept = netProfit * (1 - cfg.rollReinvestPct / 100);
      const reinvested = netProfit * (cfg.rollReinvestPct / 100);
      lockedProfit += kept;
      const totalEquity = curMargin + reinvested + lockedProfit;

      rows.push({
        stage: s,
        entryPx: curPrice,
        exitPx: nextPrice,
        margin: curMargin,
        notional,
        netProfit,
        lockedProfit,
        totalEquity,
        multiple: totalEquity / cfg.rollInitUsd,
      });

      curPrice = nextPrice;
      curMargin = curMargin + reinvested;
    }

    const last = rows[rows.length - 1];
    return {
      rows,
      finalEquity: last?.totalEquity ?? cfg.rollInitUsd,
      finalMultiple: last?.multiple ?? 1,
      lockedProfit: last?.lockedProfit ?? 0,
      finalPrice: last?.exitPx ?? base,
    };
  }, [cfg, entryPrice]);

  return (
    <div className="calc-page">
      <div className="calc-inner">
        {/* Top Bar */}
        <div className="radar-top-head">
          <div className="rth-left">
            <button type="button" className="btn-back-chart" onClick={onBackToWorkbench}>
              <ArrowLeft size={14} />
              <span>{isZh ? '返回主看盘' : 'Back to Chart'}</span>
            </button>
            <div className="radar-title-badge">
              <span>🧮</span>
              <span>
                {isZh
                  ? '合约仓位与加仓风控计算器（本地实时演算 · 零手续费陷阱）'
                  : 'Position Sizing, DCA Martingale & Rolling Calculator'}
              </span>
            </div>
          </div>

          <div className="rth-right">
            <div className="calc-quick-tickers">
              {QUICK_TICKERS.map((qt) => (
                <button
                  key={qt.symbol}
                  type="button"
                  className={`calc-qchip ${activeSym === qt.symbol ? 'active' : ''}`}
                  onClick={() => fetchLivePrice(qt.market, qt.symbol)}
                >
                  {qt.symbol.replace('USDT', '')}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-refresh"
              onClick={() => fetchLivePrice(activeMkt, activeSym)}
              disabled={tickLoading}
            >
              <RefreshCw size={13} className={tickLoading ? 'spin' : ''} />
              <span>
                {activeSym} ${fmtPx(livePx)} · 同步现价
              </span>
            </button>
          </div>
        </div>

        {/* 3-Tab Switcher */}
        <div className="calc-tabs">
          <button
            type="button"
            className={`calc-tab ${cfg.tab === 'pos' ? 'active' : ''}`}
            onClick={() => setCfg((p) => ({ ...p, tab: 'pos' }))}
          >
            ⚖️ 以损定量仓位器（日常开单必算）
          </button>
          <button
            type="button"
            className={`calc-tab ${cfg.tab === 'scale' ? 'active' : ''}`}
            onClick={() => setCfg((p) => ({ ...p, tab: 'scale' }))}
          >
            🎯 逆势分批摊平 / 马丁生死推演
          </button>
          <button
            type="button"
            className={`calc-tab ${cfg.tab === 'roll' ? 'active' : ''}`}
            onClick={() => setCfg((p) => ({ ...p, tab: 'roll' }))}
          >
            🚀 顺势浮盈滚仓推演（只拿利润滚）
          </button>
        </div>

        {/* TAB 1: 以损定量 */}
        {cfg.tab === 'pos' && (
          <div className="calc-grid">
            <div className="calc-card">
              <div className="cc-head">
                <h3>📝 交易计划参数 ({activeSym})</h3>
                <div className="cc-side-group">
                  <button
                    type="button"
                    className={`cc-side-btn long ${cfg.side === 'LONG' ? 'active' : ''}`}
                    onClick={() => handleSideChange('LONG')}
                  >
                    做多 LONG
                  </button>
                  <button
                    type="button"
                    className={`cc-side-btn short ${cfg.side === 'SHORT' ? 'active' : ''}`}
                    onClick={() => handleSideChange('SHORT')}
                  >
                    做空 SHORT
                  </button>
                </div>
              </div>

              <div className="cc-field">
                <label>账户总资金 (USDT)</label>
                <div className="cc-row">
                  {[2000, 5000, 10000, 50000].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`etf-chip ${cfg.equityUsd === v ? 'active' : ''}`}
                      onClick={() => setCfg((p) => ({ ...p, equityUsd: v }))}
                    >
                      ${(v / 1000).toFixed(0)}k
                    </button>
                  ))}
                  <input
                    type="number"
                    min={100}
                    step={500}
                    value={cfg.equityUsd}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, equityUsd: Math.max(100, Number(e.target.value) || 10000) }))
                    }
                    className="etf-num-input"
                  />
                </div>
              </div>

              <div className="cc-field">
                <label>单笔最大止损比例（推荐 1%~1.5% 铁律）</label>
                <div className="cc-row">
                  {[0.5, 1, 1.5, 2, 3].map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`etf-chip ${Math.abs(cfg.riskPct - r) < 0.01 ? 'active' : ''}`}
                      onClick={() => setCfg((p) => ({ ...p, riskPct: r }))}
                    >
                      {r}% ({fmtUsd((cfg.equityUsd * r) / 100, 0)})
                    </button>
                  ))}
                </div>
              </div>

              <div className="cc-field">
                <label>合约名义杠杆倍数</label>
                <div className="cc-row">
                  {[1, 2, 3, 5, 10, 20].map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      className={`etf-chip ${cfg.leverage === lv ? 'active' : ''}`}
                      onClick={() => setCfg((p) => ({ ...p, leverage: lv }))}
                    >
                      {lv}x
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={125}
                    value={cfg.leverage}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, leverage: Math.max(1, Math.min(125, Number(e.target.value) || 3)) }))
                    }
                    className="etf-num-input sm"
                  />
                </div>
              </div>

              <div className="cc-price-grid">
                <div className="cc-field">
                  <label>开仓价</label>
                  <input
                    type="number"
                    step="any"
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(Number(e.target.value) || 0)}
                    className="cc-num-lg"
                  />
                </div>
                <div className="cc-field">
                  <label>止损价 ({posResult.stopPct.toFixed(2)}%)</label>
                  <input
                    type="number"
                    step="any"
                    value={stopPrice}
                    onChange={(e) => setStopPrice(Number(e.target.value) || 0)}
                    className="cc-num-lg"
                  />
                </div>
                <div className="cc-field">
                  <label>止盈价 ({posResult.tpPct.toFixed(2)}%)</label>
                  <input
                    type="number"
                    step="any"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(Number(e.target.value) || 0)}
                    className="cc-num-lg"
                  />
                </div>
              </div>

              <div className="cc-field">
                <label>交易所双边 Taker 费率参考</label>
                <div className="cc-row">
                  {(Object.keys(FEE_PRESETS) as FeePresetKey[]).map((fk) => (
                    <button
                      key={fk}
                      type="button"
                      className={`etf-chip ${cfg.feePreset === fk ? 'active' : ''}`}
                      onClick={() =>
                        setCfg((p) => ({ ...p, feePreset: fk, feePct: FEE_PRESETS[fk].ratePct }))
                      }
                    >
                      {FEE_PRESETS[fk].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="calc-card">
              <div className="cc-head">
                <h3>📊 科学开仓结果 & 开单前自动风控安检</h3>
                <span className={`cc-rr-pill ${posResult.rrRatio >= 1.5 ? 'ok' : 'warn'}`}>
                  净盈亏比 1 : {posResult.rrRatio.toFixed(2)}
                </span>
              </div>

              <div className="calc-kpi-grid">
                <div className="calc-kpi">
                  <span>建议开仓价值 (名义仓位)</span>
                  <strong className="gold">{fmtUsd(posResult.notionalUsd, 2)}</strong>
                  <small>下单数量: {posResult.qty.toFixed(posResult.qty >= 10 ? 2 : 4)} {activeSym.replace('USDT', '')}</small>
                </div>
                <div className="calc-kpi">
                  <span>所需初始保证金 ({cfg.leverage}x)</span>
                  <strong className="emerald">{fmtUsd(posResult.reqMarginUsd, 2)}</strong>
                  <small>实际账户杠杆: {posResult.effLeverage.toFixed(2)}x</small>
                </div>
                <div className="calc-kpi">
                  <span>扣费后净止损 / 预期净盈利</span>
                  <strong>
                    <em className="dn">-{fmtUsd(posResult.maxRiskUsd, 1)}</em> /{' '}
                    <em className="up">+{fmtUsd(posResult.netProfitUsd, 1)}</em>
                  </strong>
                  <small>双边预估手续费: {fmtUsd(posResult.roundTripFeeUsd, 2)}</small>
                </div>
                <div className="calc-kpi">
                  <span>预估逐仓强平参考价</span>
                  <strong className="danger">${fmtPx(posResult.estLiqPrice)}</strong>
                  <small>
                    {cfg.side === 'LONG' ? '止损必须在强平价上方' : '止损必须在强平价下方'}
                  </small>
                </div>
              </div>

              <div className="calc-rr-bar-wrap">
                <div className="crb-labels">
                  <span className="dn">最大止损 -{fmtUsd(posResult.maxRiskUsd, 0)}</span>
                  <span className="up">目标净赚 +{fmtUsd(posResult.netProfitUsd, 0)}</span>
                </div>
                <div className="calc-rr-bar">
                  <div
                    className="crb-loss"
                    style={{
                      width: `${
                        posResult.maxRiskUsd + Math.max(0, posResult.netProfitUsd) > 0
                          ? (posResult.maxRiskUsd /
                              (posResult.maxRiskUsd + Math.max(0, posResult.netProfitUsd))) *
                            100
                          : 50
                      }%`,
                    }}
                  />
                  <div className="crb-win" />
                </div>
              </div>

              <div className="calc-checklist">
                {posResult.checks.map((c, i) => (
                  <div key={i} className={`cck-row ${c.ok ? 'ok' : 'bad'}`}>
                    <span>{c.ok ? '✅' : '🚨'}</span>
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: 逆势分批摊平 / 马丁生死推演 */}
        {cfg.tab === 'scale' && (
          <div className="calc-scale-wrap">
            <div className="calc-card">
              <div className="cc-head">
                <h3>🎯 币圈左侧分批加仓倍率配置（默认推荐 1.5x 黄金倍率 + 越跌越宽）</h3>
                <div className="cc-side-group">
                  <button
                    type="button"
                    className={`cc-side-btn long ${cfg.side === 'LONG' ? 'active' : ''}`}
                    onClick={() => handleSideChange('LONG')}
                  >
                    逢跌加多
                  </button>
                  <button
                    type="button"
                    className={`cc-side-btn short ${cfg.side === 'SHORT' ? 'active' : ''}`}
                    onClick={() => handleSideChange('SHORT')}
                  >
                    逢涨加空
                  </button>
                </div>
              </div>

              <div className="calc-scale-controls">
                <div className="cc-field">
                  <label>加仓倍率（币圈实战选型）</label>
                  <div className="cc-row">
                    {[
                      { m: 1.0, lbl: '稳健等额 1.0x (1-1-1-1)' },
                      { m: 1.5, lbl: '币圈黄金 1.5x (1-1.5-2.25-3.4) ⭐' },
                      { m: 2.0, lbl: '温和马丁 2.0x (1-2-4-8)' },
                      { m: 3.0, lbl: '赌场3倍 3.0x (10-30-90-270 高危)' },
                    ].map((opt) => (
                      <button
                        key={opt.m}
                        type="button"
                        className={`etf-chip ${Math.abs(cfg.scaleMult - opt.m) < 0.05 ? 'active' : ''}`}
                        onClick={() => setCfg((p) => ({ ...p, scaleMult: opt.m }))}
                      >
                        {opt.lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="cc-row wrap-gap">
                  <div className="cc-field">
                    <label>总保证金池 ($)</label>
                    <input
                      type="number"
                      min={100}
                      step={500}
                      value={cfg.scalePoolUsd}
                      onChange={(e) =>
                        setCfg((p) => ({ ...p, scalePoolUsd: Math.max(100, Number(e.target.value) || 10000) }))
                      }
                      className="etf-num-input"
                    />
                  </div>
                  <div className="cc-field">
                    <label>首枪开仓价</label>
                    <input
                      type="number"
                      step="any"
                      value={entryPrice}
                      onChange={(e) => setEntryPrice(Number(e.target.value) || 0)}
                      className="etf-num-input"
                    />
                  </div>
                  <div className="cc-field">
                    <label>合约杠杆</label>
                    <div className="cc-row">
                      {[2, 3, 5, 10].map((lv) => (
                        <button
                          key={lv}
                          type="button"
                          className={`etf-chip ${cfg.scaleLeverage === lv ? 'active' : ''}`}
                          onClick={() => setCfg((p) => ({ ...p, scaleLeverage: lv }))}
                        >
                          {lv}x
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cc-field">
                    <label>最多加仓枪数</label>
                    <div className="cc-row">
                      {[3, 4, 5, 6].map((g) => (
                        <button
                          key={g}
                          type="button"
                          className={`etf-chip ${cfg.scaleGuns === g ? 'active' : ''}`}
                          onClick={() => setCfg((p) => ({ ...p, scaleGuns: g }))}
                        >
                          {g} 枪
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cc-field">
                    <label>加仓间距模式</label>
                    <div className="cc-row">
                      <button
                        type="button"
                        className={`etf-chip ${cfg.scaleSpacing === 'widening' ? 'active' : ''}`}
                        onClick={() => setCfg((p) => ({ ...p, scaleSpacing: 'widening' }))}
                      >
                        越跌越宽 (0/6/14/24%) ⭐
                      </button>
                      <button
                        type="button"
                        className={`etf-chip ${cfg.scaleSpacing === 'uniform' ? 'active' : ''}`}
                        onClick={() => setCfg((p) => ({ ...p, scaleSpacing: 'uniform' }))}
                      >
                        等距 {cfg.scaleStepPct}%
                      </button>
                      {cfg.scaleSpacing === 'uniform' && (
                        <input
                          type="number"
                          min={1}
                          max={25}
                          value={cfg.scaleStepPct}
                          onChange={(e) =>
                            setCfg((p) => ({ ...p, scaleStepPct: Math.max(1, Number(e.target.value) || 6) }))
                          }
                          className="etf-num-input sm"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="calc-kpi-grid">
                <div className="calc-kpi">
                  <span>第 1 枪安全头仓占比</span>
                  <strong className="emerald">{scaleResult.gun1SharePct.toFixed(1)}%</strong>
                  <small>必须按 {cfg.scaleGuns} 枪总比例倒推首仓</small>
                </div>
                <div className="calc-kpi">
                  <span>打满 {cfg.scaleGuns} 枪后摊平新均价</span>
                  <strong className="gold">${fmtPx(scaleResult.finalAvg)}</strong>
                  <small>只需反向波动 {scaleResult.finalReboundPct.toFixed(2)}% 即全部回本</small>
                </div>
                <div className="calc-kpi">
                  <span>单边极端行情爆仓红线</span>
                  <strong className={scaleResult.isHighDanger ? 'danger' : 'emerald'}>
                    {scaleResult.finalLiqPrice > 0 ? `$${fmtPx(scaleResult.finalLiqPrice)}` : '极低风险'}
                  </strong>
                  <small>
                    自第 1 枪单边 {cfg.side === 'LONG' ? '暴跌' : '暴涨'} {scaleResult.crashBufPct.toFixed(1)}% 全仓归零
                  </small>
                </div>
                <div className="calc-kpi">
                  <span>建议总认赔止损线 (防归零)</span>
                  <strong className="danger">${fmtPx(scaleResult.recTotalStop)}</strong>
                  <small>打完末枪再反向破 6% 必须砍仓保命</small>
                </div>
              </div>

              <div className="etf-table-wrap">
                <table className="etf-table">
                  <thead>
                    <tr>
                      <th>枪数</th>
                      <th>加仓触发价 (偏离)</th>
                      <th>本枪保证金 (占比)</th>
                      <th>累计保证金 / 名义仓位</th>
                      <th>摊平后新均价</th>
                      <th>需反弹/回落回本</th>
                      <th>全仓强平参考价</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scaleResult.rows.map((r) => (
                      <tr key={r.gun}>
                        <td>
                          <strong>第 {r.gun} 枪</strong>
                        </td>
                        <td className="mono">
                          ${fmtPx(r.trigPrice)} ({cfg.side === 'LONG' ? '-' : '+'}
                          {r.offsetPct}%)
                        </td>
                        <td className="mono">
                          <span className="gold">{fmtUsd(r.gunMargin, 0)}</span> ({r.weightSharePct.toFixed(1)}%)
                        </td>
                        <td className="mono">
                          {fmtUsd(r.cumMargin, 0)} → <b>{fmtUsd(r.cumNotional, 0)}</b>
                        </td>
                        <td className="mono emerald">${fmtPx(r.avgEntry)}</td>
                        <td className="mono">{r.reboundPct.toFixed(2)}%</td>
                        <td className={`mono ${Math.abs(r.distFromFirstPct) < 33 ? 'danger' : ''}`}>
                          {r.liqPrice > 0
                            ? `$${fmtPx(r.liqPrice)} (总波动 ${r.distFromFirstPct.toFixed(1)}%)`
                            : '极安全 (未满1x)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: 顺势浮盈滚仓推演 */}
        {cfg.tab === 'roll' && (
          <div className="calc-scale-wrap">
            <div className="calc-card">
              <div className="cc-head">
                <h3>🚀 顺势浮盈滚仓（推荐「50% 半利安全滚仓」，边滚边把一半利润落袋）</h3>
                <div className="cc-side-group">
                  <button
                    type="button"
                    className={`cc-side-btn long ${cfg.side === 'LONG' ? 'active' : ''}`}
                    onClick={() => handleSideChange('LONG')}
                  >
                    顺势滚多
                  </button>
                  <button
                    type="button"
                    className={`cc-side-btn short ${cfg.side === 'SHORT' ? 'active' : ''}`}
                    onClick={() => handleSideChange('SHORT')}
                  >
                    顺势滚空
                  </button>
                </div>
              </div>

              <div className="cc-row wrap-gap" style={{ marginBottom: 14 }}>
                <div className="cc-field">
                  <label>初始开仓保证金 ($)</label>
                  <input
                    type="number"
                    min={50}
                    step={100}
                    value={cfg.rollInitUsd}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, rollInitUsd: Math.max(50, Number(e.target.value) || 1000) }))
                    }
                    className="etf-num-input"
                  />
                </div>
                <div className="cc-field">
                  <label>起步价</label>
                  <input
                    type="number"
                    step="any"
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(Number(e.target.value) || 0)}
                    className="etf-num-input"
                  />
                </div>
                <div className="cc-field">
                  <label>杠杆</label>
                  <div className="cc-row">
                    {[2, 3, 5, 10].map((lv) => (
                      <button
                        key={lv}
                        type="button"
                        className={`etf-chip ${cfg.rollLeverage === lv ? 'active' : ''}`}
                        onClick={() => setCfg((p) => ({ ...p, rollLeverage: lv }))}
                      >
                        {lv}x
                      </button>
                    ))}
                  </div>
                </div>
                <div className="cc-field">
                  <label>每轮主升/主跌波幅 %</label>
                  <div className="cc-row">
                    {[8, 12, 15, 20].map((mv) => (
                      <button
                        key={mv}
                        type="button"
                        className={`etf-chip ${cfg.rollMovePct === mv ? 'active' : ''}`}
                        onClick={() => setCfg((p) => ({ ...p, rollMovePct: mv }))}
                      >
                        {cfg.side === 'LONG' ? '+' : '-'}
                        {mv}%
                      </button>
                    ))}
                  </div>
                </div>
                <div className="cc-field">
                  <label>滚仓风格</label>
                  <div className="cc-row">
                    <button
                      type="button"
                      className={`etf-chip ${cfg.rollReinvestPct === 50 ? 'active' : ''}`}
                      onClick={() => setCfg((p) => ({ ...p, rollReinvestPct: 50 }))}
                    >
                      50% 半利安全滚仓 ⭐
                    </button>
                    <button
                      type="button"
                      className={`etf-chip ${cfg.rollReinvestPct === 100 ? 'active' : ''}`}
                      onClick={() => setCfg((p) => ({ ...p, rollReinvestPct: 100 }))}
                    >
                      100% 全利激进复利
                    </button>
                  </div>
                </div>
              </div>

              <div className="calc-kpi-grid">
                <div className="calc-kpi">
                  <span>滚完 {cfg.rollStages} 轮总权益</span>
                  <strong className="emerald">{fmtUsd(rollResult.finalEquity, 0)}</strong>
                  <small>初始本金 {fmtUsd(cfg.rollInitUsd, 0)} → 翻 {rollResult.finalMultiple.toFixed(2)} 倍</small>
                </div>
                <div className="calc-kpi">
                  <span>已安全落袋锁死利润</span>
                  <strong className="gold">{fmtUsd(rollResult.lockedProfit, 0)}</strong>
                  <small>哪怕最后回撤打止损，落袋部分保底不吐回</small>
                </div>
                <div className="calc-kpi">
                  <span>终点目标参考价</span>
                  <strong>${fmtPx(rollResult.finalPrice)}</strong>
                  <small>单轮净推演波幅 {cfg.rollMovePct}% × {cfg.rollStages} 轮</small>
                </div>
                <div className="calc-kpi">
                  <span>铁律提醒</span>
                  <strong className="up">大势顺风才滚</strong>
                  <small>每次加滚后必须把止损上移/下移到最新加仓保本位</small>
                </div>
              </div>

              <div className="etf-table-wrap">
                <table className="etf-table">
                  <thead>
                    <tr>
                      <th>轮次</th>
                      <th>入场价 → 目标价</th>
                      <th>本轮投入保证金</th>
                      <th>名义仓位 ({cfg.rollLeverage}x)</th>
                      <th>本轮净盈利 (扣费)</th>
                      <th>累计已落袋利润</th>
                      <th>完成后总权益 (倍数)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollResult.rows.map((r) => (
                      <tr key={r.stage}>
                        <td>
                          <strong>第 {r.stage} 轮</strong>
                        </td>
                        <td className="mono">
                          ${fmtPx(r.entryPx)} → ${fmtPx(r.exitPx)}
                        </td>
                        <td className="mono">{fmtUsd(r.margin, 0)}</td>
                        <td className="mono">{fmtUsd(r.notional, 0)}</td>
                        <td className="mono emerald">+{fmtUsd(r.netProfit, 0)}</td>
                        <td className="mono gold">{fmtUsd(r.lockedProfit, 0)}</td>
                        <td className="mono">
                          <b>{fmtUsd(r.totalEquity, 0)}</b> ({r.multiple.toFixed(2)}x)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
