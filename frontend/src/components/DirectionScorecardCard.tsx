import React, { useState } from 'react';
import { Award, ChevronDown, ChevronUp } from 'lucide-react';
import type { DirectionScorecard, LangType } from '../types';

interface Props {
  scorecard?: DirectionScorecard | null;
  interval: string;
  lang: LangType;
}

function fmtShortTime(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function fmtPx(p: number): string {
  if (!p) return '-';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (p >= 10) return p.toFixed(2);
  if (p >= 0.1) return p.toFixed(4);
  return p.toFixed(6);
}

export const DirectionScorecardCard: React.FC<Props> = ({ scorecard, interval, lang }) => {
  const [expanded, setExpanded] = useState(false);
  const isZh = lang === 'zh';

  if (!scorecard) {
    return (
      <div className="panel-card sc-card">
        <div className="card-header">
          <span>{isZh ? '12K 方向胜率成绩单' : '12-Bar Direction Scorecard'}</span>
          <span className="card-sub">{interval.toUpperCase()}</span>
        </div>
        <div className="overview-summary">
          {isZh ? '当前 K 线样本少于 85 根，暂无法生成 12K 回测成绩单。' : 'Need >= 85 candles for 12-bar scorecard.'}
        </div>
      </div>
    );
  }

  const edgePos = scorecard.edge_vs_baseline >= 0;
  const avgPos = scorecard.avg_signed_ret_pct >= 0;

  return (
    <div className="panel-card sc-card">
      <div className="card-header">
        <span className="sc-title-wrap">
          <Award size={13} className="sc-award-ico" />
          <span>{isZh ? '12K 方向胜率成绩单' : '12-Bar Scorecard'}</span>
        </span>
        <span className={`sc-grade grade-${scorecard.grade.toLowerCase()}`}>
          {isZh ? `评级 ${scorecard.grade}` : `Grade ${scorecard.grade}`}
        </span>
      </div>

      <div className="sc-hero">
        <div className="sc-hero-main">
          <div className={`sc-win-num ${scorecard.win_rate >= 55 ? 'bull' : scorecard.win_rate < 48 ? 'bear' : ''}`}>
            {scorecard.win_rate.toFixed(1)}%
          </div>
          <div className="sc-win-sub">
            {isZh
              ? `命中 ${scorecard.hits}/${scorecard.calls} 次 (观望 ${scorecard.abstained})`
              : `${scorecard.hits}/${scorecard.calls} hits (${scorecard.abstained} flat)`}
          </div>
        </div>
        <div className="sc-hero-side">
          <div className={`sc-edge-pill ${edgePos ? 'bull' : 'bear'}`}>
            {isZh ? 'vs基线 ' : 'vs Naive '}
            {edgePos ? '+' : ''}
            {scorecard.edge_vs_baseline.toFixed(1)}%
          </div>
          <div className="sc-avg-ret">
            {isZh ? '均值 ' : 'Avg '}
            <b className={avgPos ? 'bull' : 'bear'}>
              {avgPos ? '+' : ''}
              {scorecard.avg_signed_ret_pct.toFixed(2)}%
            </b>
          </div>
        </div>
      </div>

      <div className="sc-split-grid">
        <div className="sc-split-box">
          <div className="sc-sb-top">
            <span className="bull">{isZh ? '做多命中' : 'Long Hit'}</span>
            <b>
              {scorecard.bull_win_rate.toFixed(0)}% ({scorecard.bull_hits}/{scorecard.bull_calls})
            </b>
          </div>
          <div className="f-track">
            <div className="f-fill bull" style={{ width: `${Math.min(100, scorecard.bull_win_rate)}%` }} />
          </div>
        </div>
        <div className="sc-split-box">
          <div className="sc-sb-top">
            <span className="bear">{isZh ? '做空命中' : 'Short Hit'}</span>
            <b>
              {scorecard.bear_win_rate.toFixed(0)}% ({scorecard.bear_hits}/{scorecard.bear_calls})
            </b>
          </div>
          <div className="f-track">
            <div className="f-fill bear" style={{ width: `${Math.min(100, scorecard.bear_win_rate)}%` }} />
          </div>
        </div>
      </div>

      {scorecard.recent_records.length > 0 && (
        <div className="sc-streak-row">
          <span className="sc-streak-lbl">{isZh ? '近8次检验' : 'Last 8'}</span>
          <div className="sc-streak-dots">
            {scorecard.recent_records.map((rec, i) => (
              <span
                key={`sr-${rec.time}-${i}`}
                className={`sc-dot ${rec.hit ? 'hit' : 'miss'}`}
                title={`${fmtShortTime(rec.time)} ${rec.prediction === 'bull' ? '看多' : '看空'} -> ${rec.signed_ret_pct >= 0 ? '+' : ''}${rec.signed_ret_pct.toFixed(2)}%`}
              >
                {rec.hit ? '✓' : '✗'}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="sc-expand-btn"
            onClick={() => setExpanded((v) => !v)}
          >
            <span>{isZh ? (expanded ? '收起' : '明细') : expanded ? 'Hide' : 'Log'}</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      )}

      {expanded && scorecard.recent_records.length > 0 && (
        <div className="sc-table">
          <div className="sc-tr head">
            <span>{isZh ? '触发时间' : 'Time'}</span>
            <span>{isZh ? '方向' : 'Call'}</span>
            <span>{isZh ? '12K 盈亏' : '12B Ret'}</span>
          </div>
          {scorecard.recent_records.slice().reverse().map((rec, i) => (
            <div key={`row-${rec.time}-${i}`} className="sc-tr">
              <span className="sc-td-time" title={`${fmtPx(rec.entry_price)} → ${fmtPx(rec.exit_price)}`}>
                {fmtShortTime(rec.time)}
              </span>
              <span className={rec.prediction === 'bull' ? 'bull' : 'bear'}>
                {rec.prediction === 'bull' ? (isZh ? '看多' : 'Long') : isZh ? '看空' : 'Short'}
              </span>
              <span className={rec.hit ? 'bull' : 'bear'}>
                {rec.hit ? '✓ ' : '✗ '}
                {rec.signed_ret_pct >= 0 ? '+' : ''}
                {rec.signed_ret_pct.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {scorecard.low_sample && (
        <div className="sim-warn">
          {isZh ? '⚠ 有效出手样本不足 10 次，胜率仅供参考' : '⚠ Fewer than 10 directional calls; sample small'}
        </div>
      )}
    </div>
  );
};
