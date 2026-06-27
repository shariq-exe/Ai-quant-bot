// Quant engine — shared types.
// No runtime deps. Pure TypeScript so it can run on server (API routes / mini-services).

export type Symbol = "EUR/USD" | "XAU/USD";

export type Regime = "trend" | "revert" | "highvol" | "calm";

// --- Machine learning signal synthesis (Phase 1.6) ---

// The 12 research-derived features per spec section 1.6.
export interface MLFeatureVector {
  time: number;
  features: Record<string, number>;
  // The target: next-bar forward return (for training)
  forwardReturn: number;
}

export interface MLFeatureReport {
  symbol: Symbol;
  featureNames: string[]; // the 12 feature names, in canonical order
  featureMatrix: MLFeatureVector[]; // aligned T×12 matrix
  // Per-feature statistics for the display
  featureStats: {
    name: string;
    mean: number;
    std: number;
    // Mutual information with the forward return (non-linear importance)
    mi: number;
    // Stability: |mean| / std (high = stable signal)
    stability: number;
  }[];
  // Sample count + date range
  sampleCount: number;
  startYear: number;
  endYear: number;
}

// The three specialist model types per spec.
export type SpecialistRegime = "trending" | "mean-reverting" | "volatile";

export interface SpecialistModel {
  regime: SpecialistRegime;
  modelType: "gradient-boosted-trees" | "ridge-regression" | "lstm-proxy";
  // In-sample fit metrics
  trainR2: number;
  trainMSE: number;
  // Out-of-sample metrics (from CPCV)
  oosR2: number;
  oosMSE: number;
  // Feature importance (normalized 0..1, SHAP-style proxy)
  featureImportance: { feature: string; importance: number }[];
  // Model weights (learned coefficients or splits)
  weights: Record<string, number>;
  // Number of training samples
  trainSamples: number;
}

export interface EnsemblePrediction {
  // The HMM-regime-weighted blend of the 3 specialists
  predictedReturn: number;
  // Confidence (0..1) — how aligned the specialists are
  confidence: number;
  // Per-specialist raw predictions before gating
  specialistPredictions: { regime: SpecialistRegime; prediction: number; weight: number }[];
  // The dominant regime (which specialist drove the ensemble)
  dominantRegime: SpecialistRegime;
  // Direction signal derived from the predicted return
  direction: "long" | "short" | "flat";
}

export interface MLValidationResult {
  // Combinatorial Purged Cross-Validation with embargo
  cpcvFolds: number;
  cpcvEmbargoBars: number;
  // Per-fold OOS Sharpe ratios
  foldSharpeRatios: number[];
  // Mean OOS Sharpe
  oosSharpe: number;
  // Deflated Sharpe Ratio (accounts for multiple testing bias)
  deflatedSharpe: number;
  // Number of trials used in the deflation (multiple testing correction)
  numTrials: number;
  // Walk-forward optimization result
  walkForwardWindows: { start: number; end: number; oosSharpe: number }[];
  // Years of out-of-sample data
  oosYears: number;
  // Verdict: does the model pass the anti-overfit protocol?
  passes: boolean;
  passRationale: string;
}

export interface MLReport {
  symbol: Symbol;
  features: MLFeatureReport;
  specialists: SpecialistModel[];
  ensemble: EnsemblePrediction;
  validation: MLValidationResult;
  // SHAP-style feature importance (aggregated across specialists)
  shapImportance: { feature: string; importance: number; stable: boolean }[];
  // --- SHAP-driven feature pruning (spec: "prune features with unstable importance") ---
  // Two-pass: train with all 12 features, compute SHAP, identify unstable,
  // retrain without them. The pruned model is the one used for signal injection.
  pruningApplied: boolean;
  prunedFeatures: string[]; // features removed (unstable)
  retainedFeatures: string[]; // features kept (stable)
  prunedSpecialists: SpecialistModel[];
  prunedEnsemble: EnsemblePrediction;
  prunedValidation: MLValidationResult;
  // Did pruning improve the validation?
  pruningImproved: boolean;
  pruningNote: string;
  timestamp: number;
}

// --- Statistical arbitrage & mean-reversion (Phase 1.5) ---

