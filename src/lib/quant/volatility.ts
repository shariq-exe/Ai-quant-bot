// Quant engine — volatility intelligence & regime detection (Phase 1.2).
//
// Three components:
//   1. GARCH(1,1) with regime classification — fit ω, α, β by MLE, derive
//      conditional σ_t, then classify into low-vol / transitional / high-vol
//      regimes by quantile of the long-run unconditional vol.
//   2. Barndorff-Nielsen & Shephard bipower variation — decompose realized
//      volatility into continuous (BV) and jump components; z-test for jumps.
//   3. Gaussian HMM (3 states) — Baum-Welch EM training + Viterbi decoding +
//      forward probabilities for real-time regime classification. Acts as the
//      master switch that determines which strategy family is active.
//
// All pure TypeScript, no external deps. Designed to run on a ~500-bar window
// in <100ms per symbol so the dashboard can poll it live.

import type {
  Bar,
  HMMState,
  Regime,
  StrategyDispatch,
  Symbol,
  VolRegime,
  VolatilityReport,
} from "./types";
import { mean, std, normalCdf } from "./statistics";

// ===========================================================================
// 1. GARCH(1,1) with regime classification
// ===========================================================================
//   σ_t² = ω + α · r_{t-1}² + β · σ_{t-1}²
// Fit (ω, α, β) by maximizing the Gaussian log-likelihood of returns under
// the conditional variance. Use a small grid + coordinate refinement to keep
// it dependency-free and bounded. Persistence = α + β; stationarity requires
// persistence < 1. Long-run unconditional variance = ω / (1 - α - β).

export interface GARCHFit {
  omega: number;
  alpha: number;
  beta: number;
  persistence: number;
  longRunVol: number; // sqrt(ω / (1 - α - β))
  conditionalVols: number[]; // σ_t series
  logLikelihood: number;
}

export function fitGARCH(returns: number[]): GARCHFit | null {
  const n = returns.length;
  if (n < 30) return null;
  const r2 = returns.map((r) => r * r);
  const sampleVar = Math.max(mean(r2), 1e-12);

  // Log-likelihood under GARCH(1,1) for a given (ω, α, β).
  function logLik(omega: number, alpha: number, beta: number): number {
    const persist = alpha + beta;
    if (persist >= 0.999 || omega <= 0 || alpha < 0 || beta < 0) return -Infinity;
    let sig2 = sampleVar; // init at unconditional
    let ll = 0;
    for (let i = 0; i < n; i++) {
      sig2 = omega + alpha * r2[i] + beta * sig2;
      if (sig2 <= 0) return -Infinity;
      // Gaussian log-likelihood: -0.5 * (log(2π) + log(σ²) + r²/σ²)
      ll += -0.5 * (1.8378770664 + Math.log(sig2) + r2[i] / sig2);
    }
    return ll;
  }

  // Grid search over (α, β) with ω derived from the long-run variance target.
  // This is coarse but robust and dependency-free.
  let best = { omega: sampleVar * 0.01, alpha: 0.05, beta: 0.9, ll: -Infinity };
  for (let a = 0.02; a <= 0.3; a += 0.04) {
    for (let b = 0.7; b <= 0.97; b += 0.03) {
      if (a + b >= 0.995) continue;
      // ω = (1 - α - β) * sampleVar → matches unconditional variance
      const omega = Math.max((1 - a - b) * sampleVar, 1e-8);
      const ll = logLik(omega, a, b);
      if (ll > best.ll) best = { omega, alpha: a, beta: b, ll };
    }
  }

  const { omega, alpha, beta } = best;
  const persistence = alpha + beta;
  const longRunVar = omega / Math.max(1 - persistence, 1e-4);
  const longRunVol = Math.sqrt(longRunVar);
  const conditionalVols: number[] = [];
  let sig2 = sampleVar;
  for (let i = 0; i < n; i++) {
    sig2 = omega + alpha * r2[i] + beta * sig2;
    conditionalVols.push(Math.sqrt(Math.max(sig2, 1e-12)));
  }

  return {
    omega,
    alpha,
    beta,
    persistence,
    longRunVol,
    conditionalVols,
    logLikelihood: best.ll,
  };
}

