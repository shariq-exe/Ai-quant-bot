// Quant engine — information theory & causality detection (Phase 1.4).
//
// Three components:
//   1. Transfer Entropy (TE) — directed information transfer between XAU/USD
//      and EUR/USD. Uses the exact spec formula:
//        TE(X→Y) = Σ p(y_{t+1}, y_t, x_t) · log[ p(y_{t+1}|y_t, x_t) / p(y_{t+1}|y_t) ]
//      When TE(XAU→EUR) spikes, gold leads euro — a cross-asset edge.
//   2. Permutation Entropy (PE) — Bandt-Pompe symbolic entropy on rolling
//      windows. Low PE = predictable (increase size); high PE = random (reduce).
//   3. Mutual Information (MI) — non-linear feature selection. Computes MI
//      between candidate features and future returns, ranking them.
//
// All pure TypeScript, no external deps. Quantized-symbol estimators keep the
// joint-distribution counts tractable without external KDE libraries.

import type {
  Bar,
  InformationReport,
  MutualInfoFeature,
  MutualInfoResult,
  PermutationEntropyResult,
  Symbol,
  TransferEntropyResult,
} from "./types";
import { mean, std } from "./statistics";

// ---------------------------------------------------------------------------
// Helpers: quantize a continuous series into k symbols (equal-width bins).
// This makes the joint-distribution counts finite and tractable.
// ---------------------------------------------------------------------------
function quantize(values: number[], bins: number): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1e-9;
  return values.map((v) => {
    let b = Math.floor(((v - min) / span) * bins);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    return b;
  });
}

// ===========================================================================
// 1. Transfer Entropy (Schreiber 2000) — exact spec formula
// ===========================================================================
// TE(X→Y) = Σ p(y_{t+1}, y_t, x_t) · log2[ p(y_{t+1}|y_t, x_t) / p(y_{t+1}|y_t) ]
//
// We quantize X and Y into `bins` symbols, then form the triplets and count
// joint frequencies. TE is the reduction in uncertainty about y_{t+1} when
// adding x_t to the conditioning set (vs just y_t).
//
// X = XAU/USD returns, Y = EUR/USD returns (so X→Y = gold leads euro).
export function transferEntropy(
  xSeries: number[],
  ySeries: number[],
  bins = 4,
  rollingWindow = 120
): TransferEntropyResult {
  const n = Math.min(xSeries.length, ySeries.length);
  if (n < 30) {
    return {
      teXtoY: 0,
      teYtoX: 0,
      netTE: 0,
      leadDirection: "balanced",
      spike: false,
      spikeZScore: 0,
      series: [],
    };
  }
  const xq = quantize(xSeries, bins);
  const yq = quantize(ySeries, bins);

  // Compute TE over a rolling window to build a time series + detect spikes.
  const series: { time: number; teXtoY: number; teYtoX: number }[] = [];
  // We don't have real timestamps for raw return arrays; use index as time.
  for (let end = rollingWindow; end <= n - 1; end++) {
    const start = end - rollingWindow;
    const xs = xq.slice(start, end);
    const ys = yq.slice(start, end);
    const t1 = teCore(xs, ys, bins);
    const t2 = teCore(ys, xs, bins);
    series.push({ time: end, teXtoY: t1, teYtoX: t2 });
  }

  if (series.length === 0) {
    return {
      teXtoY: 0,
      teYtoX: 0,
      netTE: 0,
      leadDirection: "balanced",
      spike: false,
      spikeZScore: 0,
      series: [],
    };
  }

  const last = series[series.length - 1];
  const teXtoY = last.teXtoY;
  const teYtoX = last.teYtoX;
  const netTE = teXtoY - teYtoX;
  const leadDirection: TransferEntropyResult["leadDirection"] =
    Math.abs(netTE) < 0.02 ? "balanced" : netTE > 0 ? "XAU-leads-EUR" : "EUR-leads-XAU";

  // Spike detection on the dominant direction's TE vs its rolling baseline.
  const dominantSeries = netTE >= 0 ? series.map((s) => s.teXtoY) : series.map((s) => s.teYtoX);
  const m = mean(dominantSeries);
  const s = std(dominantSeries) || 1e-9;
  const currentDominant = netTE >= 0 ? teXtoY : teYtoX;
  const z = (currentDominant - m) / s;
  const spike = z > 2;

  return {
    teXtoY,
    teYtoX,
    netTE,
    leadDirection,
    spike,
    spikeZScore: z,
    series: series.slice(-60),
  };
}