export interface OUResult {
  theta: number; // mean-reversion speed (per bar)
  mu: number; // equilibrium level (log-spread)
  sigma: number; // OU process volatility
  halfLife: number; // bars (= -ln(2)/θ when θ>0, else Infinity)
  // Current spread stats
  currentSpread: number;
  zScore: number; // (spread - μ) / σ_OU
  deviation: number; // |zScore|
  // Trade signal: enter when |z| > 2 AND θ confirms reversion speed
  entrySignal: "long-spread" | "short-spread" | "none";
  // Half-life validity per spec (1 ≤ HL ≤ maxHolding)
  halfLifeValid: boolean;
  halfLifeNote: string;
  // Spread series for charting
  series: { time: number; spread: number; equilibrium: number; upperBand: number; lowerBand: number }[];
}

export interface KalmanResult {
  // Dynamic hedge ratio β_t (time-varying)
  hedgeRatio: number;
  hedgeRatioSeries: { time: number; beta: number }[];
  // Residual = Y - β·X (the trading signal)
  residual: number;
  residualMean: number;
  residualStd: number;
  residualZScore: number; // standardized innovation
  // Entry when |residual z| > 2
  entrySignal: "long-residual" | "short-residual" | "none";
  // Innovation sequence stats (spec: "±2 standard deviations of its innovation sequence")
  innovationSeries: { time: number; residual: number }[];
  // Filter convergence (posterior variance — lower = more confident)
  posteriorVariance: number;
}

export interface CointegrationResult {
  // Johansen-style trace statistic (simplified eigenvalue-based test)
  isCointegrated: boolean;
  traceStat: number;
  criticalValue: number; // 5% critical value
  pValue: number;
  // The eigenvector (cointegrating vector) [1, -β]
  cointegratingVector: [number, number];
  note: string;
}

export interface StatArbReport {
  symbols: [Symbol, Symbol];
  // The spread being analyzed: log(XAU) - β·log(EUR) using the Kalman β
  spreadLabel: string;
  ou: OUResult;
  kalman: KalmanResult;
  cointegration: CointegrationResult;
  // Composite signal: combines OU z-score + Kalman residual + half-life gate
  compositeSignal: "long-spread" | "short-spread" | "none";
  compositeRationale: string;
  // Trade gate: only trade when half-life is valid AND cointegration holds
  tradeGate: "open" | "closed";
  timestamp: number;
}

// --- Information theory & causality (Phase 1.4) ---

export interface TransferEntropyResult {
  // Directed TE in bits: X → Y and Y → X
  teXtoY: number; // XAU → EUR
  teYtoX: number; // EUR → XAU
  netTE: number; // teXtoY - teYtoX (positive = X leads Y)
  leadDirection: "XAU-leads-EUR" | "EUR-leads-XAU" | "balanced";
  // Spike detection: is the dominant direction's TE elevated vs its rolling baseline?
  spike: boolean;
  spikeZScore: number;
  // History for charting
  series: { time: number; teXtoY: number; teYtoX: number }[];
}

export interface PermutationEntropyResult {
  pe: number; // 0..1 (0 = perfectly ordered/predictable, 1 = random)
  rollingMean: number;
  rollingStd: number;
  percentile: number; // rank in recent window (0..1)
  // Predictability state per spec
  state: "predictable" | "normal" | "random";
  // Sizing multiplier per spec: low PE (predictable) → increase size, high PE → reduce
  sizingMultiplier: number;
  series: { time: number; pe: number }[];
}

export interface MutualInfoFeature {
  feature: string;
  mi: number; // mutual information with future returns (bits)
  // Normalized rank 0..1 (1 = most informative)
  rank: number;
}

export interface MutualInfoResult {
  features: MutualInfoFeature[];
  // The single most informative feature for future returns
  topFeature: string;
  topMI: number;
  // Count of features with MI > 0.05 bits (non-trivial dependence)
  informativeCount: number;
}

