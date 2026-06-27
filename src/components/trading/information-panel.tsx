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
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  ArrowRightLeft,
  Brain,
  Layers,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  Gauge as GaugeIcon,
} from "lucide-react";
import type { InformationReport, PermutationEntropyResult } from "@/lib/api";

interface InformationPanelProps {
  report: InformationReport;
}

const PE_STATE_COLOR: Record<PermutationEntropyResult["state"], string> = {
  predictable: "#34d399", // emerald — increase size
  normal: "#64748b", // slate
  random: "#f43f5e", // rose — reduce exposure
};

export function InformationPanel({ report }: InformationPanelProps) {
  const te = report.transferEntropy;
  const edgeActive = report.crossAssetEdge !== "none";
  const edgeIsLong = report.crossAssetEdge.includes("long");
  const teData = te.series.map((s) => ({
    t: s.time,
    xauToEur: s.teXtoY,
    eurToXau: s.teYtoX,
  }));
  const miData = report.mutualInfo.features.map((f) => ({
    feature: f.feature,
    mi: f.mi,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* Transfer Entropy — cross-asset causality */}
      <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono text-sm font-semibold text-slate-100">Transfer Entropy</span>
            </div>
            <span className="text-[10px] text-slate-500">XAU ↔ EUR directed info flow</span>
          </div>
          {te.spike ? (
            <Badge className="text-[9px] py-0 px-1 h-4 gap-0.5 bg-amber-500/20 text-amber-300 border-amber-500/40">
              <Zap className="h-2.5 w-2.5" /> SPIKE
            </Badge>
          ) : (
            <span className="text-[9px] font-mono text-slate-600">z={te.spikeZScore.toFixed(2)}</span>
          )}
        </div>

        {/* Direction gauge */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-amber-300/80">XAU→EUR</span>
            <span className="text-slate-500">{te.teXtoY.toFixed(4)} bits</span>
          </div>
          <div className="relative h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="absolute inset-y-0 left-1/2 bg-amber-500/60"
              style={{
                width: `${Math.min(Math.abs(te.netTE) * 100, 50)}%`,
                transform: te.netTE >= 0 ? "none" : "translateX(-100%)",
              }}
            />
            <div className="absolute inset-y-0 left-1/2 w-px bg-slate-500" />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-500">{te.teYtoX.toFixed(4)} bits</span>
            <span className="text-violet-300/80">EUR→XAU</span>
          </div>
          <div className="text-center text-[10px] font-mono mt-0.5">
            <span
              className={
                te.leadDirection === "XAU-leads-EUR"
                  ? "text-amber-400"
                  : te.leadDirection === "EUR-leads-XAU"
                  ? "text-violet-400"
                  : "text-slate-500"
              }
            >
              {te.leadDirection === "balanced"
                ? "balanced (no lead)"
                : `net TE ${te.netTE >= 0 ? "+" : ""}${te.netTE.toFixed(4)} → ${te.leadDirection}`}
            </span>
          </div>
        </div>

        {/* TE time series */}
        <ResponsiveContainer width="100%" height={70}>
          <LineChart data={teData} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="t" hide />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(71, 85, 105, 0.5)",
                borderRadius: "4px",
                fontSize: "10px",
              }}
              formatter={(v: number, n) => [`${v.toFixed(4)} bits`, n === "xauToEur" ? "XAU→EUR" : "EUR→XAU"]}
            />
            <Line type="monotone" dataKey="xauToEur" stroke="#fbbf24" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="eurToXau" stroke="#a78bfa" strokeWidth={1.2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>

        {/* Cross-asset edge banner */}
        <div
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded border ${
            edgeActive
              ? edgeIsLong
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-rose-500/40 bg-rose-500/10"
              : "border-slate-700/40 bg-slate-800/30"
          }`}
        >
          {edgeActive ? (
            edgeIsLong ? (
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            )
          ) : (
            <Minus className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          )}
          <span
            className={`text-[10px] font-mono uppercase ${
              edgeActive ? (edgeIsLong ? "text-emerald-300" : "text-rose-300") : "text-slate-500"
            }`}
          >
            {edgeActive ? report.crossAssetEdge.replace(/-/g, " ") : "no edge"}
          </span>
        </div>
        <p className="text-[10px] leading-snug text-slate-400">{report.edgeRationale}</p>
      </Card>

      {/* Permutation Entropy — predictability per symbol */}
      <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono text-sm font-semibold text-slate-100">Permutation Entropy</span>
            </div>
            <span className="text-[10px] text-slate-500">predictability & sizing</span>
          </div>
        </div>

        {(["EUR/USD", "XAU/USD"] as const).map((sym) => {
          const pe = report.permutationEntropy[sym];
          const color = PE_STATE_COLOR[pe.state];
          return (
            <div key={sym} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-slate-300">{sym}</span>
                <span className="font-mono text-[10px] uppercase font-semibold" style={{ color }}>
                  {pe.state} · ×{pe.sizingMultiplier.toFixed(2)}
                </span>
              </div>
              {/* PE gauge: 0 (predictable) → 1 (random), with 20th/80th pct zones */}
              <div className="relative h-1.5 rounded-full bg-gradient-to-r from-emerald-500/50 via-slate-600/50 to-rose-500/50">
                <div
                  className="absolute -top-0.5 w-0.5 h-2.5 bg-slate-100"
                  style={{ left: `${pe.pe * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[8px] font-mono text-slate-600">
                <span>PE {pe.pe.toFixed(3)}</span>
                <span>pct {(pe.percentile * 100).toFixed(0)}%</span>
              </div>
            </div>
          );
        })}

        <div className="text-[9px] text-slate-500 leading-tight pt-1 border-t border-slate-800/40">
          <span className="text-emerald-400">predictable</span> (&lt;20th pct) → increase size ·{" "}
          <span className="text-rose-400">random</span> (&gt;80th pct) → reduce exposure
        </div>
      </Card>

      {/* Mutual Information — non-linear feature ranking */}
      <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono text-sm font-semibold text-slate-100">Mutual Information</span>
            </div>
            <span className="text-[10px] text-slate-500">non-linear feature selection</span>
          </div>
          <span className="text-[9px] font-mono text-slate-600">
            {report.mutualInfo.informativeCount} informative
          </span>
        </div>

        <ResponsiveContainer width="100%" height={120}>
          <BarChart
            data={miData}
            layout="vertical"
            margin={{ top: 2, right: 8, left: 8, bottom: 0 }}
          >
            <XAxis type="number" stroke="#475569" fontSize={9} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="feature"
              stroke="#94a3b8"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              width={70}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(71, 85, 105, 0.5)",
                borderRadius: "4px",
                fontSize: "10px",
              }}
              formatter={(v: number) => [`${v.toFixed(4)} bits`, "MI"]}
            />
            <ReferenceLine x={0.05} stroke="#475569" strokeDasharray="2 2" strokeOpacity={0.5} />
            <Bar dataKey="mi" radius={[0, 2, 2, 0]}>
              {miData.map((entry, i) => (
                <Cell key={i} fill={entry.mi > 0.05 ? "#fbbf24" : "#334155"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/40">
          <GaugeIcon className="h-3.5 w-3.5 text-amber-400/70 shrink-0" />
          <span className="text-[10px] text-slate-400">
            top: <span className="font-mono text-amber-300">{report.mutualInfo.topFeature}</span> (MI={report.mutualInfo.topMI.toFixed(4)})
          </span>
        </div>
        <p className="text-[9px] text-slate-500 leading-tight">
          MI captures non-linear deps Pearson misses. Bars in amber exceed the 0.05-bit informative threshold.
        </p>
      </Card>
    </div>
  );
}
