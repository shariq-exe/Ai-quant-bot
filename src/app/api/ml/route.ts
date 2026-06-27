import { NextResponse } from "next/server";
import { getML } from "@/lib/quant";
import type { Symbol } from "@/lib/quant/types";

// GET /api/ml?symbol=<EUR/USD|XAU/USD>
// Returns the full ML report: 12-feature matrix, ensemble of 3 specialists
// (GBT/Ridge/LSTM-proxy) gated by HMM, anti-overfit validation (CPCV +
// walk-forward + Deflated Sharpe), and SHAP-style feature importance.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") as Symbol | null;
    const targetSymbol: Symbol = symbol === "XAU/USD" ? "XAU/USD" : "EUR/USD";
    const report = getML(targetSymbol, 2000);
    return NextResponse.json({
      report,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Do not swallow — surface the real cause.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute ML report", detail: message },
      { status: 500 }
    );
  }
}
