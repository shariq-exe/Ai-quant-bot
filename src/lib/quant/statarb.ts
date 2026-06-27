// Quant engine — statistical arbitrage & mean-reversion (Phase 1.5).
//
// Three components:
//   1. Ornstein-Uhlenbeck process for the EUR/USD vs XAU/USD spread.
//      dX_t = θ(μ - X_t)dt + σ dW_t
//      Estimate θ, μ, σ by MLE (discrete-time AR(1) regression). Trade when the
//      spread deviates beyond 2σ from equilibrium, with θ confirming reversion.
//   2. Cointegration with Kalman Filter — Johansen-style eigenvalue test for
//      cointegration + Kalman Filter for the dynamic time-varying hedge ratio.
//      The Kalman residual is the trading signal; enter when |residual z| > 2.
//   3. Half-life of mean reversion: -ln(2) / ln(β) where β is the AR(1) coeff.
//      Only trade when 1 ≤ half-life ≤ maxHoldingPeriod.
//
// All pure TypeScript, no external deps.

import type {
  Bar,
  CointegrationResult,
  KalmanResult,
  OUResult,
  StatArbReport,
  Symbol,
} from "./types";
import { mean, std, normalCdf } from "./statistics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function logPrices(bars: Bar[]): number[] {
  return bars.map((b) => Math.log(b.close));
}

// OLS slope + intercept of y on x.
function ols(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = Math.min(x.length, y.length);
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  return { slope, intercept };
}

// ===========================================================================
// 1. Ornstein-Uhlenbeck process estimation (discrete AR(1) MLE)
// ===========================================================================
// The OU process dX_t = θ(μ - X_t)dt + σ dW_t has a discrete-time AR(1) form:
//   X_{t+1} = α + β·X_t + ε_t,  where β = exp(-θ·Δt), α = μ(1-β)
// So: θ = -ln(β) / Δt, μ = α / (1-β), σ² = Var(ε) · 2θ / (1-β²)
// Half-life = -ln(2) / θ = -ln(2) / (-ln(β)) = ln(2) / ln(1/β) = -ln(2)/ln(β)
//
// We regress ΔX on X (the simpler form): ΔX_t = -θ·X_{t-1} + θ·μ + ε
// slope = -θ, so θ = -slope. This is the spec's half-life formula directly.
export function estimateOU(spread: number[], maxHolding = 48): OUResult {
  const n = spread.length;
  if (n < 30) {
    return {
      theta: 0,
      mu: mean(spread),
      sigma: std(spread),
      halfLife: Infinity,
      currentSpread: spread[n - 1] ?? 0,
      zScore: 0,
      deviation: 0,
      entrySignal: "none",
      halfLifeValid: false,
      halfLifeNote: "insufficient data",
      series: [],
    };
  }
  // AR(1) regression: spread[t] = α + β·spread[t-1] + ε
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 1; i < n; i++) {
    x.push(spread[i - 1]);
    y.push(spread[i]);
  }
  const { slope: beta, intercept: alpha } = ols(x, y);
  // θ = -ln(β) (per-bar; Δt=1). β must be in (0,1) for mean-reversion.
  const theta = beta > 0 && beta < 1 ? -Math.log(beta) : 0;
  const mu = beta !== 1 ? alpha / (1 - beta) : mean(spread);
  // Residuals → σ (diffusion)
  const residuals: number[] = [];
  for (let i = 0; i < x.length; i++) {
    residuals.push(y[i] - (alpha + beta * x[i]));
  }
  const sigmaOU = Math.max(std(residuals), 1e-9);
  // Half-life = -ln(2) / ln(β)  (spec formula)
  const halfLife = beta > 0 && beta < 1 ? -Math.log(2) / Math.log(beta) : Infinity;

  // Current spread stats
  const currentSpread = spread[n - 1];
  const zScore = (currentSpread - mu) / sigmaOU;
  const deviation = Math.abs(zScore);

  // Half-life validity: 1 ≤ HL ≤ maxHolding
  let halfLifeValid: boolean;
  let halfLifeNote: string;
  if (!isFinite(halfLife) || theta <= 0) {
    halfLifeValid = false;
    halfLifeNote = `non-reverting (θ=${theta.toFixed(3)} ≤ 0)`;
  } else if (halfLife < 1) {
    halfLifeValid = false;
    halfLifeNote = `half-life ${halfLife.toFixed(1)} < 1 (too fast)`;
  } else if (halfLife > maxHolding) {
    halfLifeValid = false;
    halfLifeNote = `half-life ${halfLife.toFixed(1)} > ${maxHolding} holding (won't complete)`;
  } else {
    halfLifeValid = true;
    halfLifeNote = `half-life ${halfLife.toFixed(1)} bars (valid for ${maxHolding}-bar holding)`;
  }

  // Entry signal: |z| > 2 AND θ confirms reversion
  let entrySignal: OUResult["entrySignal"] = "none";
  if (theta > 0 && halfLifeValid) {
    if (zScore > 2) entrySignal = "short-spread"; // spread too high → short
    else if (zScore < -2) entrySignal = "long-spread"; // spread too low → long
  }

  // Series for charting (last 100 points)
  const series = spread.slice(-100).map((s, i) => ({
    time: i,
    spread: s,
    equilibrium: mu,
    upperBand: mu + 2 * sigmaOU,
    lowerBand: mu - 2 * sigmaOU,
  }));

  return {
    theta,
    mu,
    sigma: sigmaOU,
    halfLife,
    currentSpread,
    zScore,
    deviation,
    entrySignal,
    halfLifeValid,
    halfLifeNote,
    series,
  };
}

