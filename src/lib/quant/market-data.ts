// Quant engine — synthetic market data generator.
// Regime-aware Geometric Brownian Motion with Markov regime switching.
// Produces statistically realistic EUR/USD and XAU/USD OHLCV series for backtesting.
// Deterministic when a seed is supplied (mulberry32 PRNG) so backtests are reproducible.

import type { Bar, Regime, Symbol, SymbolConfig } from "./types";

export const SYMBOL_CONFIG: Record<Symbol, SymbolConfig> = {
  "EUR/USD": {
    symbol: "EUR/USD",
    basePrice: 1.085,
    dailyVol: 0.006, // ~0.6% daily vol — realistic for EUR/USD
    spread: 0.00005, // 0.5 pip half-spread
    pipSize: 0.0001,
    tvSymbol: "FX:EURUSD",
  },
  "XAU/USD": {
    symbol: "XAU/USD",
    basePrice: 2330,
    dailyVol: 0.012, // ~1.2% daily vol — realistic for spot gold
    spread: 0.3, // $0.30 half-spread
    pipSize: 0.1,
    tvSymbol: "OANDA:XAU_USD",
  },
};

// Markov regime transition matrix. Regimes persist (sticky) but switch.
const TRANSITION: Record<Regime, Record<Regime, number>> = {
  trend: { trend: 0.96, revert: 0.02, highvol: 0.01, calm: 0.01 },
  revert: { trend: 0.02, revert: 0.96, highvol: 0.01, calm: 0.01 },
  highvol: { trend: 0.08, revert: 0.05, highvol: 0.82, calm: 0.05 },
  calm: { trend: 0.06, revert: 0.06, highvol: 0.03, calm: 0.85 },
};

const REGIMES: Regime[] = ["trend", "revert", "highvol", "calm"];

// mulberry32 — small, fast, deterministic PRNG.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gaussian via Box-Muller, driven by a supplied uniform PRNG.
function makeGauss(rng: () => number): () => number {
  return function () {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

function nextRegime(rng: () => number, current: Regime): Regime {
  const r = rng();
  let acc = 0;
  const row = TRANSITION[current];
  for (const k of REGIMES) {
    acc += row[k];
    if (r <= acc) return k;
  }
  return current;
}

export interface GenerateOptions {
  bars: number;
  intervalMs: number; // bar interval
  seed?: number;
  switchEveryNBars?: number; // how often to evaluate regime transitions (default: daily)
}

export function generateSeries(
  symbol: Symbol,
  opts: GenerateOptions
): { bars: Bar[]; regimes: Regime[] } {
  const cfg = SYMBOL_CONFIG[symbol];
  const { bars: nBars, intervalMs } = opts;
  const rng = opts.seed != null ? mulberry32(opts.seed) : Math.random;
  const gauss = makeGauss(rng);
  const dt = intervalMs / (24 * 60 * 60 * 1000); // fraction of a day per bar
  const baseSigma = cfg.dailyVol * Math.sqrt(dt);

  let price = cfg.basePrice;
  let regime: Regime = "calm";
  let trendDrift = 0; // per-bar drift during a trend regime (small, in bps of vol)
  let eqMean = cfg.basePrice; // OU equilibrium, slowly evolving

  const switchEvery = opts.switchEveryNBars ?? Math.max(1, Math.round((24 * 60 * 60 * 1000) / intervalMs));
  const out: Bar[] = [];
  const regimes: Regime[] = [];
  const start = Date.now() - nBars * intervalMs;
  // Global mean-reversion pull keeps the series bounded over very long runs
  // so a sustained trend regime can't run price to zero or infinity.
  const globalPull = 0.002; // weak pull toward basePrice per bar when far away

  for (let i = 0; i < nBars; i++) {
    if (i > 0 && i % switchEvery === 0) {
      const newRegime = nextRegime(rng, regime);
      if (newRegime !== regime) {
        regime = newRegime;
        if (regime === "trend") {
          // Small per-bar drift: a fraction of one sigma. Over a ~24-bar trend
          // regime this moves price by a few sigma, not by a multiple.
          trendDrift = (rng() > 0.5 ? 1 : -1) * baseSigma * (0.15 + rng() * 0.2);
        }
        if (regime === "revert") {
          eqMean = price; // re-anchor OU mean to current price
        }
      }
    }

    // Distance from base, in log terms, capped so the pull never explodes.
    const logDev = Math.log(Math.max(price, cfg.pipSize) / cfg.basePrice);
    const boundedPull = -globalPull * Math.max(-0.3, Math.min(0.3, logDev));

    let drift = boundedPull;
    let vol = baseSigma;
    switch (regime) {
      case "trend":
        drift = trendDrift + boundedPull;
        vol = baseSigma;
        break;
      case "revert":
        drift = (eqMean - price) / price * 0.03 + boundedPull; // OU pull (fractional)
        vol = baseSigma * 0.85;
        break;
      case "highvol":
        drift = boundedPull;
        vol = baseSigma * 2.3;
        break;
      case "calm":
        drift = boundedPull;
        vol = baseSigma * 0.6;
        break;
    }

    const ret = drift + vol * gauss();
    const open = price;
    const close = Math.max(price * (1 + ret), cfg.pipSize);
    const wick = Math.abs(gauss()) * vol * 0.4;
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.min(open, close) * (1 - wick);
    const volume = Math.round(
      800 + Math.abs(gauss()) * 400 + (regime === "highvol" ? 1500 : 0) + (regime === "trend" ? 800 : 0)
    );

    out.push({
      time: start + i * intervalMs,
      open,
      high,
      low,
      close,
      volume,
    });
    regimes.push(regime);
    price = close;
  }

  return { bars: out, regimes };
}

// Generate a "live" tail: append one new bar to an existing series using the
// same regime model, so the dashboard's latest price moves realistically.
export function generateLiveTick(
  symbol: Symbol,
  lastBar: Bar,
  intervalMs: number,
  rng: () => number = Math.random
): Bar {
  const cfg = SYMBOL_CONFIG[symbol];
  const gauss = makeGauss(rng);
  const dt = intervalMs / (24 * 60 * 60 * 1000);
  const sigma = cfg.dailyVol * Math.sqrt(dt);
  const ret = sigma * gauss();
  const open = lastBar.close;
  const close = Math.max(open * (1 + ret), cfg.pipSize);
  const wick = Math.abs(gauss()) * sigma * 0.4;
  return {
    time: lastBar.time + intervalMs,
    open,
    high: Math.max(open, close) * (1 + wick),
    low: Math.min(open, close) * (1 - wick),
    close,
    volume: Math.round(800 + Math.abs(gauss()) * 400),
  };
}
