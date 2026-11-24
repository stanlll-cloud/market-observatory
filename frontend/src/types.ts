export type MarketType = 'crypto' | 'us';
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

export interface AnalysisData {
  fractals: Fractal[];
  strokes: Stroke[];
  segments: Segment[];
  centers: Center[];
  signals: Signal[];
  absorption?: AbsorptionSignal[];
  fvg_zones?: FvgZone[];
  dual_ma?: DualMaData;
  vwap?: VwapData | null;
  fibonacci?: FibonacciData | null;
  regime?: RegimeData | null;
  buy_advice?: BuyAdvice | null;
  options_advice?: OptionsAdvice | null;
  htf_lock?: HtfLock | null;
  earnings_warning?: EarningsWarning | null;
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

export type ViewMode = 'workbench' | 'radar' | 'calendar';

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
  market: 'crypto' | 'us';
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
