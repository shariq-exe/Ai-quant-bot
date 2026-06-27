// ML module — composite entrypoint.
// Ties together feature engineering, ensemble training, and validation into
// a single MLReport per symbol.

import type { Bar, MLReport, Symbol } from "../types";
import { extractFeatures } from "./features";
import { trainEnsemble } from "./ensemble";
import { validateModel } from "./validation";
import { computeVolatility } from "../volatility";

export function computeML(symbol: Symbol, bars: Bar[], lookback = 2000): MLReport {
  // 1. Extract the 12-feature matrix.
  const features = extractFeatures(symbol, bars, 200, 20);

  // 2. Get HMM regime probabilities for the ensemble gating.
  // Map the HMM 3-state output to the 3 specialist regimes.
  const vol = computeVolatility(symbol, bars.slice(-500), "calm");
  // HMM state 0 = low-vol compression → mean-reverting specialist
  // HMM state 1 = transitional → volatile specialist
  // HMM state 2 = high-vol trending → trending specialist
  const hmmProbs = (() => {
    const p = vol.hmm.probability;
    const rem = (1 - p) / 2;
    if (vol.hmm.state === 0) return { trending: rem, meanReverting: p, volatile: rem };
    if (vol.hmm.state === 2) return { trending: p, meanReverting: rem, volatile: rem };
    return { trending: rem, meanReverting: rem, volatile: p };
  })();

  // 3. Train the ensemble (3 specialists + HMM gating).
  const { specialists, ensemble, shapImportance } = trainEnsemble(features, hmmProbs);

  // 4. Validate with CPCV + walk-forward + Deflated Sharpe.
  const validation = validateModel(features, 12);

  return {
    symbol,
    features,
    specialists,
    ensemble,
    validation,
    shapImportance,
    timestamp: bars[bars.length - 1]?.time ?? Date.now(),
  };
}