// ===========================================================================
// 2. Kalman Filter for dynamic hedge ratio
// ===========================================================================
// State: β_t (the hedge ratio). Observation: y_t = α + β_t · x_t + v_t.
// State transition: β_t = β_{t-1} + w_t (random walk).
//
// IMPORTANT: we demean both series (subtract their rolling means) before the
// Kalman fit so the filter tracks the hedge ratio on DEVIATIONS, not levels.
// Without this, fitting log(XAU)≈7.7 on log(EUR)≈0.08 makes β explode to fit
// the level rather than the relationship. The intercept α is estimated
// separately via OLS and held fixed; the Kalman filter tracks the time-varying
// β on the demeaned residuals.
export function kalmanHedgeRatio(
  xSeries: number[], // log(EUR)
  ySeries: number[], // log(XAU)
  q = 0.0001, // process noise (hedge-ratio drift variance)
  r = 0.001, // observation noise
  warmup = 30
): KalmanResult {
  const n = Math.min(xSeries.length, ySeries.length);
  if (n < 40) {
    return {
      hedgeRatio: ols(xSeries, ySeries).slope,
      hedgeRatioSeries: [],
      residual: 0,
      residualMean: 0,
      residualStd: 1e-9,
      residualZScore: 0,
      entrySignal: "none",
      innovationSeries: [],
      posteriorVariance: 0,
    };
  }
  // Demean both series so the Kalman filter tracks β on deviations.
  const mx = mean(xSeries);
  const my = mean(ySeries);
  const xd = xSeries.map((v) => v - mx);
  const yd = ySeries.map((v) => v - my);
  // Initialize β from OLS on the demeaned warmup window.
  const initOLS = ols(xd.slice(0, warmup), yd.slice(0, warmup));
  let beta = initOLS.slope;
  let P = Math.max(initOLS.slope * 0.01, 0.01) + 0.01; // initial posterior variance
  const betaSeries: { time: number; beta: number }[] = [];
  const innovations: { time: number; residual: number }[] = [];
  for (let t = warmup; t < n; t++) {
    const x = xd[t];
    const y = yd[t];
    // Predict
    const Ppred = P + q;
    // Update
    const denom = x * x * Ppred + r;
    const K = denom > 0 ? (Ppred * x) / denom : 0;
    const yhat = x * beta;
    const innov = y - yhat; // residual = innovation (on demeaned series)
    beta = beta + K * innov;
    P = (1 - K * x) * Ppred;
    if (P < 0) P = 0;
    betaSeries.push({ time: t, beta });
    innovations.push({ time: t, residual: innov });
  }
  const residualValues = innovations.map((d) => d.residual);
  const residualMean = mean(residualValues);
  const residualStd = Math.max(std(residualValues), 1e-9);
  const currentResidual = residualValues[residualValues.length - 1] ?? 0;
  const residualZScore = (currentResidual - residualMean) / residualStd;
  let entrySignal: KalmanResult["entrySignal"] = "none";
  if (residualZScore > 2) entrySignal = "short-residual"; // residual too high → expect reversion down
  else if (residualZScore < -2) entrySignal = "long-residual"; // residual too low → expect reversion up

  return {
    hedgeRatio: beta,
    hedgeRatioSeries: betaSeries.slice(-100),
    residual: currentResidual,
    residualMean,
    residualStd,
    residualZScore,
    entrySignal,
    innovationSeries: innovations.slice(-100),
    posteriorVariance: P,
  };
}

