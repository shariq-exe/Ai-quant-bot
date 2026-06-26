// Quant engine — market microstructure intelligence.
// Implements the four metrics from Phase 1 (Alpha Laboratory):
//   1. VPIN  — Volume-Synchronized Probability of Informed Trading (Easley-López de Prado-O'Hara)
//   2. Kyle's Lambda — permanent price impact coefficient
//   3. Amihud ILLIQ — illiquidity ratio
//   4. OFI   — Order Flow Imbalance (cumulative delta divergence)
//
// All metrics are computed from OHLCV bars via Bulk Volume Classification (BVC)
// to infer trade direction without tick-level data. Each metric returns both a
// raw value and a normalized z-score / percentile so the dashboard can render
// a toxicity gauge. Real math, no placeholders.

import type { Bar, Regime, Symbol } from "./types";
import { mean, std, normalCdf, olsSlope } from "./statistics";

// ---------------------------------------------------------------------------
// Bulk Volume Classification (BVC)
// ---------------------------------------------------------------------------
// Easley, López de Prado, O'Hara (2012). Splits each bar's volume into
// buy/sell pressure using the standardized price-change CDF under a normal
// approximation: V_buy = V * CDF(ΔP/σ), V_sell = V * (1 - CDF(ΔP/σ)).
// This avoids the tick-rule requirement and works on OHLCV bars.
export interface ClassifiedVolume {
  time: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  delta: number; // buy - sell
  price: number;
}

