"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, Minus, Zap, Pause, PowerOff, ShieldCheck } from "lucide-react";
import type { LiveSignal } from "@/lib/quant/types";

interface SignalCardProps {
  signal: LiveSignal;
}

const TYPE_LABELS: Record<string, string> = {
  "mean-reversion": "Mean Reversion",
  momentum: "Momentum",
  breakout: "Breakout",
  carry: "Carry",
  "cross-asset": "Cross-Asset TE",
  "stat-arb": "Stat-Arb OU",
  "ml-ensemble": "ML Ensemble",
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
  const status = signal.signalStatus;

  // 3-state styling:
  //   active    — full color, amber ring, ⚡ ACTIVE badge
  //   hold      — amber-tinted, dashed ring, ⏸ HOLD badge (HMM ok but fractal gate closed)
  //   suppressed — dimmed, ⏻ SUPPRESSED badge
  const cardClass =
    status === "active"
      ? signal.isCrossAsset
        ? `${dirBg} ring-1 ring-fuchsia-400/50` // cross-asset edge gets a fuchsia ring
        : `${dirBg} ring-1 ring-amber-400/40`
      : status === "hold"
      ? `${dirBg} ring-1 ring-amber-500/30 ring-dashed opacity-70`
      : `${dirBg} opacity-40 saturate-50`;

  const StatusIcon = status === "active" ? Zap : status === "hold" ? Pause : PowerOff;
  const statusColor =
    status === "active"
      ? "text-amber-300 border-amber-500/40 bg-amber-500/20"
      : status === "hold"
      ? "text-amber-400 border-amber-600/40 bg-amber-600/10"
      : "text-slate-500 border-slate-700 bg-slate-800/40";
  const statusLabel = status === "active" ? "ACTIVE" : status === "hold" ? "HOLD" : "SUPPRESSED";

  return (
    <Card className={`border ${cardClass} p-4 flex flex-col gap-2 transition-opacity`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-slate-100">
              {signal.symbol}
            </span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-slate-600 text-slate-400">
              {TYPE_LABELS[signal.strategyType] ?? signal.strategyType}
            </Badge>
            <Badge className={`text-[9px] py-0 px-1 h-4 gap-0.5 border ${statusColor} hover:${statusColor}`}>
              <StatusIcon className="h-2.5 w-2.5" /> {statusLabel}
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
          {signal.peSizingMultiplier !== 1 && (
            <span
              className={`ml-1 font-mono text-[9px] ${
                signal.peSizingMultiplier > 1 ? "text-emerald-400" : "text-rose-400"
              }`}
              title={`PE ${signal.peState} → sizing ×${signal.peSizingMultiplier.toFixed(2)}`}
            >
              →{(signal.effectiveConfidence * 100).toFixed(0)}%
            </span>
          )}
        </span>
      </div>

      {/* PE sizing badge */}
      {signal.peSizingMultiplier !== 1 && (
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[9px] font-mono px-1 py-0 rounded ${
              signal.peSizingMultiplier > 1
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-rose-500/10 text-rose-400"
            }`}
          >
            PE {signal.peState} ×{signal.peSizingMultiplier.toFixed(2)}
          </span>
        </div>
      )}

      <p className="text-[11px] leading-snug text-slate-400 line-clamp-2" title={signal.rationale}>
        {signal.rationale}
      </p>

      {/* Composite status note — explains the 3-state classification */}
      <p className="text-[9px] font-mono text-slate-500 italic flex items-start gap-1" title={signal.statusNote}>
        {status === "active" && <ShieldCheck className="h-2.5 w-2.5 text-amber-400/60 shrink-0 mt-0.5" />}
        {signal.statusNote}
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
