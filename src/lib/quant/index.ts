// Quant engine — public entrypoint.
// Centralizes data generation (cached), live signal generation, and the
// backtest suite so API routes have one clean import.

import type { Bar, LiveSignal, Regime, Strategy, Symbol } from "./types";
import { generateSeries, generateLiveTick, SYMBOL_CONFIG } from "./market-data";
import { STRATEGIES, getStrategy } from "./strategies";
import { runBacktest, type BacktestConfig, type BacktestResult } from "./backtest";
import type { StrategySummary } from "./backtest";

// 1-hour bars over ~11 years → ~96k bars per symbol. Long enough that validated
// strategies accumulate >1000 trades at their proper (non-overfit) thresholds.
const HOURLY_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_BARS = 96_000;
const PERIODS_PER_YEAR = 252 * 6.5; // ~6.5 trading hours/day, 252 trading days

// Deterministic seeds per symbol so backtests are reproducible across requests.
const SEEDS: Record<Symbol, number> = {
  "EUR/USD": 0xa11ce,
  "XAU/USD": 0xb0b,
};

export const SYMBOLS: Symbol[] = ["EUR/USD", "XAU/USD"];

interface CachedSeries {
  bars: Bar[];
  regimes: Regime[];
  generatedAt: number;
}

const cache = new Map<Symbol, CachedSeries>();
let suiteCache: StrategySummary[] | null = null;
let suiteCacheAt = 0;
const SUITE_TTL_MS = 5 * 60 * 1000; // recompute suite every 5 min

export function getSeries(symbol: Symbol): { bars: Bar[]; regimes: Regime[] } {
  let c = cache.get(symbol);
  if (!c) {
    const gen = generateSeries(symbol, {
      bars: DEFAULT_BARS,
      intervalMs: HOURLY_INTERVAL_MS,
      seed: SEEDS[symbol],
    });
    c = { ...gen, generatedAt: Date.now() };
    cache.set(symbol, c);
  }
  return { bars: c.bars, regimes: c.regimes };
}

// Append a freshly generated live bar to the cached series so the dashboard
// "current price" advances over time. Keeps the recent tail realistic.
export function advanceLiveTick(symbol: Symbol): Bar {
  const c = cache.get(symbol);
  if (!c) {
    const { bars } = getSeries(symbol);
    return bars[bars.length - 1];
  }
  const last = c.bars[c.bars.length - 1];
  const next = generateLiveTick(symbol, last, HOURLY_INTERVAL_MS);
  c.bars.push(next);
  c.regimes.push(c.regimes[c.regimes.length - 1]); // assume regime persists for the tick
  // keep memory bounded
  if (c.bars.length > DEFAULT_BARS + 500) {
    c.bars.splice(0, c.bars.length - DEFAULT_BARS);
    c.regimes.splice(0, c.regimes.length - DEFAULT_BARS);
  }
  return next;
}

export function getStrategies(): Strategy[] {
  return STRATEGIES;
}

export function backtestStrategy(
  code: string,
  symbol: Symbol,
  opts: { maxBars?: number } = {}
): BacktestResult | null {
  const strat = getStrategy(code);
  if (!strat) return null;
  const { bars, regimes } = getSeries(symbol);
  const cfg: BacktestConfig = {
    strategy: strat,
    symbol,
    bars,
    regimes,
    capital: 100_000,
    riskPerTrade: 0.01,
    slippagePips: 1,
    periodsPerYear: PERIODS_PER_YEAR,
    maxBars: opts.maxBars,
  };
  return runBacktest(cfg);
}

export function getBacktestSuite(): StrategySummary[] {
  const now = Date.now();
  if (suiteCache && now - suiteCacheAt < SUITE_TTL_MS) return suiteCache;
  const out: StrategySummary[] = [];
  for (const strat of STRATEGIES) {
    for (const sym of SYMBOLS) {
      const res = backtestStrategy(strat.code, sym);
      if (res) {
        out.push({
          code: strat.code,
          name: strat.name,
          type: strat.type,
          description: strat.description,
          symbol: sym,
          stats: res.stats,
        });
      }
    }
  }
  suiteCache = out;
  suiteCacheAt = now;
  return out;
}

// Generate the current live signal for every strategy × symbol.
// Uses the latest N bars of the cached series and the strategy's signal fn.
export function getLiveSignals(): LiveSignal[] {
  const out: LiveSignal[] = [];
  const lookback = 200;
  for (const strat of STRATEGIES) {
    for (const sym of SYMBOLS) {
      const { bars } = getSeries(sym);
      if (bars.length < lookback + 5) continue;
      // Evaluate on the most recent bar.
      const idx = bars.length - 1;
      const res = strat.signal({ bars, idx, position: null });
      const direction: LiveSignal["direction"] =
        res.action === "enter-long" ? "long" : res.action === "enter-short" ? "short" : "flat";
      out.push({
        strategyCode: strat.code,
        strategyName: strat.name,
        strategyType: strat.type,
        symbol: sym,
        direction,
        confidence: res.strength,
        price: bars[idx].close,
        rationale: res.rationale,
        indicators: res.indicators ?? {},
        timestamp: bars[idx].time,
      });
    }
  }
  return out;
}

// Recent OHLCV tail for charting (last N bars).
export function getRecentBars(symbol: Symbol, n: number): Bar[] {
  const { bars } = getSeries(symbol);
  return bars.slice(-n);
}

export function getSymbolConfig(symbol: Symbol) {
  return SYMBOL_CONFIG[symbol];
}
