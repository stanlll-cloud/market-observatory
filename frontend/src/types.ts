export type MarketType = 'crypto' | 'us' | 'commodity';
export type LangType = 'zh' | 'en';

export interface SymbolItem {
  symbol: string;
  market: MarketType;
  name: string;
  exchange: string;
  sector?: string;
  sector_en?: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MacdPoint {
  time: number;
  dif: number;
  dea: number;
  hist: number;
}

export interface Fractal {
  index: number;
  time: number;
  price: number;
  type: 'top' | 'bottom';
}

export interface Stroke {
  start_idx: number;
  end_idx: number;
  start_time: number;
  end_time: number;
  start_price: number;
  end_price: number;
  direction: 'up' | 'down';
}

export interface Segment {
  start_time: number;
  end_time: number;
  start_price: number;
  end_price: number;
  direction: 'up' | 'down';
}

export interface Center {
  start_time: number;
  end_time: number;
  zg: number;
  zd: number;
  gg: number;
  dd: number;
  level: string;
}

export interface Signal {
  time: number;
  price: number;
  type: 'top_div' | 'bottom_div';
  label: string;
}

export interface BiasFactor {
  key: string;
  label: string;
  label_en: string;
  score: number;
}

export interface TradePlan {
  side: 'bull' | 'bear';
  status: string;
  entry_low: number;
  entry_high: number;
  t1: number;
  t2: number;
  stop_loss: number;
  projection_paths: {
    primary: { time: number; value: number }[];
    secondary: { time: number; value: number }[];
  };
}

export interface DualMaCross {
  time: number;
  price: number;
  type: 'golden' | 'death';
  label: string;
}

export interface DualMaData {
  ma_type: string;
  fast_period: number;
  slow_period: number;
  fast_line: { time: number; value: number }[];
  slow_line: { time: number; value: number }[];
  crosses: DualMaCross[];
  fast_val: number;
  slow_val: number;
  spread_pct: number;
  trend: 'bullish' | 'pullback' | 'bearish' | 'rebound' | 'neutral';
  trend_label_zh: string;
  trend_label_en: string;
}

export interface BullBandData {
  period: number;
  ema_line: { time: number; value: number }[];
  sma_line: { time: number; value: number }[];
  ema_val: number;
  sma_val: number;
  ema_rising: boolean;
  sma_rising: boolean;
  both_rising: boolean;
  both_falling: boolean;
  price_above: boolean;
  price_below: boolean;
  ema_above_sma: boolean;
  state: 'bull_rising' | 'bull_watch' | 'inside_band' | 'bear_falling' | 'bear_below' | 'neutral';
  label_zh: string;
  label_en: string;
}

export interface BuyAdvice {
  action: 'BUY' | 'ACCUMULATE' | 'WAIT' | 'AVOID';
  action_zh: string;
  action_en: string;
  confidence: number;
  position_zh: string;
  position_en: string;
  entry_low: number;
  entry_high: number;
  target_price: number;
  stop_loss: number;
  stop_dist_pct?: number;
  risk_parity_pct?: number;
  crash_lock?: boolean;
  reasons_zh: string[];
  reasons_en: string[];
}

export interface HtfLock {
  interval: string;
  interval_zh: string;
  locked: boolean;
  trend: string;
  label_zh: string;
  label_en: string;
  fast_val: number;
  slow_val: number;
}

export interface OptionsAdvice {
  signal: 'BUY_CALL' | 'BUY_PUT' | 'WAIT_IV' | 'NO_TRADE';
  signal_zh: string;
  signal_en: string;
  direction: 'CALL' | 'PUT' | 'NONE';
  strike: number;
  dte_zh: string;
  dte_en: string;
  entry_trigger_zh: string;
  entry_trigger_en: string;
  size_zh: string;
  size_en: string;
  rule_zh: string;
  rule_en: string;
}

export interface FibonacciLevel {
  ratio: string;
  price: number;
}

export interface FibonacciData {
  direction: 'up' | 'down';
  swing_high: number;
  swing_low: number;
  levels: FibonacciLevel[];
  confluence: boolean;
  match_label_zh: string;
  match_label_en: string;
}

export interface RegimeData {
  state: 'tangled' | 'bear_chop' | 'bull_chop' | 'bear_trend' | 'bull_trend' | 'trend';
  title_zh: string;
  title_en: string;
  desc_zh: string;
  desc_en: string;
  range_pct: number;
  markers: { time: number; type: string; label: string }[];
}

export interface VwapData {
  line: { time: number; value: number }[];
  current: number;
  dist_pct: number;
  above: boolean;
}

export interface AbsorptionSignal {
  time: number;
  price: number;
  type: 'bull_absorb' | 'bear_absorb';
  grade: 'A' | 'B';
  score: number;
  vol_ratio: number;
  sweep: boolean;
  label: string;
  label_en: string;
}

export interface FvgZone {
  type: 'bull' | 'bear';
  start_time: number;
  start_index: number;
  top: number;
  bottom: number;
  orig_top: number;
  orig_bottom: number;
  ce_mid: number;
  fill_pct: number;
  dist_pct: number;
}

export interface DirectionScoreRecord {
  time: number;
  end_time: number;
  prediction: 'bull' | 'bear';
  outcome: 'bull' | 'bear' | 'neutral';
  hit: boolean;
  entry_price: number;
  exit_price: number;
  raw_ret_pct: number;
  signed_ret_pct: number;
  bull_pct: number;
}

export interface DirectionScorecard {
  horizon: number;
  seen: number;
  calls: number;
  abstained: number;
  hits: number;
  win_rate: number;
  bull_calls: number;
  bull_hits: number;
  bull_win_rate: number;
  bear_calls: number;
  bear_hits: number;
  bear_win_rate: number;
  baseline_hits: number;
  baseline_win_rate: number;
  edge_vs_baseline: number;
  avg_signed_ret_pct: number;
  grade: 'A' | 'B' | 'C' | 'D';
  low_sample: boolean;
  recent_records: DirectionScoreRecord[];
}

export interface LiquidationBin {
  price: number;
  price_low: number;
  price_high: number;
  side: 'short_liq' | 'long_liq';
  liq_usd: number;
  intensity: number;
  dist_pct: number;
  dominant_lev: number;
}

export interface LiquidationCluster {
  price: number;
  liq_usd: number;
  dist_pct: number;
  dominant_lev: number;
  side: 'short_liq' | 'long_liq';
}

export interface LiquidationResponse {
  supported: boolean;
  symbol: string;
  hl_coin?: string;
  interval?: string;
  reason?: string;
  reason_en?: string;
  mark_price?: number;
  oracle_price?: number;
  open_interest_usd?: number;
  day_volume_usd?: number;
  max_leverage?: number;
  funding_8h_pct?: number;
  funding_ann_pct?: number;
  long_ratio?: number;
  short_ratio?: number;
  ls_source?: string;
  upper_total_usd?: number;
  lower_total_usd?: number;
  imbalance_pct?: number;
  upper_clusters: LiquidationCluster[];
  lower_clusters: LiquidationCluster[];
  bins: LiquidationBin[];
  summary_zh?: string;
  summary_en?: string;
  updated_ts?: number;
}

export interface AnalysisData {
  fractals: Fractal[];
  strokes: Stroke[];
  segments: Segment[];
  centers: Center[];
  signals: Signal[];
  absorption?: AbsorptionSignal[];
  fvg_zones?: FvgZone[];
  dual_ma?: DualMaData;
  bull_band?: BullBandData;
  vwap?: VwapData | null;
  fibonacci?: FibonacciData | null;
  regime?: RegimeData | null;
  buy_advice?: BuyAdvice | null;
  options_advice?: OptionsAdvice | null;
  htf_lock?: HtfLock | null;
  earnings_warning?: EarningsWarning | null;
  direction_scorecard?: DirectionScorecard | null;
  bias: {
    bull_pct: number;
    bear_pct: number;
    factors: BiasFactor[];
  };
  overview: {
    stroke_count: number;
    segment_count: number;
    center_count: number;
    zg: number;
    zd: number;
    summary_zh: string;
    summary_en: string;
  };
  plans: {
    bull_plan: TradePlan;
    bear_plan: TradePlan;
  } | null;
  similar_samples: {
    count: number;
    up_pct: number;
    flat_pct: number;
    down_pct: number;
    horizon: number;
  };
}

export interface AnalyzeResponse {
  meta: {
    symbol: string;
    price: number;
    price_change: number;
    price_change_percent: number;
    source: string;
    name?: string;
    exchange?: string;
    sector?: string;
    sector_en?: string;
    interval?: string;
    market?: MarketType;
    session?: string;
    session_zh?: string;
    session_en?: string;
  };
  candles: Candle[];
  total_candles: number;
  macd: MacdPoint[];
  analysis: AnalysisData;
  error?: string;
}

export interface EtfFlowItem {
  symbol: string;
  label_zh: string;
  label_en: string;
  price: number;
  change_pct: number;
  intraday_range_pct: number;
  rvol: number;
  flow_state: 'strong_inflow' | 'inflow' | 'strong_outflow' | 'outflow' | 'neutral';
  flow_zh: string;
  flow_en: string;
}

export interface BullBearStep {
  id: number;
  done: boolean;
  label_zh: string;
  label_en: string;
}

export interface BullBearCycle {
  ready: boolean;
  sma20: number;
  sma60: number;
  sma120: number;
  deduct_20: number;
  is_deduct_low: boolean;
  deduct_label_zh: string;
  deduct_label_en: string;
  gap_20_60_pct: number;
  vol_compress_ratio: number;
  low_vol_bottoming: boolean;
  steps: BullBearStep[];
  completed_steps: number;
  permission_state: 'bull_full' | 'bull_unlock' | 'coil_watch' | 'bear_lock' | 'transition' | 'neutral';
  permission_zh: string;
  permission_en: string;
  squeeze_warning_zh: string;
  squeeze_warning_en: string;
}

export interface BreakingNewsItem {
  id: string;
  ts: number;
  time_str: string;
  age_minutes: number;
  age_label_zh: string;
  age_label_en: string;
  is_within_30m: boolean;
  source: string;
  text: string;
  importance: 'high' | 'normal';
  sentiment: 'bull' | 'bear' | 'volatile' | 'neutral';
  tag_zh: string;
  tag_en: string;
}

export interface MacroGuidance {
  mood: string;
  mood_zh: string;
  mood_en: string;
  wick_level: 'high' | 'medium' | 'low';
  wick_warning_zh: string;
  wick_warning_en: string;
  buy_method_zh: string;
  buy_method_en: string;
  in_us_open_window: boolean;
  hot_30m_count: number;
  target_context: string;
}

export interface MacroIntelResponse {
  etfs: EtfFlowItem[];
  water_sources: {
    btc_etf_flow_zh: string;
    btc_etf_flow_en: string;
    fed_liquidity_zh: string;
    fed_liquidity_en: string;
  };
  cycle: BullBearCycle;
  guidance: MacroGuidance;
  news: BreakingNewsItem[];
  within_30m_count: number;
  updated_at: string;
}

export interface RadarFuturesItem {
  symbol: string;
  code: string;
  label_zh: string;
  label_en: string;
  price: number;
  change_pct: number;
}

export interface RadarVixFutures {
  nq: RadarFuturesItem;
  es: RadarFuturesItem;
  vix_spot: number;
  vix3m: number;
  term_ratio: number;
  vix_10d_peak: number;
  state: 'HARD_BRAKE' | 'RELIEF_WINDOW' | 'CAUTION' | 'NORMAL';
  label_zh: string;
  label_en: string;
  desc_zh: string;
  desc_en: string;
}

export interface RadarTemperature {
  bubble_score: number;
  bottom_score: number;
  bubble_label_zh: string;
  bottom_label_zh: string;
  note_zh: string;
}

export interface RadarCounts {
  total: number;
  golden_pit: number;
  bear_short_put: number;
  resilient_leader: number;
  ma_squeeze: number;
  bull_runner: number;
  macd_bull?: number;
  hedge_tool?: number;
  crash_knife: number;
}

export type RadarSetupType =
  | 'golden_pit'
  | 'resilient_leader'
  | 'bear_short_put'
  | 'ma_squeeze'
  | 'bull_runner'
  | 'hedge_tool'
  | 'crash_knife'
  | 'watch';

export interface RadarItem {
  symbol: string;
  market: MarketType;
  name: string;
  exchange: string;
  sector: string;
  sector_en: string;
  alias: string;
  price: number;
  change_pct: number;
  rvol: number;
  rsi14: number;
  atr_pct: number;
  ema20: number;
  ema60: number;
  sma120: number;
  ma_spread_pct: number;
  dist_ema20_pct: number;
  rs_20d: number;
  in_fib_pit: boolean;
  right_side_bounce: boolean;
  crash_lock: boolean;
  is_squeeze: boolean;
  is_resilient: boolean;
  is_hedge?: boolean;
  macd_state?: string;
  macd_label_zh?: string;
  macd_label_en?: string;
  macd_dif?: number;
  macd_dea?: number;
  macd_hist?: number;
  setup: RadarSetupType;
  setup_zh: string;
  setup_en: string;
  tags: string[];
  radar_score: number;
  entry_ref: number;
  target_ref: number;
  stop_ref: number;
  stop_dist_pct: number;
  risk_parity_pct: number;
}

export interface RadarResponse {
  vix_futures: RadarVixFutures;
  temperature: RadarTemperature;
  counts: RadarCounts;
  items: RadarItem[];
  updated_at: string;
  ts: number;
}

export type ViewMode = 'workbench' | 'radar' | 'calendar' | 'etf_plan' | 'calculator';

export interface EarningsWarning {
  symbol: string;
  date: string;
  days_until: number;
  time_slot: string;
  time_label_zh: string;
  eps_forecast: string;
  iv_crush_risk: boolean;
  warning_zh: string;
  warning_en: string;
}

export interface CalendarEconEvent {
  id: string;
  date: string;
  et_time: string;
  cst_date: string;
  cst_time: string;
  timestamp: number;
  all_day: boolean;
  country: string;
  country_label: string;
  event: string;
  event_zh: string;
  impact: 'high' | 'medium' | 'low';
  actual: string;
  consensus: string;
  previous: string;
  why_zh?: string;
  playbook_zh?: string;
  description: string;
}

export interface CalendarEarningItem {
  symbol: string;
  name: string;
  company_name: string;
  sector: string;
  sector_en: string;
  in_watchlist: boolean;
  date: string;
  days_until: number;
  time_slot: string;
  time_label_zh: string;
  time_label_en: string;
  market_cap: number;
  market_cap_fmt: string;
  eps_forecast: string;
  last_year_eps: string;
  fiscal_quarter: string;
  iv_crush_risk: boolean;
  playbook_zh?: string;
}

export interface CalendarResponse {
  dates: string[];
  today_et: string;
  updated_at: string;
  ts: number;
  econ_count: number;
  high_impact_count: number;
  urgent_48h_count?: number;
  earnings_count: number;
  watchlist_earnings_count: number;
  next_high_impact: CalendarEconEvent | null;
  economic_events: CalendarEconEvent[];
  earnings: CalendarEarningItem[];
  error?: string;
}

export interface PriceAlertItem {
  id: string;
  market: MarketType;
  symbol: string;
  targetPrice: number;
  direction: 'above' | 'below';
  createdAt: number;
  triggeredAt?: number;
  active: boolean;
}

export interface PaperTradePosition {
  symbol?: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  entryTime: number;
}

export interface PaperTradeState {
  balance: number;
  realizedPnl: number;
  tradesCount: number;
  position: PaperTradePosition | null;
}

export interface RrToolState {
  enabled: boolean;
  side: 'LONG' | 'SHORT';
  entry: number;
  stop: number;
  target: number;
  capital: number;
  riskPct: number;
  pickField: 'entry' | 'stop' | 'target' | null;
}

export interface MeasurePoint {
  time: number;
  price: number;
  index: number;
}

export interface LayerToggles {
  macro: boolean;
  plan: boolean;
  dual_ma: boolean;
  ma5: boolean;
  ma10: boolean;
  ma20: boolean;
  ma60: boolean;
  ma120: boolean;
  ma200: boolean;
  boll: boolean;
  volume: boolean;
  macd: boolean;
  bull_band: boolean;
  vwap: boolean;
  vpvr: boolean;
  fvg: boolean;
  absorption: boolean;
  deduct: boolean;
  compare: boolean;
  fib: boolean;
  regime: boolean;
  strokes: boolean;
  segments: boolean;
  centers: boolean;
  signals: boolean;
  projection: boolean;
  fractals: boolean;
}

export interface EtfLinePoint {
  time: number;
  value: number;
}

export interface EtfBenchmarkTranche {
  id: number;
  pct: number;
  label_zh: string;
  desc_zh: string;
  trigger_price: number;
  triggered: boolean;
}

export interface EtfBenchmarkPlan {
  symbol: 'QQQ' | 'SPY';
  name_zh: string;
  name_en: string;
  price: number;
  change_pct: number;
  session: string;
  session_zh: string;
  ema20: number;
  sma60: number;
  sma120: number;
  sma200: number;
  rsi14: number;
  high_52w: number;
  drawdown_from_high_pct: number;
  dist_sma200_pct: number;
  dist_ema20_pct: number;
  unlock_3x_price: number;
  hard_stop_3x_price: number;
  euphoria_t1_price: number;
  euphoria_t2_price: number;
  zone1_price: number;
  zone2_price: number;
  zone3_price: number;
  zone4_price: number;
  zone_mode?: 'ma_bull' | 'dd_bear';
  tranches?: EtfBenchmarkTranche[];
  dd15_price: number;
  dd25_price: number;
  dd35_price: number;
  allow_3x_right_side: boolean;
  hard_stop_triggered: boolean;
  regime_code:
    | 'BULL_HEALTHY'
    | 'BULL_PULLBACK'
    | 'BULL_OVERHEAT'
    | 'BEAR_WATCH'
    | 'BEAR_DEEP_CRASH';
  regime_label_zh: string;
  regime_label_en: string;
  regime_summary_zh: string;
  candles: Candle[];
  ema20_line: EtfLinePoint[];
  sma60_line: EtfLinePoint[];
  sma120_line: EtfLinePoint[];
  sma200_line: EtfLinePoint[];
}

export interface Etf3xRightSideStep {
  benchmark_trigger: number;
  est_3x_price: number;
  pct_share: number;
  rule_zh: string;
}

export interface Etf3xGun {
  gun: number;
  label_zh: string;
  dd_label: string;
  pct_share: number;
  benchmark_trigger: number;
  est_3x_price: number;
  triggered?: boolean;
  rule_zh: string;
}

export interface Etf3xExitRule {
  type: 'hard_stop' | 'euphoria_trim' | 'bear_rebound';
  title_zh: string;
  trigger_zh: string;
  est_3x_price: number;
  action_zh: string;
}

export interface Etf3xTiming {
  symbol: 'TQQQ' | 'UPRO';
  name_zh: string;
  benchmark_symbol: 'QQQ' | 'SPY';
  price: number;
  change_pct: number;
  rsi14: number;
  high_52w: number;
  drawdown_pct: number;
  benchmark_price: number;
  benchmark_sma200: number;
  benchmark_ema20: number;
  benchmark_sma60: number;
  benchmark_dist_sma200_pct: number;
  above_sma200: boolean;
  breakout_unlocked: boolean;
  status_code: 'BULL_OPEN' | 'BUFFER_ZONE' | 'BEAR_LOCKED';
  status_zh: string;
  right_side_breakout: Etf3xRightSideStep;
  right_side_pullback: Etf3xRightSideStep;
  left_side_guns: Etf3xGun[];
  exit_rules: Etf3xExitRule[];
  benchmark_52w_high: number;
}

export interface EtfLiveItem {
  symbol: string;
  name_zh: string;
  layer: number;
  layer_name_zh: string;
  weight_pct: number;
  price: number;
  change_pct: number;
  session_zh: string;
  payout_freq: 'monthly' | 'quarterly';
  payout_freq_zh: string;
  ttm_div_usd: number;
  ttm_yield_pct: number;
  return_1y_pct: number | null;
  cagr_3y_pct: number | null;
  cagr_10y_pct: number | null;
  history_note_zh: string;
  max_dd_pct: number;
  maint_margin_pct: number;
  margin_allowed: boolean;
  tax_note_zh: string;
  role_zh: string;
  verdict: 'core' | 'hold' | 'shield' | 'tactical' | 'exclude';
}

export interface EtfPlanResponse {
  updated_at: string;
  updated_ts: number;
  et_date: string;
  market_session: {
    session: string;
    session_zh: string;
    session_en: string;
  };
  ibkr_margin_apr_pct: number;
  w8ben_tax_pct: number;
  defaults: {
    principal_usd: number;
    leverage_ratio: number;
    x3_choice: 'TQQQ' | 'UPRO' | 'split';
    held_shares: Record<string, number>;
  };
  benchmarks: Record<'QQQ' | 'SPY', EtfBenchmarkPlan>;
  leveraged_timing: Record<'TQQQ' | 'UPRO', Etf3xTiming>;
  etfs: EtfLiveItem[];
}

export interface MaAlertRule {
  id: string;
  market: MarketType;
  symbol: string;
  interval: '1h' | '4h' | '1d' | '1w';
  ma_type: 'ema' | 'sma';
  period: number;
  direction: 'cross_above' | 'cross_below' | 'both';
  offset_pct: number;
  enabled: boolean;
  cooldown_min: number;
  last_side: 'above' | 'below' | null;
  last_price: number;
  last_ma: number;
  last_trigger_line: number;
  last_dist_pct: number;
  last_checked_at: string;
  last_triggered_at: string | null;
  last_triggered_ts: number;
  note: string;
}

export interface MaAlertHistoryItem {
  id: string;
  rule_id: string;
  symbol: string;
  market: string;
  interval: string;
  ma_label: string;
  crossed: 'above' | 'below';
  price: number;
  trigger_line: number;
  title: string;
  triggered_at: string;
  ts: number;
  pushed_via?: string[];
}

export interface MaAlertsResponse {
  rules: MaAlertRule[];
  history: MaAlertHistoryItem[];
  last_scan_at: string;
  channels: {
    telegram_configured: boolean;
    telegram_token_masked: string;
    telegram_chat_id_masked: string;
    webhook_configured: boolean;
    webhook_masked: string;
    poll_sec: number;
  };
}
