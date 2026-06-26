"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import type { LiveSignal } from "@/lib/quant/types";

interface SignalCardProps {
  signal: LiveSignal;
}

const TYPE_LABELS: Record<string, string> = {
  "mean-reversion": "Mean Reversion",
  momentum: "Momentum",
  breakout: "Breakout",
  carry: "Carry",
};

export function SignalCard({ signal }: SignalCardProps) {
  const dir = signal.direction;
  const DirIcon = dir === "long" ? ArrowUpRight : dir === "short" ? ArrowDownRight : Minus;
  const dirColor =
    dir === "long"
      ? "text-emerald-400"
      : dir === "short"
      ? "text-rose-400"
      : "text-slate-400";
  const dirBg =
    dir === "long"
      ? "bg-emerald-500/10 border-emerald-500/30"
      : dir === "short"
      ? "bg-rose-500/10 border-rose-500/30"
      : "bg-slate-500/10 border-slate-500/30";

  const decimals = signal.symbol === "EUR/USD" ? 5 : 2;

  return (
    <Card className={`border ${dirBg} p-4 flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-100">
              {signal.symbol}
            </span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-slate-600 text-slate-400">
              {TYPE_LABELS[signal.strategyType] ?? signal.strategyType}
            </Badge>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate" title={signal.strategyName}>
            {signal.strategyName}
          </div>
        </div>
        <div className={`flex items-center gap-1 ${dirColor} font-mono font-bold text-sm uppercase shrink-0`}>
          <DirIcon className="h-4 w-4" />
          {dir}
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg font-semibold text-slate-50">
          {signal.price.toFixed(decimals)}
        </span>
        <span className="text-[11px] text-slate-400">
          conf{" "}
          <span className={dir === "flat" ? "text-slate-500" : dirColor}>
            {(signal.confidence * 100).toFixed(0)}%
          </span>
        </span>
      </div>

      <p className="text-[11px] leading-snug text-slate-400 line-clamp-2" title={signal.rationale}>
        {signal.rationale}
      </p>

      {Object.keys(signal.indicators).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {Object.entries(signal.indicators)
            .slice(0, 3)
            .map(([k, v]) => (
              <span
                key={k}
                className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/40"
              >
                {k}={isFinite(v) ? v.toFixed(2) : "∞"}
              </span>
            ))}
        </div>
      )}
    </Card>
  );
}
