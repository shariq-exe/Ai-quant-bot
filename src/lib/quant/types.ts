// Quant engine — shared types.
// No runtime deps. Pure TypeScript so it can run on server (API routes / mini-services).

export type Symbol = "EUR/USD" | "XAU/USD";

export type Regime = "trend" | "revert" | "highvol" | "calm";

export interface Bar {
  time: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolConfig {
  symbol: Symbol;
  basePrice: number;
  dailyVol: number; // fractional daily vol
  spread: number; // half-spread in price units
  pipSize: number;
  tvSymbol: string; // TradingView ticker
}

export type TradeSide = "long" | "short";

export interface Trade {
  side: TradeSide;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  bars: number;
  pnl: number; // absolute
  pnlPct: number; // fractional return on the trade
  exitReason: string;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number; // fractional drawdown from peak
}

export interface SignalEvent {
  time: number;
  value: number; // signal strength, sign = direction
  action: SignalAction;
  rationale: string;
  price: number;
}

export type SignalAction = "enter-long" | "enter-short" | "exit" | "hold";

export interface Position {
  side: TradeSide;
  entryPrice: number;
  entryIdx: number;
  entryTime: number;
  size: number; // notional units
}

export interface StrategyContext {
  bars: Bar[];
  idx: number;
  position: Position | null;
}

export interface SignalResult {
  action: SignalAction;
  strength: number; // 0..1
  rationale: string;
  indicators?: Record<string, number>;
  // Optional price-distance stop, used for position sizing (risk-parity).
  // The backtester sizes so that stopDistance * size = equity * riskPerTrade,
  // bounding the per-trade loss at riskPerTrade of equity. When omitted,
  // a default of 1% of entry price is used.
  stopDistance?: number;
}

export interface Strategy {
  id: string;
  code: string;
  name: string;
  type: "mean-reversion" | "momentum" | "breakout" | "carry";
  description: string;
  signal(ctx: StrategyContext): SignalResult;
}

export interface BacktestStats {
  trades: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  hitRate: number;
  profitFactor: number;
  pValue: number;
  tStat: number;
  expectancy: number; // per-trade expected return (fractional)
  avgWin: number;
  avgLoss: number;
  avgBars: number;
  totalReturn: number;
  cagr: number;
  signalHalfLife: number; // bars
  valid: boolean; // passes p<0.05 && trades>=1000
  invalidReason?: string;
}

export interface BacktestResult {
  strategyCode: string;
  symbol: Symbol;
  trades: Trade[];
  equityCurve: EquityPoint[];
  signals: SignalEvent[];
  stats: BacktestStats;
  regimeDistribution: Record<Regime, number>;
}

export interface LiveSignal {
  strategyCode: string;
  strategyName: string;
  strategyType: string;
  symbol: Symbol;
  direction: "long" | "short" | "flat";
  confidence: number;
  price: number;
  rationale: string;
  indicators: Record<string, number>;
  timestamp: number;
}
