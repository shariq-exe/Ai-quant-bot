// ML module — composite entrypoint.
// Ties together feature engineering, ensemble training, and validation into
// a single MLReport per symbol. Implements the spec's SHAP-driven feature
// pruning via a two-pass approach: train with all 12 features → compute SHAP
// stability → retrain without unstable features → compare validation.

import type { Bar, MLFeatureReport, MLReport, Symbol } from "../types";
import { extractFeatures } from "./features";
import { trainEnsemble } from "./ensemble";
import { validateModel } from "./validation";
import { computeVolatility } from "../volatility";

export function computeML(symbol: Symbol, bars: Bar[], lookback = 2000): MLReport {
  // 1. Extract the 12-feature matrix.
  const features = extractFeatures(symbol, bars, 200, 20);

  // 2. Get HMM regime probabilities for the ensemble gating.
  const vol = computeVolatility(symbol, bars.slice(-500), "calm");
  const hmmProbs = (() => {
    const p = vol.hmm.probability;
    const rem = (1 - p) / 2;
    if (vol.hmm.state === 0) return { trending: rem, meanReverting: p, volatile: rem };
    if (vol.hmm.state === 2) return { trending: p, meanReverting: rem, volatile: rem };
    return { trending: rem, meanReverting: rem, volatile: p };
  })();

  // 3. First pass: train the ensemble with ALL 12 features.
  const { specialists, ensemble, shapImportance } = trainEnsemble(features, hmmProbs);
  const validation = validateModel(features, 12);

  // 4. SHAP-driven feature pruning (spec: "prune features with unstable importance").
  // Identify unstable features (high cross-model variance in importance).
  const unstableFeatures = shapImportance.filter((s) => !s.stable).map((s) => s.feature);
  const stableFeatures = shapImportance.filter((s) => s.stable).map((s) => s.feature);
  const pruningApplied = unstableFeatures.length > 0 && stableFeatures.length >= 3;

  let prunedSpecialists = specialists;
  let prunedEnsemble = ensemble;
  let prunedValidation = validation;
  let pruningImproved = false;
  let pruningNote = "no pruning needed (all features stable)";

  if (pruningApplied) {
    // Create a pruned feature report with only the stable features.
    const prunedFeatureReport: MLFeatureReport = {
      ...features,
      featureNames: stableFeatures,
      featureMatrix: features.featureMatrix.map((v) => ({
        time: v.time,
        forwardReturn: v.forwardReturn,
        features: Object.fromEntries(
          stableFeatures.map((f) => [f, v.features[f] ?? 0])
        ) as Record<string, number>,
      })),
      featureStats: features.featureStats.filter((s) => stableFeatures.includes(s.name)),
    };

    // Second pass: retrain the ensemble on the pruned feature set.
    const prunedResult = trainEnsemble(prunedFeatureReport, hmmProbs);
    prunedSpecialists = prunedResult.specialists;
    prunedEnsemble = prunedResult.ensemble;
    prunedValidation = validateModel(prunedFeatureReport, 12);

    // Did pruning improve validation?
    pruningImproved = prunedValidation.deflatedSharpe > validation.deflatedSharpe;
    pruningNote = `pruned ${unstableFeatures.length} unstable feature(s) [${unstableFeatures.join(", ")}] → deflated Sharpe ${validation.deflatedSharpe.toFixed(2)} → ${prunedValidation.deflatedSharpe.toFixed(2)} (${pruningImproved ? "improved" : "no improvement"})`;
  } else if (unstableFeatures.length > 0 && stableFeatures.length < 3) {
    pruningNote = `${unstableFeatures.length} unstable feature(s) but only ${stableFeatures.length} stable — too few to prune, keeping all`;
  }

  return {
    symbol,
    features,
    specialists,
    ensemble,
    validation,
    shapImportance,
    pruningApplied,
    prunedFeatures: unstableFeatures,
    retainedFeatures: stableFeatures.length > 0 ? stableFeatures : features.featureNames,
    prunedSpecialists,
    prunedEnsemble,
    prunedValidation,
    pruningImproved,
    pruningNote,
    timestamp: bars[bars.length - 1]?.time ?? Date.now(),
  };
}
