// Quant engine — shared types.
// No runtime deps. Pure TypeScript so it can run on server (API routes / mini-services).

export type Symbol = "EUR/USD" | "XAU/USD";

export type Regime = "trend" | "revert" | "highvol" | "calm";

// --- Volatility intelligence (Phase 1.2) ---

// Markov-switching GARCH regimes (3-state volatility model).
export type VolRegime = "low-vol" | "transitional" | "high-vol";

// Mapping from a volatility regime to the strategy family that should be active.
// Low-vol → mean-reversion; Transitional → reduced size / breakout-prep; High-vol → momentum/trend.
export type StrategyDispatch = "mean-reversion" | "breakout-prep" | "momentum";

// Gaussian Hidden Markov Model state (3-4 hidden states decoded by Viterbi).
// Multivariate over 4 features: log-returns, realized vol, volume skewness,
// spread proxy (diagonal-covariance Gaussian emissions).
export interface HMMState {
  state: number; // decoded state index
  label: string; // human-readable state name
  probability: number; // forward probability of current state (0..1)
  // Legacy single-value fields (mean/vol of the log-return feature, feature 0)
  // kept for backward compat with the dashboard's HMM bar chart.
  stateMeans: number[]; // mean of log-return feature per state
  stateVols: number[]; // vol of log-return feature per state
  logLikelihood: number; // model fit
  // Multivariate feature details (Phase 1.2 spec: 4 features).
  featureNames: string[]; // ["log-return", "realized-vol", "vol-skew", "spread-proxy"]
  stateFeatureMeans: number[][]; // [state][feature] mean
  stateFeatureVols: number[][]; // [state][feature] std-dev
  currentFeatures: number[]; // the 4 feature values at the current bar
}

export interface VolatilityReport {
  symbol: Symbol;
  // GARCH(1,1) regime detection
  garch: {
    regime: VolRegime;
    regimeProbability: number; // posterior prob of current regime
    conditionalVol: number; // current σ_t estimate
    longRunVol: number; // unconditional σ
    omega: number;
    alpha: number; // ARCH coefficient (recent shock)
    beta: number; // GARCH coefficient (persistence)
    persistence: number; // alpha + beta (<1 → stationary)
    series: { time: number; vol: number; regime: VolRegime }[];
  };
  // Bipower variation jump detection (Barndorff-Nielsen & Shephard)
  jumps: {
    realizedVol: number; // RV_t = Σ r_i²
    bipowerVol: number; // BV_t (continuous component)
    jumpComponent: number; // max(RV - BV, 0)
    jumpRatio: number; // jumpComponent / RV (0..1)
    jumpDetected: boolean; // z-test on jump ratio > threshold
    jumpZScore: number;
    recentJumps: { time: number; ratio: number; detected: boolean }[];
  };
  // HMM regime classification (master switch)
  hmm: HMMState;
  // Composite: which strategy family should be active right now
  dispatch: StrategyDispatch;
  dispatchRationale: string;
  // Bridge to the legacy Regime type used elsewhere
  legacyRegime: Regime;
  timestamp: number;
}

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
  // --- Regime-aware dispatch (Phase 1.2 master switch) ---
  // The HMM-derived dispatch family active for this symbol right now.
  dispatch: StrategyDispatch;
  // Whether this strategy's type matches the active dispatch family.
  // Carry strategies are always eligible (structural harvest, regime-agnostic).
  regimeActive: boolean;
  // Human-readable reason for the active/inactive classification.
  regimeNote: string;
}

// Per-symbol dispatch context returned alongside live signals so the dashboard
// can show the master-switch state next to the signal grid.
export interface SymbolDispatch {
  symbol: Symbol;
  dispatch: StrategyDispatch;
  regimeLabel: string; // HMM state label
  regimeProbability: number;
  volRegime: VolRegime;
  rationale: string;
}