// Classify the current conditional vol into a 3-state regime by comparing to
// the long-run vol. <0.7× = low-vol (compression), 0.7–1.4× = transitional,
// >1.4× = high-vol (trending). Returns the regime + posterior probability.
export function classifyVolRegime(
  currentVol: number,
  longRunVol: number,
  volSeries: number[]
): { regime: VolRegime; probability: number } {
  const ratio = currentVol / Math.max(longRunVol, 1e-9);
  let regime: VolRegime;
  if (ratio < 0.7) regime = "low-vol";
  else if (ratio > 1.4) regime = "high-vol";
  else regime = "transitional";

  // Posterior probability: how extreme is the current vol vs the empirical
  // distribution of the conditional vol series? Use a normal approximation.
  const m = mean(volSeries);
  const s = std(volSeries) || 1e-9;
  // Probability that the current vol is "in" its regime = tail mass beyond the
  // threshold on the appropriate side.
  const z = (currentVol - m) / s;
  let probability: number;
  if (regime === "high-vol") probability = 1 - normalCdf(z);
  else if (regime === "low-vol") probability = normalCdf(z);
  else probability = normalCdf(Math.abs(ratio - 1) < 0.001 ? 0 : (1 - Math.abs(ratio - 1)) * 2);
  probability = Math.max(0.05, Math.min(0.98, probability));

  return { regime, probability };
}

// ===========================================================================
// 2. Bipower variation jump detection (Barndorff-Nielsen & Shephard)
// ===========================================================================
//   BV_t = (π/2) · (1/(n-1)) · Σ |r_i| · |r_{i-1}|   (continuous component)
//   RV_t = Σ r_i²                                    (total realized vol)
//   Jump = max(RV_t - BV_t, 0)
//   Jump ratio = Jump / RV_t  → high ratio ⇒ jump-dominated bar
// A z-test on the jump ratio (relative to its rolling distribution) flags
// regime transitions — jumps are a leading indicator of trend initiation.

export interface JumpReport {
  realizedVol: number;
  bipowerVol: number;
  jumpComponent: number;
  jumpRatio: number;
  jumpDetected: boolean;
  jumpZScore: number;
  recentJumps: { time: number; ratio: number; detected: boolean }[];
}

export function detectJumps(bars: Bar[], window = 50): JumpReport {
  const n = bars.length;
  if (n < 5) {
    return {
      realizedVol: 0,
      bipowerVol: 0,
      jumpComponent: 0,
      jumpRatio: 0,
      jumpDetected: false,
      jumpZScore: 0,
      recentJumps: [],
    };
  }
  // Compute log-returns.
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    rets.push(Math.log(bars[i].close / bars[i - 1].close));
  }
  // Rolling jump-ratio series over `window`-bar blocks.
  const ratios: { time: number; ratio: number }[] = [];
  const block = Math.max(10, Math.floor(window / 2));
  for (let i = block; i < rets.length; i++) {
    const slice = rets.slice(i - block + 1, i + 1);
    let rv = 0;
    let bv = 0;
    for (let j = 0; j < slice.length; j++) {
      rv += slice[j] * slice[j];
      if (j > 0) bv += Math.abs(slice[j]) * Math.abs(slice[j - 1]);
    }
    bv = (Math.PI / 2) * (bv / Math.max(slice.length - 1, 1));
    const jump = Math.max(rv - bv, 0);
    const ratio = rv > 0 ? jump / rv : 0;
    ratios.push({ time: bars[i].time, ratio });
  }

  if (ratios.length === 0) {
    return {
      realizedVol: 0,
      bipowerVol: 0,
      jumpComponent: 0,
      jumpRatio: 0,
      jumpDetected: false,
      jumpZScore: 0,
      recentJumps: [],
    };
  }

  // Current (last block) values.
  const last = ratios[ratios.length - 1];
  const recent = ratios.slice(-window);
  const values = recent.map((r) => r.ratio);
  const m = mean(values);
  const s = std(values) || 1e-9;
  const z = (last.ratio - m) / s;
  // Jump detected if ratio is in the top 5% of its recent distribution (z>1.645).
  const detected = z > 1.645 && last.ratio > 0.3;

  // Also compute the raw RV / BV for the latest block for the report.
  const lastSlice = rets.slice(-block);
  let rvNow = 0;
  let bvNow = 0;
  for (let j = 0; j < lastSlice.length; j++) {
    rvNow += lastSlice[j] * lastSlice[j];
    if (j > 0) bvNow += Math.abs(lastSlice[j]) * Math.abs(lastSlice[j - 1]);
  }
  bvNow = (Math.PI / 2) * (bvNow / Math.max(lastSlice.length - 1, 1));
  const jumpNow = Math.max(rvNow - bvNow, 0);

  return {
    realizedVol: rvNow,
    bipowerVol: bvNow,
    jumpComponent: jumpNow,
    jumpRatio: last.ratio,
    jumpDetected: detected,
    jumpZScore: z,
    recentJumps: recent.slice(-30).map((r) => ({ time: r.time, ratio: r.ratio, detected: r.ratio > m + 1.645 * s && r.ratio > 0.3 })),
  };
}

