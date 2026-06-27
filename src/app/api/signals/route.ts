import { NextResponse } from "next/server";
import { getLiveSignals, getDispatchContext } from "@/lib/quant";

// GET /api/signals
// Returns the current live signal for every strategy × symbol, each tagged
// with the HMM master-switch dispatch for its symbol (regimeActive = true when
// the strategy's type matches the active dispatch family). Also returns the
// per-symbol dispatch context so the dashboard can render the master-switch
// state alongside the signal grid.
export async function GET() {
  try {
    const signals = getLiveSignals();
    const dispatch = getDispatchContext();
    return NextResponse.json({
      signals,
      dispatch,
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