// Core TE estimator for one window. Counts joint triplets and computes the
// log-ratio of conditionals via empirical probabilities.
function teCore(xSym: number[], ySym: number[], bins: number): number {
  const T = xSym.length;
  if (T < 4) return 0;
  // We need (x_t, y_t, y_{t+1}). Shift by 1.
  // Counters:
  //  p(y_{t+1}, y_t, x_t) — joint triple
  //  p(y_t, x_t) — for conditioning
  //  p(y_{t+1}, y_t) — marginal conditioning on y_t alone
  //  p(y_t) — marginal
  const tripleCount = new Map<string, number>();
  const pairYXCount = new Map<string, number>();
  const pairYYCount = new Map<string, number>();
  const yCount = new Map<number, number>();
  let total = 0;
  for (let t = 0; t < T - 1; t++) {
    const xt = xSym[t];
    const yt = ySym[t];
    const yt1 = ySym[t + 1];
    const k3 = `${yt1},${yt},${xt}`;
    const k2yx = `${yt},${xt}`;
    const k2yy = `${yt1},${yt}`;
    tripleCount.set(k3, (tripleCount.get(k3) ?? 0) + 1);
    pairYXCount.set(k2yx, (pairYXCount.get(k2yx) ?? 0) + 1);
    pairYYCount.set(k2yy, (pairYYCount.get(k2yy) ?? 0) + 1);
    yCount.set(yt, (yCount.get(yt) ?? 0) + 1);
    total++;
  }
  if (total === 0) return 0;
  let te = 0;
  for (const [k3, c3] of tripleCount) {
    const [yt1Str, ytStr, xtStr] = k3.split(",");
    const yt1 = Number(yt1Str);
    const yt = Number(ytStr);
    const xt = Number(xtStr);
    const p3 = c3 / total;
    const c2yx = pairYXCount.get(`${yt},${xt}`) ?? 0;
    const c2yy = pairYYCount.get(`${yt1},${yt}`) ?? 0;
    const cy = yCount.get(yt) ?? 0;
    if (c2yx === 0 || c2yy === 0 || cy === 0) continue;
    // p(y_{t+1} | y_t, x_t) = c3 / c2yx
    // p(y_{t+1} | y_t) = c2yy / cy
    const condJoint = c3 / c2yx;
    const condMarginal = c2yy / cy;
    if (condJoint > 0 && condMarginal > 0) {
      te += p3 * Math.log2(condJoint / condMarginal);
    }
  }
  // Clamp tiny negatives (finite-sample noise) to 0.
  return Math.max(0, te);
}

// ===========================================================================
// 2. Permutation Entropy (Bandt-Pompe 2002)
// ===========================================================================
// For embedding dimension m and time delay τ, map each window of m values to
// its ordinal pattern (the permutation that sorts them). PE = Shannon entropy
// of the pattern distribution, normalized by log2(m!) so PE ∈ [0,1].
//   PE ≈ 0 → highly ordered / predictable
//   PE ≈ 1 → random
export function permutationEntropy(
  values: number[],
  m = 4,
  tau = 1,
  window = 100
): PermutationEntropyResult {
  const n = values.length;
  if (n < window + m * tau) {
    return {
      pe: 1,
      rollingMean: 1,
      rollingStd: 0,
      percentile: 0.5,
      state: "normal",
      sizingMultiplier: 1,
      series: [],
    };
  }
  // Rolling PE series.
  const peSeries: { time: number; pe: number }[] = [];
  for (let end = window; end <= n; end++) {
    const slice = values.slice(end - window, end);
    const pe = peWindow(slice, m, tau);
    peSeries.push({ time: end, pe });
  }
  const recent = peSeries.slice(-window);
  const peValues = recent.map((s) => s.pe);
  const current = peValues[peValues.length - 1] ?? 1;
  const m0 = mean(peValues);
  const s0 = std(peValues) || 1e-9;
  // Percentile rank.
  let below = 0;
  for (const v of peValues) if (v <= current) below++;
  const percentile = below / peValues.length;
  // State per spec: <20th pct = predictable, >80th pct = random.
  let state: PermutationEntropyResult["state"];
  let sizingMultiplier: number;
  if (percentile < 0.2) {
    state = "predictable";
    sizingMultiplier = 1.25; // increase position sizing
  } else if (percentile > 0.8) {
    state = "random";
    sizingMultiplier = 0.5; // reduce / eliminate exposure
  } else {
    state = "normal";
    sizingMultiplier = 1.0;
  }
  return {
    pe: current,
    rollingMean: m0,
    rollingStd: s0,
    percentile,
    state,
    sizingMultiplier,
    series: recent.slice(-60),
  };
}

