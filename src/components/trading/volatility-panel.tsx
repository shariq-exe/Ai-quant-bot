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
  Zap,
  Activity,
  Layers,
  Gauge,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Crosshair,
} from "lucide-react";
import type { VolatilityReport, VolRegime, StrategyDispatch } from "@/lib/api";

interface VolatilityPanelProps {
  reports: VolatilityReport[];
}

const REGIME_COLORS: Record<VolRegime, string> = {
  "low-vol": "#34d399",
  transitional: "#fbbf24",
  "high-vol": "#f43f5e",
};

const REGIME_LABEL: Record<VolRegime, string> = {
  "low-vol": "LOW-VOL COMPRESSION",
  transitional: "TRANSITIONAL",
  "high-vol": "HIGH-VOL TRENDING",
};

const DISPATCH_META: Record<StrategyDispatch, { icon: React.ElementType; color: string; label: string }> = {
  "mean-reversion": { icon: Minus, color: "#34d399", label: "MEAN-REVERSION" },
  "breakout-prep": { icon: Crosshair, color: "#fbbf24", label: "BREAKOUT-PREP" },
  momentum: { icon: TrendingUp, color: "#a78bfa", label: "MOMENTUM" },
};

export function VolatilityPanel({ reports }: VolatilityPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {reports.map((r) => {
        const regColor = REGIME_COLORS[r.garch.regime];
        const dm = DISPATCH_META[r.dispatch];
        const DispatchIcon = dm.icon;
        const volRatio = r.garch.conditionalVol / Math.max(r.garch.longRunVol, 1e-12);
        const volData = r.garch.series.map((s) => ({
          t: s.time,
          vol: s.vol * 1e4, // scale for readable axis (bps)
          regime: s.regime,
        }));
        const hmmBars = r.hmm.stateVols.map((v, i) => ({
          state: `S${i}`,
          vol: v * 1e4,
          mean: r.hmm.stateMeans[i] * 1e4,
          active: i === r.hmm.state,
        }));
        const jumpData = r.jumps.recentJumps.map((j) => ({
          t: j.time,
          ratio: j.ratio * 100,
          detected: j.detected,
        }));

        return (
          <Card key={r.symbol} className="p-4 flex flex-col gap-3">
            {/* Header + regime badge */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-100">{r.symbol}</span>
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4 capitalize border-slate-600 text-slate-400">
                    {r.legacyRegime}
                  </Badge>
                </div>
                <span className="text-[10px] text-slate-500">volatility intelligence</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                  style={{ color: regColor, backgroundColor: `${regColor}1a` }}
                >
                  {REGIME_LABEL[r.garch.regime]}
                </span>
                <span className="text-[9px] font-mono text-slate-500">
                  p={r.garch.regimeProbability.toFixed(2)} · {volRatio.toFixed(2)}× LR
                </span>
              </div>
            </div>

            {/* Strategy dispatch banner (master switch) */}
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded border"
              style={{ borderColor: `${dm.color}40`, backgroundColor: `${dm.color}10` }}
            >
              <DispatchIcon className="h-3.5 w-3.5 shrink-0" style={{ color: dm.color }} />
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Dispatch</span>
              <ArrowRight className="h-3 w-3 text-slate-600" />
              <span className="font-mono text-[11px] font-bold" style={{ color: dm.color }}>
                {dm.label}
              </span>
              <span className="text-[10px] text-slate-500 truncate ml-auto" title={r.dispatchRationale}>
                {r.dispatchRationale.split(" · ")[0]}
              </span>
            </div>

            {/* Conditional vol series */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                  <Activity className="h-3 w-3" /> GARCH σ_t
                </span>
                <span className="text-[9px] font-mono text-slate-600">
                  α={r.garch.alpha.toFixed(2)} β={r.garch.beta.toFixed(2)} pers={r.garch.persistence.toFixed(2)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={70}>
                <LineChart data={volData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="t" hide />
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(71, 85, 105, 0.5)",
                      borderRadius: "4px",
                      fontSize: "10px",
                    }}
                    labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                    formatter={(v: number) => [`${v.toFixed(3)} bps`, "σ_t"]}
                  />
                  <ReferenceLine y={r.garch.longRunVol * 1e4} stroke="#64748b" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <Line
                    type="monotone"
                    dataKey="vol"
                    stroke={regColor}
                    strokeWidth={1.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* HMM state bars */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                  <Layers className="h-3 w-3" /> HMM States (sorted by σ)
                </span>
                <span className="text-[9px] font-mono text-slate-600">
                  current: S{r.hmm.state} · p={r.hmm.probability.toFixed(2)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={56}>
                <BarChart data={hmmBars} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="state" stroke="#475569" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(71, 85, 105, 0.5)",
                      borderRadius: "4px",
                      fontSize: "10px",
                    }}
                    formatter={(v: number, _n, p) => {
                      const idx = p?.payload?.active ? "ACTIVE " : "";
                      return [`${idx}${v.toFixed(3)} bps`, "σ"];
                    }}
                  />
                  <Bar dataKey="vol" radius={[2, 2, 0, 0]}>
                    {hmmBars.map((entry, i) => (
                      <Cell key={i} fill={entry.active ? "#fbbf24" : "#334155"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex justify-between text-[9px] font-mono text-slate-600">
                {r.hmm.stateVols.map((v, i) => (
                  <span key={i} className={i === r.hmm.state ? "text-amber-400 font-semibold" : ""}>
                    S{i}: {(v * 1e4).toFixed(2)}
                  </span>
                ))}
              </div>
            </div>

            {/* HMM multivariate feature table (4 features × 3 states) */}
            {r.hmm.featureNames && r.hmm.stateFeatureMeans && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                    <Layers className="h-3 w-3" /> HMM Feature Matrix (standardized)
                  </span>
                  <span className="text-[9px] font-mono text-slate-600">μ per state</span>
                </div>
                <div className="overflow-hidden rounded border border-slate-800/60">
                  <table className="w-full text-[9px] font-mono">
                    <thead>
                      <tr className="bg-slate-900/60 text-slate-500">
                        <th className="py-1 px-1.5 text-left font-medium">feature</th>
                        {r.hmm.stateFeatureMeans.map((_, i) => (
                          <th key={i} className={`py-1 px-1.5 text-right font-medium ${i === r.hmm.state ? "text-amber-400" : ""}`}>
                            S{i}{i === r.hmm.state ? "●" : ""}
                          </th>
                        ))}
                        <th className="py-1 px-1.5 text-right font-medium text-slate-400">now</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.hmm.featureNames.map((fn, fi) => (
                        <tr key={fi} className="border-t border-slate-800/40">
                          <td className="py-1 px-1.5 text-slate-400">{fn}</td>
                          {r.hmm.stateFeatureMeans.map((row, si) => (
                            <td
                              key={si}
                              className={`py-1 px-1.5 text-right ${
                                si === r.hmm.state ? "text-amber-300/90 bg-amber-500/5" : "text-slate-300"
                              }`}
                            >
                              {row[fi].toFixed(2)}
                            </td>
                          ))}
                          <td className="py-1 px-1.5 text-right text-slate-500 italic">
                            {r.hmm.currentFeatures[fi]?.toFixed(2) ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Jump detection */}
            <div className="flex items-center justify-between py-1.5 border-t border-slate-800/40">
              <div className="flex items-center gap-2">
                <Zap
                  className={`h-3.5 w-3.5 ${r.jumps.jumpDetected ? "text-amber-400" : "text-slate-600"}`}
                />
                <span className="text-[11px] text-slate-300">Bipower Jump</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-slate-400">
                  ratio {(r.jumps.jumpRatio * 100).toFixed(0)}% · z={r.jumps.jumpZScore.toFixed(2)}
                </span>
                {r.jumps.jumpDetected ? (
                  <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 border-amber-500/50 text-amber-300">
                    JUMP
                  </Badge>
                ) : (
                  <span className="text-[9px] text-slate-600 font-mono">none</span>
                )}
              </div>
            </div>

            {/* Dispatch rationale (full) */}
            <div className="flex items-start gap-2 pt-1 border-t border-slate-800/40">
              <Gauge className="h-3.5 w-3.5 text-amber-400/70 shrink-0 mt-0.5" />
              <p className="text-[10px] leading-snug text-slate-400">{r.dispatchRationale}</p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