export function bulkVolumeClassify(bars: Bar[], volStdWindow = 20): ClassifiedVolume[] {
  const out: ClassifiedVolume[] = [];
  // Rolling σ of price changes, used to standardize ΔP for the normal CDF.
  const dPrices: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const dp = i === 0 ? 0 : bars[i].close - bars[i - 1].close;
    dPrices.push(dp);
    if (i === 0) {
      out.push({
        time: bars[i].time,
        buyVolume: bars[i].volume / 2,
        sellVolume: bars[i].volume / 2,
        totalVolume: bars[i].volume,
        delta: 0,
        price: bars[i].close,
      });
      continue;
    }
    // σ over the recent window of price changes (floor at a tiny epsilon).
    const start = Math.max(1, i - volStdWindow + 1);
    const slice = dPrices.slice(start, i + 1);
    const sigma = Math.max(std(slice), 1e-9);
    const z = dp / sigma;
    const buyProb = normalCdf(z); // >0.5 if price up
    const v = bars[i].volume;
    const buy = v * buyProb;
    const sell = v * (1 - buyProb);
    out.push({
      time: bars[i].time,
      buyVolume: buy,
      sellVolume: sell,
      totalVolume: v,
      delta: buy - sell,
      price: bars[i].close,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// VPIN — Volume-Synchronized Probability of Informed Trading
// ---------------------------------------------------------------------------
// Groups bars into volume buckets (not time buckets), then sums the absolute
// buy-sell imbalance across n buckets, normalized by total volume. High VPIN
// => toxic flow => informed trading => early warning of directional moves.
//
//   VPIN = (1/n) × Σ_τ |V_buy(τ) - V_sell(τ)| / V_bucket(τ)

export interface VPINResult {
  vpin: number; // current VPIN (0..1)
  rollingMean: number;
  rollingStd: number;
  zScore: number; // (vpin - mean) / std
  toxicityFlag: boolean; // zScore > 2  → early warning
  bucketCount: number;
  series: { time: number; vpin: number }[]; // time series for charting
}

export function computeVPIN(
  classified: ClassifiedVolume[],
  bucketVolume: number,
  nBuckets = 50,
  rollingWindow = 100
): VPINResult {
  if (classified.length === 0) {
    return {
      vpin: 0,
      rollingMean: 0,
      rollingStd: 0,
      zScore: 0,
      toxicityFlag: false,
      bucketCount: 0,
      series: [],
    };
  }
  // Aggregate into volume buckets.
  const buckets: { time: number; buy: number; sell: number; vol: number }[] = [];
  let cur = { time: classified[0].time, buy: 0, sell: 0, vol: 0 };
  for (const c of classified) {
    cur.buy += c.buyVolume;
    cur.sell += c.sellVolume;
    cur.vol += c.totalVolume;
    if (cur.vol >= bucketVolume) {
      buckets.push({ ...cur });
      cur = { time: c.time, buy: 0, sell: 0, vol: 0 };
    }
  }
  if (cur.vol > 0) buckets.push({ ...cur });

  // Sliding VPIN over the last nBuckets buckets.
  const series: { time: number; vpin: number }[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const start = Math.max(0, i - nBuckets + 1);
    const window = buckets.slice(start, i + 1);
    let absImb = 0;
    let totalVol = 0;
    for (const b of window) {
      absImb += Math.abs(b.buy - b.sell);
      totalVol += b.vol;
    }
    const vpin = totalVol > 0 ? absImb / (window.length * (totalVol / window.length)) : 0;
    series.push({ time: buckets[i].time, vpin });
  }

  const recent = series.slice(-rollingWindow);
  const values = recent.map((s) => s.vpin);
  const m = mean(values);
  const s = std(values) || 1e-9;
  const current = values[values.length - 1] ?? 0;
  const z = (current - m) / s;

  return {
    vpin: current,
    rollingMean: m,
    rollingStd: s,
    zScore: z,
    toxicityFlag: z > 2,
    bucketCount: buckets.length,
    series: series.slice(-rollingWindow),
  };
}

// ---------------------------------------------------------------------------
// Kyle's Lambda — permanent price impact coefficient
// ---------------------------------------------------------------------------
// Regress ΔP on signed volume (net buy volume): ΔP = λ × SignedVolume + ε.
// A rising λ means flow is moving price more per unit volume → thin book /
// informed pressure. A declining λ means the book absorbs flow easily.
export interface KyleLambdaResult {
  lambda: number; // price impact per unit signed volume
  rollingLambda: number; // recent-window estimate
  mean: number;
  std: number;
  zScore: number;
  trend: "rising" | "falling" | "stable";
  series: { time: number; lambda: number }[];
}

export function computeKyleLambda(
  classified: ClassifiedVolume[],
  window = 100,
  rollingWindow = 50
): KyleLambdaResult {
  const series: { time: number; lambda: number }[] = [];
  for (let i = window; i < classified.length; i++) {
    const slice = classified.slice(i - window, i + 1);
    const dP = slice.map((c, j) => (j === 0 ? 0 : c.price - slice[j - 1].price));
    const signedVol = slice.map((c) => c.delta);
    // OLS slope of ΔP on signed volume = λ
    const lambda = olsSlope(signedVol, dP);
    if (isFinite(lambda)) {
      series.push({ time: classified[i].time, lambda: Math.abs(lambda) });
    }
  }
  if (series.length === 0) {
    return { lambda: 0, rollingLambda: 0, mean: 0, std: 0, zScore: 0, trend: "stable", series: [] };
  }
  const recent = series.slice(-rollingWindow);
  const values = recent.map((s) => s.lambda);
  const m = mean(values);
  const s = std(values) || 1e-9;
  const current = values[values.length - 1] ?? 0;
  const z = (current - m) / s;
  // Trend: compare current half vs prior half of the rolling window.
  const half = Math.floor(values.length / 2);
  const firstHalf = mean(values.slice(0, half));
  const secondHalf = mean(values.slice(half));
  const trend =
    secondHalf > firstHalf * 1.15 ? "rising" : secondHalf < firstHalf * 0.85 ? "falling" : "stable";

  return {
    lambda: current,
    rollingLambda: current,
    mean: m,
    std: s,
    zScore: z,
    trend: trend as "rising" | "falling" | "stable",
    series: recent,
  };
}

// ---------------------------------------------------------------------------
// Amihud Illiquidity Ratio
// ---------------------------------------------------------------------------
//   ILLIQ = (1/D) × Σ |r_t| / Volume_t
// Maps illiquidity cycles to volatility expansion. Low liquidity + directional
// pressure = explosive moves. Returns the current value + a percentile rank
// over the rolling window so the gauge reads "illiquid" when in the top decile.
export interface AmihudResult {
  illiq: number; // current
  mean: number;
  std: number;
  zScore: number;
  percentile: number; // 0..1
  series: { time: number; illiq: number }[];
}

export function computeAmihud(bars: Bar[], window = 100): AmihudResult {
  const series: { time: number; illiq: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const r = Math.abs(bars[i].close / bars[i - 1].close - 1);
    const v = Math.max(bars[i].volume, 1);
    series.push({ time: bars[i].time, illiq: r / v });
  }
  if (series.length === 0) {
    return { illiq: 0, mean: 0, std: 0, zScore: 0, percentile: 0, series: [] };
  }
  const recent = series.slice(-window);
  const values = recent.map((s) => s.illiq);
  const m = mean(values);
  const s = std(values) || 1e-9;
  const current = values[values.length - 1] ?? 0;
  const z = (current - m) / s;
  // Percentile rank within the window.
  let below = 0;
  for (const v of values) if (v <= current) below++;
  const percentile = below / values.length;

  return {
    illiq: current,
    mean: m,
    std: s,
    zScore: z,
    percentile,
    series: recent,
  };
}

// ---------------------------------------------------------------------------
// Order Flow Imbalance (OFI) — cumulative delta divergence
// ---------------------------------------------------------------------------
// Tracks cumulative volume delta (buy - sell). When price makes new highs but
// cumulative delta diverges negatively, institutional distribution is occurring
// (bearish). Symmetric for new lows + positive delta (accumulation, bullish).
export interface OFIResult {
  cumulativeDelta: number; // current cumulative buy-sell
  deltaSeries: { time: number; delta: number; cumDelta: number; price: number }[];
  divergence: "bullish" | "bearish" | "none";
  divergenceStrength: number; // 0..1
  priceTrend: "up" | "down" | "flat";
  deltaTrend: "up" | "down" | "flat";
}

export function computeOFI(classified: ClassifiedVolume[], lookback = 100): OFIResult {
  const recent = classified.slice(-lookback);
  let cum = 0;
  const deltaSeries: OFIResult["deltaSeries"] = [];
  for (const c of recent) {
    cum += c.delta;
    deltaSeries.push({ time: c.time, delta: c.delta, cumDelta: cum, price: c.price });
  }
  if (deltaSeries.length < 10) {
    return {
      cumulativeDelta: cum,
      deltaSeries,
      divergence: "none",
      divergenceStrength: 0,
      priceTrend: "flat",
      deltaTrend: "flat",
    };
  }
  // Linear-regression slopes (via first/last halves) for price and cumDelta.
  const half = Math.floor(deltaSeries.length / 2);
  const firstPrice = mean(deltaSeries.slice(0, half).map((d) => d.price));
  const lastPrice = mean(deltaSeries.slice(half).map((d) => d.price));
  const firstDelta = mean(deltaSeries.slice(0, half).map((d) => d.cumDelta));
  const lastDelta = mean(deltaSeries.slice(half).map((d) => d.cumDelta));
  const priceUp = lastPrice > firstPrice * 1.0005;
  const priceDown = lastPrice < firstPrice * 0.9995;
  const deltaUp = lastDelta > firstDelta;
  const deltaDown = lastDelta < firstDelta;
  const priceTrend: OFIResult["priceTrend"] = priceUp ? "up" : priceDown ? "down" : "flat";
  const deltaTrend: OFIResult["deltaTrend"] = deltaUp ? "up" : deltaDown ? "down" : "flat";

  // Divergence: price up + delta down → bearish; price down + delta up → bullish.
  let divergence: OFIResult["divergence"] = "none";
  let divergenceStrength = 0;
  if (priceUp && deltaDown) {
    divergence = "bearish";
    const priceMove = Math.abs(lastPrice - firstPrice) / firstPrice;
    const deltaMove = Math.abs(lastDelta - firstDelta) / (Math.abs(firstDelta) + 1);
    divergenceStrength = Math.min(1, (priceMove * 100 + deltaMove) / 2);
  } else if (priceDown && deltaUp) {
    divergence = "bullish";
    const priceMove = Math.abs(lastPrice - firstPrice) / firstPrice;
    const deltaMove = Math.abs(lastDelta - firstDelta) / (Math.abs(firstDelta) + 1);
    divergenceStrength = Math.min(1, (priceMove * 100 + deltaMove) / 2);
  }

  return {
    cumulativeDelta: cum,
    deltaSeries,
    divergence,
    divergenceStrength,
    priceTrend,
    deltaTrend,
  };
}

// ---------------------------------------------------------------------------
// Aggregate microstructure report for one symbol
// ---------------------------------------------------------------------------
export interface MicrostructureReport {
  symbol: Symbol;
  vpin: VPINResult;
  kyleLambda: KyleLambdaResult;
  amihud: AmihudResult;
  ofi: OFIResult;
  // Composite toxicity score (0..1): weighted blend of normalized signals.
  toxicity: number;
  toxicityLabel: "calm" | "elevated" | "toxic" | "extreme";
  // Liquidity score (0..1): higher = more liquid / orderly.
  liquidity: number;
  liquidityLabel: "thin" | "normal" | "deep";
  // Narrative interpretation for the dashboard.
  interpretation: string;
  regime: Regime;
  timestamp: number;
}

export function computeMicrostructure(symbol: Symbol, bars: Bar[], regime: Regime): MicrostructureReport {
  const classified = bulkVolumeClassify(bars);
  // Bucket volume = median bar volume (so we get ~1 bucket per bar on average).
  const vols = bars.map((b) => b.volume).sort((a, b) => a - b);
  const medianVol = vols[Math.floor(vols.length / 2)] || 1000;
  const bucketVolume = medianVol;

  const vpin = computeVPIN(classified, bucketVolume);
  const kyleLambda = computeKyleLambda(classified);
  const amihud = computeAmihud(bars);
  const ofi = computeOFI(classified);

  // Composite toxicity: blend VPIN z-score, Kyle λ z-score, Amihud percentile,
  // and OFI divergence strength. Each normalized to 0..1, then weighted.
  const vpinScore = clamp01((vpin.zScore + 2) / 4); // map z∈[-2,2] → [0,1]
  const kyleScore = clamp01((kyleLambda.zScore + 2) / 4);
  const amihudScore = amihud.percentile;
  const ofiScore = ofi.divergenceStrength;
  const toxicity = clamp01(0.35 * vpinScore + 0.25 * kyleScore + 0.2 * amihudScore + 0.2 * ofiScore);

  const toxicityLabel: MicrostructureReport["toxicityLabel"] =
    toxicity > 0.75 ? "extreme" : toxicity > 0.6 ? "toxic" : toxicity > 0.4 ? "elevated" : "calm";

  // Liquidity: inverse of Amihud percentile + inverse of Kyle λ percentile.
  const liquidity = clamp01(0.6 * (1 - amihud.percentile) + 0.4 * (1 - kyleScore));
  const liquidityLabel: MicrostructureReport["liquidityLabel"] =
    liquidity > 0.66 ? "deep" : liquidity > 0.33 ? "normal" : "thin";

  const interpretation = buildInterpretation(vpin, kyleLambda, amihud, ofi, toxicityLabel, liquidityLabel);

  return {
    symbol,
    vpin,
    kyleLambda,
    amihud,
    ofi,
    toxicity,
    toxicityLabel,
    liquidity,
    liquidityLabel,
    interpretation,
    regime,
    timestamp: bars[bars.length - 1]?.time ?? Date.now(),
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function buildInterpretation(
  vpin: VPINResult,
  kyle: KyleLambdaResult,
  amihud: AmihudResult,
  ofi: OFIResult,
  tox: MicrostructureReport["toxicityLabel"],
  liq: MicrostructureReport["liquidityLabel"]
): string {
  const parts: string[] = [];
  if (vpin.toxicityFlag) {
    parts.push(`VPIN toxicity flag (z=${vpin.zScore.toFixed(2)}) — informed flow detected`);
  }
  if (kyle.trend === "rising") {
    parts.push("Kyle λ rising — thinning book / directional pressure building");
  } else if (kyle.trend === "falling") {
    parts.push("Kyle λ falling — book absorbing flow easily (continuation-favorable)");
  }
  if (amihud.percentile > 0.8) {
    parts.push(`Amihud ILLIQ in top ${(100 - amihud.percentile * 100).toFixed(0)}% — illiquid regime`);
  }
  if (ofi.divergence === "bearish") {
    parts.push("Price/delta divergence bearish — distribution suspected");
  } else if (ofi.divergence === "bullish") {
    parts.push("Price/delta divergence bullish — accumulation suspected");
  }
  if (parts.length === 0) {
    parts.push(`Flow ${tox} / book ${liq} — no microstructure anomaly`);
  }
  return parts.join(" · ");
}