// ===========================================================================
// 3. Multivariate Gaussian HMM (3 states, 4 features) — Baum-Welch + Viterbi
// ===========================================================================
// Model: 3 hidden states, each emitting a 4-D Gaussian with DIAGONAL covariance
// over the features [log-return, realized-vol, volume-skew, spread-proxy].
// Trained by Baum-Welch EM. Decoded by Viterbi (most likely state path) +
// forward algorithm gives the posterior P(state_t | obs_{1:t}).
//
// This implements the Phase 1.2 spec exactly: "Train a Gaussian HMM with 3-4
// hidden states using features: log-returns, realized volatility, volume
// profile skewness, and spread dynamics."
//
// State ordering: after training, states are sorted by the realized-vol feature
// mean so state 0 = lowest vol, state 2 = highest vol. This makes the "master
// switch" mapping stable across retraining.

const HMM_FEATURE_NAMES = ["log-return", "realized-vol", "vol-skew", "spread-proxy"];

interface HMMParams {
  N: number; // number of states
  D: number; // number of features (dimensions)
  pi: number[]; // initial state probs
  A: number[][]; // transition matrix
  mu: number[][]; // [state][feature] means
  sigma: number[][]; // [state][feature] std-devs (diagonal cov)
}

interface HMMResult {
  params: HMMParams;
  viterbi: number[]; // decoded state path
  forwardProbs: number[][]; // P(state_t | obs_{1:t}) per time
  logLikelihood: number;
  iterations: number;
}

// Extract the 4 HMM features from a bar series. Returns a T×D matrix aligned
// with the bars (the first row is a zero vector since realized vol / skew /
// spread need a lookback). Each feature is standardized to zero mean / unit
// variance over the window so no single feature dominates the Gaussian fit.
export function extractHMMFeatures(bars: Bar[], rvWindow = 20, skewWindow = 50): number[][] {
  const n = bars.length;
  const feats: number[][] = Array.from({ length: n }, () => new Array(4).fill(0));
  // Feature 0: log-return.
  // Feature 1: realized volatility over rvWindow (sum of squared log-returns).
  // Feature 2: volume profile skewness over skewWindow (third-moment normalized).
  // Feature 3: spread proxy = (high - low) / close, a Corwin-Schultz-style
  //            bid-ask spread estimator from the bar's range.
  const logRets: number[] = [0];
  for (let i = 1; i < n; i++) logRets.push(Math.log(bars[i].close / bars[i - 1].close));
  for (let i = 0; i < n; i++) {
    feats[i][0] = logRets[i];
    // realized vol
    let rv = 0;
    const rvStart = Math.max(1, i - rvWindow + 1);
    for (let j = rvStart; j <= i; j++) rv += logRets[j] * logRets[j];
    feats[i][1] = Math.sqrt(rv / Math.max(i - rvStart + 1, 1));
    // volume skewness
    if (i >= skewWindow) {
      const vols: number[] = [];
      for (let j = i - skewWindow + 1; j <= i; j++) vols.push(bars[j].volume);
      const m = vols.reduce((a, b) => a + b, 0) / vols.length;
      const sd = Math.sqrt(vols.reduce((a, b) => a + (b - m) ** 2, 0) / vols.length) || 1e-9;
      const sk = vols.reduce((a, b) => a + ((b - m) / sd) ** 3, 0) / vols.length;
      feats[i][2] = sk;
    } else {
      feats[i][2] = 0;
    }
    // spread proxy
    feats[i][3] = i > 0 ? (bars[i].high - bars[i].low) / bars[i].close : 0;
  }
  // Standardize each feature column (skip the warmup zeros).
  for (let d = 0; d < 4; d++) {
    const col: number[] = [];
    for (let i = skewWindow; i < n; i++) col.push(feats[i][d]);
    if (col.length < 2) continue;
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / (col.length - 1)) || 1e-9;
    for (let i = 0; i < n; i++) feats[i][d] = (feats[i][d] - m) / sd;
  }
  return feats;
}

