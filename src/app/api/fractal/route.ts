import { NextResponse } from "next/server";
import { getAllFractal, getFractal } from "@/lib/quant";
import type { Symbol } from "@/lib/quant/types";

// GET /api/fractal?symbol=<EUR/USD|XAU/USD>
// With no symbol: returns reports for all symbols. Each report contains the
// multi-timeframe Hurst (R/S + DFA), MF-DFA spectrum, Higuchi fractal
// dimension, composite dispatch, and the signal-quality trade gate.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") as Symbol | null;
    if (symbol) {
      if (symbol !== "EUR/USD" && symbol !== "XAU/USD") {
        return NextResponse.json(
          { error: `Invalid symbol: ${symbol}. Must be EUR/USD or XAU/USD.` },
          { status: 400 }
        );
      }
      const report = getFractal(symbol);
      return NextResponse.json({ report, generatedAt: new Date().toISOString() });
    }
    const reports = getAllFractal();
    return NextResponse.json({
      reports,
      count: reports.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Do not swallow — surface the real cause.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute fractal analysis", detail: message },
      { status: 500 }
    );
  }
}
