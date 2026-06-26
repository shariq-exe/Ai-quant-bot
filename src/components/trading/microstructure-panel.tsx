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
  AlertTriangle,
  Activity,
  Droplets,
  Waves,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { MicrostructureReport } from "@/lib/api";

interface MicrostructurePanelProps {
  reports: MicrostructureReport[];
}

const TOX_COLORS: Record<string, string> = {
  calm: "#34d399",
  elevated: "#fbbf24",
  toxic: "#fb923c",
  extreme: "#f43f5e",
};

const LIQ_COLORS: Record<string, string> = {
  deep: "#34d399",
  normal: "#fbbf24",
  thin: "#f43f5e",
};

function Gauge({
  label,
  value,
  label2,
  color,
  sub,
}: {
  label: string;
  value: number;
  label2: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
        <span className="text-[10px] font-mono font-semibold" style={{ color }}>
          {label2}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, backgroundColor: color }}
        />
      </div>
      {sub && <span className="text-[9px] text-slate-600 font-mono">{sub}</span>}
    </div>
  );
}

function MetricRow({
  icon: Icon,
  name,
  value,
  z,
  flag,
  flagLabel,
}: {
  icon: React.ElementType;
  name: string;
  value: string;
  z?: number;
  flag?: boolean;
  flagLabel?: string;
}) {
  const zColor =
    z === undefined ? "text-slate-400" : z > 2 ? "text-rose-400" : z > 1 ? "text-amber-400" : z < -1 ? "text-emerald-400" : "text-slate-300";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        <span className="text-[11px] text-slate-300 truncate">{name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-[11px] text-slate-200">{value}</span>
        {z !== undefined && (
          <span className={`font-mono text-[10px] ${zColor}`}>z={z.toFixed(2)}</span>
        )}
        {flag && (
          <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 border-rose-500/40 text-rose-300">
            {flagLabel ?? "FLAG"}
          </Badge>
        )}
      </div>
    </div>
  );
}

export function MicrostructurePanel({ reports }: MicrostructurePanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {reports.map((r) => {
        const toxColor = TOX_COLORS[r.toxicityLabel];
        const liqColor = LIQ_COLORS[r.liquidityLabel];
        const ToxIcon = r.toxicityLabel === "calm" || r.toxicityLabel === "elevated" ? ShieldCheck : ShieldAlert;
        const divIcon =
          r.ofi.divergence === "bullish" ? TrendingUp : r.ofi.divergence === "bearish" ? TrendingDown : Minus;
        const divColor =
          r.ofi.divergence === "bullish" ? "text-emerald-400" : r.ofi.divergence === "bearish" ? "text-rose-400" : "text-slate-500";

        // VPIN mini-series for sparkline
        const vpinData = r.vpin.series.map((s) => ({ t: s.time, v: s.vpin }));
        const kyleTrendIcon = r.kyleLambda.trend === "rising" ? TrendingUp : r.kyleLambda.trend === "falling" ? TrendingDown : Minus;

        return (
          <Card key={r.symbol} className="p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-100">{r.symbol}</span>
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4 capitalize border-slate-600 text-slate-400">
                    {r.regime}
                  </Badge>
                </div>
                <span className="text-[10px] text-slate-500">microstructure intelligence</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ToxIcon className="h-4 w-4" style={{ color: toxColor }} />
                <span className="font-mono text-xs font-semibold uppercase" style={{ color: toxColor }}>
                  {r.toxicityLabel}
                </span>
              </div>
            </div>

            {/* Composite gauges */}
            <div className="grid grid-cols-2 gap-3">
              <Gauge
                label="Toxicity"
                value={r.toxicity}
                label2={`${(r.toxicity * 100).toFixed(0)}%`}
                color={toxColor}
                sub={r.toxicityLabel}
              />
              <Gauge
                label="Liquidity"
                value={r.liquidity}
                label2={`${(r.liquidity * 100).toFixed(0)}%`}
                color={liqColor}
                sub={r.liquidityLabel}
              />
            </div>

            {/* VPIN sparkline */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">VPIN series</span>
                <span className="text-[9px] font-mono text-slate-600">
                  mean {r.vpin.rollingMean.toFixed(3)} · {r.vpin.bucketCount} buckets
                </span>
              </div>
              <ResponsiveContainer width="100%" height={48}>
                <LineChart data={vpinData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(71, 85, 105, 0.5)",
                      borderRadius: "4px",
                      fontSize: "10px",
                    }}
                    labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                    formatter={(v: number) => [v.toFixed(4), "VPIN"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke={toxColor}
                    strokeWidth={1.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <ReferenceLine y={r.vpin.rollingMean} stroke="#475569" strokeDasharray="2 2" strokeOpacity={0.4} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Metric rows */}
            <div className="flex flex-col">
              <MetricRow
                icon={Waves}
                name="VPIN"
                value={r.vpin.vpin.toFixed(4)}
                z={r.vpin.zScore}
                flag={r.vpin.toxicityFlag}
                flagLabel="TOXIC"
              />
              <MetricRow
                icon={Activity}
                name="Kyle λ"
                value={r.kyleLambda.lambda.toExponential(2)}
                z={r.kyleLambda.zScore}
              />
              <MetricRow
                icon={Droplets}
                name="Amihud ILLIQ"
                value={`${r.amihud.illiq.toExponential(2)} · pct ${(r.amihud.percentile * 100).toFixed(0)}%`}
                z={r.amihud.zScore}
              />
              <MetricRow
                icon={divIcon}
                name={`OFI · cumΔ ${r.ofi.cumulativeDelta >= 0 ? "+" : ""}${r.ofi.cumulativeDelta.toFixed(0)}`}
                value={r.ofi.divergence === "none" ? "no div" : `${r.ofi.divergence} ${(r.ofi.divergenceStrength * 100).toFixed(0)}%`}
                flag={r.ofi.divergence !== "none"}
                flagLabel={r.ofi.divergence.toUpperCase()}
              />
            </div>

            {/* Interpretation */}
            <div className="flex items-start gap-2 pt-1 border-t border-slate-800/40">
              {r.toxicityLabel === "extreme" || r.toxicityLabel === "toxic" ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/60 shrink-0 mt-0.5" />
              )}
              <p className="text-[10px] leading-snug text-slate-400">{r.interpretation}</p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
