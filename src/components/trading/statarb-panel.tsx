"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import {
  GitCompareArrows,
  Gauge as GaugeIcon,
  Timer,
  ShieldCheck,
  ShieldX,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import type { StatArbReport } from "@/lib/api";

interface StatArbPanelProps {
  report: StatArbReport;
}

export function StatArbPanel({ report }: StatArbPanelProps) {
  const ou = report.ou;
  const kal = report.kalman;
  const coint = report.cointegration;
  const gateOpen = report.tradeGate === "open";
  const GateIcon = gateOpen ? ShieldCheck : ShieldX;
  const spreadData = ou.series.map((s) => ({
    time: s.time,
    spread: s.spread,
    equilibrium: s.equilibrium,
    upperBand: s.upperBand,
    lowerBand: s.lowerBand,
  }));
  const residualData = kal.innovationSeries.map((s) => ({
    time: s.time,
    residual: s.residual,
  }));
  const compositeLong = report.compositeSignal === "long-spread";
  const compositeShort = report.compositeSignal === "short-spread";
  const CompIcon = compositeLong ? TrendingUp : compositeShort ? TrendingDown : Minus;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* OU spread chart */}
      <Card className="p-4 flex flex-col gap-3 lg:col-span-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GitCompareArrows className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono text-sm font-semibold text-slate-100">OU Spread</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">{report.spreadLabel}</span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded flex items-center gap-1"
              style={{
                color: gateOpen ? "#34d399" : "#f43f5e",
                backgroundColor: gateOpen ? "#34d3991a" : "#f43f5e1a",
              }}
            >
              <GateIcon className="h-3 w-3" />
              GATE {gateOpen ? "OPEN" : "CLOSED"}
            </span>
            <span className="text-[9px] font-mono text-slate-600">
              θ={ou.theta.toFixed(4)} · HL={isFinite(ou.halfLife) ? ou.halfLife.toFixed(1) : "∞"}b
            </span>
          </div>
        </div>

        {/* Spread chart with equilibrium + 2σ bands */}
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={spreadData} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
            <defs>
              <linearGradient id="spreadGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis stroke="#475569" fontSize={9} tickLine={false} axisLine={false} domain={["dataMin", "dataMax"]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(71, 85, 105, 0.5)",
                borderRadius: "4px",
                fontSize: "10px",
              }}
              formatter={(v: number, n) => [v.toFixed(4), n === "spread" ? "spread" : n === "equilibrium" ? "μ" : n === "upperBand" ? "+2σ" : "−2σ"]}
            />
            <ReferenceArea y1={ou.lowerBand} y2={ou.upperBand} fill="#334155" fillOpacity={0.1} />
            <ReferenceLine y={ou.equilibrium} stroke="#64748b" strokeDasharray="3 3" strokeOpacity={0.5} />
            <ReferenceLine y={ou.upperBand} stroke="#f43f5e" strokeDasharray="2 2" strokeOpacity={0.3} />
            <ReferenceLine y={ou.lowerBand} stroke="#f43f5e" strokeDasharray="2 2" strokeOpacity={0.3} />
            <Area type="monotone" dataKey="spread" stroke="#fbbf24" strokeWidth={1.2} fill="url(#spreadGrad)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>

        {/* OU stats row */}
        <div className="grid grid-cols-4 gap-2 text-[10px] font-mono">
          <div className="flex flex-col">
            <span className="text-slate-500">z-score</span>
            <span className={Math.abs(ou.zScore) > 2 ? "text-amber-400 font-semibold" : "text-slate-300"}>
              {ou.zScore.toFixed(2)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-slate-500">θ (revert)</span>
            <span className={ou.theta > 0 ? "text-emerald-400" : "text-rose-400"}>
              {ou.theta.toFixed(4)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-slate-500">half-life</span>
            <span className={ou.halfLifeValid ? "text-emerald-400" : "text-rose-400"}>
              {isFinite(ou.halfLife) ? ou.halfLife.toFixed(1) + "b" : "∞"}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-slate-500">σ (OU vol)</span>
            <span className="text-slate-300">{ou.sigma.toFixed(4)}</span>
          </div>
        </div>
      </Card>

      {/* Kalman residual + cointegration + composite */}
      <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GaugeIcon className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono text-sm font-semibold text-slate-100">Kalman + Cointegration</span>
            </div>
            <span className="text-[10px] text-slate-500">dynamic hedge ratio + residual signal</span>
          </div>
        </div>

        {/* Kalman residual mini-chart */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-slate-500">residual (innovation)</span>
          <ResponsiveContainer width="100%" height={50}>
            <LineChart data={residualData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="time" hide />
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Tooltip
                contentStyle={{ backgroundColor: "rgba(15, 23, 42, 0.95)", border: "1px solid rgba(71, 85, 105, 0.5)", borderRadius: "4px", fontSize: "10px" }}
                formatter={(v: number) => [v.toFixed(4), "residual"]}
              />
              <ReferenceLine y={kal.residualMean} stroke="#64748b" strokeDasharray="2 2" strokeOpacity={0.4} />
              <ReferenceLine y={kal.residualMean + 2 * kal.residualStd} stroke="#f43f5e" strokeDasharray="2 2" strokeOpacity={0.3} />
              <ReferenceLine y={kal.residualMean - 2 * kal.residualStd} stroke="#f43f5e" strokeDasharray="2 2" strokeOpacity={0.3} />
              <Line type="monotone" dataKey="residual" stroke="#a78bfa" strokeWidth={1} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex justify-between text-[9px] font-mono">
            <span className="text-slate-500">β={kal.hedgeRatio.toFixed(3)}</span>
            <span className="text-slate-500">resid z={kal.residualZScore.toFixed(2)}</span>
          </div>
        </div>

        {/* Cointegration */}
        <div className="flex items-center justify-between py-1 border-t border-slate-800/40">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Timer className="h-3 w-3" /> Cointegration
          </span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-slate-500">trace={coint.traceStat.toFixed(2)}</span>
            {coint.isCointegrated ? (
              <Badge className="text-[9px] py-0 px-1 h-4 bg-emerald-500/20 text-emerald-300 border-emerald-500/40">YES</Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] py-0 px-1 h-4 border-rose-500/40 text-rose-300">NO</Badge>
            )}
          </div>
        </div>

        {/* Half-life validity */}
        <div className="flex items-center justify-between py-1 border-t border-slate-800/40">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Timer className="h-3 w-3" /> Half-life
          </span>
          <span className={`font-mono text-[10px] ${ou.halfLifeValid ? "text-emerald-400" : "text-rose-400"}`}>
            {ou.halfLifeNote}
          </span>
        </div>

        {/* Composite signal banner */}
        <div
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded border mt-auto ${
            compositeLong
              ? "border-emerald-500/40 bg-emerald-500/10"
              : compositeShort
              ? "border-rose-500/40 bg-rose-500/10"
              : "border-slate-700/40 bg-slate-800/30"
          }`}
        >
          <CompIcon
            className={`h-3.5 w-3.5 shrink-0 ${
              compositeLong ? "text-emerald-400" : compositeShort ? "text-rose-400" : "text-slate-500"
            }`}
          />
          <span
            className={`text-[10px] font-mono uppercase ${
              compositeLong ? "text-emerald-300" : compositeShort ? "text-rose-300" : "text-slate-500"
            }`}
          >
            {report.compositeSignal === "none" ? "no signal" : report.compositeSignal}
          </span>
        </div>
        <p className="text-[9px] leading-snug text-slate-400">{report.compositeRationale}</p>
      </Card>
    </div>
  );
}
