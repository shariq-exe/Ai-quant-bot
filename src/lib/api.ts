// Frontend API client — typed fetch helpers for the quant endpoints.
// All requests use relative paths (sandbox-safe; no hardcoded ports).

import type { BacktestStats, LiveSignal, Symbol, StrategyDispatch, SymbolDispatch } from "@/lib/quant/types";

export interface StrategyInfo {
  code: string;
  name: string;
  type: string;
  description: string;
}

export interface StrategyResult {
  code: string;
  name: string;
  type: string;
  description: string;
  symbol: Symbol;
  stats: BacktestStats;
}

export interface StrategiesResponse {
  symbols: Symbol[];
  strategies: StrategyInfo[];
  results: StrategyResult[];
  generatedAt: string;
}

export interface SignalsResponse {
  signals: LiveSignal[];
  dispatch: SymbolDispatch[];
  count: number;
  generatedAt: string;
}

// Re-export the dispatch types for convenience in components.
export type { StrategyDispatch, SymbolDispatch };

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolConfig {
  symbol: Symbol;
  basePrice: number;
  dailyVol: number;
  spread: number;
  pipSize: number;
  tvSymbol: string;
}

export interface MarketDataResponse {
  symbol: Symbol;
  config: SymbolConfig;
  bars: Bar[];
  lastPrice: number;
  change: number;
  changePct: number;
  timestamp: number;
  generatedAt: string;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

export interface Trade {
  side: "long" | "short";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  bars: number;
  pnl: number;
  pnlPct: number;
  exitReason: string;
}

export interface BacktestResponse {
  strategyCode: string;
  symbol: Symbol;
  stats: BacktestStats;
  regimeDistribution: Record<string, number>;
  equityCurve: EquityPoint[];
  trades: Trade[];
  totalTrades: number;
  generatedAt: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `GET ${url} → ${res.status}: ${body.error ?? res.statusText}${body.detail ? " — " + body.detail : ""}`
    );
  }
  return res.json() as Promise<T>;
}

// --- Microstructure types (mirror src/lib/quant/microstructure.ts) ---

export interface VPINResult {
  vpin: number;
  rollingMean: number;
  rollingStd: number;
  zScore: number;
  toxicityFlag: boolean;
  bucketCount: number;
  series: { time: number; vpin: number }[];
}

export interface KyleLambdaResult {
  lambda: number;
  rollingLambda: number;
  mean: number;
  std: number;
  zScore: number;
  trend: "rising" | "falling" | "stable";
  series: { time: number; lambda: number }[];
}

export interface AmihudResult {
  illiq: number;
  mean: number;
  std: number;
  zScore: number;
  percentile: number;
  series: { time: number; illiq: number }[];
}

export interface OFIResult {
  cumulativeDelta: number;
  deltaSeries: { time: number; delta: number; cumDelta: number; price: number }[];
  divergence: "bullish" | "bearish" | "none";
  divergenceStrength: number;
  priceTrend: "up" | "down" | "flat";
  deltaTrend: "up" | "down" | "flat";
}

export interface MicrostructureReport {
  symbol: Symbol;
  vpin: VPINResult;
  kyleLambda: KyleLambdaResult;
  amihud: AmihudResult;
  ofi: OFIResult;
  toxicity: number;
  toxicityLabel: "calm" | "elevated" | "toxic" | "extreme";
  liquidity: number;
  liquidityLabel: "thin" | "normal" | "deep";
  interpretation: string;
  regime: string;
  timestamp: number;
}

export interface MicrostructureResponse {
  reports: MicrostructureReport[];
  count: number;
  generatedAt: string;
}

// --- Volatility intelligence types (mirror src/lib/quant/volatility.ts) ---

export type VolRegime = "low-vol" | "transitional" | "high-vol";
export type StrategyDispatch = "mean-reversion" | "breakout-prep" | "momentum";

export interface HMMState {
  state: number;
  label: string;
  probability: number;
  stateMeans: number[];
  stateVols: number[];
  logLikelihood: number;
  // Multivariate (4 features: log-return, realized-vol, vol-skew, spread-proxy)
  featureNames: string[];
  stateFeatureMeans: number[][]; // [state][feature]
  stateFeatureVols: number[][];
  currentFeatures: number[];
}

export interface VolatilityReport {
  symbol: Symbol;
  garch: {
    regime: VolRegime;
    regimeProbability: number;
    conditionalVol: number;
    longRunVol: number;
    omega: number;
    alpha: number;
    beta: number;
    persistence: number;
    series: { time: number; vol: number; regime: VolRegime }[];
  };
  jumps: {
    realizedVol: number;
    bipowerVol: number;
    jumpComponent: number;
    jumpRatio: number;
    jumpDetected: boolean;
    jumpZScore: number;
    recentJumps: { time: number; ratio: number; detected: boolean }[];
  };
  hmm: HMMState;
  dispatch: StrategyDispatch;
  dispatchRationale: string;
  legacyRegime: string;
  timestamp: number;
}

export interface VolatilityResponse {
  reports: VolatilityReport[];
  count: number;
  generatedAt: string;
}

export const api = {
  strategies: () => fetchJson<StrategiesResponse>("/api/strategies"),
  signals: () => fetchJson<SignalsResponse>("/api/signals"),
  marketData: (symbol: Symbol, bars = 200) =>
    fetchJson<MarketDataResponse>(`/api/market-data?symbol=${encodeURIComponent(symbol)}&bars=${bars}`),
  backtest: (code: string, symbol: Symbol) =>
    fetchJson<BacktestResponse>(
      `/api/backtest?code=${encodeURIComponent(code)}&symbol=${encodeURIComponent(symbol)}`
    ),
  microstructure: () => fetchJson<MicrostructureResponse>("/api/microstructure"),
  volatility: () => fetchJson<VolatilityResponse>("/api/volatility"),
};
