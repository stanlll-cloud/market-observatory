import React, { memo, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, ShieldAlert } from 'lucide-react';
import type { CalendarEconEvent, CalendarResponse } from '../types';

interface Props {
  data: CalendarResponse | null;
  loading: boolean;
  lang: 'zh' | 'en';
  onRefresh: () => void;
  onBackToWorkbench: () => void;
  onJumpToSymbol: (symbol: string) => void;
}

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getFriendlyDayLabel(dateStr: string, isZh: boolean): string {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const tmr = new Date(now.getTime() + 86400000);
  const tmrStr = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const wk = WEEKDAYS_ZH[dt.getDay()] || '';
  if (!isZh) return `${dateStr}`;
  if (dateStr === todayStr) return `今天 (${dateStr.slice(5)} ${wk})`;
  if (dateStr === tmrStr) return `明天 (${dateStr.slice(5)} ${wk})`;
  return `${dateStr.slice(5)} ${wk}`;
}

function fmtCountdown(secLeft: number, isZh: boolean): string {
  if (secLeft <= 0) return isZh ? '公布中 / 即将出炉' : 'Live / Releasing';
  const days = Math.floor(secLeft / 86400);
  const rem = secLeft % 86400;
  const hh = String(Math.floor(rem / 3600)).padStart(2, '0');
  const mm = String(Math.floor((rem % 3600) / 60)).padStart(2, '0');
  const ss = String(rem % 60).padStart(2, '0');
  if (days > 0) return `${days}${isZh ? '天 ' : 'd '}${hh}:${mm}:${ss}`;
  return `${hh}:${mm}:${ss}`;
}

/** Isolated 1s timer leaf so CalendarPage cards NEVER re-render every second */
const LiveCountdownClock: React.FC<{ targetTs?: number; isZh: boolean }> = memo(({ targetTs, isZh }) => {
  const [nowTs, setNowTs] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!targetTs) return;
    const id = window.setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [targetTs]);

  if (!targetTs) return <div className="cal-clock-digits">--:--:--</div>;
  return <div className="cal-clock-digits">{fmtCountdown(Math.max(0, targetTs - nowTs), isZh)}</div>;
});

