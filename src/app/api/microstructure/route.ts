import { NextResponse } from "next/server";
import { getAllMicrostructure, getMicrostructure } from "@/lib/quant";
import type { Symbol } from "@/lib/quant/types";

// GET /api/microstructure?symbol=<EUR/USD|XAU/USD>
// With no symbol param: returns reports for all symbols.
// Each report includes VPIN, Kyle's Lambda, Amihud ILLIQ, OFI, composite
// toxicity/liquidity scores, and a narrative interpretation.
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
      const report = getMicrostructure(symbol);
      return NextResponse.json({ report, generatedAt: new Date().toISOString() });
    }
    const reports = getAllMicrostructure();
    return NextResponse.json({
      reports,
      count: reports.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Do not swallow — surface the real cause.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute microstructure", detail: message },
      { status: 500 }
    );
  }
}
