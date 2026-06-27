import { NextResponse } from "next/server";
import { getStatArb } from "@/lib/quant";

// GET /api/statarb
// Returns the statistical-arbitrage report: OU process (θ/μ/σ) on the
// EUR-XAU spread, Kalman Filter dynamic hedge ratio + residual signal,
// Johansen cointegration test, half-life of mean reversion with validity gate,
// and the composite spread-reversion signal.
export async function GET() {
  try {
    const report = getStatArb(500);
    return NextResponse.json({
      report,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Do not swallow — surface the real cause.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute stat-arb report", detail: message },
      { status: 500 }
    );
  }
}
