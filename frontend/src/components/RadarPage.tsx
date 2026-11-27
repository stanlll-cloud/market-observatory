import React, { useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Search, Star, TrendingUp } from 'lucide-react';
import type { LangType, MarketType, RadarItem, RadarResponse } from '../types';
import { HeatmapView } from './HeatmapView';

interface RadarPageProps {
  radar: RadarResponse | null;
  loading: boolean;
  lang: LangType;
  favorites: string[];
  onToggleFavorite: (sym: string, e: React.MouseEvent) => void;
  onSelectSymbol: (market: MarketType, symbol: string) => void;
  onRefresh: () => void;
  onBackToChart: () => void;
}

type MarketFilter = 'all' | 'us' | 'crypto' | 'commodity' | 'fav';
type StrategyFilter =
  | 'all'
  | 'resilient_leader'
  | 'golden_pit'
  | 'bear_short_put'
  | 'ma_squeeze'
  | 'bull_runner'
  | 'macd_bull'
  | 'hedge_tool'
  | 'crash_knife';
type SortKey = 'score' | 'chg_desc' | 'chg_asc' | 'rs' | 'squeeze';

const fmtPrice = (v: number) => {
  if (!v) return '--';
  if (v >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
};

export const RadarPage: React.FC<RadarPageProps> = React.memo(({
  radar,
  loading,
  lang,
  favorites,
  onToggleFavorite,
  onSelectSymbol,
  onRefresh,
  onBackToChart,
}) => {
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [strategyFilter, setStrategyFilter] = useState<StrategyFilter>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [query, setQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [subView, setSubView] = useState<'cards' | 'heatmap'>('cards');

  const items = radar?.items ?? [];

  const availableSectors = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (marketFilter === 'us' && it.market !== 'us') continue;
      if (marketFilter === 'crypto' && it.market !== 'crypto') continue;
      if (marketFilter === 'commodity' && it.market !== 'commodity') continue;
      if (marketFilter === 'fav' && !favorites.includes(it.symbol)) continue;
      if (it.sector) set.add(it.sector);
    }
    return Array.from(set);
  }, [items, marketFilter, favorites]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((it) => {
      if (marketFilter === 'us' && it.market !== 'us') return false;
      if (marketFilter === 'crypto' && it.market !== 'crypto') return false;
      if (marketFilter === 'commodity' && it.market !== 'commodity') return false;
      if (marketFilter === 'fav' && !favorites.includes(it.symbol)) return false;

      if (strategyFilter !== 'all') {
        const matchesPrimary = it.setup === strategyFilter;
        const matchesTag = it.tags?.includes(strategyFilter);
        if (!matchesPrimary && !matchesTag) return false;
      }

      if (sectorFilter !== 'all' && it.sector !== sectorFilter) return false;

      if (q) {
        const hay = `${it.symbol} ${it.name} ${it.sector} ${it.alias}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    sorted.sort((a: RadarItem, b: RadarItem) => {
      if (sortBy === 'chg_desc') return b.change_pct - a.change_pct;
      if (sortBy === 'chg_asc') return a.change_pct - b.change_pct;
      if (sortBy === 'rs') return b.rs_20d - a.rs_20d;
      if (sortBy === 'squeeze') return Math.abs(a.ma_spread_pct) - Math.abs(b.ma_spread_pct);
      if (b.radar_score !== a.radar_score) return b.radar_score - a.radar_score;
      return b.rs_20d - a.rs_20d;
    });
    return sorted;
  }, [items, marketFilter, strategyFilter, sectorFilter, query, sortBy, favorites]);

  const vf = radar?.vix_futures;
  const temp = radar?.temperature;
  const counts = radar?.counts;

  return (
    <div className="radar-page">
      {/* Top Action Header */}
      <div className="radar-top-head">
        <div className="rth-left">
          <button type="button" className="btn-back-chart" onClick={onBackToChart}>
            <ArrowLeft size={14} />
            <span>{lang === 'zh' ? '返回 K 线看盘台' : 'Back to Workbench'}</span>
          </button>
          <div className="rth-title">
            <span className="rth-bolt">⚡</span>
            <span>
              {lang === 'zh'
                ? `量化选股 / 选币雷达 (${items.length || 64} 标的)`
                : `Quant Radar Screener (${items.length || 64} Assets)`}
            </span>
          </div>
        </div>

        <div className="rth-right">
          <span className="radar-sync-time">
            {lang === 'zh' ? `全池更新: ${radar?.updated_at || '--'}` : `Synced: ${radar?.updated_at || '--'}`}
          </span>
          <button type="button" className="btn-refresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            <span>{lang === 'zh' ? '立即全池扫描' : 'Scan Now'}</span>
          </button>
        </div>
      </div>

      {/* Top 4-Card Command Strip */}
      <div className="radar-cmd-grid">
        {/* Card 1: 24H Futures Sentinel */}
        <div className="radar-cmd-card">
          <div className="rcc-head">
            <span>{lang === 'zh' ? '📡 24H 美股期指先导哨' : '📡 24H US Futures Sentinel'}</span>
            <span className="rcc-tag">{lang === 'zh' ? '白天看夜盘' : 'Overnight'}</span>
          </div>
          <div className="rcc-futures-rows">
            {[vf?.nq, vf?.es].map((fut, idx) => {
              if (!fut) return null;
              const isUp = fut.change_pct >= 0;
              return (
                <div key={fut.symbol || idx} className="rf-row">
                  <div>
                    <span className="rf-code">{fut.code}</span>
                    <span className="rf-name">{lang === 'zh' ? fut.label_zh : fut.label_en}</span>
                  </div>
                  <div className="rf-vals">
                    <b>{fmtPrice(fut.price)}</b>
                    <span className={isUp ? 'bull' : 'bear'}>
                      {isUp ? '+' : ''}
                      {fut.change_pct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rcc-desc">
            {lang === 'zh'
              ? '北京时间白天美股休市期间，直接以 NQ/ES 期货预判今晚开盘风向。'
              : 'Track NQ & ES 24h futures during Asian/European hours before US cash open.'}
          </div>
        </div>

        {/* Card 2: True VIX Term-Structure Brake */}
        <div className={`radar-cmd-card vix-card state-${(vf?.state || 'NORMAL').toLowerCase()}`}>
          <div className="rcc-head">
            <span>{lang === 'zh' ? '🛡️ 真 VIX 期限结构刹车' : '🛡️ VIX Term Structure'}</span>
            <span className="rcc-tag">
              {vf ? `VIX ${vf.vix_spot} / 3M ${vf.vix3m}` : '--'}
            </span>
          </div>
          <div className="rcc-vix-badge">
            {vf ? (lang === 'zh' ? vf.label_zh : vf.label_en) : '--'}
          </div>
          <div className="rcc-vix-metrics">
            <span>
              {lang === 'zh' ? '近/远月比值' : 'Term Ratio'}:{' '}
              <b className={(vf?.term_ratio ?? 0) >= 1 ? 'bear' : 'bull'}>
                {vf?.term_ratio ? vf.term_ratio.toFixed(2) : '--'}
              </b>
            </span>
            <span>
              {lang === 'zh' ? '10日恐慌峰值' : '10D Peak'}: <b>{vf?.vix_10d_peak ?? '--'}</b>
            </span>
          </div>
          <div className="rcc-desc">
            {vf ? (lang === 'zh' ? vf.desc_zh : vf.desc_en) : ''}
          </div>
        </div>

        {/* Card 3: Bubble & Bottom Thermometers */}
        <div className="radar-cmd-card">
          <div className="rcc-head">
            <span>{lang === 'zh' ? '🌡️ 纯美股泡沫 / 抄底温度计' : '🌡️ Bubble & Bottom Meter'}</span>
            <span className="rcc-tag">{lang === 'zh' ? '已剔除BTC对冲' : 'Pure Equities'}</span>
          </div>
          <div className="thermo-meter-row">
            <div className="tm-label">
              <span>🔥 {lang === 'zh' ? '泡沫评分' : 'Bubble'}: {temp?.bubble_label_zh ?? '--'}</span>
              <b className="bull">{temp?.bubble_score ?? 50} / 100</b>
            </div>
            <div className="tm-track">
              <div
                className="tm-fill-bubble"
                style={{ width: `${temp?.bubble_score ?? 50}%` }}
              />
            </div>
          </div>
          <div className="thermo-meter-row" style={{ marginTop: 8 }}>
            <div className="tm-label">
              <span>🧲 {lang === 'zh' ? '抄底指数' : 'Bottom'}: {temp?.bottom_label_zh ?? '--'}</span>
              <b className="bear">{temp?.bottom_score ?? 50} / 100</b>
            </div>
            <div className="tm-track">
              <div
                className="tm-fill-bottom"
                style={{ width: `${temp?.bottom_score ?? 50}%` }}
              />
            </div>
          </div>
          {temp?.note_zh ? (
            <div className="rcc-warn">{temp.note_zh}</div>
          ) : (
            <div className="rcc-desc">
              {lang === 'zh'
                ? '基于美股核心成分股均线偏离、RSI 与斐波那契坑位深度实时加权。'
                : 'Weighted across core US equities MA distance, RSI14 and Fib depth.'}
            </div>
          )}
        </div>

        {/* Card 4: Signal Distribution Quick Filters */}
        <div className="radar-cmd-card">
          <div className="rcc-head">
            <span>{lang === 'zh' ? '🎯 策略信号池分布（点击直达）' : '🎯 Strategy Buckets'}</span>
            <span className="rcc-tag">{counts?.total ?? items.length} 只</span>
          </div>
          <div className="rcc-buckets">
            <button
              type="button"
              className={`rb-chip pit ${strategyFilter === 'golden_pit' ? 'active' : ''}`}
              onClick={() => setStrategyFilter(strategyFilter === 'golden_pit' ? 'all' : 'golden_pit')}
            >
              <span>🟢 黄金坑右侧</span>
              <b>{counts?.golden_pit ?? 0}</b>
            </button>
            <button
              type="button"
              className={`rb-chip put ${strategyFilter === 'bear_short_put' ? 'active' : ''}`}
              onClick={() => setStrategyFilter(strategyFilter === 'bear_short_put' ? 'all' : 'bear_short_put')}
            >
              <span>🩸 反抽空/Put</span>
              <b>{counts?.bear_short_put ?? 0}</b>
            </button>
            <button
              type="button"
              className={`rb-chip squeeze ${strategyFilter === 'ma_squeeze' ? 'active' : ''}`}
              onClick={() => setStrategyFilter(strategyFilter === 'ma_squeeze' ? 'all' : 'ma_squeeze')}
            >
              <span>⚡ 均线粘合</span>
              <b>{counts?.ma_squeeze ?? 0}</b>
            </button>
            <button
              type="button"
              className={`rb-chip leader ${strategyFilter === 'resilient_leader' ? 'active' : ''}`}
              onClick={() => setStrategyFilter(strategyFilter === 'resilient_leader' ? 'all' : 'resilient_leader')}
            >
              <span>🛡️ 抗跌领涨</span>
              <b>{counts?.resilient_leader ?? 0}</b>
            </button>
            <button
              type="button"
              className={`rb-chip bull ${strategyFilter === 'bull_runner' ? 'active' : ''}`}
              onClick={() => setStrategyFilter(strategyFilter === 'bull_runner' ? 'all' : 'bull_runner')}
            >
              <span>🚀 多头主升</span>
              <b>{counts?.bull_runner ?? 0}</b>
            </button>
            <button
              type="button"
              className={`rb-chip bull ${strategyFilter === 'macd_bull' ? 'active' : ''}`}
              onClick={() => setStrategyFilter(strategyFilter === 'macd_bull' ? 'all' : 'macd_bull')}
            >
              <span>🌊 MACD水上多头</span>
              <b>{counts?.macd_bull ?? 0}</b>
            </button>
            <button
              type="button"
              className={`rb-chip hedge ${strategyFilter === 'hedge_tool' ? 'active' : ''}`}
              onClick={() => setStrategyFilter(strategyFilter === 'hedge_tool' ? 'all' : 'hedge_tool')}
            >
              <span>🛡️ 对冲工具</span>
              <b>{counts?.hedge_tool ?? 0}</b>
            </button>
            <button
              type="button"
              className={`rb-chip crash ${strategyFilter === 'crash_knife' ? 'active' : ''}`}
              onClick={() => setStrategyFilter(strategyFilter === 'crash_knife' ? 'all' : 'crash_knife')}
            >
              <span>🛑 暴跌排雷</span>
              <b>{counts?.crash_knife ?? 0}</b>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="radar-filter-bar">
        <div className="rfb-row">
          <div className="rfb-group">
            {(
              [
                ['all', lang === 'zh' ? `全部 (${items.length})` : `All (${items.length})`],
                ['us', lang === 'zh' ? '🇺🇸 美股·ETF' : '🇺🇸 US'],
                ['crypto', lang === 'zh' ? '₿ 加密货币' : '₿ Crypto'],
                ['commodity', lang === 'zh' ? '🛢️ 黄金·原油' : '🛢️ Cmdty'],
                ['fav', lang === 'zh' ? `⭐ 自选 (${favorites.length})` : `⭐ Fav (${favorites.length})`],
              ] as [MarketFilter, string][]
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className={`rfb-pill ${marketFilter === k ? 'active' : ''}`}
                onClick={() => {
                  setMarketFilter(k);
                  setSectorFilter('all');
                }}
              >
                {lbl}
              </button>
            ))}
            <span className="rfb-divider" />
            <button
              type="button"
              className={`rfb-pill subview ${subView === 'cards' ? 'active' : ''}`}
              onClick={() => setSubView('cards')}
            >
              {lang === 'zh' ? '📋 信号卡片' : '📋 Cards'}
            </button>
            <button
              type="button"
              className={`rfb-pill subview heatmap ${subView === 'heatmap' ? 'active' : ''}`}
              onClick={() => setSubView('heatmap')}
            >
              {lang === 'zh' ? '🟩 板块资金热力图' : '🟩 Heatmap'}
            </button>
          </div>

          <div className="rfb-search-sort">
            <div className="rfb-search">
              <Search size={13} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={lang === 'zh' ? '0ms 秒搜代码/中文名/赛道 (如 美光/大饼)...' : 'Instant search...'}
              />
              {query && (
                <button type="button" className="rfb-clear" onClick={() => setQuery('')}>
                  ×
                </button>
              )}
            </div>
            <select
              className="rfb-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
            >
              <option value="score">{lang === 'zh' ? '排序: 综合评分' : 'Sort: Score'}</option>
              <option value="rs">{lang === 'zh' ? '排序: 20日抗跌RS' : 'Sort: 20D RS'}</option>
              <option value="chg_desc">{lang === 'zh' ? '排序: 涨幅由高到低' : 'Sort: Top Gainers'}</option>
              <option value="chg_asc">{lang === 'zh' ? '排序: 跌幅由深到浅' : 'Sort: Top Losers'}</option>
              <option value="squeeze">{lang === 'zh' ? '排序: 均线极度粘合' : 'Sort: Tightest MA'}</option>
            </select>
          </div>
        </div>

        <div className="rfb-row secondary">
          <div className="rfb-group scrollable">
            {(
              [
                ['all', lang === 'zh' ? '🔥 综合高分' : 'All Setups'],
                ['resilient_leader', lang === 'zh' ? '🛡️ 抗跌领涨' : 'Resilient'],
                ['golden_pit', lang === 'zh' ? '🟢 黄金坑右侧' : 'Golden Pit'],
                ['bear_short_put', lang === 'zh' ? '🩸 反抽做空·Put' : 'Short / Put'],
                ['ma_squeeze', lang === 'zh' ? '⚡ 均线粘合(期权)' : 'MA Squeeze'],
                ['bull_runner', lang === 'zh' ? '🚀 多头主升' : 'Bull Runner'],
                ['macd_bull', lang === 'zh' ? '🌊 MACD水上多头' : 'MACD Above 0'],
                ['hedge_tool', lang === 'zh' ? '🛡️ 对冲工具' : 'Hedge Tools'],
                ['crash_knife', lang === 'zh' ? '🛑 暴跌排雷' : 'Crash Lock'],
              ] as [StrategyFilter, string][]
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className={`rfb-strat ${k} ${strategyFilter === k ? 'active' : ''}`}
                onClick={() => setStrategyFilter(k)}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="rfb-group scrollable">
            <button
              type="button"
              className={`rfb-sector ${sectorFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSectorFilter('all')}
            >
              {lang === 'zh' ? '全部赛道' : 'All Sectors'}
            </button>
            {availableSectors.map((sec) => (
              <button
                key={sec}
                type="button"
                className={`rfb-sector ${sectorFilter === sec ? 'active' : ''}`}
                onClick={() => setSectorFilter(sectorFilter === sec ? 'all' : sec)}
              >
                {sec}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cards Grid or Heatmap View */}
      {subView === 'heatmap' ? (
        <HeatmapView
          items={filteredItems}
          lang={lang}
          onJumpToChart={(it) => onSelectSymbol(it.market, it.symbol)}
        />
      ) : filteredItems.length === 0 ? (
        <div className="radar-empty">
          {items.length === 0
            ? lang === 'zh'
              ? '⏳ 正在并发扫描全市场 64 只美股与加密资产日线结构，请稍候 2~3 秒...'
              : 'Scanning 64 US & Crypto assets...'
            : lang === 'zh'
            ? '当前筛选条件下暂无匹配标的，可点「🔥 综合高分」或「全部赛道」重置筛选。'
            : 'No matching assets under current filters.'}
        </div>
      ) : (
        <div className="radar-cards-grid">
          {filteredItems.map((it) => {
            const isFav = favorites.includes(it.symbol);
            const isUp = it.change_pct >= 0;
            const rsUp = it.rs_20d >= 0;
            return (
              <div
                key={`${it.market}:${it.symbol}`}
                className={`radar-card setup-${it.setup}`}
                onClick={() => onSelectSymbol(it.market, it.symbol)}
              >
                <div className="rc-top">
                  <div className="rc-sym-block">
                    <span className="rc-mkt-tag">
                      {it.market === 'crypto' ? '₿' : it.market === 'commodity' ? '油金' : '$'}
                    </span>
                    <div>
                      <div className="rc-sym-line">
                        <b>{it.symbol}</b>
                        <span className="rc-sector">{it.sector}</span>
                      </div>
                      <div className="rc-name">{it.name}</div>
                    </div>
                  </div>
                  <div className="rc-price-block">
                    <div className="rc-price">{fmtPrice(it.price)}</div>
                    <div className={`rc-chg ${isUp ? 'bull' : 'bear'}`}>
                      {isUp ? '+' : ''}
                      {it.change_pct.toFixed(2)}%
                    </div>
                  </div>
                </div>

                <div className="rc-badges-row">
                  <span className={`rc-setup-pill setup-${it.setup}`}>
                    {lang === 'zh' ? it.setup_zh : it.setup_en}
                  </span>
                  <span className="rc-score-pill">
                    {lang === 'zh' ? `评分 ${it.radar_score}` : `Score ${it.radar_score}`}
                  </span>
                  {it.macd_label_zh && (
                    <span className={`rc-macd-pill state-${it.macd_state || 'below_bear'}`}>
                      MACD·{lang === 'zh' ? it.macd_label_zh : it.macd_label_en}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`star-btn ${isFav ? 'fav' : ''}`}
                    onClick={(e) => onToggleFavorite(it.symbol, e)}
                    title="Favorite"
                  >
                    <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                  </button>
                </div>

                <div className="rc-metrics">
                  <div>
                    <span>{lang === 'zh' ? '20日RS' : '20D RS'}</span>
                    <b className={rsUp ? 'bull' : 'bear'}>
                      {rsUp ? '+' : ''}
                      {it.rs_20d.toFixed(1)}%
                    </b>
                  </div>
                  <div>
                    <span>RSI14</span>
                    <b>{it.rsi14.toFixed(0)}</b>
                  </div>
                  <div>
                    <span>{lang === 'zh' ? '20/60差' : 'MA Gap'}</span>
                    <b className={Math.abs(it.ma_spread_pct) <= 1.8 ? 'warn-text' : ''}>
                      {it.ma_spread_pct >= 0 ? '+' : ''}
                      {it.ma_spread_pct.toFixed(1)}%
                    </b>
                  </div>
                  <div>
                    <span>RVol</span>
                    <b>{it.rvol.toFixed(1)}x</b>
                  </div>
                </div>

                <div className="rc-trio">
                  <div>
                    <span>{lang === 'zh' ? '参考入场' : 'Entry'}</span>
                    <b>{fmtPrice(it.entry_ref)}</b>
                  </div>
                  <div>
                    <span>{lang === 'zh' ? '目标止盈' : 'Target'}</span>
                    <b className="bull">{fmtPrice(it.target_ref)}</b>
                  </div>
                  <div>
                    <span>{lang === 'zh' ? '铁血止损' : 'Stop'}</span>
                    <b className="bear">{fmtPrice(it.stop_ref)}</b>
                  </div>
                </div>

                <div className="rc-foot">
                  <span className="rc-pos">
                    {it.crash_lock
                      ? lang === 'zh'
                        ? '🛑 触发熔断 · 建议仓位 0%'
                        : '🛑 Crash Lock · 0%'
                      : lang === 'zh'
                      ? `1.5%风控建议仓位: ${it.risk_parity_pct}% (止损距 ${it.stop_dist_pct}%)`
                      : `1.5% Risk Size: ${it.risk_parity_pct}% (SL ${it.stop_dist_pct}%)`}
                  </span>
                  <button
                    type="button"
                    className="rc-jump-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSymbol(it.market, it.symbol);
                    }}
                  >
                    <TrendingUp size={12} />
                    <span>{lang === 'zh' ? '看K线' : 'Chart'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
