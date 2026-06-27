"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import {
  Brain,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldCheck,
  ShieldX,
  Scissors,
} from "lucide-react";
import type { MLReport, SpecialistRegime } from "@/lib/api";

interface MLPanelProps {
  report: MLReport;
}

const REGIME_COLOR: Record<SpecialistRegime, string> = {
  trending: "#a78bfa", // violet
  "mean-reverting": "#34d399", // emerald
  volatile: "#fbbf24", // amber
};

const MODEL_LABEL: Record<string, string> = {
  "gradient-boosted-trees": "GBT",
  "ridge-regression": "Ridge",
  "lstm-proxy": "LSTM-proxy",
};

export function MLPanel({ report }: MLPanelProps) {
  const ens = report.ensemble;
  const val = report.validation;
  const DirIcon = ens.direction === "long" ? TrendingUp : ens.direction === "short" ? TrendingDown : Minus;
  const shapData = report.shapImportance.map((s) => ({
    feature: s.feature.replace(/-/g, " "),
    importance: s.importance * 100,
    stable: s.stable,
  }));
  // Radar data for specialist R² comparison
  const radarData = report.specialists.map((s) => ({
    regime: s.regime,
    trainR2: Math.max(0, s.trainR2 * 100),
    oosR2: Math.max(0, s.oosR2 * 100),
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* Specialists table */}
      <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-mono text-sm font-semibold text-slate-100">Ensemble Specialists</span>
        </div>
        <div className="flex flex-col gap-2">
          {report.specialists.map((s) => (
            <div key={s.regime} className="flex flex-col gap-1 p-2 rounded border border-slate-800/60 bg-slate-900/30">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: REGIME_COLOR[s.regime] }}>
                  {s.regime}
                </span>
                <Badge variant="outline" className="text-[9px] py-0 px-1 h-4 border-slate-600 text-slate-400">
                  {MODEL_LABEL[s.modelType]}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
                <span className="text-slate-500">R² train: <span className="text-slate-300">{s.trainR2.toFixed(3)}</span></span>
                <span className="text-slate-500">R² OOS: <span className={s.oosR2 > 0 ? "text-emerald-400" : "text-rose-400"}>{s.oosR2.toFixed(3)}</span></span>
                <span className="text-slate-500">MSE: <span className="text-slate-300">{s.trainMSE.toExponential(1)}</span></span>
                <span className="text-slate-500">n: <span className="text-slate-300">{s.trainSamples}</span></span>
              </div>
              {/* HMM weight bar */}
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[8px] text-slate-600 font-mono">HMM weight</span>
                <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(ens.specialistPredictions.find((p) => p.regime === s.regime)?.weight ?? 0) * 100}%`,
                      backgroundColor: REGIME_COLOR[s.regime],
                    }}
                  />
                </div>
                <span className="text-[8px] font-mono text-slate-500">
                  {((ens.specialistPredictions.find((p) => p.regime === s.regime)?.weight ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Ensemble prediction + validation */}
      <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-mono text-sm font-semibold text-slate-100">Ensemble Prediction</span>
        </div>

        {/* Prediction banner */}
        <div
          className={`flex items-center gap-2 px-2.5 py-2 rounded border ${
            ens.direction === "long"
              ? "border-emerald-500/40 bg-emerald-500/10"
              : ens.direction === "short"
              ? "border-rose-500/40 bg-rose-500/10"
              : "border-slate-700/40 bg-slate-800/30"
          }`}
        >
          <DirIcon
            className={`h-4 w-4 shrink-0 ${
              ens.direction === "long" ? "text-emerald-400" : ens.direction === "short" ? "text-rose-400" : "text-slate-500"
            }`}
          />
          <div className="flex flex-col">
            <span className="font-mono text-sm font-bold text-slate-100">{ens.direction.toUpperCase()}</span>
            <span className="text-[9px] font-mono text-slate-500">
              pred={ens.predictedReturn.toExponential(2)} · conf={ens.confidence.toFixed(2)} · dom={ens.dominantRegime}
            </span>
          </div>
        </div>

        {/* Validation gate */}
        <div className="flex items-start gap-2 px-2 py-1.5 rounded border border-slate-800/60 bg-slate-900/30">
          {val.passes ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="flex flex-col gap-0.5">
            <span className={`text-[10px] font-mono font-semibold uppercase ${val.passes ? "text-emerald-400" : "text-rose-400"}`}>
              {val.passes ? "VALIDATION PASSES" : "VALIDATION FAILS"}
            </span>
            <span className="text-[9px] font-mono text-slate-400">{val.passRationale}</span>
          </div>
        </div>

        {/* SHAP-driven feature pruning banner */}
        {report.pruningApplied && (
          <div className={`flex items-start gap-2 px-2 py-1.5 rounded border ${
            report.pruningImproved
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          }`}>
            <Scissors className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${report.pruningImproved ? "text-emerald-400" : "text-amber-400"}`} />
            <div className="flex flex-col gap-0.5">
              <span className={`text-[10px] font-mono font-semibold uppercase ${report.pruningImproved ? "text-emerald-400" : "text-amber-400"}`}>
                PRUNED {report.prunedFeatures.length} FEATURE{report.prunedFeatures.length > 1 ? "S" : ""} {report.pruningImproved ? "→ IMPROVED" : "→ NO IMPROVEMENT"}
              </span>
              <span className="text-[9px] font-mono text-slate-400">
                removed: {report.prunedFeatures.join(", ")}
              </span>
              <span className="text-[9px] font-mono text-slate-500">
                deflated Sharpe: {report.validation.deflatedSharpe.toFixed(2)} → {report.prunedValidation.deflatedSharpe.toFixed(2)}
              </span>
            </div>
          </div>
        )}
        {!report.pruningApplied && report.shapImportance.some((s) => !s.stable) && (
          <div className="text-[9px] font-mono text-amber-400/70 italic px-2">
            unstable features detected but pruning not applied ({report.pruningNote})
          </div>
        )}

        {/* Validation stats */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          <div className="flex flex-col p-1.5 rounded bg-slate-900/30">
            <span className="text-slate-500 text-[9px]">OOS Sharpe</span>
            <span className={val.oosSharpe > 0.5 ? "text-emerald-400" : "text-amber-400"}>{val.oosSharpe.toFixed(2)}</span>
          </div>
          <div className="flex flex-col p-1.5 rounded bg-slate-900/30">
            <span className="text-slate-500 text-[9px]">Deflated Sharpe</span>
            <span className={val.deflatedSharpe > 0.5 ? "text-emerald-400" : "text-amber-400"}>{val.deflatedSharpe.toFixed(2)}</span>
          </div>
          <div className="flex flex-col p-1.5 rounded bg-slate-900/30">
            <span className="text-slate-500 text-[9px]">CPCV folds</span>
            <span className="text-slate-300">{val.cpcvFolds} (embargo {val.cpcvEmbargoBars}b)</span>
          </div>
          <div className="flex flex-col p-1.5 rounded bg-slate-900/30">
            <span className="text-slate-500 text-[9px]">OOS years</span>
            <span className={val.oosYears >= 5 ? "text-emerald-400" : "text-amber-400"}>{val.oosYears}y</span>
          </div>
        </div>
        <p className="text-[9px] text-slate-500 leading-tight">
          CPCV: {val.foldSharpeRatios.map((s) => s.toFixed(1)).join(", ")} · WF windows: {val.walkForwardWindows.length}
        </p>
      </Card>

      {/* SHAP feature importance */}
      <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-amber-400" />
            <span className="font-mono text-sm font-semibold text-slate-100">SHAP Importance</span>
          </div>
          <span className="text-[9px] font-mono text-slate-600">
            {report.shapImportance.filter((s) => s.stable).length}/{report.shapImportance.length} stable
          </span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={shapData} layout="vertical" margin={{ top: 2, right: 8, left: 8, bottom: 0 }}>
            <XAxis type="number" stroke="#475569" fontSize={9} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="feature"
              stroke="#94a3b8"
              fontSize={8}
              tickLine={false}
              axisLine={false}
              width={75}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(71, 85, 105, 0.5)",
                borderRadius: "4px",
                fontSize: "10px",
              }}
              formatter={(v: number) => [`${v.toFixed(1)}%`, "importance"]}
            />
            <Bar dataKey="importance" radius={[0, 2, 2, 0]}>
              {shapData.map((entry, i) => (
                <Cell key={i} fill={entry.stable ? "#34d399" : "#f43f5e"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-emerald-400" /> stable
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-rose-400" /> unstable (prune)
          </span>
        </div>
        <p className="text-[9px] text-slate-500 leading-tight">
          Aggregated importance across specialists. Unstable features (high cross-model variance) should be pruned per spec.
        </p>
      </Card>
    </div>
  );
}
