"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { StrategyResult } from "@/lib/api";

interface StrategyTableProps {
  results: StrategyResult[];
  selectedCode?: string;
  selectedSymbol?: string;
  onSelect?: (code: string, symbol: string) => void;
}

function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return n > 0 ? "∞" : "-∞";
  return n.toFixed(digits);
}

function fmtPct(n: number, digits = 1): string {
  if (!isFinite(n)) return "∞";
  return (n * 100).toFixed(digits) + "%";
}

export function StrategyTable({ results, selectedCode, selectedSymbol, onSelect }: StrategyTableProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
            <tr className="text-left text-slate-400 border-b border-slate-700/60">
              <th className="py-2.5 px-3 font-medium">Strategy</th>
              <th className="py-2.5 px-2 font-medium">Sym</th>
              <th className="py-2.5 px-2 font-medium text-right">Trades</th>
              <th className="py-2.5 px-2 font-medium text-right">Sharpe</th>
              <th className="py-2.5 px-2 font-medium text-right">Sortino</th>
              <th className="py-2.5 px-2 font-medium text-right">MaxDD</th>
              <th className="py-2.5 px-2 font-medium text-right">Hit%</th>
              <th className="py-2.5 px-2 font-medium text-right">PF</th>
              <th className="py-2.5 px-2 font-medium text-right">p-val</th>
              <th className="py-2.5 px-3 font-medium text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const s = r.stats;
              const isSelected =
                selectedCode === r.code && selectedSymbol === r.symbol;
              const sharpeColor =
                s.sharpe >= 2
                  ? "text-emerald-400"
                  : s.sharpe >= 0.5
                  ? "text-amber-400"
                  : "text-rose-400";
              return (
                <tr
                  key={`${r.code}-${r.symbol}`}
                  onClick={() => onSelect?.(r.code, r.symbol)}
                  className={`border-b border-slate-800/50 cursor-pointer transition-colors ${
                    isSelected ? "bg-amber-500/10" : "hover:bg-slate-800/40"
                  }`}
                >
                  <td className="py-2 px-3">
                    <div className="font-mono text-slate-100">{r.code}</div>
                    <div className="text-[10px] text-slate-500 capitalize">{r.type}</div>
                  </td>
                  <td className="py-2 px-2 font-mono text-slate-300">{r.symbol}</td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">
                    {s.trades.toLocaleString()}
                  </td>
                  <td className={`py-2 px-2 text-right font-mono font-semibold ${sharpeColor}`}>
                    {fmt(s.sharpe)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">
                    {fmt(s.sortino)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-rose-300/80">
                    {fmtPct(s.maxDrawdown)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">
                    {fmtPct(s.hitRate, 0)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-slate-300">
                    {fmt(s.profitFactor)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-slate-400">
                    {s.pValue < 0.001 ? "<0.001" : fmt(s.pValue, 3)}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {s.valid ? (
                      <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20 gap-1">
                        <CheckCircle2 className="h-3 w-3" /> VALID
                      </Badge>
                    ) : s.trades < 1000 ? (
                      <Badge variant="outline" className="text-amber-300 border-amber-500/30 gap-1">
                        <AlertTriangle className="h-3 w-3" /> low-n
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-rose-300 border-rose-500/30 gap-1">
                        <XCircle className="h-3 w-3" /> fail
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
