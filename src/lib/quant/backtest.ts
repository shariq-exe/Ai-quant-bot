// Quant engine — backtesting framework.
// Walks forward through bars, executes strategy signals on the NEXT bar's open
// (no lookahead), models spread + slippage, sizes positions by risk fraction,
// and computes a full statistical validation: Sharpe, Sortino, max DD, hit rate,
// profit factor, t-stat + p-value, expectancy, and signal half-life.
//
// A strategy is only marked `valid` when:
//   - trades >= 1000  (statistical power)
//   - pValue < 0.05   (edge is not chance)
//   - sharpe > 0.5    (economically meaningful after costs)
//
// This is the validation gate the mandate demands.

import type {
  BacktestResult,
  BacktestStats,
  Bar,
  EquityPoint,
  Position,
  Regime,
  SignalEvent,
  Strategy,
  Symbol,
  Trade,
} from "./types";
import { SYMBOL_CONFIG } from "./market-data";
import {
  halfLife,
  maxDrawdown,
  mean,
  sharpe as sharpeFn,
  sortino as sortinoFn,
  tTest,
} from "./statistics";

export interface BacktestConfig {
  strategy: Strategy;
  symbol: Symbol;
  bars: Bar[];
  regimes?: Regime[];
  capital: number;
  riskPerTrade: number; // fraction of equity risked per trade
  slippagePips: number; // slippage in pips applied on entry/exit
  periodsPerYear: number; // for annualization (e.g. 252 for daily, 252*6.5 for hourly-equity-session)
  maxBars?: number; // optional cap to keep runtimes bounded
}

const MIN_TRADES = 1000;
const MAX_PVALUE = 0.05;
const MIN_SHARPE = 0.5;

export function runBacktest(cfg: BacktestConfig): BacktestResult {
  const { strategy, symbol, bars, capital, riskPerTrade, periodsPerYear } = cfg;
  const sym = SYMBOL_CONFIG[symbol];
  const slippage = cfg.slippagePips * sym.pipSize;
  const end = cfg.maxBars ? Math.min(bars.length, cfg.maxBars) : bars.length;

  let equity = capital;
  let peak = capital;
  let position: Position | null = null;
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];
  const signals: SignalEvent[] = [];
  const regimeDist: Record<Regime, number> = { trend: 0, revert: 0, highvol: 0, calm: 0 };

  // Pending action set on bar i, executed at bar i+1 open.
  let pending: { action: string; strength: number; rationale: string; indicators?: Record<string, number>; stopDistance?: number } | null = null;

  for (let i = 0; i < end; i++) {
    const bar = bars[i];
    if (cfg.regimes) regimeDist[cfg.regimes[i]]++;

    // ---- Execute pending action at this bar's open (no lookahead) ----
    if (pending && i > 0) {
      const execPrice = bar.open;
      // Risk-parity sizing: stopDistance (price units) × size = equity × riskPerTrade.
      // Strategy may supply stopDistance; otherwise default to 1% of entry.
      const computeSize = (entry: number) => {
        const stopDist = Math.max(pending?.stopDistance ?? entry * 0.01, sym.pipSize * 5);
        const raw = (equity * riskPerTrade) / stopDist;
        const capped = (equity * 20) / entry; // cap notional at 20x equity
        return Math.min(raw, capped);
      };
      if (pending.action === "enter-long" && !position) {
        const entry = execPrice + slippage + sym.spread; // pay the spread + slip
        const size = computeSize(entry);
        position = { side: "long", entryPrice: entry, entryIdx: i, entryTime: bar.time, size };
      } else if (pending.action === "enter-short" && !position) {
        const entry = execPrice - slippage - sym.spread;
        const size = computeSize(entry);
        position = { side: "short", entryPrice: entry, entryIdx: i, entryTime: bar.time, size };
      } else if (pending.action === "exit" && position) {
        const exit = position.side === "long" ? execPrice - slippage - sym.spread : execPrice + slippage + sym.spread;
        const grossPnl =
          position.side === "long"
            ? (exit - position.entryPrice) * position.size
            : (position.entryPrice - exit) * position.size;
        equity += grossPnl;
        const pnlPct = grossPnl / capital; // relative to starting capital for comparability
        trades.push({
          side: position.side,
          entryTime: position.entryTime,
          exitTime: bar.time,
          entryPrice: position.entryPrice,
          exitPrice: exit,
          bars: i - position.entryIdx,
          pnl: grossPnl,
          pnlPct,
          exitReason: pending.rationale,
        });
        position = null;
      }
      pending = null;
    }

    // ---- Mark-to-market equity (open position valued at close) ----
    let mtmEquity = equity;
    if (position) {
      mtmEquity =
        equity +
        (position.side === "long"
          ? (bar.close - position.entryPrice) * position.size
          : (position.entryPrice - bar.close) * position.size);
    }
    if (mtmEquity > peak) peak = mtmEquity;
    const dd = peak > 0 ? (peak - mtmEquity) / peak : 0;
    equityCurve.push({ time: bar.time, equity: mtmEquity, drawdown: dd });

    // ---- Generate signal for next bar ----
    const res = strategy.signal({ bars, idx: i, position });
    const sign = res.action === "enter-short" ? -1 : res.action === "enter-long" ? 1 : 0;
    signals.push({
      time: bar.time,
      value: res.strength * sign,
      action: res.action,
      rationale: res.rationale,
      price: bar.close,
    });
    if (res.action === "enter-long" || res.action === "enter-short" || res.action === "exit") {
      pending = { action: res.action, strength: res.strength, rationale: res.rationale, indicators: res.indicators, stopDistance: res.stopDistance };
    }
  }

  // ---- Force-close any open position at the last close ----
  if (position && bars.length > 0) {
    const last = bars[end - 1];
    const exit = position.side === "long" ? last.close - sym.spread : last.close + sym.spread;
    const grossPnl =
      position.side === "long"
        ? (exit - position.entryPrice) * position.size
        : (position.entryPrice - exit) * position.size;
    equity += grossPnl;
    trades.push({
      side: position.side,
      entryTime: position.entryTime,
      exitTime: last.time,
      entryPrice: position.entryPrice,
      exitPrice: exit,
      bars: end - 1 - position.entryIdx,
      pnl: grossPnl,
      pnlPct: grossPnl / capital,
      exitReason: "end-of-backtest forced exit",
    });
  }

  const stats = computeStats(trades, equityCurve, bars, capital, periodsPerYear);
  return {
    strategyCode: strategy.code,
    symbol,
    trades,
    equityCurve,
    signals,
    stats,
    regimeDistribution: regimeDist,
  };
}

