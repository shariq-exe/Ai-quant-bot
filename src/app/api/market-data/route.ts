import { NextResponse } from "next/server";
import { getRecentBars, getSymbolConfig, SYMBOLS, advanceLiveTick } from "@/lib/quant";
import type { Symbol } from "@/lib/quant/types";

// GET /api/market-data?symbol=<EUR/USD|XAU/USD>&bars=<n>&advance=<0|1>
// Returns the recent OHLCV tail for a symbol + its symbol config (for the
// dashboard's price ticker and any custom charting). If advance=1 is set,
// a fresh live bar is appended first so the "current price" advances.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") as Symbol | null;
    const barsParam = searchParams.get("bars");
    const advance = searchParams.get("advance") === "1";
    if (!symbol) {
      // No symbol → return the catalog.
      return NextResponse.json({ symbols: SYMBOLS });
    }
    if (symbol !== "EUR/USD" && symbol !== "XAU/USD") {
      return NextResponse.json(
        { error: `Invalid symbol: ${symbol}. Must be EUR/USD or XAU/USD.` },
        { status: 400 }
      );
    }
    if (advance) advanceLiveTick(symbol);
    const n = Math.min(Math.max(parseInt(barsParam ?? "100", 10) || 100, 10), 1000);
    const bars = getRecentBars(symbol, n);
    const cfg = getSymbolConfig(symbol);
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const change = prev ? last.close - prev.close : 0;
    const changePct = prev ? (change / prev.close) * 100 : 0;
    return NextResponse.json({
      symbol,
      config: cfg,
      bars,
      lastPrice: last.close,
      change,
      changePct,
      timestamp: last.time,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to fetch market data", detail: message },
      { status: 500 }
    );
  }
}
