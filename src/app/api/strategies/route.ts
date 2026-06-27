import { NextResponse } from "next/server";
import { getBacktestSuite, getStrategies, SYMBOLS } from "@/lib/quant";

// GET /api/strategies
// Returns the strategy catalog with full backtest stats per symbol.
// This is the data behind the dashboard's strategy performance table.
export async function GET() {
  try {
    const strategies = getStrategies().map((s) => ({
      code: s.code,
      name: s.name,
      type: s.type,
      description: s.description,
    }));
    const suite = getBacktestSuite();
    return NextResponse.json({
      symbols: SYMBOLS,
      strategies,
      results: suite.map((r) => ({
        code: r.code,
        name: r.name,
        type: r.type,
        description: r.description,
        symbol: r.symbol,
        stats: r.stats,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Do not swallow — surface the real cause.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute strategy suite", detail: message },
      { status: 500 }
    );
  }
}