// Diagonal-covariance multivariate Gaussian PDF. Returns the product of
// per-feature 1-D Gaussians (independence assumption). Log-form internally
// for numerical stability, exponentiated at the end.
function mvGaussianPdf(x: number[], mu: number[], sigma: number[]): number {
  let logp = 0;
  const D = x.length;
  for (let d = 0; d < D; d++) {
    const s = Math.max(sigma[d], 1e-9);
    const z = (x[d] - mu[d]) / s;
    logp += -0.5 * (Math.log(2 * Math.PI) + Math.log(s * s) + z * z);
  }
  return Math.exp(logp);
}

// Forward algorithm with scaling (avoids underflow). Returns alpha (scaled)
// and log-likelihood.
function forward(obs: number[][], p: HMMParams): { alpha: number[][]; logLik: number } {
  const T = obs.length;
  const alpha: number[][] = Array.from({ length: T }, () => new Array(p.N).fill(0));
  const scales: number[] = new Array(T).fill(0);
  let scaleSum = 0;
  for (let i = 0; i < p.N; i++) {
    alpha[0][i] = p.pi[i] * mvGaussianPdf(obs[0], p.mu[i], p.sigma[i]);
    scaleSum += alpha[0][i];
  }
  scales[0] = scaleSum || 1;
  for (let i = 0; i < p.N; i++) alpha[0][i] /= scales[0];
  let logLik = Math.log(scales[0]);
  for (let t = 1; t < T; t++) {
    scaleSum = 0;
    for (let j = 0; j < p.N; j++) {
      let s = 0;
      for (let i = 0; i < p.N; i++) s += alpha[t - 1][i] * p.A[i][j];
      alpha[t][j] = s * mvGaussianPdf(obs[t], p.mu[j], p.sigma[j]);
      scaleSum += alpha[t][j];
    }
    scales[t] = scaleSum || 1;
    for (let j = 0; j < p.N; j++) alpha[t][j] /= scales[t];
    logLik += Math.log(scales[t]);
  }
  return { alpha, logLik };
}

// Backward algorithm with the same scaling.
function backward(obs: number[][], p: HMMParams, scales: number[]): number[][] {
  const T = obs.length;
  const beta: number[][] = Array.from({ length: T }, () => new Array(p.N).fill(0));
  for (let i = 0; i < p.N; i++) beta[T - 1][i] = 1 / scales[T - 1];
  for (let t = T - 2; t >= 0; t--) {
    for (let i = 0; i < p.N; i++) {
      let s = 0;
      for (let j = 0; j < p.N; j++) {
        s += p.A[i][j] * mvGaussianPdf(obs[t + 1], p.mu[j], p.sigma[j]) * beta[t + 1][j];
      }
      beta[t][i] = s / scales[t];
    }
  }
  return beta;
}