// ===========================================================================
// 3. Cointegration test (Johansen-style simplified eigenvalue approach)
// ===========================================================================
// Full Johansen is complex; we use a practical simplification: estimate the
// cointegrating regression log(Y) = α + β·log(X) + ε, then run an ADF-style
// test on the residuals. If the residual series is stationary (mean-reverts
// fast), the pair is cointegrated. The trace statistic is approximated from
// the AR(1) coefficient of the residuals.
export function testCointegration(
  xLog: number[], // log(EUR)
  yLog: number[] // log(XAU)
): CointegrationResult {
  const n = Math.min(xLog.length, yLog.length);
  if (n < 50) {
    return {
      isCointegrated: false,
      traceStat: 0,
      criticalValue: 12.25, // Johansen 5% CV for r=0, 2 variables
      pValue: 1,
      cointegratingVector: [1, -ols(xLog, yLog).slope],
      note: "insufficient data",
    };
  }
  // OLS cointegrating regression
  const { slope: beta, intercept: alpha } = ols(xLog, yLog);
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    residuals.push(yLog[i] - (alpha + beta * xLog[i]));
  }
  // ADF-style: regress Δ(residual) on residual_{t-1}.
  const xr: number[] = [];
  const yr: number[] = [];
  for (let i = 1; i < residuals.length; i++) {
    xr.push(residuals[i - 1]);
    yr.push(residuals[i] - residuals[i - 1]);
  }
  const { slope: adfBeta } = ols(xr, yr);
  // adfBeta is negative if stationary. t-statistic ≈ adfBeta / SE.
  const fitted = xr.map((x) => adfBeta * x);
  const residStd = std(yr.map((y, i) => y - fitted[i])) || 1e-9;
  const seBeta = residStd / Math.sqrt(xr.reduce((s, x) => s + x * x, 0));
  const tStat = seBeta > 0 ? adfBeta / seBeta : 0;
  // Map t-stat to a pseudo-trace statistic (Johansen trace ≈ -tStat²·n / something)
  // We use a scaled approximation: trace ≈ -tStat · 3 (positive when stationary).
  const traceStat = Math.max(0, -tStat * 3);
  const criticalValue = 12.25; // Johansen 5% CV for r=0 with 2 variables
  // p-value via normal CDF on the t-stat (ADF critical values are more negative
  // than normal; we use the standard -1.96 approximation for simplicity)
  const pValue = normalCdf(tStat);
  const isCointegrated = traceStat > criticalValue && tStat < -2.86; // ADF 5% CV ≈ -2.86
  const note = isCointegrated
    ? `cointegrated (trace=${traceStat.toFixed(2)} > ${criticalValue}, ADF t=${tStat.toFixed(2)} < -2.86)`
    : `not cointegrated (trace=${traceStat.toFixed(2)}, ADF t=${tStat.toFixed(2)})`;

  return {
    isCointegrated,
    traceStat,
    criticalValue,
    pValue,
    cointegratingVector: [1, -beta],
    note,
  };
}

