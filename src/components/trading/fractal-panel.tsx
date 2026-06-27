"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import {
  Box,
  TrendingUp,
  TrendingDown,
  Minus,
  Layers,
  Activity,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Gauge as GaugeIcon,
} from "lucide-react";
import type { FractalReport, HurstRegime } from "@/lib/api";

interface FractalPanelProps {
  reports: FractalReport[];
}

const HURST_COLOR: Record<HurstRegime, string> = {
  persistent: "#a78bfa", // violet — trending → momentum
  "random-walk": "#64748b", // slate
  "anti-persistent": "#34d399", // emerald — mean-reversion
};

const HURST_LABEL: Record<HurstRegime, string> = {
  persistent: "PERSISTENT",
  "random-walk": "RANDOM WALK",
  "anti-persistent": "ANTI-PERSISTENT",
};

const GATE_META = {
  open: { icon: ShieldCheck, color: "#34d399", label: "GATE OPEN" },
  caution: { icon: ShieldAlert, color: "#fbbf24", label: "GATE CAUTION" },
  closed: { icon: ShieldX, color: "#f43f5e", label: "GATE CLOSED" },
} as const;

const DISPATCH_COLOR: Record<FractalReport["dispatch"], string> = {
  momentum: "#a78bfa",
  "mean-reversion": "#34d399",
  "reduce-exposure": "#64748b",
};

