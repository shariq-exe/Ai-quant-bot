import { NextResponse } from "next/server";
import { backtestStrategy } from "@/lib/quant";
import type { Symbol } from "@/lib/quant/types";

// GET /api/backtest?code=<strategyCode>&symbol=<EUR/USD|XAU/USD>
// Runs a full backtest for one strategy × symbol and returns trades,
// equity curve (downsampled for the chart), signals, and full stats.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const symbol = searchParams.get("symbol") as Symbol | null;
    if (!code || !symbol) {
      return NextResponse.json(
        { error: "Missing required params: code, symbol" },
        { status: 400 }
      );
    }
    if (symbol !== "EUR/USD" && symbol !== "XAU/USD") {
      return NextResponse.json(
        { error: `Invalid symbol: ${symbol}. Must be EUR/USD or XAU/USD.` },
        { status: 400 }
      );
    }
    const result = backtestStrategy(code, symbol);
    if (!result) {
      return NextResponse.json(
        { error: `Unknown strategy code: ${code}` },
        { status: 404 }
      );
    }
    // Downsample the equity curve to ~300 points for the chart so the
    // response stays small without distorting the drawdown shape.
    const step = Math.max(1, Math.floor(result.equityCurve.length / 300));
    const equityCurve = result.equityCurve.filter((_, i) => i % step === 0);
    // Cap the trades array sent to the client (last 200) for the blotter.
    const recentTrades = result.trades.slice(-200).reverse();
    return NextResponse.json({
      strategyCode: result.strategyCode,
      symbol: result.symbol,
      stats: result.stats,
      regimeDistribution: result.regimeDistribution,
      equityCurve,
      trades: recentTrades,
      totalTrades: result.trades.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Backtest failed", detail: message },
      { status: 500 }
    );
  }
}