export const CalendarPage: React.FC<Props> = memo(
  ({ data, loading, lang, onRefresh, onBackToWorkbench, onJumpToSymbol }) => {
    const isZh = lang === 'zh';
    const [tab, setTab] = useState<'econ' | 'earnings'>('econ');
    const [onlyHigh, setOnlyHigh] = useState<boolean>(false);
    const [onlyWatchlist, setOnlyWatchlist] = useState<boolean>(false);

    const econList = useMemo(() => {
      const list = data?.economic_events || [];
      return onlyHigh ? list.filter((e) => e.impact === 'high') : list;
    }, [data, onlyHigh]);

    const groupedEcon = useMemo(() => {
      const map = new Map<string, CalendarEconEvent[]>();
      for (const ev of econList) {
        const key = ev.cst_date || ev.date;
        const arr = map.get(key) || [];
        arr.push(ev);
        map.set(key, arr);
      }
      return Array.from(map.entries());
    }, [econList]);

    const earningsList = useMemo(() => {
      const list = data?.earnings || [];
      return onlyWatchlist ? list.filter((e) => e.in_watchlist) : list;
    }, [data, onlyWatchlist]);

    const nextEv = data?.next_high_impact || null;
    const hoursToNext = nextEv ? (nextEv.timestamp - Math.floor(Date.now() / 1000)) / 3600 : 999;
    const isUrgent24h = nextEv !== null && hoursToNext <= 24;

    return (
      <div className="calendar-page">
        {/* Top Header matching RadarPage button styling */}
        <div className="radar-top-head">
          <div className="rth-left">
            <button type="button" className="btn-back-chart" onClick={onBackToWorkbench}>
              <ArrowLeft size={14} />
              <span>{isZh ? '返回 K 线看盘台' : 'Back to Workbench'}</span>
            </button>
            <div className="rth-title">
              <ShieldAlert size={16} color="#ffd400" />
              <span>
                {isZh
                  ? '防插针 · 财报避雷针（本周重磅催化剂）'
                  : 'Macro Spike Guard & Earnings Avoidance'}
              </span>
            </div>
          </div>

          <div className="rth-right">
            <span className="radar-sync-time">
              {data?.updated_at
                ? isZh
                  ? `更新: ${data.updated_at} 北京时间`
                  : `Synced: ${data.updated_at}`
                : ''}
            </span>
            <button type="button" className="btn-refresh" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              <span>{isZh ? '刷新避雷日历' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Beginner 3-Second Guide + Next Event Countdown Hero */}
        <div className={`cal-hero-countdown ${isUrgent24h ? 'urgent' : 'calm'}`}>
          <div className="cal-hero-left">
            <div className="cal-hero-eyebrow">
              <span className={`cal-status-pill ${isUrgent24h ? 'urgent' : 'safe'}`}>
                {isUrgent24h
                  ? isZh
                    ? '🔴 未来24小时内有数据插针预警'
                    : '🔴 HIGH VOLATILITY < 24H'
                  : isZh
                  ? '🟢 今晚无宏观核弹雷 · 可放心按均线节奏做单'
                  : '🟢 CALM WINDOW TONIGHT · FOLLOW TREND'}
              </span>
              {nextEv && (
                <span className="cal-country-tag">
                  {isZh ? '下一重点' : 'Next'}: {nextEv.cst_date.slice(5)} {nextEv.cst_time} 北京时间
                </span>
              )}
            </div>

            <div className="cal-hero-title">
              {nextEv
                ? isZh
                  ? `${nextEv.event_zh}`
                  : nextEv.event
                : loading
                ? isZh
                  ? '正在过滤出本周最核心的美股/BTC催化剂...'
                  : 'Loading curated US macro catalysts...'
                : isZh
                ? '未来6天暂无重大核弹级宏观数据'
                : 'No major macro bombs in next 6 days'}
            </div>

            {nextEv && (
              <div className="cal-hero-meta">
                <span>📌 {nextEv.why_zh}</span>
                {nextEv.consensus && (
                  <span>
                    · {isZh ? '预期' : 'Est'}: <b>{nextEv.consensus}</b>
                  </span>
                )}
                {nextEv.previous && (
                  <span>
                    · {isZh ? '前值' : 'Prev'}: <b>{nextEv.previous}</b>
                  </span>
                )}
              </div>
            )}

            <div className="cal-guide-pills">
              <span>
                {isZh
                  ? '① 宏观防插针：重磅数据公布前15分钟勿重仓，防瞬间上下插针洗盘'
                  : '① Avoid heavy bets 15m before macro prints to dodge liquidity wicks'}
              </span>
              <span>
                {isZh
                  ? '② 财报避雷针：美股发财报前 IV 极高，发完常跌波双杀（IV Crush）'
                  : '② Avoid holding single-leg options through earnings IV Crush'}
              </span>
            </div>
          </div>

          <div className="cal-hero-clock">
            <div className="cal-clock-label">
              {nextEv
                ? isZh
                  ? `距「${nextEv.event_zh}」`
                  : 'NEXT CATALYST'
                : isZh
                ? '安全倒计时'
                : 'COUNTDOWN'}
            </div>
            <LiveCountdownClock targetTs={nextEv?.timestamp} isZh={isZh} />
          </div>
        </div>

        {/* Clean 2-Tab Bar */}
        <div className="cal-toolbar">
          <div className="cal-main-tabs">
            <button
              type="button"
              className={`cal-tab-btn ${tab === 'econ' ? 'active' : ''}`}
              onClick={() => setTab('econ')}
            >
              {isZh
                ? `⚡ 大盘防插针时刻表 (${data?.econ_count ?? 0})`
                : `⚡ Macro Catalysts (${data?.econ_count ?? 0})`}
            </button>
            <button
              type="button"
              className={`cal-tab-btn ${tab === 'earnings' ? 'active' : ''}`}
              onClick={() => setTab('earnings')}
            >
              {isZh
                ? `💣 大票财报避雷榜 (${data?.earnings_count ?? 0})`
                : `💣 Major Earnings (${data?.earnings_count ?? 0})`}
            </button>
          </div>

          <div className="cal-sub-filters">
            {tab === 'econ' ? (
              <button
                type="button"
                className={`filter-pill ${onlyHigh ? 'active' : ''}`}
                onClick={() => setOnlyHigh((v) => !v)}
              >
                {isZh ? '🔴 只看核弹级数据 (PCE/CPI/非农/GDP)' : '🔴 High Impact Only'}
              </button>
            ) : (
              <button
                type="button"
                className={`filter-pill ${onlyWatchlist ? 'active' : ''}`}
                onClick={() => setOnlyWatchlist((v) => !v)}
              >
                {isZh
                  ? `⭐ 只看我的雷达观察池 (${data?.watchlist_earnings_count ?? 0})`
                  : `⭐ Watchlist Only (${data?.watchlist_earnings_count ?? 0})`}
              </button>
            )}
          </div>
        </div>

        {/* Curated Macro Events Grouped by Day */}
        {tab === 'econ' ? (
          groupedEcon.length === 0 ? (
            <div className="radar-empty-box">
              {loading
                ? isZh
                  ? '正在从 Nasdaq 筛选本周核心事件...'
                  : 'Loading macro events...'
                : isZh
                ? '当前筛选窗口内暂无核弹级宏观事件，大盘主要按均线和技术结构运行。'
                : 'No high-impact macro events in current filter.'}
            </div>
          ) : (
            <div className="cal-days-stack">
              {groupedEcon.map(([dayStr, events]) => (
                <section key={dayStr} className="cal-day-group">
                  <div className="cal-day-header">
                    <span className="cal-day-dot" />
                    <h3>{getFriendlyDayLabel(dayStr, isZh)}</h3>
                    <span className="cal-day-cnt">{events.length} 项重点</span>
                  </div>
                  <div className="cal-cards-grid">
                    {events.map((ev) => (
                      <div key={ev.id} className={`cal-event-card impact-${ev.impact}`}>
                        <div className="cal-ev-top">
                          <span className={`cal-impact-pill ${ev.impact}`}>
                            {ev.impact === 'high'
                              ? isZh
                                ? '🔴 核弹级防插针'
                                : 'HIGH'
                              : isZh
                              ? '🟡 短线波动催化剂'
                              : 'MEDIUM'}
                          </span>
                          <span className="cal-ev-time">
                            🇨🇳 {ev.cst_time} 北京 · 🇺🇸 {ev.et_time} ET
                          </span>
                        </div>

                        <div className="cal-ev-name">{isZh ? ev.event_zh : ev.event}</div>
                        {isZh && <div className="cal-ev-en">{ev.event}</div>}

                        <div className="cal-ev-metrics">
                          <div className="cal-metric-cell">
                            <span>{isZh ? '公布结果' : 'Actual'}</span>
                            <b className={ev.actual ? 'highlight' : ''}>{ev.actual || '待公布'}</b>
                          </div>
                          <div className="cal-metric-cell">
                            <span>{isZh ? '市场预期' : 'Consensus'}</span>
                            <b>{ev.consensus || '暂无预期'}</b>
                          </div>
                          <div className="cal-metric-cell">
                            <span>{isZh ? '上期前值' : 'Previous'}</span>
                            <b>{ev.previous || '-'}</b>
                          </div>
                        </div>

                        {ev.why_zh && (
                          <div className="cal-ev-why">
                            <span>📌 为什么盯它：</span>
                            {ev.why_zh}
                          </div>
                        )}
                        {ev.playbook_zh && (
                          <div className="cal-ev-playbook">
                            <span>🛡️ 实战应对：</span>
                            {ev.playbook_zh}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : earningsList.length === 0 ? (
          <div className="radar-empty-box">
            {isZh ? '当前筛选下暂无重点观察池美股财报' : 'No matching earnings in window'}
          </div>
        ) : (
          <div className="cal-earnings-grid">
            {earningsList.map((item) => (
              <div
                key={`${item.date}-${item.symbol}`}
                className={`cal-earning-card ${item.in_watchlist ? 'watchlist' : ''}`}
              >
                <div className="cal-earn-head">
                  <div>
                    <div className="cal-earn-sym-row">
                      <span className="cal-earn-sym">{item.symbol}</span>
                      {item.in_watchlist && (
                        <span className="cal-watch-tag">
                          {isZh ? '⭐ 雷达观察池' : '⭐ Watchlist'}
                        </span>
                      )}
                      <span className={`cal-slot-tag slot-${item.time_slot.toLowerCase()}`}>
                        {isZh ? item.time_label_zh : item.time_slot}
                      </span>
                    </div>
                    <div className="cal-earn-name">{item.name}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-jump-kline"
                    onClick={() => onJumpToSymbol(item.symbol)}
                  >
                    {isZh ? '📈 看K线' : '📈 Chart'}
                  </button>
                </div>

                <div className="cal-earn-metrics">
                  <div>
                    <span>{isZh ? '财报时间' : 'Date'}</span>
                    <b>
                      {item.date.slice(5)} (
                      {item.days_until === 0 ? (isZh ? '今天' : 'Today') : `${item.days_until}${isZh ? '天后' : 'd'}`})
                    </b>
                  </div>
                  <div>
                    <span>{isZh ? '总市值' : 'Cap'}</span>
                    <b>{item.market_cap_fmt}</b>
                  </div>
                  <div>
                    <span>{isZh ? '预期 EPS' : 'Est EPS'}</span>
                    <b>{item.eps_forecast}</b>
                  </div>
                  <div>
                    <span>{isZh ? '去年同期' : 'Last Yr'}</span>
                    <b>{item.last_year_eps}</b>
                  </div>
                </div>

                {item.iv_crush_risk && (
                  <div className="cal-iv-crush-banner">
                    {isZh
                      ? `💣 ${item.playbook_zh}`
                      : `⚠️ Earnings in ${item.days_until}d · Avoid single-leg options IV Crush.`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);
