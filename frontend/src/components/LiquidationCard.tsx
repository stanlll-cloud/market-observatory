import React, { useMemo, useState } from 'react';
import { Flame, Layers, RefreshCw, X } from 'lucide-react';
import type { LangType, LiquidationBin, LiquidationResponse } from '../types';

interface Props {
  data: LiquidationResponse | null;
  loading: boolean;
  lang: LangType;
  showOnChart: boolean;
  onToggleChart: () => void;
  onRefresh: () => void;
}

function fmtUsd(v?: number): string {
  if (!v || !Number.isFinite(v)) return '$0';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function fmtPx(p?: number): string {
  if (!p || !Number.isFinite(p)) return '-';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (p >= 10) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 0.1) return p.toFixed(4);
  return p.toFixed(6);
}

/** Merge 36 granular bins into 14 compact ladder rows (7 above mark, 7 below mark) for crisp sidebar display */
function groupLadderBins(bins: LiquidationBin[]): { upperRows: LiquidationBin[]; lowerRows: LiquidationBin[] } {
  const shorts = bins.filter((b) => b.side === 'short_liq'); // already high -> low
  const longs = bins.filter((b) => b.side === 'long_liq');   // high -> low

  const bucket = (list: LiquidationBin[], targetCount: number): LiquidationBin[] => {
    if (!list.length) return [];
    const chunk = Math.max(1, Math.ceil(list.length / targetCount));
    const rows: LiquidationBin[] = [];
    for (let i = 0; i < list.length; i += chunk) {
      const slice = list.slice(i, i + chunk);
      const peak = slice.reduce((a, b) => (b.liq_usd >= a.liq_usd ? b : a), slice[0]);
      const sumUsd = slice.reduce((acc, x) => acc + x.liq_usd, 0);
      rows.push({
        ...peak,
        liq_usd: sumUsd,
        intensity: Math.max(...slice.map((x) => x.intensity)),
      });
    }
    return rows;
  };

  const uRows = bucket(shorts, 7);
  const lRows = bucket(longs, 7);
  const maxSum = Math.max(1, ...uRows.map((r) => r.liq_usd), ...lRows.map((r) => r.liq_usd));
  return {
    upperRows: uRows.map((r) => ({ ...r, intensity: Math.min(1, r.liq_usd / maxSum) })),
    lowerRows: lRows.map((r) => ({ ...r, intensity: Math.min(1, r.liq_usd / maxSum) })),
  };
}

