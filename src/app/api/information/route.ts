import { NextResponse } from "next/server";
import { getInformation } from "@/lib/quant";

// GET /api/information
// Returns the information-theory report: Transfer Entropy (XAU↔EUR directed),
// Permutation Entropy per symbol (with predictability state + sizing multiplier),
// Mutual Information feature ranking, and the composite cross-asset edge signal.
export async function GET() {
  try {
    const report = getInformation(500);
    return NextResponse.json({
      report,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Do not swallow — surface the real cause.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute information-theory report", detail: message },
      { status: 500 }
    );
  }
}