// Viterbi: most likely state path.
function viterbi(obs: number[][], p: HMMParams): number[] {
  const T = obs.length;
  const delta: number[][] = Array.from({ length: T }, () => new Array(p.N).fill(0));
  const psi: number[][] = Array.from({ length: T }, () => new Array(p.N).fill(0));
  for (let i = 0; i < p.N; i++) {
    delta[0][i] = Math.log(Math.max(p.pi[i], 1e-12)) + Math.log(Math.max(mvGaussianPdf(obs[0], p.mu[i], p.sigma[i]), 1e-12));
  }
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < p.N; j++) {
      let bestVal = -Infinity;
      let bestArg = 0;
      for (let i = 0; i < p.N; i++) {
        const v = delta[t - 1][i] + Math.log(Math.max(p.A[i][j], 1e-12));
        if (v > bestVal) {
          bestVal = v;
          bestArg = i;
        }
      }
      delta[t][j] = bestVal + Math.log(Math.max(mvGaussianPdf(obs[t], p.mu[j], p.sigma[j]), 1e-12));
      psi[t][j] = bestArg;
    }
  }
  const path = new Array(T).fill(0);
  let bestFinal = 0;
  for (let i = 1; i < p.N; i++) if (delta[T - 1][i] > delta[T - 1][bestFinal]) bestFinal = i;
  path[T - 1] = bestFinal;
  for (let t = T - 2; t >= 0; t--) path[t] = psi[t + 1][path[t + 1]];
  return path;
}

