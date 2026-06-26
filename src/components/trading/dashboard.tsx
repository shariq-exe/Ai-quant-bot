"use client";

import { useEffect, useState, useCallback } from "react";
import { Activity, Radio, Database, Cpu, RefreshCw, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TradingViewChart } from "./tradingview-chart";
import { SignalCard } from "./signal-card";
import { StrategyTable } from "./strategy-table";
import { EquityChart } from "./equity-chart";
import { PriceTicker } from "./price-ticker";
import { StatsPanel } from "./stats-panel";
import { api } from "@/lib/api";
import type {
  StrategiesResponse,
  SignalsResponse,
  MarketDataResponse,
  BacktestResponse,
} from "@/lib/api";
import type { Symbol } from "@/lib/quant/types";
import { SYMBOL_CONFIG } from "@/lib/quant/market-data";

const POLL_MS = 15_000;

export function Dashboard() {
  const [strategies, setStrategies] = useState<StrategiesResponse | null>(null);
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [eur, setEur] = useState<MarketDataResponse | null>(null);
  const [xau, setXau] = useState<MarketDataResponse | null>(null);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [selected, setSelected] = useState<{ code: string; symbol: Symbol }>({
    code: "decay-mom",
    symbol: "EUR/USD",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [s, sig, e, x] = await Promise.all([
        api.strategies(),
        api.signals(),
        api.marketData("EUR/USD", 200),
        api.marketData("XAU/USD", 200),
      ]);
      setStrategies(s);
      setSignals(sig);
      setEur(e);
      setXau(x);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBacktest = useCallback(async (code: string, symbol: Symbol) => {
    try {
      const bt = await api.backtest(code, symbol);
      setBacktest(bt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Initial load.
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Load backtest whenever the selection changes.
  useEffect(() => {
    loadBacktest(selected.code, selected.symbol);
  }, [selected, loadBacktest]);

  // Poll signals + tickers (cheap) every POLL_MS so the "live" feel is real.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const [sig, e, x] = await Promise.all([
          api.signals(),
          api.marketData("EUR/USD", 200),
          api.marketData("XAU/USD", 200),
        ]);
        setSignals(sig);
        setEur(e);
        setXau(x);
      } catch {
        // silent on poll failures; real errors surface on full reload
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const validCount = strategies?.results.filter((r) => r.stats.valid).length ?? 0;
  const totalCount = strategies?.results.length ?? 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#080a0e] text-slate-200">
      {/* Header */}
      <header className="border-b border-slate-800/60 bg-[#0b0e13]/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-amber-400" />
              <span className="font-mono font-bold text-sm tracking-tight text-slate-50">
                QUANT<span className="text-amber-400">·</span>DESK
              </span>
            </div>
            <span className="hidden sm:inline text-[11px] text-slate-500 font-mono">
              EUR/USD · XAU/USD · deep-research-to-execution
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5 text-[11px] font-mono">
              <span className="flex items-center gap-1 text-emerald-400">
                <Radio className="h-3 w-3 animate-pulse" /> LIVE
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">
                {validCount}/{totalCount} strategies validated
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500 hidden lg:inline">
              {now.toUTCString().slice(17, 25)} UTC
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={loadAll}
              disabled={loading}
              className="h-7 text-[11px] border-slate-700 hover:border-slate-600"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 py-4 space-y-4">
        {error && (
          <Card className="p-3 border-rose-500/40 bg-rose-500/5 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span className="text-xs font-mono text-rose-200">{error}</span>
          </Card>
        )}

        {/* Row 1: price tickers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {eur ? <PriceTicker data={eur} /> : <Skeleton className="h-[68px] bg-slate-800/50" />}
          {xau ? <PriceTicker data={xau} /> : <Skeleton className="h-[68px] bg-slate-800/50" />}
        </div>

        {/* Row 2: TradingView charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card className="p-3">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="font-mono text-xs text-slate-400">EUR/USD · TradingView</span>
              <span className="text-[10px] text-slate-600 font-mono">{SYMBOL_CONFIG["EUR/USD"].tvSymbol}</span>
            </div>
            <TradingViewChart symbol={SYMBOL_CONFIG["EUR/USD"].tvSymbol} height={400} />
          </Card>
          <Card className="p-3">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="font-mono text-xs text-slate-400">XAU/USD · TradingView</span>
              <span className="text-[10px] text-slate-600 font-mono">{SYMBOL_CONFIG["XAU/USD"].tvSymbol}</span>
            </div>
            <TradingViewChart symbol={SYMBOL_CONFIG["XAU/USD"].tvSymbol} height={400} />
          </Card>
        </div>

        {/* Row 3: live signals */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs uppercase tracking-wider text-slate-400 font-medium flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-emerald-400" />
              Live Signals
            </h2>
            <span className="text-[10px] text-slate-600 font-mono">
              {signals ? `updated ${new Date(signals.generatedAt).toLocaleTimeString()}` : "loading…"}
            </span>
          </div>
          {signals ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {signals.signals.map((sig) => (
                <SignalCard key={`${sig.strategyCode}-${sig.symbol}`} signal={sig} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[140px] bg-slate-800/50" />
              ))}
            </div>
          )}
        </section>

        {/* Row 4: strategy table + backtest detail */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <section className="xl:col-span-3">
            <h2 className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-2 flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-amber-400" />
              Strategy Performance · Validation Gate (p&lt;0.05 · ≥1000 trades · Sharpe&gt;0.5)
            </h2>
            {strategies ? (
              <StrategyTable
                results={strategies.results}
                selectedCode={selected.code}
                selectedSymbol={selected.symbol}
                onSelect={(code, symbol) => setSelected({ code, symbol: symbol as Symbol })}
              />
            ) : (
              <Skeleton className="h-[400px] bg-slate-800/50" />
            )}
          </section>
          <section className="xl:col-span-2 space-y-3">
            <h2 className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-2 flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-amber-400" />
              Backtest Detail
            </h2>
            {backtest ? (
              <>
                <EquityChart
                  equityCurve={backtest.equityCurve}
                  stats={backtest.stats}
                  symbol={backtest.symbol}
                  strategyCode={backtest.strategyCode}
                />
                <StatsPanel
                  title="Statistics"
                  stats={[
                    { label: "Trades", value: backtest.stats.trades.toLocaleString() },
                    { label: "Sharpe", value: backtest.stats.sharpe.toFixed(2), tone: backtest.stats.sharpe > 0.5 ? "good" : "bad" },
                    { label: "Sortino", value: isFinite(backtest.stats.sortino) ? backtest.stats.sortino.toFixed(2) : "∞" },
                    { label: "p-value", value: backtest.stats.pValue < 0.001 ? "<0.001" : backtest.stats.pValue.toFixed(4), tone: backtest.stats.pValue < 0.05 ? "good" : "bad" },
                    { label: "t-stat", value: backtest.stats.tStat.toFixed(2) },
                    { label: "Hit Rate", value: `${(backtest.stats.hitRate * 100).toFixed(1)}%` },
                    { label: "Profit Factor", value: isFinite(backtest.stats.profitFactor) ? backtest.stats.profitFactor.toFixed(2) : "∞", tone: backtest.stats.profitFactor > 1 ? "good" : "bad" },
                    { label: "Expectancy", value: `${(backtest.stats.expectancy * 100).toFixed(3)}%`, tone: backtest.stats.expectancy > 0 ? "good" : "bad" },
                    { label: "Max DD", value: `${(backtest.stats.maxDrawdown * 100).toFixed(1)}%`, tone: "bad" },
                    { label: "Signal HL", value: isFinite(backtest.stats.signalHalfLife) ? `${backtest.stats.signalHalfLife.toFixed(1)}b` : "∞" },
                  ]}
                />
                <StatsPanel
                  title="Regime Distribution"
                  stats={Object.entries(backtest.regimeDistribution).map(([k, v]) => ({
                    label: k,
                    value: v.toLocaleString(),
                    tone: "neutral",
                  }))}
                />
              </>
            ) : (
              <Skeleton className="h-[400px] bg-slate-800/50" />
            )}
          </section>
        </div>

        {/* Trade blotter */}
        {backtest && backtest.trades.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-2">
              Trade Blotter · last {backtest.trades.length} of {backtest.totalTrades.toLocaleString()}
            </h2>
            <Card className="overflow-hidden p-0">
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead className="sticky top-0 bg-slate-900/95">
                    <tr className="text-left text-slate-400 border-b border-slate-700/60">
                      <th className="py-2 px-3 font-medium">Side</th>
                      <th className="py-2 px-2 font-medium">Entry</th>
                      <th className="py-2 px-2 font-medium">Exit</th>
                      <th className="py-2 px-2 font-medium text-right">Entry Px</th>
                      <th className="py-2 px-2 font-medium text-right">Exit Px</th>
                      <th className="py-2 px-2 font-medium text-right">Bars</th>
                      <th className="py-2 px-2 font-medium text-right">PnL%</th>
                      <th className="py-2 px-3 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtest.trades.map((t, i) => (
                      <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                        <td className={`py-1.5 px-3 ${t.side === "long" ? "text-emerald-400" : "text-rose-400"}`}>
                          {t.side.toUpperCase()}
                        </td>
                        <td className="py-1.5 px-2 text-slate-400">{new Date(t.entryTime).toISOString().slice(0, 10)}</td>
                        <td className="py-1.5 px-2 text-slate-400">{new Date(t.exitTime).toISOString().slice(0, 10)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300">{t.entryPrice.toFixed(backtest.symbol === "EUR/USD" ? 5 : 2)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300">{t.exitPrice.toFixed(backtest.symbol === "EUR/USD" ? 5 : 2)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-500">{t.bars}</td>
                        <td className={`py-1.5 px-2 text-right font-semibold ${t.pnlPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {(t.pnlPct * 100).toFixed(3)}%
                        </td>
                        <td className="py-1.5 px-3 text-slate-500 truncate max-w-[220px]" title={t.exitReason}>
                          {t.exitReason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        )}
      </main>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-slate-800/60 bg-[#0b0e13] py-3">
        <div className="max-w-[1600px] mx-auto px-4 flex items-center justify-between gap-2 flex-wrap text-[10px] font-mono text-slate-600">
          <span>
            QUANT·DESK — synthetic regime-aware data · risk-parity sizing · validation gate p&lt;0.05 ·
            not investment advice
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            engine online
          </span>
        </div>
      </footer>
    </div>
  );
}