function peWindow(values: number[], m: number, tau: number): number {
  const n = values.length;
  if (n < (m - 1) * tau + 1) return 1;
  const patternCount = new Map<string, number>();
  let total = 0;
  for (let i = 0; i <= n - (m - 1) * tau - 1; i++) {
    // Extract the embedding vector and its ordinal pattern.
    const idx = [];
    for (let j = 0; j < m; j++) idx.push(i + j * tau);
    const vals = idx.map((k) => values[k]);
    // Ordinal pattern = permutation that sorts vals ascending.
    const order = vals
      .map((v, k) => ({ v, k }))
      .sort((a, b) => (a.v === b.v ? a.k - b.k : a.v - b.v))
      .map((o) => o.k)
      .join(",");
    patternCount.set(order, (patternCount.get(order) ?? 0) + 1);
    total++;
  }
  if (total === 0) return 1;
  // Shannon entropy of pattern distribution, normalized by log2(m!).
  let h = 0;
  for (const c of patternCount.values()) {
    const p = c / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  const maxH = Math.log2(factorial(m));
  return maxH > 0 ? h / maxH : 1;
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// ===========================================================================
// 3. Mutual Information for feature selection
// ===========================================================================
// MI(X;Y) = Σ_x Σ_y p(x,y) · log2[ p(x,y) / (p(x)·p(y)) ]
// Captures non-linear dependencies that Pearson correlation misses.
// We compute MI between each candidate feature and the future (next-bar)
// return, ranking features by information content.
export function mutualInfo(
  featureMatrix: { feature: string; values: number[] }[],
  futureReturns: number[],
  bins = 5
): MutualInfoResult {
  const features: MutualInfoFeature[] = [];
  const n = futureReturns.length;
  if (n < 10) {
    return { features: [], topFeature: "—", topMI: 0, informativeCount: 0 };
  }
  const yq = quantize(futureReturns, bins);
  for (const { feature, values } of featureMatrix) {
    if (values.length < n) continue;
    const xs = values.slice(0, n);
    const xq = quantize(xs, bins);
    const mi = miCore(xq, yq, bins);
    features.push({ feature, mi, rank: 0 });
  }
  // Sort by MI descending, assign normalized ranks.
  features.sort((a, b) => b.mi - a.mi);
  const maxMI = features[0]?.mi ?? 1;
  features.forEach((f, i) => {
    f.rank = features.length > 1 ? 1 - i / (features.length - 1) : 1;
    f.mi = Math.max(0, f.mi);
  });
  const top = features[0];
  const informativeCount = features.filter((f) => f.mi > 0.05).length;
  return {
    features,
    topFeature: top?.feature ?? "—",
    topMI: top?.mi ?? 0,
    informativeCount,
  };
}

function miCore(xq: number[], yq: number[], bins: number): number {
  const n = xq.length;
  if (n === 0) return 0;
  const joint = new Map<string, number>();
  const px = new Map<number, number>();
  const py = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const k = `${xq[i]},${yq[i]}`;
    joint.set(k, (joint.get(k) ?? 0) + 1);
    px.set(xq[i], (px.get(xq[i]) ?? 0) + 1);
    py.set(yq[i], (py.get(yq[i]) ?? 0) + 1);
  }
  let mi = 0;
  for (const [k, c] of joint) {
    const [xs, ys] = k.split(",");
    const pxy = c / n;
    const pxi = (px.get(Number(xs)) ?? 0) / n;
    const pyi = (py.get(Number(ys)) ?? 0) / n;
    if (pxi > 0 && pyi > 0 && pxy > 0) {
      mi += pxy * Math.log2(pxy / (pxi * pyi));
    }
  }
  return mi;
}

// ===========================================================================
// Composite information-theory report
// ===========================================================================
function logReturns(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) out.push(Math.log(bars[i].close / bars[i - 1].close));
  return out;
}

