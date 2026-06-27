import { NextResponse } from "next/server";
import { getAllVolatility, getVolatility } from "@/lib/quant";
import type { Symbol } from "@/lib/quant/types";

// GET /api/volatility?symbol=<EUR/USD|XAU/USD>
// With no symbol: returns reports for all symbols. Each report contains the
// GARCH(1,1) regime + params, bipower-variation jump stats, HMM master-switch
// state, and the strategy-family dispatch decision.
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
      const report = getVolatility(symbol);
      return NextResponse.json({ report, generatedAt: new Date().toISOString() });
    }
    const reports = getAllVolatility();
    return NextResponse.json({
      reports,
      count: reports.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Do not swallow — surface the real cause.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute volatility intelligence", detail: message },
      { status: 500 }
    );
  }
}
