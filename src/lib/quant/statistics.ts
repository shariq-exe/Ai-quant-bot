// Quant engine — statistical functions.
// All pure. Used by backtester and strategy validation.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}

export function std(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

// Ordinary least squares slope of y on x (single regressor, with intercept).
export function olsSlope(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) * (x[i] - mx);
  }
  if (den === 0) return 0;
  return num / den;
}

// Standard normal CDF (Abramowitz & Stegun 26.2.17 approximation).
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Two-sided p-value for a t-statistic (normal approx; valid for n large).
export function pValueFromT(t: number): number {
  return 2 * (1 - normalCdf(Math.abs(t)));
}

// Annualized Sharpe ratio. returns are per-period; periodsPerYear annualizes.
export function sharpe(returns: number[], periodsPerYear = 252): number {
  if (returns.length < 2) return 0;
  const m = mean(returns);
  const s = std(returns);
  if (s === 0) return 0;
  return (m / s) * Math.sqrt(periodsPerYear);
}

// Annualized Sortino ratio (penalizes downside deviation only).
export function sortino(returns: number[], periodsPerYear = 252): number {
  if (returns.length < 2) return 0;
  const m = mean(returns);
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return m > 0 ? Infinity : 0;
  const dd = Math.sqrt(
    downside.reduce((acc, r) => acc + r * r, 0) / downside.length
  );
  if (dd === 0) return 0;
  return (m / dd) * Math.sqrt(periodsPerYear);
}

export interface DrawdownInfo {
  maxDrawdown: number; // fractional (0.25 = -25%)
  peakIdx: number;
  troughIdx: number;
}

// Max drawdown of an equity curve.
export function maxDrawdown(equity: number[]): DrawdownInfo {
  if (equity.length === 0) return { maxDrawdown: 0, peakIdx: 0, troughIdx: 0 };
  let peak = equity[0];
  let peakIdx = 0;
  let mdd = 0;
  let mddPeakIdx = 0;
  let mddTroughIdx = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) {
      peak = equity[i];
      peakIdx = i;
    }
    if (peak > 0) {
      const dd = (peak - equity[i]) / peak;
      if (dd > mdd) {
        mdd = dd;
        mddPeakIdx = peakIdx;
        mddTroughIdx = i;
      }
    }
  }
  return { maxDrawdown: mdd, peakIdx: mddPeakIdx, troughIdx: mddTroughIdx };
}

// One-sample t-test, H0: mean(returns) = 0.
export function tTest(returns: number[]): { t: number; p: number } {
  const n = returns.length;
  if (n < 2) return { t: 0, p: 1 };
  const m = mean(returns);
  const s = std(returns);
  if (s === 0) return { t: 0, p: 1 };
  const t = (m * Math.sqrt(n)) / s;
  return { t, p: pValueFromT(t) };
}

// Ornstein-Uhlenbeck half-life estimation (bars).
// Regress price changes on (lagged price - mean); half-life = -ln(2)/ln(1-phi).
// Returns Infinity if the series is not mean-reverting (phi <= 0 or >= 1).
export function halfLife(prices: number[]): number {
  const n = prices.length;
  if (n < 10) return Infinity;
  const m = mean(prices);
  const dx: number[] = [];
  const lag: number[] = [];
  for (let i = 1; i < n; i++) {
    dx.push(prices[i] - prices[i - 1]);
    lag.push(prices[i - 1] - m);
  }
  const slope = olsSlope(lag, dx);
  // slope is the mean-reversion speed (negative for reverting series).
  const phi = -slope;
  if (phi <= 0 || phi >= 1) return Infinity;
  return -Math.log(2) / Math.log(1 - phi);
}

// Rolling simple moving average.
export function sma(values: number[], period: number, idx: number): number {
  if (idx + 1 < period) return NaN;
  let s = 0;
  for (let i = idx - period + 1; i <= idx; i++) s += values[i];
  return s / period;
}

// Rolling standard deviation (sample).
export function rollingStd(values: number[], period: number, idx: number): number {
  if (idx + 1 < period) return NaN;
  const slice = values.slice(idx - period + 1, idx + 1);
  return std(slice);
}

// Average True Range over period at idx. tr = max(h-l, |h-prevClose|, |l-prevClose|).
export function atr(bars: { high: number; low: number; close: number }[], period: number, idx: number): number {
  if (idx < period) return NaN;
  const trs: number[] = [];
  for (let i = idx - period + 1; i <= idx; i++) {
    const prevClose = bars[i - 1].close;
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose)
    );
    trs.push(tr);
  }
  return mean(trs);
}

// Exponentially weighted mean of a window (newest = last element).
export function ewma(values: number[], alpha: number): number {
  if (values.length === 0) return 0;
  let acc = values[0];
  for (let i = 1; i < values.length; i++) {
    acc = alpha * values[i] + (1 - alpha) * acc;
  }
  return acc;
}

// Percentile rank of value in array (0..1).
export function percentileRank(arr: number[], value: number): number {
  if (arr.length === 0) return 0;
  let below = 0;
  for (const v of arr) if (v <= value) below++;
  return below / arr.length;
}