export function FractalPanel({ reports }: FractalPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {reports.map((r) => {
        const dm = GATE_META[r.tradeGate];
        const GateIcon = dm.icon;
        const dispatchColor = DISPATCH_COLOR[r.dispatch];
        // MF-DFA spectrum data
        const spectrumData = r.mfdfa.qValues.map((q, i) => ({ q, h: r.mfdfa.hValues[i] }));
        // Average H across timeframes + methods for the headline
        const avgH =
          r.timeframes.length > 0
            ? r.timeframes.reduce((s, t) => s + (t.rs.value + t.dfa.value) / 2, 0) / r.timeframes.length
            : 0.5;

        return (
          <Card key={r.symbol} className="p-4 flex flex-col gap-3">
            {/* Header + trade-gate badge */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-100">{r.symbol}</span>
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4 border-slate-600 text-slate-400">
                    fractal
                  </Badge>
                </div>
                <span className="text-[10px] text-slate-500">long-memory & fractal geometry</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded flex items-center gap-1"
                  style={{ color: dm.color, backgroundColor: `${dm.color}1a` }}
                >
                  <GateIcon className="h-3 w-3" />
                  {dm.label}
                </span>
                <span className="text-[9px] font-mono text-slate-600">
                  H̄={avgH.toFixed(2)} · D={r.higuchi.dimension.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Dispatch banner */}
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded border"
              style={{ borderColor: `${dispatchColor}40`, backgroundColor: `${dispatchColor}10` }}
            >
              <GaugeIcon className="h-3.5 w-3.5 shrink-0" style={{ color: dispatchColor }} />
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Fractal Dispatch</span>
              <span className="font-mono text-[11px] font-bold" style={{ color: dispatchColor }}>
                {r.dispatch.toUpperCase()}
              </span>
              <span className="text-[10px] text-slate-500 truncate ml-auto" title={r.dispatchRationale}>
                {r.dispatchRationale.split(" · ")[0]}
              </span>
            </div>

            {/* Multi-timeframe Hurst table */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Multi-Timeframe Hurst
                </span>
                <span className="text-[9px] font-mono text-slate-600">
                  {r.maxDislocation > 0.15 ? `⚡ ${r.dislocationTimeframes} Δ=${r.maxDislocation.toFixed(2)}` : "timeframes aligned"}
                </span>
              </div>
              <div className="overflow-hidden rounded border border-slate-800/60">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="bg-slate-900/60 text-slate-500">
                      <th className="py-1 px-1.5 text-left font-medium">TF</th>
                      <th className="py-1 px-1.5 text-right font-medium">R/S H</th>
                      <th className="py-1 px-1.5 text-right font-medium">DFA H</th>
                      <th className="py-1 px-1.5 text-right font-medium">Δ</th>
                      <th className="py-1 px-1.5 text-center font-medium">regime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.timeframes.map((t) => {
                      const avg = (t.rs.value + t.dfa.value) / 2;
                      const reg = avg > 0.55 ? "persistent" : avg < 0.45 ? "anti-persistent" : "random-walk";
                      const RegIcon = reg === "persistent" ? TrendingUp : reg === "anti-persistent" ? TrendingDown : Minus;
                      return (
                        <tr key={t.timeframe} className="border-t border-slate-800/40">
                          <td className="py-1 px-1.5 text-slate-300">{t.timeframe}</td>
                          <td className="py-1 px-1.5 text-right text-slate-300">{t.rs.value.toFixed(3)}</td>
                          <td className="py-1 px-1.5 text-right text-slate-300">{t.dfa.value.toFixed(3)}</td>
                          <td className="py-1 px-1.5 text-right text-slate-500">{t.dislocation.toFixed(3)}</td>
                          <td className="py-1 px-1.5 text-center">
                            <span className="inline-flex items-center gap-1" style={{ color: HURST_COLOR[reg] }}>
                              <RegIcon className="h-3 w-3" />
                              {HURST_LABEL[reg].slice(0, 4)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* MF-DFA spectrum */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                  <Activity className="h-3 w-3" /> MF-DFA Spectrum h(q)
                </span>
                <span className="text-[9px] font-mono text-slate-600">
                  Δh={r.mfdfa.deltaH.toFixed(3)} ({r.mfdfa.complexity}) · h(2)={r.mfdfa.h2.toFixed(3)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={spectrumData} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="2 2" strokeOpacity={0.3} vertical={false} />
                  <XAxis
                    dataKey="q"
                    stroke="#475569"
                    fontSize={9}
                    tickLine={false}
                    axisLine={false}
                    label={{ value: "q", position: "insideBottomRight", fontSize: 9, fill: "#475569" }}
                  />
                  <YAxis
                    stroke="#475569"
                    fontSize={9}
                    tickLine={false}
                    axisLine={false}
                    domain={[0.3, 0.7]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(71, 85, 105, 0.5)",
                      borderRadius: "4px",
                      fontSize: "10px",
                    }}
                    formatter={(v: number) => [v.toFixed(3), "h(q)"]}
                  />
                  <ReferenceLine y={0.5} stroke="#64748b" strokeDasharray="3 3" strokeOpacity={0.4} />
                  <Line
                    type="monotone"
                    dataKey="h"
                    stroke="#fbbf24"
                    strokeWidth={1.5}
                    dot={{ r: 2, fill: "#fbbf24" }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Higuchi + complexity row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1 p-2 rounded bg-slate-900/40 border border-slate-800/60">
                <span className="text-[9px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                  <Box className="h-3 w-3" /> Higuchi D
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-base font-semibold text-slate-100">
                    {r.higuchi.dimension.toFixed(3)}
                  </span>
                  <span
                    className={`text-[9px] font-mono uppercase ${
                      r.higuchi.signalQuality === "high"
                        ? "text-emerald-400"
                        : r.higuchi.signalQuality === "low"
                        ? "text-rose-400"
                        : "text-amber-400"
                    }`}
                  >
                    {r.higuchi.signalQuality}
                  </span>
                </div>
                {/* 1.0=trending ↔ 2.0=noise gauge */}
                <div className="relative h-1 rounded-full bg-gradient-to-r from-emerald-500/50 via-amber-500/40 to-rose-500/50">
                  <div
                    className="absolute -top-0.5 w-0.5 h-2 bg-slate-100"
                    style={{ left: `${((r.higuchi.dimension - 1) / 1) * 100}%` }}
                  />
                </div>
                <span className="text-[8px] font-mono text-slate-600 flex justify-between">
                  <span>trending</span>
                  <span>noise</span>
                </span>
              </div>
              <div className="flex flex-col gap-1 p-2 rounded bg-slate-900/40 border border-slate-800/60">
                <span className="text-[9px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                  <Layers className="h-3 w-3" /> MF-DFA Δh
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-base font-semibold text-slate-100">
                    {r.mfdfa.deltaH.toFixed(3)}
                  </span>
                  <span
                    className={`text-[9px] font-mono uppercase ${
                      r.mfdfa.complexity === "simple"
                        ? "text-emerald-400"
                        : r.mfdfa.complexity === "complex"
                        ? "text-rose-400"
                        : "text-amber-400"
                    }`}
                  >
                    {r.mfdfa.complexity}
                  </span>
                </div>
                <div className="text-[9px] text-slate-500 leading-tight">
                  {r.mfdfa.complexity === "simple"
                    ? "monofractal — predictable"
                    : r.mfdfa.complexity === "complex"
                    ? "multifractal — reduce confidence"
                    : "moderate complexity"}
                </div>
              </div>
            </div>

            {/* Full dispatch rationale */}
            <div className="flex items-start gap-2 pt-1 border-t border-slate-800/40">
              <GaugeIcon className="h-3.5 w-3.5 text-amber-400/70 shrink-0 mt-0.5" />
              <p className="text-[10px] leading-snug text-slate-400">{r.dispatchRationale}</p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
