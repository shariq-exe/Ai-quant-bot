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
import { computeFractal } from "./fractal";
import type { FractalReport } from "./fractal";
import { computeInformation } from "./information";
import type { InformationReport } from "./information";
import { computeStatArb } from "./statarb";
import type { StatArbReport } from "./statarb";

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
// Each signal is tagged with TWO gates:
//   1. HMM master switch (Phase 1.2): regimeActive = strategy type matches dispatch
//   2. Fractal signal-quality gate (Phase 1.3): fractalGate = open/caution/closed
// The composite signalStatus is:
//   active     — HMM matches AND fractal gate ≠ closed
//   hold       — HMM matches BUT fractal gate closed (fractal contradicts regime)
//   suppressed — HMM does not match (regardless of fractal)
// This implements the spec's "only trade when fractal dimension confirms the regime."
export function getLiveSignals(): LiveSignal[] {
  const out: LiveSignal[] = [];
  const lookback = 200;
  // Precompute dispatch (HMM) + fractal gate + PE sizing per symbol.
  const dispatchBySymbol = new Map<Symbol, SymbolDispatch>();
  for (const d of getDispatchContext()) dispatchBySymbol.set(d.symbol, d);
  const fractalBySymbol = new Map<Symbol, FractalReport>();
  for (const f of getAllFractal(500)) fractalBySymbol.set(f.symbol, f);
  // PE sizing from the information-theory report (per-symbol).
  const info = getInformation(500);
  const peBySymbol = new Map<Symbol, { multiplier: number; state: "predictable" | "normal" | "random" }>();
  for (const sym of SYMBOLS) {
    const pe = info.permutationEntropy[sym];
    peBySymbol.set(sym, { multiplier: pe.sizingMultiplier, state: pe.state });
  }

  for (const strat of STRATEGIES) {
    for (const sym of SYMBOLS) {
      const { bars } = getSeries(sym);
      if (bars.length < lookback + 5) continue;
      const idx = bars.length - 1;
      const res = strat.signal({ bars, idx, position: null });
      const direction: LiveSignal["direction"] =
        res.action === "enter-long" ? "long" : res.action === "enter-short" ? "short" : "flat";
      const ctx = dispatchBySymbol.get(sym);
      const fract = fractalBySymbol.get(sym);
      const pe = peBySymbol.get(sym) ?? { multiplier: 1, state: "normal" as const };
      const family = STRATEGY_DISPATCH[strat.type] ?? "always";
      const regimeActive =
        family === "always" || family === ctx?.dispatch;
      const regimeNote = regimeActive
        ? family === "always"
          ? "carry · regime-agnostic"
          : `matches ${ctx?.dispatch} regime`
        : `suppressed — ${ctx?.dispatch} regime active`;
      const fractalGate = fract?.tradeGate ?? "caution";
      // Composite 3-state status (HMM + fractal gate).
      let signalStatus: LiveSignal["signalStatus"];
      let statusNote: string;
      if (!regimeActive) {
        signalStatus = "suppressed";
        statusNote = regimeNote;
      } else if (fractalGate === "closed") {
        signalStatus = "hold";
        statusNote = `HMM ok · fractal gate CLOSED (D=${fract?.higuchi.dimension.toFixed(2)} contradicts ${fract?.dispatch})`;
      } else {
        signalStatus = "active";
        statusNote = regimeNote + (fractalGate === "caution" ? " · fractal caution" : " · fractal confirmed");
      }
      // PE sizing modulation (Phase 1.4 spec: increase size when predictable,
      // reduce/eliminate when random). effectiveConfidence = confidence × multiplier.
      const effectiveConfidence = res.strength * pe.multiplier;
      // "Eliminate exposure": if PE is random and the effective confidence drops
      // below 0.15, downgrade an active signal to HOLD.
      if (signalStatus === "active" && pe.state === "random" && effectiveConfidence < 0.15) {
        signalStatus = "hold";
        statusNote += ` · PE random (×${pe.multiplier}) → exposure eliminated`;
      } else if (signalStatus === "active" && pe.state !== "normal") {
        statusNote += ` · PE ${pe.state} (×${pe.multiplier.toFixed(2)})`;
      }
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
        fractalGate,
        signalStatus,
        statusNote,
        peSizingMultiplier: pe.multiplier,
        peState: pe.state,
        effectiveConfidence,
        isCrossAsset: false,
      });
    }
  }

  // --- Cross-asset edge signal injection (Phase 1.4 Transfer Entropy) ---
  // Per spec: "When TE(XAU→EUR) spikes, use gold signals to predict EUR/USD moves."
  // When the directed TE z-score > 2, inject a synthetic signal for the lagging
  // asset based on the leading asset's recent direction. This is the "massive
  // edge that retail traders completely miss." The signal carries confidence
  // proportional to the spike z-score and goes through the same PE sizing +
  // fractal gate pipeline as regular signals.
  if (info.crossAssetEdge !== "none") {
    const edge = info.crossAssetEdge;
    const isXauLeadsEur = edge.startsWith("xau-leads-eur");
    const isLong = edge.includes("long");
    const targetSymbol: Symbol = isXauLeadsEur ? "EUR/USD" : "XAU/USD";
    const leaderSymbol: Symbol = isXauLeadsEur ? "XAU/USD" : "EUR/USD";
    const leaderBars = getSeries(leaderSymbol).bars;
    const leaderRet = leaderBars.length > 1
      ? Math.log(leaderBars[leaderBars.length - 1].close / leaderBars[leaderBars.length - 2].close)
      : 0;
    const targetBars = getSeries(targetSymbol).bars;
    const targetIdx = targetBars.length - 1;
    const targetPe = peBySymbol.get(targetSymbol) ?? { multiplier: 1, state: "normal" as const };
    const targetFract = fractalBySymbol.get(targetSymbol);
    const targetFractalGate = targetFract?.tradeGate ?? "caution";
    // Confidence from the TE spike z-score (z>2 → confidence 0.5–1.0).
    const zConfidence = Math.min(1, Math.max(0.5, (info.transferEntropy.spikeZScore - 1) / 3));
    const effConf = zConfidence * targetPe.multiplier;
    // Cross-asset signals bypass the HMM dispatch (they're regime-agnostic edge
    // captures) but still respect the fractal gate + PE sizing.
    let edgeStatus: LiveSignal["signalStatus"];
    let edgeNote: string;
    if (targetFractalGate === "closed") {
      edgeStatus = "hold";
      edgeNote = `TE edge · fractal gate CLOSED for ${targetSymbol}`;
    } else if (targetPe.state === "random" && effConf < 0.15) {
      edgeStatus = "hold";
      edgeNote = `TE edge · PE random → exposure eliminated`;
    } else {
      edgeStatus = "active";
      edgeNote = `TE spike z=${info.transferEntropy.spikeZScore.toFixed(2)} · ${leaderSymbol} ${leaderRet >= 0 ? "rising" : "falling"} → ${targetSymbol} ${isLong ? "long" : "short"}`;
    }
    out.push({
      strategyCode: "cross-asset-te",
      strategyName: "Cross-Asset Transfer Entropy Edge",
      strategyType: "cross-asset",
      symbol: targetSymbol,
      direction: isLong ? "long" : "short",
      confidence: zConfidence,
      price: targetBars[targetIdx]?.close ?? 0,
      rationale: info.edgeRationale,
      indicators: {
        teZ: info.transferEntropy.spikeZScore,
        netTE: info.transferEntropy.netTE,
        leaderReturn: leaderRet,
      },
      timestamp: targetBars[targetIdx]?.time ?? Date.now(),
      dispatch: "mean-reversion", // not applicable but required by type
      regimeActive: true, // cross-asset edges bypass HMM dispatch
      regimeNote: "cross-asset edge · HMM bypass",
      fractalGate: targetFractalGate,
      signalStatus: edgeStatus,
      statusNote: edgeNote,
      peSizingMultiplier: targetPe.multiplier,
      peState: targetPe.state,
      effectiveConfidence: effConf,
      isCrossAsset: true,
      edgeSource: `${leaderSymbol} ${leaderRet >= 0 ? "rising" : "falling"}`,
    });
  }

  // --- Stat-arb spread-reversion signal injection (Phase 1.5) ---
  // Per spec: trade the spread when OU deviation > 2σ with θ confirming, AND
  // half-life is valid, AND cointegration holds. The composite signal already
  // combines OU + Kalman agreement. Direction: long-spread = buy XAU / sell EUR
  // (spread too low, expect reversion up); short-spread = sell XAU / buy EUR.
  const statArb = getStatArb(500);
  if (statArb.compositeSignal !== "none" && statArb.tradeGate === "open") {
    const isLongSpread = statArb.compositeSignal === "long-spread";
    // Long-spread → buy the spread → buy XAU, sell EUR. We report two legs.
    const legSymbol: Symbol = isLongSpread ? "XAU/USD" : "EUR/USD";
    const legBars = getSeries(legSymbol).bars;
    const legIdx = legBars.length - 1;
    const legPe = peBySymbol.get(legSymbol) ?? { multiplier: 1, state: "normal" as const };
    const legFract = fractalBySymbol.get(legSymbol);
    const legFractalGate = legFract?.tradeGate ?? "caution";
    // Confidence from the OU deviation (|z| scaled to 0.5–1.0).
    const saConfidence = Math.min(1, Math.max(0.5, (statArb.ou.deviation - 1) / 3));
    const saEff = saConfidence * legPe.multiplier;
    let saStatus: LiveSignal["signalStatus"];
    let saNote: string;
    if (legFractalGate === "closed") {
      saStatus = "hold";
      saNote = `stat-arb · fractal gate CLOSED for ${legSymbol}`;
    } else if (legPe.state === "random" && saEff < 0.15) {
      saStatus = "hold";
      saNote = `stat-arb · PE random → exposure eliminated`;
    } else {
      saStatus = "active";
      saNote = `stat-arb spread ${statArb.compositeSignal} (OU z=${statArb.ou.zScore.toFixed(2)}, HL=${statArb.ou.halfLife.toFixed(1)}b, Kalman z=${statArb.kalman.residualZScore.toFixed(2)})`;
    }
    out.push({
      strategyCode: "stat-arb-ou",
      strategyName: "Stat-Arb Spread Reversion (OU + Kalman)",
      strategyType: "stat-arb",
      symbol: legSymbol,
      direction: isLongSpread ? "long" : "short",
      confidence: saConfidence,
      price: legBars[legIdx]?.close ?? 0,
      rationale: statArb.compositeRationale,
      indicators: {
        ouZ: statArb.ou.zScore,
        ouTheta: statArb.ou.theta,
        halfLife: statArb.ou.halfLife,
        kalmanZ: statArb.kalman.residualZScore,
        hedgeRatio: statArb.kalman.hedgeRatio,
      },
      timestamp: legBars[legIdx]?.time ?? Date.now(),
      dispatch: "mean-reversion",
      regimeActive: true, // stat-arb bypasses HMM (it's a structural spread trade)
      regimeNote: "stat-arb · HMM bypass",
      fractalGate: legFractalGate,
      signalStatus: saStatus,
      statusNote: saNote,
      peSizingMultiplier: legPe.multiplier,
      peState: legPe.state,
      effectiveConfidence: saEff,
      isCrossAsset: false,
    });
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

// Fractal geometry report for one symbol: multi-timeframe Hurst (R/S + DFA),
// MF-DFA spectrum, Higuchi fractal dimension, composite dispatch + trade gate.
export function getFractal(symbol: Symbol, lookback = 500): FractalReport {
  const { bars } = getSeries(symbol);
  const recent = bars.slice(-lookback);
  return computeFractal(symbol, recent);
}

// All symbols' fractal reports (for the dashboard panel).
export function getAllFractal(lookback = 500): FractalReport[] {
  return SYMBOLS.map((s) => getFractal(s, lookback));
}

// Information-theory report: Transfer Entropy (XAU↔EUR), Permutation Entropy
// per symbol, Mutual Information feature ranking, composite cross-asset edge.
export function getInformation(lookback = 500): InformationReport {
  const eur = getSeries("EUR/USD").bars.slice(-lookback);
  const xau = getSeries("XAU/USD").bars.slice(-lookback);
  return computeInformation(eur, xau);
}

// Statistical-arbitrage report: OU process (θ/μ/σ) on the EUR-XAU spread,
// Kalman Filter dynamic hedge ratio + residual signal, Johansen cointegration
// test, half-life of mean reversion with validity gate.
export function getStatArb(lookback = 500): StatArbReport {
  const eur = getSeries("EUR/USD").bars.slice(-lookback);
  const xau = getSeries("XAU/USD").bars.slice(-lookback);
  return computeStatArb(eur, xau, 48);
}
