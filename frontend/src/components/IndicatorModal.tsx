import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, GripHorizontal, Search, SlidersHorizontal, X } from 'lucide-react';
import type { LangType, LayerToggles } from '../types';

export type IndicatorPreset = 'clean' | 'bull20w' | 'smart_money' | 'chanlun' | 'naked';

interface MaConfig {
  type: 'ema' | 'sma';
  fast: number;
  slow: number;
}

interface IndicatorDef {
  key: keyof LayerToggles;
  group: 'trend' | 'volume' | 'osc' | 'structure';
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  color: string;
  keywords: string;
}

interface IndicatorModalProps {
  open: boolean;
  onClose: () => void;
  lang: LangType;
  layers: LayerToggles;
  onToggleLayer: (key: keyof LayerToggles) => void;
  onApplyPreset: (preset: IndicatorPreset) => void;
  maConfig: MaConfig;
  onChangeMaConfig: (next: MaConfig) => void;
  compareSymbol: string;
}

const PANEL_WIDTH = 420;

export const IndicatorModal: React.FC<IndicatorModalProps> = ({
  open,
  onClose,
  lang,
  layers,
  onToggleLayer,
  onApplyPreset,
  maConfig,
  onChangeMaConfig,
  compareSymbol,
}) => {
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== 'undefined' ? Math.max(16, window.innerWidth - PANEL_WIDTH - 18) : 980,
    y: 66,
  }));
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    if (!open) return;
    // Re-clamp on open in case window resized since last drag
    setPos((prev) => {
      const w = panelRef.current?.offsetWidth || PANEL_WIDTH;
      const maxX = Math.max(8, window.innerWidth - w - 8);
      const maxY = Math.max(54, window.innerHeight - 120);
      return {
        x: Math.min(maxX, Math.max(8, prev.x)),
        y: Math.min(maxY, Math.max(54, prev.y)),
      };
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st.active) return;
      const w = panelRef.current?.offsetWidth || PANEL_WIDTH;
      const h = panelRef.current?.offsetHeight || 480;
      const maxX = Math.max(8, window.innerWidth - w - 8);
      const maxY = Math.max(54, window.innerHeight - Math.min(h, 140));
      const nx = Math.min(maxX, Math.max(8, st.origX + (e.clientX - st.startX)));
      const ny = Math.min(maxY, Math.max(54, st.origY + (e.clientY - st.startY)));
      setPos({ x: nx, y: ny });
    };
    const onPointerUp = () => {
      if (!dragStateRef.current.active) return;
      dragStateRef.current.active = false;
      setDragging(false);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    setDragging(true);
  };

  const defs = useMemo<IndicatorDef[]>(
    () => [
      {
        key: 'dual_ma',
        group: 'trend',
        titleZh: `双均线主轨 (${maConfig.type.toUpperCase()} ${maConfig.fast}/${maConfig.slow})`,
        titleEn: `Dual MA (${maConfig.type.toUpperCase()} ${maConfig.fast}/${maConfig.slow})`,
        descZh: '高明度对比：深红20快线 / 亮翠绿60慢线 + 金叉死叉',
        descEn: 'High-luminance contrast: Deep crimson fast / bright mint slow',
        color: '#B91C1C',
        keywords: 'ema sma dual ma 双均线 均线 趋势 20 60',
      },
      {
        key: 'ma5',
        group: 'trend',
        titleZh: 'MA5 攻击线',
        titleEn: 'MA5 (5-Period SMA)',
        descZh: '超短线动量与贴线强弱参考',
        descEn: 'Ultra-short momentum moving average',
        color: '#2563EB',
        keywords: 'ma5 5日线 均线',
      },
      {
        key: 'ma10',
        group: 'trend',
        titleZh: 'MA10 操盘线',
        titleEn: 'MA10 (10-Period SMA)',
        descZh: '短线波段防守参考',
        descEn: 'Short-term swing defense average',
        color: '#D97706',
        keywords: 'ma10 10日线 均线',
      },
      {
        key: 'ma20',
        group: 'trend',
        titleZh: 'MA20 生命线',
        titleEn: 'MA20 (20-Period SMA)',
        descZh: '中期趋势强弱分界线（布林中轨）',
        descEn: 'Mid-term trend lifeline & BB basis',
        color: '#0D9488',
        keywords: 'ma20 20日线 均线',
      },
      {
        key: 'ma60',
        group: 'trend',
        titleZh: 'MA60 决策线',
        titleEn: 'MA60 (60-Period SMA)',
        descZh: '季线级别中期多空分水岭',
        descEn: 'Quarterly medium-term decision line',
        color: '#9333EA',
        keywords: 'ma60 60日线 季线 均线',
      },
      {
        key: 'ma120',
        group: 'trend',
        titleZh: 'MA120 半年线',
        titleEn: 'MA120 (120-Period SMA)',
        descZh: '长周期牛熊结构门槛',
        descEn: 'Half-year structural trend line',
        color: '#4F46E5',
        keywords: 'ma120 半年线 牛熊 均线',
      },
      {
        key: 'ma200',
        group: 'trend',
        titleZh: 'MA200 年线',
        titleEn: 'MA200 (200-Period SMA)',
        descZh: '机构公认牛熊分界线与长线买点锚定',
        descEn: 'Institutional 200-period bull/bear baseline',
        color: '#BE123C',
        keywords: 'ma200 年线 牛熊 均线',
      },
      {
        key: 'boll',
        group: 'trend',
        titleZh: 'BOLL 布林带 (20, 2)',
        titleEn: 'Bollinger Bands (20, 2)',
        descZh: '波动率收口变盘预警与上下轨超买超卖通道',
        descEn: 'Volatility squeeze & upper/lower deviation envelope',
        color: '#0284C7',
        keywords: 'boll bb 布林带 通道',
      },
      {
        key: 'bull_band',
        group: 'trend',
        titleZh: '牛熊 20 带 (EMA20 + MA20)',
        titleEn: '20-Period Bull Market Support Band',
        descZh: '周线/日线经典牛市支撑云带（自动填充多空云色）',
        descEn: 'Dual 20 EMA + SMA support cloud ribbon',
        color: '#B91C1C',
        keywords: 'bull band 牛熊20带 支撑带',
      },
      {
        key: 'vwap',
        group: 'trend',
        titleZh: 'VWAP 机构成交量加权均价',
        titleEn: 'VWAP (Volume Weighted Avg Price)',
        descZh: '日内/区间机构真实持仓成本点线',
        descEn: 'Institutional volume-weighted cost line',
        color: '#1D4ED8',
        keywords: 'vwap 机构 成本',
      },
      {
        key: 'volume',
        group: 'volume',
        titleZh: 'Volume 成交量柱',
        titleEn: 'Volume Histogram',
        descZh: 'K线底部叠加真实放量/缩量识别',
        descEn: 'Bottom-pane candlestick volume bars',
        color: '#00C47A',
        keywords: 'vol volume 成交量 量能',
      },
      {
        key: 'vpvr',
        group: 'volume',
        titleZh: 'VPVR 筹码分布峰 (POC/VA)',
        titleEn: 'VPVR Volume Profile (POC / 70% VA)',
        descZh: '可见区间庄家成本密集峰与筹码真空带',
        descEn: 'Visible range volume profile & point of control',
        color: '#D95000',
        keywords: 'vpvr 筹码峰 poc vah val',
      },
      {
        key: 'fvg',
        group: 'volume',
        titleZh: 'FVG 机构失衡缺口',
        titleEn: 'Fair Value Gaps (FVG)',
        descZh: '自动追踪未回补多空真空区（补满自动消失）',
        descEn: 'Unfilled institutional imbalance zones',
        color: '#B91C1C',
        keywords: 'fvg 缺口 失衡 机构',
      },
      {
        key: 'absorption',
        group: 'volume',
        titleZh: '主力吸筹 / 扫损派发标记',
        titleEn: 'Absorption & Liquidity Sweeps',
        descZh: '放量长影线承接与假跌破扫损箭头标记',
        descEn: 'Volume-spike rejection & stop-hunt signals',
        color: '#B91C1C',
        keywords: 'absorption 吸筹 扫损 派发',
      },
      {
        key: 'fib',
        group: 'volume',
        titleZh: 'Fibonacci 斐波那契回撤',
        titleEn: 'Fibonacci Retracement (0.382 / 0.5 / 0.618)',
        descZh: '主波段关键黄金分割支撑与阻力水平线',
        descEn: 'Auto swing 0.382 / 0.5 / 0.618 levels',
        color: '#7E22CE',
        keywords: 'fib 斐波那契 黄金分割',
      },
      {
        key: 'compare',
        group: 'volume',
        titleZh: `强弱叠加对比 (${compareSymbol})`,
        titleEn: `Benchmark Compare (${compareSymbol})`,
        descZh: '同屏曲线对比当前标的相对大盘的超额强弱',
        descEn: 'Rebased relative performance vs benchmark',
        color: '#7E22CE',
        keywords: 'compare btc qqq 对比 强弱',
      },
      {
        key: 'macd',
        group: 'osc',
        titleZh: 'MACD (12, 26, 9) 副图',
        titleEn: 'MACD (12, 26, 9) Sub-chart',
        descZh: '关闭副图可让主 K 线区域扩展到 100% 满屏高度',
        descEn: 'Toggle off to expand main chart to full height',
        color: '#F05C00',
        keywords: 'macd dif dea 副图 震荡',
      },
      {
        key: 'plan',
        group: 'structure',
        titleZh: '多空计划线 & 浮窗',
        titleEn: 'Trade Plan Lines & Card',
        descZh: '入场区、止损线与 T1/T2 止盈目标水平线',
        descEn: 'Entry, stop-loss and T1/T2 target lines',
        color: '#141413',
        keywords: 'plan 交易计划 止损 止盈',
      },
      {
        key: 'deduct',
        group: 'structure',
        titleZh: '均线扣抵位置箭头',
        titleEn: 'MA Deduction Arrows',
        descZh: '标注 20/60 周期前扣抵K线高低压制位置',
        descEn: 'Highlights fast/slow MA deduction bars',
        color: '#141413',
        keywords: 'deduct 扣抵',
      },
      {
        key: 'regime',
        group: 'structure',
        titleZh: '盘中震荡 / 趋势状态带',
        titleEn: 'Market Regime Banner',
        descZh: '主图下方窄条提示蓄势、震荡或单边行情',
        descEn: 'Regime strip directly below candlestick pane',
        color: '#B45309',
        keywords: 'regime 震荡 趋势 状态',
      },
      {
        key: 'macro',
        group: 'structure',
        titleZh: '顶部美股 ETF 风向条',
        titleEn: 'US ETF Macro Flow Strip',
        descZh: 'QQQ / SPY / SMH / IBIT / TLT 实时资金温度',
        descEn: 'Top QQQ/SPY/SMH/IBIT/TLT flow indicators',
        color: '#1D4ED8',
        keywords: 'macro etf 宏观 风向',
      },
      {
        key: 'strokes',
        group: 'structure',
        titleZh: '缠论 · 笔',
        titleEn: 'ChanLun · Strokes',
        descZh: '基础顶底分型连笔结构',
        descEn: 'Structural swing strokes',
        color: '#BE185D',
        keywords: 'chanlun strokes 缠论 笔',
      },
      {
        key: 'segments',
        group: 'structure',
        titleZh: '缠论 · 线段',
        titleEn: 'ChanLun · Segments',
        descZh: '次级别三笔特征序列线段',
        descEn: 'Composite ChanLun segments',
        color: '#64748B',
        keywords: 'chanlun segments 缠论 线段',
      },
      {
        key: 'centers',
        group: 'structure',
        titleZh: '缠论 · 中枢 (ZG / ZD)',
        titleEn: 'ChanLun · Centers (ZG/ZD)',
        descZh: '多空筹码拉锯中枢上沿与下沿区间',
        descEn: 'Consolidation center upper/lower bounds',
        color: '#00A866',
        keywords: 'chanlun centers 缠论 中枢',
      },
      {
        key: 'signals',
        group: 'structure',
        titleZh: '缠论 · 历史买卖点 / 背驰',
        titleEn: 'ChanLun · Historical Signals',
        descZh: '图上圆点标注历次顶底背驰买点',
        descEn: 'Historical divergence buy/sell markers',
        color: '#B91C1C',
        keywords: 'chanlun signals 背驰 买卖点',
      },
      {
        key: 'projection',
        group: 'structure',
        titleZh: '条件推演路径',
        titleEn: 'Conditional Projection Paths',
        descZh: '主/次情景演化虚线轨迹预测',
        descEn: 'Primary/secondary dashed trajectory projections',
        color: '#00A866',
        keywords: 'projection 路径 预测',
      },
      {
        key: 'fractals',
        group: 'structure',
        titleZh: '顶底分型箭头',
        titleEn: 'Fractal Arrows',
        descZh: '标注最近 40 个 K 线顶底分型极值点',
        descEn: 'Top/bottom fractal extrema markers',
        color: '#00A866',
        keywords: 'fractals 分型',
      },
    ],
    [maConfig, compareSymbol]
  );

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? defs.filter((d) =>
        `${d.titleZh} ${d.titleEn} ${d.descZh} ${d.keywords}`.toLowerCase().includes(q)
      )
    : defs;

  const groups: Array<{ id: IndicatorDef['group']; labelZh: string; labelEn: string }> = [
    { id: 'trend', labelZh: '趋势均线 & 波动通道', labelEn: 'Moving Averages & Channels' },
    { id: 'volume', labelZh: '成交量 & 机构筹码', labelEn: 'Volume & Smart Money' },
    { id: 'osc', labelZh: '副图震荡指标', labelEn: 'Oscillators' },
    { id: 'structure', labelZh: '交易计划 & 缠论结构', labelEn: 'Plans & Structure' },
  ];

  const activeCount = Object.values(layers).filter(Boolean).length;
  const isZh = lang === 'zh';

  return (
    <div
      ref={panelRef}
      className="ind-float-panel"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className={`ind-modal-head draggable${dragging ? ' dragging' : ''}`}
        onPointerDown={handleHeaderPointerDown}
        title={isZh ? '按住标题栏可自由拖动到任意位置，不遮挡看图' : 'Drag header to move freely'}
      >
        <div className="ind-head-title">
          <span className="ind-fx-badge">fx</span>
          <div>
            <h3>
              {isZh ? '指标库 · 可拖动实时预览' : 'Indicators · Draggable'}
              <span className="ind-drag-hint">
                <GripHorizontal size={12} /> {isZh ? '拖动窗口' : 'Drag'}
              </span>
            </h3>
            <p>
              {isZh
                ? `点选即在左侧K线生效 · 已开 ${activeCount} 项`
                : `Live preview on chart · ${activeCount} active`}
            </p>
          </div>
        </div>
        <button type="button" className="ind-close-btn" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="ind-search-bar">
        <Search size={14} className="ind-search-ico" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            isZh
              ? '搜指标：MA5 / MA200 / BOLL / 成交量 / VPVR / 缠论...'
              : 'Search MA5, MA200, BOLL, Volume, VPVR...'
          }
        />
        {query && (
          <button type="button" className="ind-search-clear" onClick={() => setQuery('')}>
            ×
          </button>
        )}
      </div>

      <div className="ind-preset-row">
        <span className="ind-preset-lbl">{isZh ? '组合:' : 'Presets:'}</span>
        {(
          [
            ['clean', isZh ? '简洁趋势' : 'Clean'],
            ['bull20w', isZh ? '20W带' : '20W Band'],
            ['smart_money', isZh ? '机构筹码' : 'Smart Money'],
            ['chanlun', isZh ? '缠论全量' : 'ChanLun'],
            ['naked', isZh ? '纯裸K' : 'Naked'],
          ] as [IndicatorPreset, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="ind-preset-btn"
            onClick={() => onApplyPreset(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ind-body-scroll">
        {groups.map((grp) => {
          const list = filtered.filter((d) => d.group === grp.id);
          if (!list.length) return null;
          return (
            <section key={grp.id} className="ind-group">
              <div className="ind-group-title">{isZh ? grp.labelZh : grp.labelEn}</div>
              <div className="ind-list">
                {list.map((item) => {
                  const checked = layers[item.key];
                  return (
                    <div key={item.key} className={`ind-item-wrap ${checked ? 'active' : ''}`}>
                      <button
                        type="button"
                        className="ind-row"
                        onClick={() => onToggleLayer(item.key)}
                      >
                        <span className="ind-dot" style={{ background: item.color }} />
                        <div className="ind-row-main">
                          <div className="ind-row-title">
                            {isZh ? item.titleZh : item.titleEn}
                          </div>
                          <div className="ind-row-desc">
                            {isZh ? item.descZh : item.descEn}
                          </div>
                        </div>
                        <span className={`ind-toggle-pill ${checked ? 'on' : ''}`}>
                          {checked ? (
                            <>
                              <Check size={12} />
                              {isZh ? '已开' : 'On'}
                            </>
                          ) : isZh ? (
                            '+ 加线'
                          ) : (
                            '+ Add'
                          )}
                        </span>
                      </button>

                      {item.key === 'dual_ma' && checked && (
                        <div className="ind-ma-inline">
                          <span className="imi-lbl">
                            <SlidersHorizontal size={12} /> {isZh ? '参数:' : 'Params:'}
                          </span>
                          <button
                            type="button"
                            className={`imi-preset ${maConfig.type === 'ema' && maConfig.fast === 20 && maConfig.slow === 60 ? 'active' : ''}`}
                            onClick={() => onChangeMaConfig({ type: 'ema', fast: 20, slow: 60 })}
                          >
                            20/60
                          </button>
                          <button
                            type="button"
                            className={`imi-preset ${maConfig.type === 'ema' && maConfig.fast === 10 && maConfig.slow === 20 ? 'active' : ''}`}
                            onClick={() => onChangeMaConfig({ type: 'ema', fast: 10, slow: 20 })}
                          >
                            10/20
                          </button>
                          <button
                            type="button"
                            className={`imi-preset ${maConfig.type === 'sma' && maConfig.fast === 50 && maConfig.slow === 200 ? 'active' : ''}`}
                            onClick={() => onChangeMaConfig({ type: 'sma', fast: 50, slow: 200 })}
                          >
                            50/200
                          </button>
                          <select
                            value={maConfig.type}
                            onChange={(e) =>
                              onChangeMaConfig({
                                ...maConfig,
                                type: e.target.value as 'ema' | 'sma',
                              })
                            }
                          >
                            <option value="ema">EMA</option>
                            <option value="sma">SMA</option>
                          </select>
                          <input
                            type="number"
                            min={2}
                            max={200}
                            value={maConfig.fast}
                            onChange={(e) =>
                              onChangeMaConfig({
                                ...maConfig,
                                fast: Math.max(2, Math.min(200, Number(e.target.value) || 20)),
                              })
                            }
                          />
                          <span>/</span>
                          <input
                            type="number"
                            min={3}
                            max={400}
                            value={maConfig.slow}
                            onChange={(e) =>
                              onChangeMaConfig({
                                ...maConfig,
                                slow: Math.max(3, Math.min(400, Number(e.target.value) || 60)),
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