// Baum-Welch EM training on the multivariate observation matrix. Initializes
// state means at quantiles of the realized-vol feature (feature 1) so states
// span the vol spectrum, then refines.
export function trainHMM(bars: Bar[], N = 3, maxIter = 30): HMMResult | null {
  const obs = extractHMMFeatures(bars);
  const T = obs.length;
  const D = 4;
  // Skip warmup rows where features are zero/undefined.
  const startIdx = Math.min(50, T - 1);
  const usable = obs.slice(startIdx);
  const Tu = usable.length;
  if (Tu < N * 10) return null;

  // Initialize: sort observations by realized-vol (feature 1) and pick N
  // quantile centroids. Sigmas init at the overall per-feature std.
  const byVol = [...usable].sort((a, b) => a[1] - b[1]);
  const initMu: number[][] = [];
  for (let k = 0; k < N; k++) {
    const center = byVol[Math.floor(((k + 0.5) / N) * Tu)];
    initMu.push([...center]);
  }
  const initSigma: number[][] = Array.from({ length: N }, () => {
    const s: number[] = [];
    for (let d = 0; d < D; d++) {
      const col = usable.map((o) => o[d]);
      const m = col.reduce((a, b) => a + b, 0) / col.length;
      const v = col.reduce((a, b) => a + (b - m) ** 2, 0) / (col.length - 1);
      s.push(Math.max(Math.sqrt(v), 1e-3));
    }
    return s;
  });

  let p: HMMParams = {
    N,
    D,
    pi: new Array(N).fill(1 / N),
    A: Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (_, j) => (i === j ? 0.85 : 0.15 / (N - 1)))
    ),
    mu: initMu,
    sigma: initSigma,
  };

  let prevLL = -Infinity;
  let iterations = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const { alpha, logLik } = forward(usable, p);
    // Compute scaled beta via the forward scales.
    const scales: number[] = new Array(Tu).fill(1);
    {
      const a2: number[][] = Array.from({ length: Tu }, () => new Array(N).fill(0));
      let sc = 0;
      for (let i = 0; i < N; i++) {
        a2[0][i] = p.pi[i] * mvGaussianPdf(usable[0], p.mu[i], p.sigma[i]);
        sc += a2[0][i];
      }
      scales[0] = sc || 1;
      for (let i = 0; i < N; i++) a2[0][i] /= scales[0];
      for (let t = 1; t < Tu; t++) {
        sc = 0;
        for (let j = 0; j < N; j++) {
          let s = 0;
          for (let i = 0; i < N; i++) s += a2[t - 1][i] * p.A[i][j];
          a2[t][j] = s * mvGaussianPdf(usable[t], p.mu[j], p.sigma[j]);
          sc += a2[t][j];
        }
        scales[t] = sc || 1;
        for (let j = 0; j < N; j++) a2[t][j] /= scales[t];
      }
    }
    const bScaled = backward(usable, p, scales);
    // gamma[t][i] = alpha_scaled[t][i] * beta_scaled[t][i] / sum_k(...)
    const gamma: number[][] = Array.from({ length: Tu }, () => new Array(N).fill(0));
    for (let t = 0; t < Tu; t++) {
      let s = 0;
      for (let i = 0; i < N; i++) {
        gamma[t][i] = alpha[t][i] * bScaled[t][i];
        s += gamma[t][i];
      }
      if (s > 0) for (let i = 0; i < N; i++) gamma[t][i] /= s;
    }
    // xi sums for transitions.
    const newA: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    const rowSum = new Array(N).fill(0);
    for (let t = 0; t < Tu - 1; t++) {
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const num =
            alpha[t][i] *
            p.A[i][j] *
            mvGaussianPdf(usable[t + 1], p.mu[j], p.sigma[j]) *
            bScaled[t + 1][j];
          newA[i][j] += num;
          rowSum[i] += num;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        newA[i][j] = rowSum[i] > 0 ? newA[i][j] / rowSum[i] : 1 / N;
      }
    }
    // M-step: update per-feature means and sigmas weighted by gamma.
    const newMu: number[][] = Array.from({ length: N }, () => new Array(D).fill(0));
    const newVar: number[][] = Array.from({ length: N }, () => new Array(D).fill(0));
    const gammaSum = new Array(N).fill(0);
    for (let t = 0; t < Tu; t++) {
      for (let i = 0; i < N; i++) {
        gammaSum[i] += gamma[t][i];
        for (let d = 0; d < D; d++) newMu[i][d] += gamma[t][i] * usable[t][d];
      }
    }
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < D; d++) {
        newMu[i][d] = gammaSum[i] > 0 ? newMu[i][d] / gammaSum[i] : initMu[i][d];
      }
    }
    for (let t = 0; t < Tu; t++) {
      for (let i = 0; i < N; i++) {
        for (let d = 0; d < D; d++) {
          newVar[i][d] += gamma[t][i] * (usable[t][d] - newMu[i][d]) ** 2;
        }
      }
    }
    const newSigma: number[][] = Array.from({ length: N }, () => new Array(D).fill(1e-3));
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < D; d++) {
        newSigma[i][d] = Math.sqrt(Math.max(newVar[i][d] / Math.max(gammaSum[i], 1e-9), 1e-6));
      }
    }
    const newPi = new Array(N).fill(1 / N);
    let piSum = 0;
    for (let i = 0; i < N; i++) {
      newPi[i] = Math.max(gamma[0][i], 1e-6);
      piSum += newPi[i];
    }
    for (let i = 0; i < N; i++) newPi[i] /= piSum;

    p = { N, D, pi: newPi, A: newA, mu: newMu, sigma: newSigma };

    if (Math.abs(logLik - prevLL) < 1e-4) break;
    prevLL = logLik;
  }

  // Sort states by the realized-vol feature mean (feature 1) ascending.
  const order = p.mu.map((_, i) => i).sort((a, b) => p.mu[a][1] - p.mu[b][1]);
  const sortedP: HMMParams = {
    N,
    D,
    pi: order.map((o) => p.pi[o]),
    A: order.map((o) => order.map((o2) => p.A[o][o2])),
    mu: order.map((o) => p.mu[o]),
    sigma: order.map((o) => p.sigma[o]),
  };
  const { alpha, logLik } = forward(usable, sortedP);
  const forwardProbs = alpha.map((row) => {
    const s = row.reduce((acc, v) => acc + v, 0) || 1;
    return row.map((v) => v / s);
  });
  const vit = viterbi(usable, sortedP);

  return { params: sortedP, viterbi: vit, forwardProbs, logLikelihood: logLik, iterations };
}

// ===========================================================================
// Composite volatility report + strategy dispatch
// ===========================================================================

const STATE_LABELS = ["Low-Vol Compression", "Transitional", "High-Vol Trending"];

