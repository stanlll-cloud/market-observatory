import React, { useMemo } from 'react';
import type { RadarItem } from '../types';

interface Props {
  items: RadarItem[];
  lang: 'zh' | 'en';
  onJumpToChart: (item: RadarItem) => void;
}

function fmtPrice(p: number): string {
  if (!p) return '-';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (p >= 10) return p.toFixed(2);
  return p.toFixed(3);
}

function getHeatStyle(chg: number): React.CSSProperties {
  const abs = Math.min(8, Math.abs(chg));
  if (chg > 0.25) {
    // 红涨 (#ff3b5c)
    const alpha = 0.14 + (abs / 8) * 0.42;
    return {
      background: `linear-gradient(155deg, rgba(255, 59, 92, ${alpha.toFixed(2)}), rgba(180, 28, 58, ${(alpha * 0.65).toFixed(2)}))`,
      borderColor: `rgba(255, 59, 92, ${Math.min(0.85, alpha + 0.22).toFixed(2)})`,
    };
  }
  if (chg < -0.25) {
    // 青绿跌 (#00e5a3)
    const alpha = 0.12 + (abs / 8) * 0.38;
    return {
      background: `linear-gradient(155deg, rgba(0, 229, 163, ${alpha.toFixed(2)}), rgba(6, 130, 96, ${(alpha * 0.62).toFixed(2)}))`,
      borderColor: `rgba(0, 229, 163, ${Math.min(0.82, alpha + 0.2).toFixed(2)})`,
    };
  }
  return {
    background: 'rgba(20, 38, 33, 0.72)',
    borderColor: 'rgba(148, 163, 184, 0.22)',
  };
}

export const HeatmapView: React.FC<Props> = ({ items, lang, onJumpToChart }) => {
  const isZh = lang === 'zh';

  const sectorGroups = useMemo(() => {
    const map = new Map<string, RadarItem[]>();
    for (const item of items) {
      const secName = isZh
        ? item.sector || (item.market === 'crypto' ? '加密资产' : '美股其他')
        : item.sector_en || item.sector || (item.market === 'crypto' ? 'Crypto' : 'Other');
      const list = map.get(secName) || [];
      list.push(item);
      map.set(secName, list);
    }

    const groups = Array.from(map.entries()).map(([sector, list]) => {
      const sorted = [...list].sort((a, b) => b.radar_score - a.radar_score || Math.abs(b.change_pct) - Math.abs(a.change_pct));
      const avgChg = list.reduce((acc, x) => acc + (x.change_pct || 0), 0) / Math.max(1, list.length);
      const upCount = list.filter((x) => x.change_pct > 0).length;
      return { sector, items: sorted, avgChg, upCount };
    });

    groups.sort((a, b) => b.items.length - a.items.length || b.avgChg - a.avgChg);
    return groups;
  }, [items, isZh]);

  const upSectors = sectorGroups.filter((g) => g.avgChg > 0).length;
  const downSectors = sectorGroups.filter((g) => g.avgChg < 0).length;

  return (
    <div className="heatmap-wrapper">
      <div className="heatmap-legend-bar">
        <div className="heatmap-legend-stats">
          <span className="hm-stat-badge up">
            {isZh ? `红涨板块 ${upSectors}` : `Advancing Sectors ${upSectors}`}
          </span>
          <span className="hm-stat-badge down">
            {isZh ? `青绿跌板块 ${downSectors}` : `Declining Sectors ${downSectors}`}
          </span>
          <span className="hm-hint-text">
            {isZh ? '点击任意方格直接切入深度K线工作台' : 'Click any tile to inspect K-line'}
          </span>
        </div>
        <div className="heatmap-scale">
          <span className="hm-scale-label down">-5%↓</span>
          <span className="hm-swatch" style={{ background: 'rgba(0, 229, 163, 0.5)' }} />
          <span className="hm-swatch" style={{ background: 'rgba(0, 229, 163, 0.22)' }} />
          <span className="hm-swatch" style={{ background: 'rgba(148, 163, 184, 0.22)' }} />
          <span className="hm-swatch" style={{ background: 'rgba(255, 59, 92, 0.26)' }} />
          <span className="hm-swatch" style={{ background: 'rgba(255, 59, 92, 0.56)' }} />
          <span className="hm-scale-label up">+5%↑</span>
        </div>
      </div>

      {sectorGroups.length === 0 ? (
        <div className="radar-empty-box">
          {isZh ? '当前筛选条件下暂无板块标的' : 'No heatmap items under active filters'}
        </div>
      ) : (
        <div className="heatmap-sector-grid">
          {sectorGroups.map((grp) => (
            <section key={grp.sector} className="heatmap-sector-card">
              <header className="heatmap-sector-header">
                <div className="heatmap-sector-title">
                  <span>{grp.sector}</span>
                  <span className="heatmap-sector-cnt">{grp.items.length}</span>
                </div>
                <span className={`heatmap-sector-avg ${grp.avgChg >= 0 ? 'up' : 'down'}`}>
                  {grp.avgChg >= 0 ? '+' : ''}
                  {grp.avgChg.toFixed(2)}%
                </span>
              </header>
              <div className="heatmap-tiles">
                {grp.items.map((item) => {
                  const isUp = item.change_pct >= 0;
                  const shortSym = item.market === 'crypto' ? item.symbol.replace('USDT', '') : item.symbol;
                  const macdBull = item.macd_state === 'above_open' || item.macd_state === 'above_consol';
                  return (
                    <button
                      key={`${item.market}-${item.symbol}`}
                      type="button"
                      className="heatmap-tile"
                      style={getHeatStyle(item.change_pct)}
                      onClick={() => onJumpToChart(item)}
                      title={`${item.symbol} ${item.name} | 评分 ${item.radar_score} | ${item.macd_label_zh || ''}`}
                    >
                      <div className="hm-tile-top">
                        <span className="hm-tile-sym">{shortSym}</span>
                        <span className="hm-tile-score">{item.radar_score}</span>
                      </div>
                      <div className={`hm-tile-chg ${isUp ? 'up' : 'down'}`}>
                        {isUp ? '+' : ''}
                        {item.change_pct.toFixed(2)}%
                      </div>
                      <div className="hm-tile-bottom">
                        <span className="hm-tile-price">${fmtPrice(item.price)}</span>
                        {item.is_hedge ? (
                          <span className="hm-tile-tag hedge">🛡️</span>
                        ) : item.crash_lock ? (
                          <span className="hm-tile-tag crash">🛑</span>
                        ) : macdBull ? (
                          <span className="hm-tile-tag bull">🌊</span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
