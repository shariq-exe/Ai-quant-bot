"use client";

import { useEffect, useRef } from "react";

interface TradingViewChartProps {
  symbol: string; // TradingView ticker, e.g. "FX:EURUSD"
  height?: number;
}

// Embeds the free TradingView Advanced Chart widget via its official script.
// No API key required. The widget loads its own live data from TradingView.
export function TradingViewChart({ symbol, height = 420 }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Clear any previous widget instance before re-injecting.
    container.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = `${height}px`;
    widgetDiv.style.width = "100%";
    container.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "60",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      backgroundColor: "rgba(8, 10, 14, 1)",
      gridColor: "rgba(255, 255, 255, 0.06)",
      textColor: "rgba(200, 210, 220, 1)",
      supports_zoom: true,
      supports_drawings: true,
      details: false,
      hotlist: false,
      calendar: false,
      studies: ["STD;EMA", "STD;Average%1True%1Range"],
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [symbol, height]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container w-full"
      style={{ height: height + 28 }}
    />
  );
}