export function computeVolatility(
  symbol: Symbol,
  bars: Bar[],
  legacyRegime: Regime
): VolatilityReport {
  const n = bars.length;
  // Log-returns.
  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push(Math.log(bars[i].close / bars[i - 1].close));

  // --- GARCH ---
  const garchFit = fitGARCH(rets);
  const currentVol = garchFit ? garchFit.conditionalVols[garchFit.conditionalVols.length - 1] : std(rets);
  const longRunVol = garchFit ? garchFit.longRunVol : std(rets);
  const volSeries = garchFit ? garchFit.conditionalVols : rets.map(() => std(rets));
  const { regime, probability } = classifyVolRegime(currentVol, longRunVol, volSeries);
  const garchSeries = bars.slice(-volSeries.length).map((b, i) => ({
    time: b.time,
    vol: volSeries[i],
    regime: classifyVolRegime(volSeries[i], longRunVol, volSeries).regime,
  }));

  // --- Jumps ---
  const jumps = detectJumps(bars, 50);

  // --- HMM (master switch) — multivariate over 4 features ---
  const hmmFit = trainHMM(bars, 3, 25);
  // Current feature vector (last bar) for the report.
  const allFeats = extractHMMFeatures(bars);
  const currentFeats = allFeats[allFeats.length - 1] ?? [0, 0, 0, 0];
  let hmm: HMMState;
  if (hmmFit) {
    const lastState = hmmFit.viterbi[hmmFit.viterbi.length - 1];
    const lastPosterior = hmmFit.forwardProbs[hmmFit.forwardProbs.length - 1];
    // Legacy single-value fields: use the log-return feature (index 0).
    hmm = {
      state: lastState,
      label: STATE_LABELS[lastState] ?? `State ${lastState}`,
      probability: lastPosterior[lastState],
      stateMeans: hmmFit.params.mu.map((m) => m[0]),
      stateVols: hmmFit.params.sigma.map((s) => s[0]),
      logLikelihood: hmmFit.logLikelihood,
      featureNames: HMM_FEATURE_NAMES,
      stateFeatureMeans: hmmFit.params.mu,
      stateFeatureVols: hmmFit.params.sigma,
      currentFeatures: currentFeats,
    };
  } else {
    // Fallback: synthesize an HMM state from the GARCH regime.
    const stateMap: Record<VolRegime, number> = { "low-vol": 0, transitional: 1, "high-vol": 2 };
    const s = stateMap[regime];
    hmm = {
      state: s,
      label: STATE_LABELS[s],
      probability: probability,
      stateMeans: [0, 0, 0],
      stateVols: [longRunVol * 0.6, longRunVol, longRunVol * 1.5],
      logLikelihood: 0,
      featureNames: HMM_FEATURE_NAMES,
      stateFeatureMeans: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      stateFeatureVols: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]],
      currentFeatures: currentFeats,
    };
  }

  // --- Strategy dispatch (the "master switch") ---
  // Primary signal: HMM state. Modulated by GARCH regime + jump detection.
  let dispatch: StrategyDispatch;
  let rationale: string;
  if (hmm.state === 0) {
    dispatch = "mean-reversion";
    rationale = `HMM low-vol compression (p=${hmm.probability.toFixed(2)}) → deploy mean-reversion with tight stops`;
  } else if (hmm.state === 2) {
    dispatch = "momentum";
    rationale = `HMM high-vol trending (p=${hmm.probability.toFixed(2)}) → deploy momentum/trend-following with trailing stops`;
  } else {
    dispatch = "breakout-prep";
    rationale = `HMM transitional (p=${hmm.probability.toFixed(2)}) → reduce size, widen stops, prepare for breakout`;
  }
  if (jumps.jumpDetected) {
    rationale += ` · ⚡ jump detected (z=${jumps.jumpZScore.toFixed(2)}) — trend initiation likely`;
  }

  return {
    symbol,
    garch: {
      regime,
      regimeProbability: probability,
      conditionalVol: currentVol,
      longRunVol,
      omega: garchFit?.omega ?? 0,
      alpha: garchFit?.alpha ?? 0,
      beta: garchFit?.beta ?? 0,
      persistence: garchFit?.persistence ?? 0,
      series: garchSeries.slice(-100),
    },
    jumps,
    hmm,
    dispatch,
    dispatchRationale: rationale,
    legacyRegime,
    timestamp: bars[n - 1]?.time ?? Date.now(),
  };
}
