import { NextResponse } from "next/server";
import { getLiveSignals } from "@/lib/quant";

// GET /api/signals
// Returns the current live signal for every strategy × symbol.
// Backed by the latest bar of the cached synthetic series.
export async function GET() {
  try {
    const signals = getLiveSignals();
    return NextResponse.json({
      signals,
      count: signals.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to generate live signals", detail: message },
      { status: 500 }
    );
  }
}