export interface InformationReport {
  symbols: [Symbol, Symbol]; // always [EUR/USD, XAU/USD] for the TE pair
  transferEntropy: TransferEntropyResult;
  // Per-symbol PE (each symbol has its own predictability window)
  permutationEntropy: {
    [K in Symbol]: PermutationEntropyResult;
  };
  mutualInfo: MutualInfoResult;
  // Composite cross-asset edge signal
  crossAssetEdge: "xau-leads-eur-long" | "xau-leads-eur-short" | "eur-leads-xau-long" | "eur-leads-xau-short" | "none";
  edgeRationale: string;
  timestamp: number;
}

// --- Fractal geometry & long-memory analysis (Phase 1.3) ---

// Hurst exponent interpretation:
//   H > 0.5  → persistent (trending) → momentum
//   H ≈ 0.5  → random walk → reduce exposure
//   H < 0.5  → anti-persistent (mean-reverting) → mean-reversion
export type HurstRegime = "persistent" | "random-walk" | "anti-persistent";

export interface HurstResult {
  value: number; // H estimate
  method: "R/S" | "DFA";
  regime: HurstRegime;
  // Fit quality: log-log regression R² of (log τ, log statistic)
  rSquared: number;
}

export interface TimeframeHurst {
  timeframe: string; // "1H", "4H", "1D"
  barsPerWindow: number;
  rs: HurstResult;
  dfa: HurstResult;
  // Dislocation: how far this timeframe's average H diverges from the 1H baseline
  dislocation: number;
}

export interface MFDAResult {
  // Spectrum h(q) for moment orders q ∈ [-4, 4]
  qValues: number[];
  hValues: number[]; // generalized Hurst exponents
  // Multifractal width Δh = h_max - h_min (market complexity)
  deltaH: number;
  // Spectral classification
  complexity: "simple" | "moderate" | "complex";
  // h(2) — the standard DFA Hurst value (q=2)
  h2: number;
}

export interface HiguchiResult {
  dimension: number; // D_H ∈ [1, 2]
  // 1.0 = trending, 2.0 = noise. Signal quality from the spec.
  signalQuality: "high" | "medium" | "low";
  rSquared: number;
}

export interface FractalReport {
  symbol: Symbol;
  // Multi-timeframe Hurst (R/S + DFA per timeframe)
  timeframes: TimeframeHurst[];
  // Largest cross-timeframe dislocation (exploitable per spec)
  maxDislocation: number;
  dislocationTimeframes: string; // e.g. "1H vs 1D"
  // Multifractal spectrum
  mfdfa: MFDAResult;
  // Higuchi fractal dimension (signal-quality filter)
  higuchi: HiguchiResult;
  // Composite: which strategy family does fractal analysis endorse?
  dispatch: "momentum" | "mean-reversion" | "reduce-exposure";
  dispatchRationale: string;
  // Signal-quality gate: only trade when Higuchi confirms the regime
  tradeGate: "open" | "caution" | "closed";
  timestamp: number;
}

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
  // --- Regime-aware dispatch (Phase 1.2 HMM master switch) ---
  dispatch: StrategyDispatch;
  regimeActive: boolean;
  regimeNote: string;
  // --- Fractal signal-quality gate (Phase 1.3) ---
  fractalGate: "open" | "caution" | "closed";
  signalStatus: "active" | "hold" | "suppressed";
  statusNote: string;
  // --- Permutation entropy sizing modulation (Phase 1.4) ---
  // PE-derived sizing multiplier for this symbol: ×1.25 (predictable), ×1.0
  // (normal), ×0.5 (random). Per spec: low PE → increase size, high PE → reduce.
  peSizingMultiplier: number;
  peState: "predictable" | "normal" | "random";
  // Effective confidence after PE modulation = confidence × peSizingMultiplier.
  // When this drops below 0.15, an active signal is downgraded to HOLD
  // (the spec's "eliminate exposure" in the high-PE random regime).
  effectiveConfidence: number;
  // --- Cross-asset edge (Phase 1.4 Transfer Entropy) ---
  // True when this signal was injected by a TE cross-asset edge (not a regular
  // strategy). The spec: "When TE(XAU→EUR) spikes, use gold signals to predict
  // EUR/USD moves." These signals fire only when the directed TE z-score > 2.
  isCrossAsset: boolean;
  // The leading asset + direction that triggered this edge signal.
  edgeSource?: string; // e.g. "XAU rising" or "EUR falling"
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
