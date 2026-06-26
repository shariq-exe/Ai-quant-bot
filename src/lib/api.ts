// Frontend API client — typed fetch helpers for the quant endpoints.
// All requests use relative paths (sandbox-safe; no hardcoded ports).

import type { BacktestStats, LiveSignal, Symbol } from "@/lib/quant/types";

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
  count: number;
  generatedAt: string;
}

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

export const api = {
  strategies: () => fetchJson<StrategiesResponse>("/api/strategies"),
  signals: () => fetchJson<SignalsResponse>("/api/signals"),
  marketData: (symbol: Symbol, bars = 200) =>
    fetchJson<MarketDataResponse>(`/api/market-data?symbol=${encodeURIComponent(symbol)}&bars=${bars}`),
  backtest: (code: string, symbol: Symbol) =>
    fetchJson<BacktestResponse>(
      `/api/backtest?code=${encodeURIComponent(code)}&symbol=${encodeURIComponent(symbol)}`
    ),
};