export function computeInformation(
  eurBars: Bar[],
  xauBars: Bar[]
): InformationReport {
  const eurRets = logReturns(eurBars);
  const xauRets = logReturns(xauBars);
  // Align lengths (both series start at index 1 of their respective bars).
  const n = Math.min(eurRets.length, xauRets.length);
  const eur = eurRets.slice(-n);
  const xau = xauRets.slice(-n);

  // --- Transfer Entropy (X = XAU, Y = EUR) ---
  const te = transferEntropy(xau, eur, 4, 120);

  // --- Permutation Entropy per symbol ---
  const peEUR = permutationEntropy(eur, 4, 1, 100);
  const peXAU = permutationEntropy(xau, 4, 1, 100);

  // --- Mutual Information for feature selection ---
  // Build candidate features from the EUR series and correlate with next-bar returns.
  const T = eur.length;
  const futureReturns: number[] = [];
  const featLogRet: number[] = [];
  const featVol: number[] = [];
  const featXauRet: number[] = [];
  const featSpread: number[] = [];
  const featVolume: number[] = [];
  const volWindow = 20;
  for (let i = volWindow; i < T - 1; i++) {
    futureReturns.push(eur[i + 1]);
    featLogRet.push(eur[i]);
    let rv = 0;
    for (let j = i - volWindow + 1; j <= i; j++) rv += eur[j] * eur[j];
    featVol.push(Math.sqrt(rv / volWindow));
    featXauRet.push(xau[i]);
    // Spread proxy from aligned EUR bars (offset by volWindow since rets start at bar 1).
    const barIdx = i + 1; // rets[i] corresponds to bars[i+1]
    if (barIdx < eurBars.length) {
      featSpread.push((eurBars[barIdx].high - eurBars[barIdx].low) / eurBars[barIdx].close);
      featVolume.push(eurBars[barIdx].volume);
    } else {
      featSpread.push(0);
      featVolume.push(0);
    }
  }
  const mi = mutualInfo(
    [
      { feature: "log-return", values: featLogRet },
      { feature: "realized-vol", values: featVol },
      { feature: "xau-return", values: featXauRet },
      { feature: "spread-proxy", values: featSpread },
      { feature: "volume", values: featVolume },
    ],
    futureReturns,
    5
  );

  // --- Composite cross-asset edge signal ---
  // If TE(XAU→EUR) spikes, gold leads euro → use gold's recent direction to
  // predict EUR's next move. This is the "massive edge" the spec mentions.
  let crossAssetEdge: InformationReport["crossAssetEdge"] = "none";
  let edgeRationale = "no cross-asset edge — TE not spiking";
  if (te.spike && te.leadDirection !== "balanced") {
    const recentXauReturn = xau[xau.length - 1];
    const recentEurReturn = eur[eur.length - 1];
    if (te.leadDirection === "XAU-leads-EUR") {
      // Gold leads euro: gold's recent move predicts EUR's next move.
      if (recentXauReturn > 0) {
        crossAssetEdge = "xau-leads-eur-long";
        edgeRationale = `TE(XAU→EUR) spike (z=${te.spikeZScore.toFixed(2)}) + gold rising → EUR/USD long edge`;
      } else {
        crossAssetEdge = "xau-leads-eur-short";
        edgeRationale = `TE(XAU→EUR) spike (z=${te.spikeZScore.toFixed(2)}) + gold falling → EUR/USD short edge`;
      }
    } else {
      if (recentEurReturn > 0) {
        crossAssetEdge = "eur-leads-xau-long";
        edgeRationale = `TE(EUR→XAU) spike (z=${te.spikeZScore.toFixed(2)}) + euro rising → XAU/USD long edge`;
      } else {
        crossAssetEdge = "eur-leads-xau-short";
        edgeRationale = `TE(EUR→XAU) spike (z=${te.spikeZScore.toFixed(2)}) + euro falling → XAU/USD short edge`;
      }
    }
  }

  return {
    symbols: ["EUR/USD", "XAU/USD"],
    transferEntropy: te,
    permutationEntropy: {
      "EUR/USD": peEUR,
      "XAU/USD": peXAU,
    },
    mutualInfo: mi,
    crossAssetEdge,
    edgeRationale,
    timestamp: eurBars[eurBars.length - 1]?.time ?? Date.now(),
  };
}