export const LiquidationCard: React.FC<Props> = ({
  data,
  loading,
  lang,
  showOnChart,
  onToggleChart,
  onRefresh,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const isZh = lang === 'zh';

  const ladder = useMemo(() => {
    if (!data?.bins?.length) return { upperRows: [], lowerRows: [] };
    return groupLadderBins(data.bins);
  }, [data?.bins]);

  if (loading && !data) {
    return (
      <div className="panel-card hl-liq-card">
        <div className="card-header">
          <span>{isZh ? 'Hyperliquid 清算分布' : 'Hyperliquid Liquidation'}</span>
          <span className="card-sub">{isZh ? '加载中...' : 'Loading...'}</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (!data.supported) {
    return (
      <div className="panel-card hl-liq-card">
        <div className="card-header">
          <span>{isZh ? 'Hyperliquid 清算分布' : 'Hyperliquid Liquidation'}</span>
          <span className="tag-pill">{data.hl_coin || data.symbol}</span>
        </div>
        <div className="overview-summary">
          {isZh ? data.reason || 'Hyperliquid 暂未覆盖该品种' : data.reason_en || 'Not listed on Hyperliquid'}
        </div>
      </div>
    );
  }

  const topUp = data.upper_clusters?.[0];
  const topDn = data.lower_clusters?.[0];
  const fund8h = data.funding_8h_pct ?? 0;
  const imb = data.imbalance_pct ?? 50;

  return (
    <>
      <div className="panel-card hl-liq-card">
        <div className="card-header">
          <span className="hl-title-wrap">
            <Flame size={13} className="hl-flame-ico" />
            <span>{isZh ? 'Hyperliquid 清算分布' : 'Hyperliquid Liq Map'}</span>
          </span>
          <div className="hl-head-right">
            <span className="hl-oi-pill" title="Hyperliquid Open Interest">
              OI {fmtUsd(data.open_interest_usd)}
            </span>
            <button
              type="button"
              className={`hl-icon-btn ${loading ? 'spinning' : ''}`}
              onClick={onRefresh}
              title={isZh ? '刷新清算分布' : 'Refresh Liquidation Data'}
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        <div className="hl-submeta">
          <span>
            {isZh ? '8H费率' : '8H Fund'}{' '}
            <b className={fund8h >= 0 ? 'bull' : 'bear'}>
              {fund8h >= 0 ? '+' : ''}
              {fund8h.toFixed(4)}%
            </b>
          </span>
          <span>
            {isZh ? '多/空比' : 'L/S'}{' '}
            <b>
              {Math.round((data.long_ratio ?? 0.5) * 100)}% / {Math.round((data.short_ratio ?? 0.5) * 100)}%
            </b>
          </span>
          <span>Max {data.max_leverage ?? 20}x</span>
        </div>

        <div className="hl-magnets-grid">
          <div className="hl-magnet-box short">
            <div className="hm-lbl">{isZh ? '上方空头强平墙' : 'Upper Short Liq'}</div>
            <div className="hm-px">{topUp ? fmtPx(topUp.price) : '-'}</div>
            <div className="hm-meta">
              {topUp ? (
                <>
                  <span>+{topUp.dist_pct.toFixed(1)}%</span>
                  <span>{fmtUsd(topUp.liq_usd)}</span>
                </>
              ) : (
                <span>-</span>
              )}
            </div>
          </div>
          <div className="hl-magnet-box long">
            <div className="hm-lbl">{isZh ? '下方多头强平墙' : 'Lower Long Liq'}</div>
            <div className="hm-px">{topDn ? fmtPx(topDn.price) : '-'}</div>
            <div className="hm-meta">
              {topDn ? (
                <>
                  <span>{topDn.dist_pct.toFixed(1)}%</span>
                  <span>{fmtUsd(topDn.liq_usd)}</span>
                </>
              ) : (
                <span>-</span>
              )}
            </div>
          </div>
        </div>

        <div className="hl-imb-bar-wrap">
          <div className="hl-imb-labels">
            <span>{isZh ? `上方空单 ${imb.toFixed(0)}% (${fmtUsd(data.upper_total_usd)})` : `Short ${imb.toFixed(0)}%`}</span>
            <span>{isZh ? `下方多单 ${(100 - imb).toFixed(0)}% (${fmtUsd(data.lower_total_usd)})` : `Long ${(100 - imb).toFixed(0)}%`}</span>
          </div>
          <div className="bias-bar">
            <div className="bias-fill-bull" style={{ width: `${imb}%` }} />
            <div className="bias-fill-bear" style={{ width: `${100 - imb}%` }} />
          </div>
        </div>

        <div className="hl-ladder">
          {ladder.upperRows.map((row, idx) => (
            <div
              key={`u-${idx}-${row.price}`}
              className="hl-ladder-row short"
              title={`${fmtPx(row.price_low)} ~ ${fmtPx(row.price_high)} (${row.dist_pct > 0 ? '+' : ''}${row.dist_pct}%) | ${fmtUsd(row.liq_usd)} | 主力 ${row.dominant_lev}x`}
            >
              <span className="hl-lad-px">{fmtPx(row.price)}</span>
              <div className="hl-lad-track">
                <div
                  className="hl-lad-fill short"
                  style={{ width: `${Math.max(4, Math.round(row.intensity * 100))}%` }}
                />
              </div>
              <span className="hl-lad-val">{fmtUsd(row.liq_usd)}</span>
            </div>
          ))}

          <div className="hl-mark-divider">
            <span>MARK {fmtPx(data.mark_price)}</span>
            <span>{isZh ? '±12% 清算带' : '±12% Band'}</span>
          </div>

          {ladder.lowerRows.map((row, idx) => (
            <div
              key={`d-${idx}-${row.price}`}
              className="hl-ladder-row long"
              title={`${fmtPx(row.price_low)} ~ ${fmtPx(row.price_high)} (${row.dist_pct}%) | ${fmtUsd(row.liq_usd)} | 主力 ${row.dominant_lev}x`}
            >
              <span className="hl-lad-px">{fmtPx(row.price)}</span>
              <div className="hl-lad-track">
                <div
                  className="hl-lad-fill long"
                  style={{ width: `${Math.max(4, Math.round(row.intensity * 100))}%` }}
                />
              </div>
              <span className="hl-lad-val">{fmtUsd(row.liq_usd)}</span>
            </div>
          ))}
        </div>

        <div className="overview-summary hl-summary">
          {isZh ? data.summary_zh : data.summary_en}
        </div>

        <div className="hl-actions">
          <button
            type="button"
            className={`hl-act-btn ${showOnChart ? 'active' : ''}`}
            onClick={onToggleChart}
          >
            <Layers size={12} />
            <span>{isZh ? (showOnChart ? '主图已标墙' : '主图标强平墙') : showOnChart ? 'On Chart' : 'Pin Walls'}</span>
          </button>
          <button
            type="button"
            className="hl-act-btn primary"
            onClick={() => setModalOpen(true)}
          >
            <span>{isZh ? '查看清算热力图' : 'Full Heatmap'}</span>
          </button>
        </div>
      </div>

      {modalOpen && (
        <div className="hl-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="hl-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hl-modal-head">
              <div>
                <div className="hl-modal-title">
                  {data.hl_coin} · Hyperliquid {isZh ? '合约清算热力图 (±12%)' : 'Liquidation Heatmap (±12%)'}
                </div>
                <div className="hl-modal-sub">
                  Mark {fmtPx(data.mark_price)} · OI {fmtUsd(data.open_interest_usd)} · 24H Vol {fmtUsd(data.day_volume_usd)} · 8H Fund {fund8h >= 0 ? '+' : ''}{fund8h.toFixed(4)}%
                </div>
              </div>
              <button type="button" className="hl-modal-close" onClick={() => setModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="hl-modal-clusters">
              <div className="hl-mc-col">
                <div className="hl-mc-title short">{isZh ? '上方 Top 3 空头强平墙' : 'Top 3 Short Liq Walls'}</div>
                {data.upper_clusters.map((c, idx) => (
                  <div key={`uc-${idx}`} className="hl-mc-row">
                    <b>#{idx + 1} {fmtPx(c.price)}</b>
                    <span className="bull">+{c.dist_pct.toFixed(2)}%</span>
                    <span>{fmtUsd(c.liq_usd)}</span>
                    <span className="hl-lev-tag">{c.dominant_lev}x</span>
                  </div>
                ))}
              </div>
              <div className="hl-mc-col">
                <div className="hl-mc-title long">{isZh ? '下方 Top 3 多头强平墙' : 'Top 3 Long Liq Walls'}</div>
                {data.lower_clusters.map((c, idx) => (
                  <div key={`dc-${idx}`} className="hl-mc-row">
                    <b>#{idx + 1} {fmtPx(c.price)}</b>
                    <span className="bear">{c.dist_pct.toFixed(2)}%</span>
                    <span>{fmtUsd(c.liq_usd)}</span>
                    <span className="hl-lev-tag">{c.dominant_lev}x</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="hl-modal-bins">
              {data.bins.map((b, idx) => (
                <div key={`mb-${idx}`} className={`hl-mb-row ${b.side === 'short_liq' ? 'short' : 'long'}`}>
                  <span className="hl-mb-px">{fmtPx(b.price)}</span>
                  <span className="hl-mb-dist">
                    {b.dist_pct > 0 ? '+' : ''}
                    {b.dist_pct.toFixed(1)}%
                  </span>
                  <div className="hl-mb-track">
                    <div
                      className={`hl-mb-fill ${b.side === 'short_liq' ? 'short' : 'long'}`}
                      style={{
                        width: `${Math.max(2, Math.round(b.intensity * 100))}%`,
                        opacity: 0.38 + b.intensity * 0.62,
                      }}
                    />
                  </div>
                  <span className="hl-mb-usd">{fmtUsd(b.liq_usd)}</span>
                  <span className="hl-lev-tag">{b.dominant_lev}x</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
