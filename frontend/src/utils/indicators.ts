import type { Candle } from '../types';

export interface LinePoint {
  time: number;
  value: number;
}

/** 0ms client-side Simple Moving Average on OHLCV closes */
export function computeSma(candles: Candle[], period: number): LinePoint[] {
  if (!candles.length || period < 2 || candles.length < period) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      out.push({ time: candles[i].time, value: sum / period });
    }
  }
  return out;
}

/** 0ms client-side Exponential Moving Average on OHLCV closes */
export function computeEma(candles: Candle[], period: number): LinePoint[] {
  if (!candles.length || period < 2) return [];
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  const out: LinePoint[] = [{ time: candles[0].time, value: ema }];
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    out.push({ time: candles[i].time, value: ema });
  }
  return out;
}

/** 0ms client-side Bollinger Bands (default 20, 2) */
export function computeBollinger(
  candles: Candle[],
  period = 20,
  mult = 2
): { upper: LinePoint[]; mid: LinePoint[]; lower: LinePoint[] } {
  if (!candles.length || period < 2 || candles.length < period) {
    return { upper: [], mid: [], lower: [] };
  }
  const upper: LinePoint[] = [];
  const mid: LinePoint[] = [];
  const lower: LinePoint[] = [];
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].close;
    sum += c;
    sumSq += c * c;
    if (i >= period) {
      const drop = candles[i - period].close;
      sum -= drop;
      sumSq -= drop * drop;
    }
    if (i >= period - 1) {
      const mean = sum / period;
      const variance = Math.max(0, sumSq / period - mean * mean);
      const sd = Math.sqrt(variance);
      const t = candles[i].time;
      mid.push({ time: t, value: mean });
      upper.push({ time: t, value: mean + mult * sd });
      lower.push({ time: t, value: mean - mult * sd });
    }
  }
  return { upper, mid, lower };
}
