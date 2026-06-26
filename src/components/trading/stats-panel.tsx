"use client";

import { Card } from "@/components/ui/card";

interface StatItem {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}

interface StatsPanelProps {
  title: string;
  stats: StatItem[];
}

const toneClass: Record<string, string> = {
  good: "text-emerald-400",
  bad: "text-rose-400",
  neutral: "text-slate-200",
};

export function StatsPanel({ title, stats }: StatsPanelProps) {
  return (
    <Card className="p-4">
      <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-3">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase">{s.label}</span>
            <span className={`font-mono text-sm font-semibold ${toneClass[s.tone ?? "neutral"]}`}>
              {s.value}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
