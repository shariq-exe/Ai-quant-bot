// Quant engine — public entrypoint.
// Centralizes data generation (cached), live signal generation, and the
// backtest suite so API routes have one clean import.

import type { Bar, LiveSignal, Regime, Strategy, Symbol } from "./types";
import { generateSeries, generateLiveTick, SYMBOL_CONFIG } from "./market-data";
import { STRATEGIES, getStrategy } from "./strategies";
import { runBacktest, type BacktestConfig, type BacktestResult } from "./backtest";
import type { StrategySummary } from "./backtest";
import { computeMicrostructure } from "./microstructure";
import type { MicrostructureReport } from "./microstructure";
import { computeVolatility } from "./volatility";
import type { VolatilityReport } from "./volatility";
import type { StrategyDispatch, SymbolDispatch } from "./types";

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

// Map a strategy type to the dispatch family it belongs to.
// Carry is regime-agnostic (structural harvest) → always eligible.
const STRATEGY_DISPATCH: Record<string, StrategyDispatch | "always"> = {
  "mean-reversion": "mean-reversion",
  momentum: "momentum",
  breakout: "breakout-prep",
  carry: "always",
};

// Compute the per-symbol dispatch context (HMM master switch state).
export function getDispatchContext(): SymbolDispatch[] {
  return SYMBOLS.map((sym) => {
    const vol = getVolatility(sym, 500);
    return {
      symbol: sym,
      dispatch: vol.dispatch,
      regimeLabel: vol.hmm.label,
      regimeProbability: vol.hmm.probability,
      volRegime: vol.garch.regime,
      rationale: vol.dispatchRationale,
    };
  });
}

// Generate the current live signal for every strategy × symbol.
// Each signal is tagged with the HMM master-switch dispatch for its symbol:
// regimeActive = true when the strategy's type matches the active dispatch
// family (or it's a regime-agnostic carry strategy). This is the wiring that
// turns the HMM into the "master switch that determines which sub-strategies
// are active" per the Phase 1.2 spec.
export function getLiveSignals(): LiveSignal[] {
  const out: LiveSignal[] = [];
  const lookback = 200;
  // Precompute dispatch per symbol so we don't recompute the HMM per strategy.
  const dispatchBySymbol = new Map<Symbol, SymbolDispatch>();
  for (const d of getDispatchContext()) dispatchBySymbol.set(d.symbol, d);

  for (const strat of STRATEGIES) {
    for (const sym of SYMBOLS) {
      const { bars } = getSeries(sym);
      if (bars.length < lookback + 5) continue;
      const idx = bars.length - 1;
      const res = strat.signal({ bars, idx, position: null });
      const direction: LiveSignal["direction"] =
        res.action === "enter-long" ? "long" : res.action === "enter-short" ? "short" : "flat";
      const ctx = dispatchBySymbol.get(sym);
      const family = STRATEGY_DISPATCH[strat.type] ?? "always";
      const regimeActive =
        family === "always" || family === ctx?.dispatch;
      const regimeNote = regimeActive
        ? family === "always"
          ? "carry · regime-agnostic"
          : `matches ${ctx?.dispatch} regime`
        : `suppressed — ${ctx?.dispatch} regime active`;
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
        dispatch: ctx?.dispatch ?? "mean-reversion",
        regimeActive,
        regimeNote,
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

// Microstructure report for one symbol. Computes VPIN, Kyle's Lambda, Amihud
// ILLIQ, and OFI from the recent bar window and returns a composite toxicity
// / liquidity score with a narrative interpretation.
export function getMicrostructure(symbol: Symbol, lookback = 500): MicrostructureReport {
  const { bars, regimes } = getSeries(symbol);
  const recent = bars.slice(-lookback);
  const recentRegimes = regimes.slice(-lookback);
  const regime = recentRegimes[recentRegimes.length - 1] ?? "calm";
  return computeMicrostructure(symbol, recent, regime);
}

// All symbols' microstructure reports (for the dashboard panel).
export function getAllMicrostructure(lookback = 500): MicrostructureReport[] {
  return SYMBOLS.map((s) => getMicrostructure(s, lookback));
}

// Volatility intelligence report for one symbol: GARCH regime, bipower-variation
// jump detection, and HMM master-switch state with strategy dispatch.
export function getVolatility(symbol: Symbol, lookback = 500): VolatilityReport {
  const { bars, regimes } = getSeries(symbol);
  const recent = bars.slice(-lookback);
  const recentRegimes = regimes.slice(-lookback);
  const legacyRegime = recentRegimes[recentRegimes.length - 1] ?? "calm";
  return computeVolatility(symbol, recent, legacyRegime);
}

// All symbols' volatility reports (for the dashboard panel).
export function getAllVolatility(lookback = 500): VolatilityReport[] {
  return SYMBOLS.map((s) => getVolatility(s, lookback));
}
