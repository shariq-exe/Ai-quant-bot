"use client";

import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { MarketDataResponse } from "@/lib/api";

interface PriceTickerProps {
  data: MarketDataResponse;
}

export function PriceTicker({ data }: PriceTickerProps) {
  const up = data.change >= 0;
  const decimals = data.symbol === "EUR/USD" ? 5 : 2;
  const Icon = up ? TrendingUp : TrendingDown;

  return (
    <Card className="p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-semibold text-slate-100">{data.symbol}</span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Sim · 1H</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="font-mono text-lg font-semibold text-slate-50 tabular-nums">
            {data.lastPrice.toFixed(decimals)}
          </div>
          <div
            className={`flex items-center justify-end gap-1 font-mono text-xs ${
              up ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            <Icon className="h-3 w-3" />
            {up ? "+" : ""}
            {data.change.toFixed(decimals)} ({up ? "+" : ""}
            {data.changePct.toFixed(2)}%)
          </div>
        </div>
        <Icon className={`h-5 w-5 ${up ? "text-emerald-400" : "text-rose-400"} shrink-0`} />
      </div>
    </Card>
  );
}
