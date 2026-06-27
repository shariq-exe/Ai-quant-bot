"use client";

import { Card } from "@/components/ui/card";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { EquityPoint } from "@/lib/api";
import type { BacktestStats } from "@/lib/quant/types";

interface EquityChartProps {
  equityCurve: EquityPoint[];
  stats?: BacktestStats;
  symbol: string;
  strategyCode: string;
}

export function EquityChart({ equityCurve, stats, symbol, strategyCode }: EquityChartProps) {
  const data = equityCurve.map((p) => ({
    time: p.time,
    equity: Math.round(p.equity),
    drawdown: +(p.drawdown * 100).toFixed(2),
  }));
  const start = data[0]?.equity ?? 100000;

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div>
          <h3 className="font-mono text-sm font-semibold text-slate-100">
            {strategyCode} <span className="text-slate-500">·</span> {symbol}
          </h3>
          <p className="text-[11px] text-slate-500">Equity curve (risk-parity sizing, after costs)</p>
        </div>
        {stats && (
          <div className="flex gap-4 text-[11px] font-mono">
            <Metric label="TOTAL" value={`${((stats.totalReturn) * 100).toFixed(1)}%`} positive={stats.totalReturn >= 0} />
            <Metric label="CAGR" value={`${(stats.cagr * 100).toFixed(1)}%`} positive={stats.cagr >= 0} />
            <Metric label="MAXDD" value={`${(stats.maxDrawdown * 100).toFixed(1)}%`} positive={false} />
            <Metric label="SHARPE" value={stats.sharpe.toFixed(2)} positive={stats.sharpe > 0} />
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tickFormatter={(t) => new Date(t).toISOString().slice(0, 7)}
            stroke="#475569"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            stroke="#475569"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            domain={["auto", "auto"]}
          />
          <ReferenceLine y={start} stroke="#64748b" strokeDasharray="3 3" strokeOpacity={0.5} />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              border: "1px solid rgba(71, 85, 105, 0.5)",
              borderRadius: "6px",
              fontSize: "11px",
            }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(value: number, name) => [
              name === "equity" ? `$${value.toLocaleString()}` : `${value}%`,
              name === "equity" ? "Equity" : "Drawdown",
            ]}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#34d399"
            strokeWidth={1.5}
            fill="url(#eqGrad)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-slate-500">{label}</span>
      <span className={positive ? "text-emerald-400" : "text-rose-400"}>{value}</span>
    </div>
  );
}