function computeStats(
  trades: Trade[],
  equityCurve: EquityPoint[],
  bars: Bar[],
  capital: number,
  periodsPerYear: number
): BacktestStats {
  const n = trades.length;
  const rets = trades.map((t) => t.pnlPct);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss;
  const { t, p } = tTest(rets);
  const closes = bars.map((b) => b.close);
  const hl = halfLife(closes);
  const totalReturn = equityCurve.length ? (equityCurve[equityCurve.length - 1].equity - capital) / capital : 0;
  const years = bars.length / periodsPerYear;
  const cagr = years > 0 && totalReturn > -1 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
  const dd = maxDrawdown(equityCurve.map((e) => e.equity));

  let valid = true;
  let invalidReason: string | undefined;
  if (n < MIN_TRADES) {
    valid = false;
    invalidReason = `insufficient trades (${n} < ${MIN_TRADES})`;
  } else if (p >= MAX_PVALUE) {
    valid = false;
    invalidReason = `p-value ${p.toFixed(4)} >= ${MAX_PVALUE} (edge not statistically significant)`;
  } else if (sharpeFn(rets, periodsPerYear) < MIN_SHARPE) {
    valid = false;
    invalidReason = `sharpe ${sharpeFn(rets, periodsPerYear).toFixed(2)} < ${MIN_SHARPE} (not economically meaningful after costs)`;
  }

  return {
    trades: n,
    sharpe: sharpeFn(rets, periodsPerYear),
    sortino: sortinoFn(rets, periodsPerYear),
    maxDrawdown: dd.maxDrawdown,
    hitRate: n > 0 ? wins.length / n : 0,
    profitFactor,
    pValue: p,
    tStat: t,
    expectancy: n > 0 ? mean(rets) : 0,
    avgWin: wins.length ? mean(wins.map((t) => t.pnlPct)) : 0,
    avgLoss: losses.length ? mean(losses.map((t) => t.pnlPct)) : 0,
    avgBars: n > 0 ? mean(trades.map((t) => t.bars)) : 0,
    totalReturn,
    cagr,
    signalHalfLife: hl,
    valid,
    invalidReason,
  };
}

// Convenience: run all strategies across both symbols and return a summary
// suitable for the dashboard's strategy table.
export interface StrategySummary {
  code: string;
  name: string;
  type: string;
  description: string;
  symbol: Symbol;
  stats: BacktestStats;
}

export function runBacktestSuite(
  strategies: Strategy[],
  symbols: Symbol[],
  dataProvider: (s: Symbol) => { bars: Bar[]; regimes: Regime[] },
  options: { capital?: number; riskPerTrade?: number; slippagePips?: number; periodsPerYear?: number; maxBars?: number } = {}
): StrategySummary[] {
  const out: StrategySummary[] = [];
  for (const strat of strategies) {
    for (const sym of symbols) {
      const { bars, regimes } = dataProvider(sym);
      const res = runBacktest({
        strategy: strat,
        symbol: sym,
        bars,
        regimes,
        capital: options.capital ?? 100000,
        riskPerTrade: options.riskPerTrade ?? 0.01,
        slippagePips: options.slippagePips ?? 1,
        periodsPerYear: options.periodsPerYear ?? 252 * 6.5,
        maxBars: options.maxBars,
      });
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
  return out;
}
