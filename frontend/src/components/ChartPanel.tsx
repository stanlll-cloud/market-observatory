import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type {
  AnalyzeResponse,
  AnalysisData,
  Candle,
  LayerToggles,
  LangType,
  MeasurePoint,
  PaperTradePosition,
  PriceAlertItem,
  RrToolState,
  TradePlan,
} from '../types';

const INTERVAL_STEP_SEC: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};

function fmtBarClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}:${mmss}`;
  if (h > 0) return `${String(h).padStart(2, '0')}:${mmss}`;
  return mmss;
}

interface ChartPanelProps {
  data: AnalyzeResponse | null;
  interval: string;
  layers: LayerToggles;
  lang: LangType;
  activePlanSide: 'bull' | 'bear';
  onChangePlanSide: (side: 'bull' | 'bear') => void;
  chartExpanded?: boolean;
  onToggleExpand?: () => void;
  loading?: boolean;
  alerts?: PriceAlertItem[];
  pickAlertMode?: boolean;
  onPickAlertPrice?: (price: number) => void;
  paperPosition?: PaperTradePosition | null;
  compact?: boolean;
  visible?: boolean;
  layoutKey?: string;
  compareCandles?: Candle[];
  compareSymbol?: string;
  rrTool?: RrToolState;
  onPickRrPrice?: (price: number) => void;
  measureMode?: boolean;
  measurePts?: MeasurePoint[];
  onPickMeasurePoint?: (pt: MeasurePoint) => void;
  onClearMeasure?: () => void;
}

/** Isolated 1s timer leaf so main K-line ChartPanel NEVER re-renders every second */
const BarCloseTimer: React.FC<{
  lastTime?: number;
  stepSec: number;
  isUs: boolean;
  lang: LangType;
}> = memo(({ lastTime, stepSec, isUs, lang }) => {
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!lastTime) return null;
  const rem = lastTime + stepSec - nowSec;
  const text =
    rem > 0 && rem <= stepSec
      ? `⏱️ ${lang === 'zh' ? '收线' : 'Bar'} ${fmtBarClock(rem)}`
      : `⏱️ ${lang === 'zh' ? (isUs ? '休市/已定型' : '新Bar待成') : 'Closed'}`;

  return (
    <span className="bar-countdown-pill" title={lang === 'zh' ? '当前周期K线收线倒计时' : 'Current bar close countdown'}>
      {text}
    </span>
  );
});

const fmtPrice = (v: number) => {
  if (!v) return '0.00';
  if (v >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
};

export const ChartPanel: React.FC<ChartPanelProps> = ({
  data,
  interval,
  layers,
  lang,
  activePlanSide,
  onChangePlanSide,
  chartExpanded = false,
  onToggleExpand,
  loading = false,
  alerts = [],
  pickAlertMode = false,
  onPickAlertPrice,
  paperPosition = null,
  compact = false,
  visible = true,
  layoutKey = '',
  compareCandles,
  compareSymbol = '',
  rrTool,
  onPickRrPrice,
  measureMode = false,
  measurePts = [],
  onPickMeasurePoint,
  onClearMeasure,
}) => {
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const alertLinesRef = useRef<IPriceLine[]>([]);

  const pickAlertModeRef = useRef<boolean>(false);
  const onPickAlertPriceRef = useRef(onPickAlertPrice);
  pickAlertModeRef.current = pickAlertMode;
  onPickAlertPriceRef.current = onPickAlertPrice;

  const rrPickRef = useRef<'entry' | 'stop' | 'target' | null>(null);
  const onPickRrRef = useRef(onPickRrPrice);
  rrPickRef.current = rrTool?.pickField || null;
  onPickRrRef.current = onPickRrPrice;

  const measureModeRef = useRef<boolean>(false);
  const onPickMeasureRef = useRef(onPickMeasurePoint);
  measureModeRef.current = measureMode;
  onPickMeasureRef.current = onPickMeasurePoint;

  const candlesRef = useRef<Candle[]>([]);
  candlesRef.current = data?.candles || [];

  const shiftDownRef = useRef<boolean>(false);
  const [shiftHeld, setShiftHeld] = useState<boolean>(false);
  const [vpvrNoteCollapsed, setVpvrNoteCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('obs_vpvr_note_collapsed') === '1';
    } catch {
      return false;
    }
  });

  const prevChartKeyRef = useRef<string>('');
  const prevAnalysisRef = useRef<AnalysisData | null>(null);
  const prevLayersKeyRef = useRef<string>('');
  const prevPlanSideRef = useRef<string>('');
  const prevCompareRef = useRef<string>('');

  // Re-sync container dimensions instantaneously on tab switch or dual-chart toggle
  useEffect(() => {
    if (!visible) return;
    const syncSize = () => {
      if (
        mainChartRef.current &&
        mainContainerRef.current &&
        mainContainerRef.current.clientWidth > 0 &&
        mainContainerRef.current.clientHeight > 0
      ) {
        mainChartRef.current.applyOptions({
          width: mainContainerRef.current.clientWidth,
          height: mainContainerRef.current.clientHeight,
        });
        if (mainContainerRef.current.clientWidth < 520) {
          setPlanCollapsed(true);
        }
      }
      if (
        macdChartRef.current &&
        macdContainerRef.current &&
        macdContainerRef.current.clientWidth > 0 &&
        macdContainerRef.current.clientHeight > 0
      ) {
        macdChartRef.current.applyOptions({
          width: macdContainerRef.current.clientWidth,
          height: macdContainerRef.current.clientHeight,
        });
      }
    };
    const raf1 = window.requestAnimationFrame(syncSize);
    const raf2 = window.setTimeout(syncSize, 60);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(raf2);
    };
  }, [visible, layoutKey]);

  const [planCollapsed, setPlanCollapsed] = useState<boolean>(
    () => typeof window !== 'undefined' && (window.innerWidth <= 960 || compact)
  );

  const [hoverOhlc, setHoverOhlc] = useState<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);

  useEffect(() => {
    if (!mainContainerRef.current || !macdContainerRef.current) return;

    const commonLayout = {
      background: { type: ColorType.Solid, color: '#07110e' },
      textColor: '#7ca094',
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
      fontSize: 11,
    };

    const fmtCrosshairTime = (t: Time) => {
      if (typeof t !== 'number') return String(t);
      const d = new Date(t * 1000);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${m}/${day} ${hh}:${mm}`;
    };

    const fmtTickMark = (t: Time, tickMarkType: TickMarkType) => {
      if (typeof t !== 'number') return String(t);
      const d = new Date(t * 1000);
      if (tickMarkType === TickMarkType.Year) return `${d.getFullYear()}年`;
      if (tickMarkType === TickMarkType.Month) return `${d.getMonth() + 1}月`;
      if (tickMarkType === TickMarkType.DayOfMonth) return `${d.getMonth() + 1}/${d.getDate()}`;
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    const mainChart = createChart(mainContainerRef.current, {
      layout: commonLayout,
      localization: {
        timeFormatter: fmtCrosshairTime,
      },
      grid: {
        vertLines: { color: 'rgba(28, 62, 50, 0.28)' },
        horzLines: { color: 'rgba(28, 62, 50, 0.28)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(24, 201, 143, 0.35)', width: 1, style: LineStyle.Dashed },
        horzLine: { color: 'rgba(24, 201, 143, 0.35)', width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: '#162f27',
        scaleMargins: { top: 0.08, bottom: 0.08 },
        autoScale: true,
      },
      timeScale: {
        borderColor: '#162f27',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 16,
        minBarSpacing: 1.5,
        tickMarkFormatter: fmtTickMark,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
    });

    const macdChart = createChart(macdContainerRef.current, {
      layout: commonLayout,
      localization: {
        timeFormatter: fmtCrosshairTime,
      },
      grid: {
        vertLines: { color: 'rgba(28, 62, 50, 0.22)' },
        horzLines: { color: 'rgba(28, 62, 50, 0.22)' },
      },
      rightPriceScale: {
        borderColor: '#162f27',
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: '#162f27',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 16,
        tickMarkFormatter: fmtTickMark,
      },
    });

    mainChartRef.current = mainChart;
    macdChartRef.current = macdChart;

    mainChart.subscribeClick((param) => {
      if (!param?.point || !candleSeriesRef.current) return;
      const p = candleSeriesRef.current.coordinateToPrice(param.point.y);
      if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return;
      const rounded = p >= 100 ? Number(p.toFixed(2)) : p >= 1 ? Number(p.toFixed(3)) : Number(p.toFixed(4));

      if (pickAlertModeRef.current && onPickAlertPriceRef.current) {
        onPickAlertPriceRef.current(rounded);
        return;
      }
      if (rrPickRef.current && onPickRrRef.current) {
        onPickRrRef.current(rounded);
        return;
      }
      if ((measureModeRef.current || shiftDownRef.current) && onPickMeasureRef.current) {
        const list = candlesRef.current;
        if (!list.length) return;
        const idx =
          typeof param.logical === 'number'
            ? Math.max(0, Math.min(list.length - 1, Math.round(param.logical)))
            : list.length - 1;
        const bar = list[idx];
        onPickMeasureRef.current({
          time: Number(param.time || bar.time),
          price: rounded,
          index: idx,
        });
      }
    });

    // Sync time scales
    let syncing = false;
    mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      macdChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });
    macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      mainChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });

    const ro = new ResizeObserver(() => {
      if (
        mainContainerRef.current &&
        mainContainerRef.current.clientWidth > 0 &&
        mainContainerRef.current.clientHeight > 0
      ) {
        mainChart.applyOptions({
          width: mainContainerRef.current.clientWidth,
          height: mainContainerRef.current.clientHeight,
        });
      }
      if (
        macdContainerRef.current &&
        macdContainerRef.current.clientWidth > 0 &&
        macdContainerRef.current.clientHeight > 0
      ) {
        macdChart.applyOptions({
          width: macdContainerRef.current.clientWidth,
          height: macdContainerRef.current.clientHeight,
        });
      }
    });
    ro.observe(mainContainerRef.current);
    ro.observe(macdContainerRef.current);

    return () => {
      ro.disconnect();
      mainChart.remove();
      macdChart.remove();
      mainChartRef.current = null;
      macdChartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mainChart = mainChartRef.current;
    const macdChart = macdChartRef.current;
    if (!mainChart || !macdChart || !data || !data.candles.length) return;
    if (data.meta.interval && data.meta.interval !== interval) return;

    const chartKey = `${data.meta.market || ''}_${data.meta.symbol}_${data.meta.interval || interval}`;
    const layersKey = JSON.stringify(layers);
    const compareKey = layers.compare && compareCandles?.length ? `${compareSymbol}:${compareCandles.length}:${compareCandles[compareCandles.length - 1].close}` : '';
    const isSameChart = chartKey === prevChartKeyRef.current;

    // Fast path: live tick on same symbol/interval/layers/plan -> update last candle in place!
    if (
      isSameChart &&
      candleSeriesRef.current &&
      data.analysis === prevAnalysisRef.current &&
      layersKey === prevLayersKeyRef.current &&
      activePlanSide === prevPlanSideRef.current &&
      compareKey === prevCompareRef.current
    ) {
      const lastC = data.candles[data.candles.length - 1];
      candleSeriesRef.current.update({
        time: lastC.time as UTCTimestamp,
        open: lastC.open,
        high: lastC.high,
        low: lastC.low,
        close: lastC.close,
      });
      return;
    }

    // Save current zoom & scroll range before rebuilding series on same chart
    const savedRange = isSameChart ? mainChart.timeScale().getVisibleLogicalRange() : null;

    prevChartKeyRef.current = chartKey;
    prevAnalysisRef.current = data.analysis;
    prevLayersKeyRef.current = layersKey;
    prevPlanSideRef.current = activePlanSide;
    prevCompareRef.current = compareKey;

    const clearChart = (c: IChartApi) => {
      const panes = c.panes();
      for (const p of panes) {
        for (const s of [...p.getSeries()]) {
          c.removeSeries(s);
        }
      }
    };
    alertLinesRef.current = [];
    clearChart(mainChart);
    clearChart(macdChart);

    // 1. Candlesticks (红涨绿跌高分离度：涨=亮朱红 #ff3b5c, 跌=亮青绿 #00e5a3)
    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: '#ff3b5c',
      downColor: '#00e5a3',
      borderUpColor: '#ff3b5c',
      borderDownColor: '#00e5a3',
      wickUpColor: '#ff3b5c',
      wickDownColor: '#00e5a3',
    });
    candleSeriesRef.current = candleSeries;

    const candleData = data.candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    const lastC = data.candles[data.candles.length - 1];
    setHoverOhlc({
      time: new Date(lastC.time * 1000).toLocaleString('zh-CN', { hour12: false }),
      open: lastC.open,
      high: lastC.high,
      low: lastC.low,
      close: lastC.close,
    });

    mainChart.subscribeCrosshairMove((param) => {
      if (!param.time) return;
      const bar = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (bar) {
        setHoverOhlc({
          time: new Date((param.time as number) * 1000).toLocaleString('zh-CN', { hour12: false }),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        });
      }
    });

    // 1.5 Dual Moving Average (高对比加粗：快线=纯白3px, 慢线=亮金黄3px)
    if (layers.dual_ma && data.analysis.dual_ma && data.analysis.dual_ma.fast_line.length > 0) {
      const fastSeries = mainChart.addSeries(LineSeries, {
        color: '#ffffff',
        lineWidth: 3,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      fastSeries.setData(
        data.analysis.dual_ma.fast_line.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      );

      const slowSeries = mainChart.addSeries(LineSeries, {
        color: '#ffd400',
        lineWidth: 3,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      slowSeries.setData(
        data.analysis.dual_ma.slow_line.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      );
    }

    // 1.7 Institutional VWAP Line (天蓝色点线 #38bdf8)
    if (layers.vwap && data.analysis.vwap && data.analysis.vwap.line.length > 0) {
      const vwapSeries = mainChart.addSeries(LineSeries, {
        color: '#38bdf8',
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      });
      vwapSeries.setData(
        data.analysis.vwap.line.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      );
    }

    // 1.8 TradingView Benchmark Compare Overlay (紫色虚线叠加 BTC / QQQ)
    if (layers.compare && compareCandles && compareCandles.length > 10 && data.candles.length > 10) {
      const cmpSorted = [...compareCandles].sort((a, b) => a.time - b.time);
      const startIdx = Math.max(0, data.candles.length - 120);
      let cmpPtr = 0;
      let baseMain = 0;
      let baseCmp = 0;
      const rebasedPts: { time: UTCTimestamp; value: number }[] = [];

      for (let i = startIdx; i < data.candles.length; i++) {
        const bar = data.candles[i];
        while (cmpPtr + 1 < cmpSorted.length && cmpSorted[cmpPtr + 1].time <= bar.time) {
          cmpPtr++;
        }
        const cmpBar = cmpSorted[cmpPtr];
        if (!cmpBar || Math.abs(cmpBar.time - bar.time) > 172800) continue;
        if (!baseMain) {
          baseMain = bar.close;
          baseCmp = cmpBar.close;
        }
        if (baseMain > 0 && baseCmp > 0) {
          rebasedPts.push({
            time: bar.time as UTCTimestamp,
            value: (cmpBar.close / baseCmp) * baseMain,
          });
        }
      }

      if (rebasedPts.length >= 2) {
        const cmpSeries = mainChart.addSeries(LineSeries, {
          color: '#a78bfa',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: `对比 ${compareSymbol}`,
        });
        cmpSeries.setData(rebasedPts);
      }
    }

    // 2. Strokes (笔: 亮品红细线，与均线彻底区分)
    if (layers.strokes && data.analysis.strokes.length > 0) {
      const strokeSeries = mainChart.addSeries(LineSeries, {
        color: '#ff5ca8',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const pts: { time: UTCTimestamp; value: number }[] = [];
      data.analysis.strokes.forEach((s, idx) => {
        if (idx === 0) {
          pts.push({ time: s.start_time as UTCTimestamp, value: s.start_price });
        }
        pts.push({ time: s.end_time as UTCTimestamp, value: s.end_price });
      });
      // Deduplicate strictly increasing timestamps
      const uniq: { time: UTCTimestamp; value: number }[] = [];
      for (const p of pts) {
        if (!uniq.length || p.time > uniq[uniq.length - 1].time) {
          uniq.push(p);
        }
      }
      strokeSeries.setData(uniq);
    }

    // 3. Segments (线段: 浅灰蓝虚线)
    if (layers.segments && data.analysis.segments.length > 0) {
      const segSeries = mainChart.addSeries(LineSeries, {
        color: '#94a3b8',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const pts: { time: UTCTimestamp; value: number }[] = [];
      data.analysis.segments.forEach((seg, idx) => {
        if (idx === 0) {
          pts.push({ time: seg.start_time as UTCTimestamp, value: seg.start_price });
        }
        pts.push({ time: seg.end_time as UTCTimestamp, value: seg.end_price });
      });
      const uniq: { time: UTCTimestamp; value: number }[] = [];
      for (const p of pts) {
        if (!uniq.length || p.time > uniq[uniq.length - 1].time) {
          uniq.push(p);
        }
      }
      segSeries.setData(uniq);
    }

    // 4. Centers (中枢 ZG/ZD 水平边界线)
    if (layers.centers && data.analysis.centers.length > 0) {
      for (const c of data.analysis.centers) {
        if (c.end_time <= c.start_time) continue;
        const zgLine = mainChart.addSeries(LineSeries, {
          color: 'rgba(16, 185, 129, 0.72)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        zgLine.setData([
          { time: c.start_time as UTCTimestamp, value: c.zg },
          { time: c.end_time as UTCTimestamp, value: c.zg },
        ]);

        const zdLine = mainChart.addSeries(LineSeries, {
          color: 'rgba(244, 91, 105, 0.72)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        zdLine.setData([
          { time: c.start_time as UTCTimestamp, value: c.zd },
          { time: c.end_time as UTCTimestamp, value: c.zd },
        ]);
      }
    }

    // 4.5 Fibonacci Retracement (0.382 / 0.5 / 0.618)
    if (layers.fib && data.analysis.fibonacci?.levels?.length) {
      for (const lv of data.analysis.fibonacci.levels) {
        const isGolden = lv.ratio === '0.618';
        candleSeries.createPriceLine({
          price: lv.price,
          color: isGolden ? '#c084fc' : 'rgba(148, 163, 184, 0.55)',
          lineWidth: 1,
          lineStyle: isGolden ? LineStyle.Dashed : LineStyle.Dotted,
          axisLabelVisible: true,
          title: `Fib ${lv.ratio}`,
        });
      }
    }

    // 5. Markers: Fractals (分型) & Signals (历史信号)
    const markers: SeriesMarker<Time>[] = [];
    if (layers.fractals) {
      for (const f of data.analysis.fractals.slice(-40)) {
        markers.push({
          time: f.time as UTCTimestamp,
          position: f.type === 'top' ? 'aboveBar' : 'belowBar',
          color: f.type === 'top' ? '#00e5a3' : '#ff3b5c',
          shape: f.type === 'top' ? 'arrowDown' : 'arrowUp',
          size: 0.6,
        });
      }
    }
    if (layers.signals) {
      for (const sig of data.analysis.signals) {
        markers.push({
          time: sig.time as UTCTimestamp,
          position: sig.type === 'top_div' ? 'aboveBar' : 'belowBar',
          color: sig.type === 'top_div' ? '#fb7185' : '#34d399',
          shape: 'circle',
          text: sig.label,
          size: 1.2,
        });
      }
    }
    if (layers.dual_ma && data.analysis.dual_ma?.crosses) {
      for (const cr of data.analysis.dual_ma.crosses) {
        markers.push({
          time: cr.time as UTCTimestamp,
          position: cr.type === 'golden' ? 'belowBar' : 'aboveBar',
          color: cr.type === 'golden' ? '#00b4ff' : '#ffd400',
          shape: cr.type === 'golden' ? 'arrowUp' : 'arrowDown',
          text: cr.label,
          size: 1.2,
        });
      }
    }
    if (layers.regime && data.analysis.regime?.markers?.length) {
      for (const rm of data.analysis.regime.markers) {
        markers.push({
          time: rm.time as UTCTimestamp,
          position: 'aboveBar',
          color: '#ffd400',
          shape: 'square',
          text: rm.label,
          size: 0.9,
        });
      }
    }
    // 5.5 图上 20 / 60 均线扣抵光标箭头
    if (layers.deduct && data.candles.length > 22) {
      const lastClose = data.candles[data.candles.length - 1].close;
      const fastP = data.analysis.dual_ma?.fast_period || 20;
      const slowP = data.analysis.dual_ma?.slow_period || 60;
      const idxF = data.candles.length - 1 - fastP;
      if (idxF >= 0) {
        const cF = data.candles[idxF];
        const isLow = lastClose >= cF.close;
        markers.push({
          time: cF.time as UTCTimestamp,
          position: 'aboveBar',
          color: '#ffffff',
          shape: 'arrowDown',
          text: `📍${fastP}扣(${isLow ? '低' : '高'})`,
          size: 1.0,
        });
      }
      const idxS = data.candles.length - 1 - slowP;
      if (idxS >= 0) {
        const cS = data.candles[idxS];
        const isLowS = lastClose >= cS.close;
        markers.push({
          time: cS.time as UTCTimestamp,
          position: 'belowBar',
          color: '#ffd400',
          shape: 'arrowUp',
          text: `📍${slowP}扣(${isLowS ? '低' : '高'})`,
          size: 1.0,
        });
      }
    }
    if (markers.length > 0) {
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candleSeries, markers);
    }

    // 6. Trade Plan Price Lines & Projection Paths
    const activePlan: TradePlan | undefined =
      activePlanSide === 'bull' ? data.analysis.plans?.bull_plan : data.analysis.plans?.bear_plan;

    if (layers.plan && activePlan) {
      const isBull = activePlanSide === 'bull';
      candleSeries.createPriceLine({
        price: activePlan.t2,
        color: '#00b4ff',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: lang === 'zh' ? (isBull ? '多单目标T2' : '空单目标T2') : 'T2',
      });
      candleSeries.createPriceLine({
        price: activePlan.t1,
        color: '#38bdf8',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: lang === 'zh' ? (isBull ? '多单目标T1' : '空单目标T1') : 'T1',
      });
      candleSeries.createPriceLine({
        price: (activePlan.entry_low + activePlan.entry_high) / 2,
        color: '#ffffff',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: lang === 'zh' ? (isBull ? '做多买入' : '开空入场') : isBull ? 'Buy' : 'Short',
      });
      candleSeries.createPriceLine({
        price: activePlan.stop_loss,
        color: '#ff6b2b',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: lang === 'zh' ? (isBull ? '多单止损' : '空单止损') : 'SL',
      });
    }

    if (layers.projection && activePlan) {
      const p1 = mainChart.addSeries(LineSeries, {
        color: '#18c98f',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      p1.setData(
        activePlan.projection_paths.primary.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      );

      const p2 = mainChart.addSeries(LineSeries, {
        color: '#f45b69',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      p2.setData(
        activePlan.projection_paths.secondary.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      );
    }

    // 7. MACD Sub-chart
    if (data.macd.length > 0) {
      const histSeries = macdChart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
      });
      histSeries.setData(
        data.macd.map((m) => ({
          time: m.time as UTCTimestamp,
          value: m.hist,
          color: m.hist >= 0 ? 'rgba(255, 59, 92, 0.68)' : 'rgba(0, 229, 163, 0.68)',
        }))
      );

      const difSeries = macdChart.addSeries(LineSeries, {
        color: '#e6f2ee',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      difSeries.setData(data.macd.map((m) => ({ time: m.time as UTCTimestamp, value: m.dif })));

      const deaSeries = macdChart.addSeries(LineSeries, {
        color: '#f5b041',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      deaSeries.setData(data.macd.map((m) => ({ time: m.time as UTCTimestamp, value: m.dea })));
    }

    if (
      isSameChart &&
      savedRange &&
      savedRange.to > 2 &&
      savedRange.from < data.candles.length - 1
    ) {
      mainChart.timeScale().setVisibleLogicalRange(savedRange);
    } else {
      mainChart.priceScale('right').applyOptions({ autoScale: true });
      if (data.candles.length > 120) {
        mainChart.timeScale().setVisibleLogicalRange({
          from: data.candles.length - 120,
          to: data.candles.length + 10,
        });
      } else {
        mainChart.timeScale().fitContent();
      }
    }
  }, [data, interval, layers, activePlanSide, lang, compareCandles, compareSymbol]);

  // Shift key state for quick Shift + Click Measure Ruler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shiftDownRef.current = e.shiftKey;
      setShiftHeld(e.shiftKey);
    };
    const onBlur = () => {
      shiftDownRef.current = false;
      setShiftHeld(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // HUD Canvas: VPVR Volume Profile (with Chinese annotations) + R:R Box + Shift Measure Box
  const drawHud = useCallback(() => {
    const canvas = hudCanvasRef.current;
    const container = mainContainerRef.current;
    const mainChart = mainChartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !container || !mainChart || !series) return;

    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    if (cssW <= 20 || cssH <= 20) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const candles = data?.candles || [];
    if (!candles.length) return;

    const drawPill = (text: string, x: number, y: number, fg: string, bg: string, border: string, alignRight = false) => {
      ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      const padX = 7;
      const metrics = ctx.measureText(text);
      const boxW = metrics.width + padX * 2;
      const boxH = 18;
      const drawX = alignRight ? x - boxW : x;
      const drawY = Math.max(4, Math.min(cssH - boxH - 4, y - boxH / 2));

      ctx.fillStyle = bg;
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(drawX, drawY, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = fg;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, drawX + padX, drawY + boxH / 2 + 0.5);
    };

    // 1. VPVR 筹码分布密集峰 (Visible Range Volume Profile + Direct Annotations)
    if (layers.vpvr && candles.length >= 6) {
      const range = mainChart.timeScale().getVisibleLogicalRange();
      const fromIdx = Math.max(0, Math.floor(range?.from ?? Math.max(0, candles.length - 120)));
      const toIdx = Math.min(candles.length - 1, Math.ceil(range?.to ?? candles.length - 1));
      const vis = toIdx - fromIdx >= 4 ? candles.slice(fromIdx, toIdx + 1) : candles.slice(-120);

      let minP = Infinity;
      let maxP = -Infinity;
      for (const c of vis) {
        if (c.low < minP) minP = c.low;
        if (c.high > maxP) maxP = c.high;
      }

      if (Number.isFinite(minP) && Number.isFinite(maxP) && maxP > minP) {
        const BINS = 24;
        const step = (maxP - minP) / BINS;
        const bins = Array.from({ length: BINS }, (_, i) => ({
          idx: i,
          low: minP + i * step,
          high: minP + (i + 1) * step,
          upVol: 0,
          downVol: 0,
          total: 0,
        }));

        for (const c of vis) {
          const vol = Math.max(1, c.volume || 1);
          const loB = Math.max(0, Math.min(BINS - 1, Math.floor((c.low - minP) / step)));
          const hiB = Math.max(0, Math.min(BINS - 1, Math.floor((c.high - minP) / step)));
          const span = hiB - loB + 1;
          const partVol = vol / span;
          const isUp = c.close >= c.open;
          for (let b = loB; b <= hiB; b++) {
            if (isUp) bins[b].upVol += partVol;
            else bins[b].downVol += partVol;
            bins[b].total += partVol;
          }
        }

        let maxBinVol = 0;
        let totalVol = 0;
        let pocIdx = 0;
        for (let i = 0; i < BINS; i++) {
          totalVol += bins[i].total;
          if (bins[i].total > maxBinVol) {
            maxBinVol = bins[i].total;
            pocIdx = i;
          }
        }

        // 70% Value Area expansion around POC
        let vaLo = pocIdx;
        let vaHi = pocIdx;
        let vaVol = bins[pocIdx].total;
        while (vaVol < totalVol * 0.7 && (vaLo > 0 || vaHi < BINS - 1)) {
          const leftV = vaLo > 0 ? bins[vaLo - 1].total : -1;
          const rightV = vaHi < BINS - 1 ? bins[vaHi + 1].total : -1;
          if (rightV >= leftV && rightV >= 0) {
            vaHi++;
            vaVol += rightV;
          } else if (leftV >= 0) {
            vaLo--;
            vaVol += leftV;
          } else {
            break;
          }
        }

        const rightEdge = cssW - 68;
        const maxBarW = compact ? Math.min(72, cssW * 0.16) : Math.min(130, cssW * 0.21);

        if (maxBinVol > 0 && rightEdge > 120) {
          for (let i = 0; i < BINS; i++) {
            const b = bins[i];
            if (b.total <= 0) continue;
            const yTop = series.priceToCoordinate(b.high);
            const yBot = series.priceToCoordinate(b.low);
            if (yTop === null || yBot === null) continue;
            const barY = Math.min(yTop, yBot) + 1;
            const barH = Math.max(2, Math.abs(yBot - yTop) - 2);
            const totalW = Math.max(2, (b.total / maxBinVol) * maxBarW);
            const upW = totalW * (b.upVol / b.total);
            const downW = totalW - upW;
            const inVa = i >= vaLo && i <= vaHi;
            const isPoc = i === pocIdx;
            const alpha = isPoc ? 0.62 : inVa ? 0.36 : 0.14;

            ctx.fillStyle = `rgba(0, 229, 163, ${alpha})`;
            ctx.fillRect(rightEdge - downW, barY, downW, barH);
            ctx.fillStyle = `rgba(255, 59, 92, ${alpha})`;
            ctx.fillRect(rightEdge - totalW, barY, upW, barH);

            if (isPoc) {
              ctx.strokeStyle = '#ffd400';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(rightEdge - totalW, barY, totalW, barH);
            }
          }

          // Guide Lines + Plain-Chinese Direct Chart Annotations
          const pocPrice = (bins[pocIdx].low + bins[pocIdx].high) / 2;
          const vahPrice = bins[vaHi].high;
          const valPrice = bins[vaLo].low;
          const yPoc = series.priceToCoordinate(pocPrice);
          const yVah = series.priceToCoordinate(vahPrice);
          const yVal = series.priceToCoordinate(valPrice);
          const lastClose = candles[candles.length - 1].close;
          const ema20Val = data?.analysis.dual_ma?.fast_val || 0;
          const isEmaResonant = ema20Val > 0 && Math.abs(ema20Val - pocPrice) / pocPrice <= 0.015;
          const showFullLabels = !compact && cssW >= 480;

          if (yVah !== null && yVah > 8 && yVah < cssH - 8) {
            ctx.save();
            ctx.setLineDash([3, 4]);
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.52)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(10, yVah);
            ctx.lineTo(rightEdge, yVah);
            ctx.stroke();
            ctx.restore();
            if (showFullLabels) {
              drawPill(
                `▲ VAH 70%筹码上沿 $${fmtPrice(vahPrice)} (放量站上加速)`,
                12,
                yVah,
                '#bae6fd',
                'rgba(8, 28, 38, 0.88)',
                'rgba(56, 189, 248, 0.45)'
              );
            }
          }

          if (yVal !== null && yVal > 8 && yVal < cssH - 8) {
            ctx.save();
            ctx.setLineDash([3, 4]);
            ctx.strokeStyle = 'rgba(0, 229, 163, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(10, yVal);
            ctx.lineTo(rightEdge, yVal);
            ctx.stroke();
            ctx.restore();
            if (showFullLabels && (yVah === null || Math.abs(yVal - yVah) > 22)) {
              drawPill(
                `▼ VAL 70%筹码下沿 $${fmtPrice(valPrice)} (跌破防跳水)`,
                12,
                yVal,
                '#a7f3d0',
                'rgba(6, 26, 20, 0.88)',
                'rgba(0, 229, 163, 0.45)'
              );
            }
          }

          if (yPoc !== null && yPoc > 8 && yPoc < cssH - 8) {
            ctx.save();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#ffd400';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(10, yPoc);
            ctx.lineTo(rightEdge, yPoc);
            ctx.stroke();
            ctx.restore();

            let labelY: number = yPoc;
            if (yVah !== null && Math.abs(labelY - yVah) < 20) labelY = Number(yPoc) + 18;
            const roleTxt = lastClose >= pocPrice ? '现价在上=强支撑' : '现价在下=套牢压力墙';
            const resTxt = isEmaResonant ? ' · ★与白线共振' : '';
            drawPill(
              showFullLabels
                ? `🎯 POC 庄家成本峰 $${fmtPrice(pocPrice)} · ${roleTxt}${resTxt}`
                : `🎯 POC $${fmtPrice(pocPrice)}`,
              12,
              labelY,
              '#ffd400',
              'rgba(22, 20, 6, 0.92)',
              'rgba(255, 212, 0, 0.65)'
            );
          }
        }
      }
    }

    // 2. TradingView Long/Short Risk-Reward Ruler Box
    if (rrTool?.enabled && rrTool.entry > 0 && rrTool.stop > 0 && rrTool.target > 0) {
      const yEntry = series.priceToCoordinate(rrTool.entry);
      const yStop = series.priceToCoordinate(rrTool.stop);
      const yTarget = series.priceToCoordinate(rrTool.target);
      if (yEntry !== null && yStop !== null && yTarget !== null) {
        const boxX = Math.max(90, cssW * 0.28);
        const boxW = Math.min(340, cssW * 0.44);

        // Profit zone (Red-Up tint)
        const pTop = Math.min(yEntry, yTarget);
        const pH = Math.max(4, Math.abs(yTarget - yEntry));
        ctx.fillStyle = 'rgba(255, 59, 92, 0.16)';
        ctx.fillRect(boxX, pTop, boxW, pH);
        ctx.strokeStyle = 'rgba(255, 59, 92, 0.72)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(boxX, pTop, boxW, pH);

        // Risk/Stop zone (Cyan-Green tint)
        const sTop = Math.min(yEntry, yStop);
        const sH = Math.max(4, Math.abs(yStop - yEntry));
        ctx.fillStyle = 'rgba(0, 229, 163, 0.14)';
        ctx.fillRect(boxX, sTop, boxW, sH);
        ctx.strokeStyle = 'rgba(0, 229, 163, 0.72)';
        ctx.strokeRect(boxX, sTop, boxW, sH);

        // Entry mid line
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(boxX, yEntry);
        ctx.lineTo(boxX + boxW, yEntry);
        ctx.stroke();

        const riskDist = Math.abs(rrTool.entry - rrTool.stop);
        const rewDist = Math.abs(rrTool.target - rrTool.entry);
        const rrRatio = riskDist > 0 ? rewDist / riskDist : 0;
        const stopPct = (riskDist / rrTool.entry) * 100;
        const rewPct = (rewDist / rrTool.entry) * 100;

        drawPill(
          `🎯 止盈 $${fmtPrice(rrTool.target)} (+${rewPct.toFixed(1)}%)`,
          boxX + boxW / 2 - 75,
          yTarget,
          '#ff8fa3',
          'rgba(32, 8, 14, 0.92)',
          'rgba(255, 59, 92, 0.65)'
        );
        drawPill(
          `📐 ${rrTool.side === 'LONG' ? '多头' : '空头'} 盈亏比 ${rrRatio.toFixed(2)} : 1`,
          boxX + 8,
          yEntry,
          '#ffffff',
          'rgba(10, 24, 20, 0.94)',
          '#ffffff'
        );
        drawPill(
          `🛑 止损 $${fmtPrice(rrTool.stop)} (-${stopPct.toFixed(1)}%)`,
          boxX + boxW / 2 - 75,
          yStop,
          '#6effd4',
          'rgba(6, 26, 20, 0.92)',
          'rgba(0, 229, 163, 0.65)'
        );
      }
    }

    // 3. Shift + Click Price & Bar Measure Ruler
    if (measurePts && measurePts.length > 0) {
      const a = measurePts[0];
      const xA = mainChart.timeScale().timeToCoordinate(a.time as UTCTimestamp);
      const yA = series.priceToCoordinate(a.price);
      if (xA !== null && yA !== null) {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(xA, yA, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        if (measurePts.length === 1) {
          drawPill(
            `📏 起点 $${fmtPrice(a.price)} · 请再点选终点`,
            xA + 10,
            yA - 14,
            '#e0f2fe',
            'rgba(8, 28, 38, 0.92)',
            '#38bdf8'
          );
        } else {
          const b = measurePts[1];
          const xB = mainChart.timeScale().timeToCoordinate(b.time as UTCTimestamp);
          const yB = series.priceToCoordinate(b.price);
          if (xB !== null && yB !== null) {
            const leftX = Math.min(xA, xB);
            const topY = Math.min(yA, yB);
            const w = Math.max(4, Math.abs(xB - xA));
            const h = Math.max(4, Math.abs(yB - yA));

            ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
            ctx.fillRect(leftX, topY, w, h);
            ctx.save();
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.4;
            ctx.strokeRect(leftX, topY, w, h);
            ctx.beginPath();
            ctx.moveTo(xA, yA);
            ctx.lineTo(xB, yB);
            ctx.stroke();
            ctx.restore();

            ctx.fillStyle = '#ffd400';
            ctx.beginPath();
            ctx.arc(xB, yB, 5, 0, Math.PI * 2);
            ctx.fill();

            const pct = a.price > 0 ? ((b.price - a.price) / a.price) * 100 : 0;
            const bars = Math.abs(b.index - a.index) + 1;
            const days = Math.abs(b.time - a.time) / 86400;
            const spanTxt = days >= 1 ? `约 ${days.toFixed(1)} 天` : `约 ${(days * 24).toFixed(1)} 小时`;
            const summary = `📏 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% | ${bars} 根K线 (${spanTxt})`;
            drawPill(
              summary,
              leftX + w / 2 - 90,
              Math.max(20, topY - 14),
              pct >= 0 ? '#ff8fa3' : '#6effd4',
              'rgba(7, 19, 24, 0.94)',
              '#38bdf8'
            );
          }
        }
      }
    }
  }, [data, layers.vpvr, compact, rrTool, measurePts]);

  // Schedule HUD Canvas redraws on zoom/pan/scale/data updates
  useEffect(() => {
    const mainChart = mainChartRef.current;
    const container = mainContainerRef.current;
    let raf = 0;
    const scheduleDraw = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(drawHud);
    };
    scheduleDraw();

    if (!mainChart || !container) {
      return () => {
        if (raf) window.cancelAnimationFrame(raf);
      };
    }

    const onRange = () => scheduleDraw();
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    container.addEventListener('wheel', scheduleDraw, { passive: true });
    container.addEventListener('pointerup', scheduleDraw);
    container.addEventListener('pointermove', scheduleDraw);

    const ro = new ResizeObserver(scheduleDraw);
    ro.observe(container);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      try {
        mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      } catch {
        // ignore if destroyed
      }
      container.removeEventListener('wheel', scheduleDraw);
      container.removeEventListener('pointerup', scheduleDraw);
      container.removeEventListener('pointermove', scheduleDraw);
      ro.disconnect();
    };
  }, [drawHud]);

  // Relative strength badge vs compare benchmark
  const compareDeltaText = useMemo(() => {
    if (!layers.compare || !compareCandles?.length || !data?.candles?.length) return '';
    const mainC = data.candles;
    const startIdx = Math.max(0, mainC.length - 120);
    const cmpSorted = [...compareCandles].sort((a, b) => a.time - b.time);
    let ptr = 0;
    let baseM = 0;
    let baseC = 0;
    let lastC = 0;
    for (let i = startIdx; i < mainC.length; i++) {
      const b = mainC[i];
      while (ptr + 1 < cmpSorted.length && cmpSorted[ptr + 1].time <= b.time) ptr++;
      const cb = cmpSorted[ptr];
      if (!cb || Math.abs(cb.time - b.time) > 172800) continue;
      if (!baseM) {
        baseM = b.close;
        baseC = cb.close;
      }
      lastC = cb.close;
    }
    if (!baseM || !baseC || !lastC) return '';
    const lastM = mainC[mainC.length - 1].close;
    const retM = ((lastM - baseM) / baseM) * 100;
    const retC = ((lastC - baseC) / baseC) * 100;
    const diff = retM - retC;
    return `vs ${compareSymbol}: ${diff >= 0 ? '领涨 +' : '跑输 '}${diff.toFixed(1)}%`;
  }, [layers.compare, compareCandles, compareSymbol, data]);

  // Overlay Chart Price Alerts (#ffd400 dashed) & Paper Trade Position (#38bdf8 solid)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of alertLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // ignore if series was already recreated
      }
    }
    alertLinesRef.current = [];

    const curSym = data?.meta?.symbol || '';
    const curMkt = data?.meta?.market;
    for (const al of alerts) {
      if (!al.active || al.symbol !== curSym || (curMkt && al.market !== curMkt)) continue;
      const dirLabel = al.direction === 'above' ? (lang === 'zh' ? '上穿' : 'Above') : (lang === 'zh' ? '下破' : 'Below');
      const line = series.createPriceLine({
        price: al.targetPrice,
        color: '#ffd400',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `🔔 ${dirLabel} ${fmtPrice(al.targetPrice)}`,
      });
      alertLinesRef.current.push(line);
    }

    if (paperPosition && paperPosition.entryPrice > 0) {
      const sideLabel =
        paperPosition.side === 'LONG'
          ? lang === 'zh'
            ? '模拟多单均价'
            : 'Paper Long'
          : lang === 'zh'
            ? '模拟空单均价'
            : 'Paper Short';
      const posLine = series.createPriceLine({
        price: paperPosition.entryPrice,
        color: '#38bdf8',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `🎯 ${sideLabel} ${fmtPrice(paperPosition.entryPrice)}`,
      });
      alertLinesRef.current.push(posLine);
    }
  }, [data, interval, layers, activePlanSide, alerts, paperPosition, lang]);

  const handleResetView = () => {
    const mainChart = mainChartRef.current;
    if (!mainChart || !data?.candles.length) return;
    mainChart.priceScale('right').applyOptions({ autoScale: true });
    if (data.candles.length > 120) {
      mainChart.timeScale().setVisibleLogicalRange({
        from: data.candles.length - 120,
        to: data.candles.length + 10,
      });
    } else {
      mainChart.timeScale().fitContent();
    }
  };

  const activePlan: TradePlan | undefined =
    activePlanSide === 'bull' ? data?.analysis.plans?.bull_plan : data?.analysis.plans?.bear_plan;

  const stepSec = INTERVAL_STEP_SEC[interval] || 3600;
  const lastCandle = data?.candles.length ? data.candles[data.candles.length - 1] : null;
  const isCrosshairPick = pickAlertMode || !!rrTool?.pickField || measureMode || shiftHeld;

  return (
    <div className={`chart-panel ${compact ? 'compact' : ''} ${isCrosshairPick ? 'pick-alert-cursor' : ''}`}>
      {/* Top OHLC + Dual MA Readout */}
      <div className="ohlc-bar">
        {hoverOhlc && (
          <>
            <span className="ohlc-time">{hoverOhlc.time}</span>
            <span>
              {lang === 'zh' ? '开' : 'O'} <b>{fmtPrice(hoverOhlc.open)}</b>
            </span>
            <span>
              {lang === 'zh' ? '高' : 'H'} <b className="bull">{fmtPrice(hoverOhlc.high)}</b>
            </span>
            <span>
              {lang === 'zh' ? '低' : 'L'} <b className="bear">{fmtPrice(hoverOhlc.low)}</b>
            </span>
            <span>
              {lang === 'zh' ? '收' : 'C'} <b>{fmtPrice(hoverOhlc.close)}</b>
            </span>
          </>
        )}
        {layers.dual_ma && data?.analysis.dual_ma && (
          <span className="ma-readout">
            <span className="ma-fast">
              {data.analysis.dual_ma.ma_type.toUpperCase()}
              {data.analysis.dual_ma.fast_period}: {fmtPrice(data.analysis.dual_ma.fast_val)}
            </span>
            <span className="ma-slow">
              {data.analysis.dual_ma.ma_type.toUpperCase()}
              {data.analysis.dual_ma.slow_period}: {fmtPrice(data.analysis.dual_ma.slow_val)}
            </span>
          </span>
        )}
        {layers.vwap && data?.analysis.vwap && data.analysis.vwap.current > 0 && (
          <span className="ma-vwap">
            VWAP: {fmtPrice(data.analysis.vwap.current)} ({data.analysis.vwap.dist_pct >= 0 ? '+' : ''}
            {data.analysis.vwap.dist_pct.toFixed(2)}%)
          </span>
        )}
        {compareDeltaText && (
          <span className="compare-delta-pill">{compareDeltaText}</span>
        )}
        <BarCloseTimer
          lastTime={lastCandle?.time}
          stepSec={stepSec}
          isUs={data?.meta.market === 'us'}
          lang={lang}
        />
        <button className="btn-reset-view" onClick={handleResetView} title="Reset Chart Zoom">
          {lang === 'zh' ? '重置视图' : 'Reset View'}
        </button>
        {onToggleExpand && (
          <button
            className={`btn-expand-chart ${chartExpanded ? 'active' : ''}`}
            onClick={onToggleExpand}
            title={lang === 'zh' ? '切换全屏看盘' : 'Toggle Expand Chart'}
          >
            {chartExpanded
              ? lang === 'zh'
                ? '退出全屏'
                : 'Exit Full'
              : lang === 'zh'
              ? '全屏看盘'
              : 'Expand'}
          </button>
        )}
      </div>

      {/* Main K-line Chart + Watermark + Floating Plan Card */}
      <div className="main-chart-wrap">
        <div className="chart-watermark">
          <div className="wm-sym">{data?.meta.symbol || 'BTCUSDT'}</div>
          <div className="wm-sub">MARKET OBSERVATORY</div>
        </div>

        <div ref={mainContainerRef} className="chart-canvas" />
        <canvas ref={hudCanvasRef} className="chart-hud-canvas" />

        {pickAlertMode && (
          <div className="chart-pick-alert-banner">
            {lang === 'zh'
              ? '🎯 点击 K线图任意价位即可立即创建金色预警线 (ESC取消)'
              : '🎯 Click anywhere on the chart to set a Price Alert'}
          </div>
        )}

        {!pickAlertMode && rrTool?.pickField && (
          <div className="chart-pick-alert-banner">
            {lang === 'zh'
              ? `📐 请点击 K线图设定盈亏比尺的「${rrTool.pickField === 'entry' ? '入场价' : rrTool.pickField === 'stop' ? '止损价' : '止盈目标'}」`
              : `📐 Click chart to set R:R ${rrTool.pickField}`}
          </div>
        )}

        {!pickAlertMode && !rrTool?.pickField && (measureMode || shiftHeld) && (
          <div className="chart-pick-alert-banner measure">
            {measurePts.length === 0
              ? '📏 测距尺模式：依次点击起点与终点测算涨跌幅与磨底天数 (ESC退出)'
              : measurePts.length === 1
              ? '📏 已定起点，请点击第 2 个位置完成测距'
              : '📏 测距完成（点击图上重新测，按 ESC 清除）'}
          </div>
        )}

        {layers.vpvr && !compact && (
          <div className={`vpvr-guide-card ${vpvrNoteCollapsed ? 'collapsed' : ''}`}>
            <button
              type="button"
              className="vpvr-guide-toggle"
              onClick={() => {
                setVpvrNoteCollapsed((prev) => {
                  const next = !prev;
                  try {
                    localStorage.setItem('obs_vpvr_note_collapsed', next ? '1' : '0');
                  } catch {
                    // ignore
                  }
                  return next;
                });
              }}
            >
              <span>💡 筹码峰 (VPVR) 看盘注释</span>
              <span>{vpvrNoteCollapsed ? '▾' : '▴'}</span>
            </button>
            {!vpvrNoteCollapsed && (
              <div className="vpvr-guide-body">
                <div>
                  <b className="gold">🟡 金色最长柱 (POC 庄家成本峰)</b>：当前画面成交最密集的价格。K线在它上面就是铁底支撑；在它下面就是套牢压力墙。
                </div>
                <div>
                  <b className="sky">🟦 高亮带 (VAH上沿 ~ VAL下沿)</b>：70% 真实资金扎堆的震荡箱体。放量站上 VAH 易走主升，跌破 VAL 防跳水。
                </div>
                <div>
                  <b className="cyan">🕳️ 最短凹槽 (筹码真空区)</b>：挂单极薄的空白价格带，一旦冲进去常像滑雪一样滑行极快。
                </div>
              </div>
            )}
          </div>
        )}

        {measurePts.length === 2 && onClearMeasure && (
          <button type="button" className="btn-clear-measure" onClick={onClearMeasure}>
            × 清除测距
          </button>
        )}

        {loading && (
          <div className="chart-loading-pill">
            <span>
              {lang === 'zh'
                ? `⏳ 正在同步 ${interval.toUpperCase()} K线数据...`
                : `⏳ Loading ${interval.toUpperCase()} candles...`}
            </span>
          </div>
        )}

        {layers.plan && activePlan && (
          <div className={`plan-overlay ${planCollapsed ? 'collapsed' : ''}`}>
            <div
              className="plan-overlay-head"
              onClick={() => setPlanCollapsed((v) => !v)}
            >
              <span>
                {lang === 'zh'
                  ? activePlanSide === 'bull'
                    ? '多空计划'
                    : '空头计划'
                  : activePlanSide === 'bull'
                  ? 'Bull Plan'
                  : 'Bear Plan'}
                {planCollapsed ? ` · ${fmtPrice(activePlan.entry_low)}` : ''}
              </span>
              <button
                type="button"
                className="plan-collapse-btn"
                aria-label="Toggle Plan Overlay"
              >
                {planCollapsed ? '▾' : '▴'}
              </button>
            </div>
            {!planCollapsed && (
              <>
                <div className="plan-tabs">
                  <button
                    className={`plan-tab ${activePlanSide === 'bull' ? 'active bull' : ''}`}
                    onClick={() => onChangePlanSide('bull')}
                  >
                    {lang === 'zh' ? '多头 / Call' : 'Bull / Call'}
                  </button>
                  <button
                    className={`plan-tab ${activePlanSide === 'bear' ? 'active bear' : ''}`}
                    onClick={() => onChangePlanSide('bear')}
                  >
                    {lang === 'zh' ? '空头 / Put' : 'Bear / Put'}
                  </button>
                </div>
                <div className="plan-card">
                  <div className={`plan-status ${activePlanSide}`}>
                    {activePlanSide === 'bull'
                      ? lang === 'zh'
                        ? `做多计划 · ${activePlan.status}`
                        : `Long Plan · ${activePlan.status === '已触发' ? 'Triggered' : 'Pending'}`
                      : lang === 'zh'
                      ? `做空计划 · ${activePlan.status}`
                      : `Short Plan · ${activePlan.status === '已触发' ? 'Triggered' : 'Pending'}`}
                  </div>

                  <div className="plan-box target">
                    <span className="plan-lbl">
                      {lang === 'zh'
                        ? activePlanSide === 'bull'
                          ? '多单止盈 T2'
                          : '空单止盈 T2'
                        : 'Target 2 (T2)'}
                    </span>
                    <span className="plan-val">{fmtPrice(activePlan.t2)}</span>
                  </div>
                  <div className="plan-box target">
                    <span className="plan-lbl">
                      {lang === 'zh'
                        ? activePlanSide === 'bull'
                          ? '多单止盈 T1'
                          : '空单止盈 T1'
                        : 'Target 1 (T1)'}
                    </span>
                    <span className="plan-val">{fmtPrice(activePlan.t1)}</span>
                  </div>
                  <div className="plan-box entry">
                    <span className="plan-lbl">
                      {lang === 'zh'
                        ? activePlanSide === 'bull'
                          ? '做多买入区'
                          : '开空入场区'
                        : 'Entry Zone'}
                    </span>
                    <span className="plan-val">
                      {fmtPrice(activePlan.entry_low)} - {fmtPrice(activePlan.entry_high)}
                    </span>
                  </div>
                  <div className="plan-box stop">
                    <span className="plan-lbl">
                      {lang === 'zh'
                        ? activePlanSide === 'bull'
                          ? '多单止损'
                          : '空单止损'
                        : 'Stop Loss'}
                    </span>
                    <span className="plan-val">{fmtPrice(activePlan.stop_loss)}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 盘中实时震荡/趋势状态带（位于 MACD 正上方） */}
      {layers.regime && data?.analysis.regime && (
        <div className={`regime-banner ${data.analysis.regime.state}`}>
          <span className="rb-title">
            {lang === 'zh' ? data.analysis.regime.title_zh : data.analysis.regime.title_en}
          </span>
          <span className="rb-desc">
            {lang === 'zh' ? data.analysis.regime.desc_zh : data.analysis.regime.desc_en}
          </span>
        </div>
      )}

      {/* MACD Sub-chart */}
      <div className="macd-wrap">
        <div className="macd-label">MACD 12 / 26 / 9</div>
        <div ref={macdContainerRef} className="macd-canvas" />
      </div>
    </div>
  );
};