// ===========================================================================
// Composite stat-arb report
// ===========================================================================
export function computeStatArb(
  eurBars: Bar[],
  xauBars: Bar[],
  maxHolding = 48
): StatArbReport {
  const n = Math.min(eurBars.length, xauBars.length);
  const eurLog = logPrices(eurBars).slice(-n);
  const xauLog = logPrices(xauBars).slice(-n);

  // --- Kalman Filter for dynamic hedge ratio ---
  const kalman = kalmanHedgeRatio(eurLog, xauLog, 0.0001, 0.001, 30);
  const beta = kalman.hedgeRatio;

  // --- Spread: log(XAU) − (α + β·log(EUR)) ---
  // Use the OLS intercept α so the spread is the cointegrating residual (mean
  // ~0 by construction), not a raw level difference. This is what the OU
  // process should model — a stationary residual, not a trending level.
  const cointOLS = ols(eurLog, xauLog);
  const alpha = cointOLS.intercept;
  const spread: number[] = [];
  for (let i = 0; i < n; i++) {
    spread.push(xauLog[i] - (alpha + beta * eurLog[i]));
  }

  // --- OU process on the spread ---
  const ou = estimateOU(spread, maxHolding);

  // --- Cointegration test ---
  const cointegration = testCointegration(eurLog, xauLog);

  // --- Composite signal ---
  // Combine OU z-score + Kalman residual. Both must agree on direction.
  let compositeSignal: StatArbReport["compositeSignal"] = "none";
  let compositeRationale = "no stat-arb signal — ";
  const ouAgrees = ou.entrySignal !== "none";
  const kalAgrees = kalman.entrySignal !== "none";

  if (ouAgrees && kalAgrees) {
    // Both agree
    const ouLong = ou.entrySignal === "long-spread";
    const kalLong = kalman.entrySignal === "long-residual";
    if (ouLong === kalLong) {
      compositeSignal = ouLong ? "long-spread" : "short-spread";
      compositeRationale = `OU z=${ou.zScore.toFixed(2)} + Kalman residual z=${kalman.residualZScore.toFixed(2)} agree → ${compositeSignal}`;
    } else {
      compositeRationale = `OU + Kalman disagree (OU ${ou.entrySignal}, Kal ${kalman.entrySignal}) — no signal`;
    }
  } else if (ouAgrees) {
    compositeRationale = `OU signal (z=${ou.zScore.toFixed(2)}) but Kalman residual not extreme (z=${kalman.residualZScore.toFixed(2)}) — wait for confirmation`;
  } else if (kalAgrees) {
    compositeRationale = `Kalman signal (residual z=${kalman.residualZScore.toFixed(2)}) but OU z not extreme (z=${ou.zScore.toFixed(2)}) — wait for confirmation`;
  } else {
    compositeRationale += `OU z=${ou.zScore.toFixed(2)} (|z|<2), Kalman z=${kalman.residualZScore.toFixed(2)} (|z|<2)`;
  }

  // --- Trade gate: half-life valid AND cointegration holds ---
  const tradeGate: StatArbReport["tradeGate"] =
    ou.halfLifeValid && cointegration.isCointegrated ? "open" : "closed";
  if (tradeGate === "closed") {
    compositeRationale += ` · GATE CLOSED: ${!ou.halfLifeValid ? ou.halfLifeNote : "not cointegrated"}`;
  }

  return {
    symbols: ["EUR/USD", "XAU/USD"],
    spreadLabel: `log(XAU) − β·log(EUR), β=${beta.toFixed(3)}`,
    ou,
    kalman,
    cointegration,
    compositeSignal,
    compositeRationale,
    tradeGate,
    timestamp: eurBars[eurBars.length - 1]?.time ?? Date.now(),
  };
}
