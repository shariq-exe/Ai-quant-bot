// Quant engine — fractal geometry & long-memory analysis (Phase 1.3).
//
// Four components:
//   1. Hurst exponent via Rescaled Range (R/S) analysis — the classic
//      Mandelbrot-Wallis estimator. H > 0.5 persistent, ≈0.5 random walk,
//      < 0.5 anti-persistent.
//   2. Hurst exponent via Detrended Fluctuation Analysis (DFA) — Peng et al.
//      More robust to non-stationarities than R/S.
//   3. Multifractal DFA (MF-DFA) — Kantelhardt et al. Extends DFA to compute
//      the full spectrum h(q) across moment orders q. Δh = market complexity.
//   4. Higuchi fractal dimension — D_H ∈ [1,2]. 1.0 = trending, 2.0 = noise.
//      Used as a signal-quality filter per the spec.
//
// All pure TypeScript, no external deps. Designed to run on a ~500-bar window
// in <150ms per symbol.

import type {
  Bar,
  FractalReport,
  HiguchiResult,
  HurstRegime,
  HurstResult,
  MFDAResult,
  Symbol,
  TimeframeHurst,
} from "./types";

// ---------------------------------------------------------------------------
// Linear regression helpers (log-log fits return slope + R²)
// ---------------------------------------------------------------------------
function logLogFit(xs: number[], ys: number[]): { slope: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const lx = xs.map(Math.log);
  const ly = ys.map(Math.log);
  const mx = lx.reduce((a, b) => a + b, 0) / n;
  const my = ly.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (lx[i] - mx) * (ly[i] - my);
    sxx += (lx[i] - mx) ** 2;
    syy += (ly[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { slope: 0, r2: 0 };
  const slope = sxy / sxx;
  const r2 = (sxy * sxy) / (sxx * syy);
  return { slope, r2 };
}

function classifyHurst(h: number): HurstRegime {
  if (h > 0.55) return "persistent";
  if (h < 0.45) return "anti-persistent";
  return "random-walk";
}

// ---------------------------------------------------------------------------
// 1. Hurst via Rescaled Range (R/S) analysis
// ---------------------------------------------------------------------------
// For a range of window sizes τ, compute the average R/S statistic:
//   R(τ)/S(τ) = (max(cumdev) - min(cumdev)) / std(deviations)
// where cumdev is the cumulative deviation of returns from their mean over the
// window. Hurst H is the slope of log(R/S) vs log(τ).
export function hurstRS(returns: number[]): HurstResult {
  const n = returns.length;
  if (n < 32) return { value: 0.5, method: "R/S", regime: "random-walk", rSquared: 0 };
  // Window sizes: geometric spacing from 8 to n/2.
  const tauSet = new Set<number>();
  const minTau = 8;
  const maxTau = Math.floor(n / 2);
  for (let k = minTau; k <= maxTau; k = Math.floor(k * 1.4)) tauSet.add(k);
  const taus = Array.from(tauSet).sort((a, b) => a - b);
  const rsValues: number[] = [];
  for (const tau of taus) {
    let rsSum = 0;
    let count = 0;
    for (let start = 0; start + tau <= n; start += tau) {
      const slice = returns.slice(start, start + tau);
      const m = slice.reduce((a, b) => a + b, 0) / tau;
      let cumdev = 0;
      let maxDev = -Infinity;
      let minDev = Infinity;
      let sqSum = 0;
      for (const r of slice) {
        cumdev += r - m;
        if (cumdev > maxDev) maxDev = cumdev;
        if (cumdev < minDev) minDev = cumdev;
        sqSum += (r - m) ** 2;
      }
      const R = maxDev - minDev;
      const S = Math.sqrt(sqSum / tau);
      if (S > 0) {
        rsSum += R / S;
        count++;
      }
    }
    if (count > 0) rsValues.push(rsSum / count);
    else rsValues.push(NaN);
  }
  const valid = taus.map((t, i) => ({ t, rs: rsValues[i] })).filter((d) => isFinite(d.rs));
  if (valid.length < 3) return { value: 0.5, method: "R/S", regime: "random-walk", rSquared: 0 };
  const { slope, r2 } = logLogFit(
    valid.map((d) => d.t),
    valid.map((d) => d.rs)
  );
  const h = Math.max(0, Math.min(1, slope));
  return { value: h, method: "R/S", regime: classifyHurst(h), rSquared: r2 };
}

// ---------------------------------------------------------------------------
// 2. Hurst via Detrended Fluctuation Analysis (DFA)
// ---------------------------------------------------------------------------
// Standard DFA (Peng et al. 1994):
//   1. Integrate the (mean-removed) series → y(k) = Σ_{i≤k} (r_i - <r>)
//   2. Divide y into windows of size τ; fit a line in each; compute RMS
//      deviation F(τ) from the local trend.
//   3. H = slope of log F(τ) vs log τ.
// DFA removes local trends so it's robust to non-stationarity.
export function hurstDFA(returns: number[]): HurstResult {
  const n = returns.length;
  if (n < 32) return { value: 0.5, method: "DFA", regime: "random-walk", rSquared: 0 };
  // Integrate (cumulative sum of mean-removed returns).
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const y: number[] = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += returns[i] - mean;
    y[i] = acc;
  }
  // Window sizes.
  const taus: number[] = [];
  for (let k = 8; k <= Math.floor(n / 2); k = Math.floor(k * 1.4)) taus.push(k);
  const fValues: number[] = [];
  for (const tau of taus) {
    let fSum = 0;
    let count = 0;
    for (let start = 0; start + tau <= n; start += tau) {
      const slice = y.slice(start, start + tau);
      // Linear trend (least-squares) over the window indices.
      const xs = slice.map((_, i) => i);
      const m = xs.reduce((a, b) => a + b, 0) / tau;
      const my = slice.reduce((a, b) => a + b, 0) / tau;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < tau; i++) {
        sxy += (xs[i] - m) * (slice[i] - my);
        sxx += (xs[i] - m) ** 2;
      }
      const slope = sxx > 0 ? sxy / sxx : 0;
      const intercept = my - slope * m;
      let rss = 0;
      for (let i = 0; i < tau; i++) {
        const resid = slice[i] - (slope * xs[i] + intercept);
        rss += resid * resid;
      }
      fSum += Math.sqrt(rss / tau);
      count++;
    }
    if (count > 0) fValues.push(fSum / count);
    else fValues.push(NaN);
  }
  const valid = taus.map((t, i) => ({ t, f: fValues[i] })).filter((d) => isFinite(d.f));
  if (valid.length < 3) return { value: 0.5, method: "DFA", regime: "random-walk", rSquared: 0 };
  const { slope, r2 } = logLogFit(
    valid.map((d) => d.t),
    valid.map((d) => d.f)
  );
  const h = Math.max(0, Math.min(1, slope));
  return { value: h, method: "DFA", regime: classifyHurst(h), rSquared: r2 };
}

// ---------------------------------------------------------------------------
// 3. Multifractal DFA (MF-DFA) — Kantelhardt et al. 2002
// ---------------------------------------------------------------------------
// Extends DFA to compute the fluctuation function F_q(τ) for different moment
// orders q. The scaling h(q) of F_q(τ) ~ τ^h(q) gives the multifractal
// spectrum. Δh = h_max - h_min measures complexity:
//   small Δh → monofractal (simple dynamics, easier to predict)
//   large Δh → multifractal (complex dynamics, reduce confidence)
//
// F_q(τ) = [ (1/N_τ) Σ (F²(τ,window))^(q/2) ]^(1/q)
// For q=0, use the geometric mean (log-average) form to avoid div-by-zero.
export function mfdfa(returns: number[], qValues: number[] = [-4, -2, -1, 0, 1, 2, 4]): MFDAResult {
  const n = returns.length;
  const hValues: number[] = [];
  if (n < 64) {
    return {
      qValues,
      hValues: qValues.map(() => 0.5),
      deltaH: 0,
      complexity: "simple",
      h2: 0.5,
    };
  }
  // Integrate.
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const y: number[] = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += returns[i] - mean;
    y[i] = acc;
  }
  // Window sizes.
  const taus: number[] = [];
  for (let k = 8; k <= Math.floor(n / 2); k = Math.floor(k * 1.4)) taus.push(k);

  // Precompute per-window, per-τ variance F²(τ, window).
  // F2ByTau[τIndex] = array of F² values for each window.
  const f2ByTau: number[][] = [];
  for (const tau of taus) {
    const f2s: number[] = [];
    for (let start = 0; start + tau <= n; start += tau) {
      const slice = y.slice(start, start + tau);
      const xs = slice.map((_, i) => i);
      const m = xs.reduce((a, b) => a + b, 0) / tau;
      const my = slice.reduce((a, b) => a + b, 0) / tau;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < tau; i++) {
        sxy += (xs[i] - m) * (slice[i] - my);
        sxx += (xs[i] - m) ** 2;
      }
      const slope = sxx > 0 ? sxy / sxx : 0;
      const intercept = my - slope * m;
      let rss = 0;
      for (let i = 0; i < tau; i++) {
        const resid = slice[i] - (slope * xs[i] + intercept);
        rss += resid * resid;
      }
      f2s.push(rss / tau);
    }
    f2ByTau.push(f2s);
  }

  // For each q, compute F_q(τ) and fit log-log slope = h(q).
  for (const q of qValues) {
    const fqs: number[] = [];
    for (let ti = 0; ti < taus.length; ti++) {
      const f2s = f2ByTau[ti];
      if (q === 0) {
        // Geometric mean: exp( mean( log(F²) / 2 ) )
        let sum = 0;
        let cnt = 0;
        for (const f2 of f2s) {
          if (f2 > 0) {
            sum += Math.log(f2) / 2;
            cnt++;
          }
        }
        fqs.push(cnt > 0 ? Math.exp(sum / cnt) : NaN);
      } else {
        // F_q = [ (1/N) Σ (F²)^(q/2) ]^(1/q)
        let sum = 0;
        let cnt = 0;
        for (const f2 of f2s) {
          if (f2 > 0) {
            sum += Math.pow(f2, q / 2);
            cnt++;
          }
        }
        fqs.push(cnt > 0 ? Math.pow(sum / cnt, 1 / q) : NaN);
      }
    }
    const valid = taus.map((t, i) => ({ t, f: fqs[i] })).filter((d) => isFinite(d.f) && d.f > 0);
    if (valid.length < 3) {
      hValues.push(0.5);
    } else {
      const { slope } = logLogFit(
        valid.map((d) => d.t),
        valid.map((d) => d.f)
      );
      hValues.push(Math.max(0, Math.min(1, slope)));
    }
  }

  const deltaH = Math.max(...hValues) - Math.min(...hValues);
  const h2 = hValues[qValues.indexOf(2)] ?? hValues[Math.floor(qValues.length / 2)];
  const complexity: MFDAResult["complexity"] =
    deltaH < 0.15 ? "simple" : deltaH > 0.4 ? "complex" : "moderate";

  return { qValues, hValues, deltaH, complexity, h2 };
}

// ---------------------------------------------------------------------------
// 4. Higuchi Fractal Dimension
// ---------------------------------------------------------------------------
// Higuchi (1988). For each k (lag), construct k subseries by skipping every
// k-th element starting at offset m. Compute the average length L_m(k) of
// these subseries, normalized by (N-1)/floor((N-m)/k)·k. D_H is the slope of
// log(L(k)) vs log(1/k). D_H → 1 = trending (smooth), D_H → 2 = noise.
export function higuchiFD(series: number[], kMax = 8): HiguchiResult {
  const N = series.length;
  if (N < 32) return { dimension: 1.5, signalQuality: "medium", rSquared: 0 };
  const ks: number[] = [];
  for (let k = 1; k <= Math.min(kMax, Math.floor(N / 4)); k++) ks.push(k);
  const lengths: number[] = [];
  for (const k of ks) {
    let sumL = 0;
    for (let m = 0; m < k; m++) {
      // Subseries: series[m], series[m+k], series[m+2k], ...
      let Lmk = 0;
      const count = Math.floor((N - m - 1) / k);
      for (let i = 0; i <= count; i++) {
        const idx = m + i * k;
        if (idx + k < N) Lmk += Math.abs(series[idx + k] - series[idx]);
      }
      if (count > 0) {
        const norm = (N - 1) / (Math.floor((N - m) / k) * k);
        Lmk = (Lmk * norm) / count;
      }
      sumL += Lmk;
    }
    lengths.push(sumL / k);
  }
  // Fit log(L(k)) vs log(1/k). Slope = D_H.
  const valid = ks.map((k, i) => ({ x: 1 / k, L: lengths[i] })).filter((d) => d.L > 0 && isFinite(d.L));
  if (valid.length < 3) return { dimension: 1.5, signalQuality: "medium", rSquared: 0 };
  const { slope, r2 } = logLogFit(
    valid.map((d) => d.x),
    valid.map((d) => d.L)
  );
  const d = Math.max(1, Math.min(2, slope));
  const signalQuality: HiguchiResult["signalQuality"] =
    d < 1.4 ? "high" : d > 1.7 ? "low" : "medium";
  return { dimension: d, signalQuality, rSquared: r2 };
}

// ---------------------------------------------------------------------------
// Multi-timeframe aggregation
// ---------------------------------------------------------------------------
// Resample the 1H bars to coarser timeframes by simple non-overlapping
// aggregation (open=first, high=max, low=min, close=last, volume=sum).
function resampleBars(bars: Bar[], factor: number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i += factor) {
    const slice = bars.slice(i, i + factor);
    if (slice.length === 0) continue;
    out.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map((b) => b.high)),
      low: Math.min(...slice.map((b) => b.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((a, b) => a + b.volume, 0),
    });
  }
  return out;
}

function logReturns(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) out.push(Math.log(bars[i].close / bars[i - 1].close));
  return out;
}

// Compute Hurst (R/S + DFA) on multiple timeframes + cross-timeframe dislocation.
function computeTimeframeHurst(bars: Bar[]): TimeframeHurst[] {
  const tfConfigs = [
    { tf: "1H", factor: 1 },
    { tf: "4H", factor: 4 },
    { tf: "1D", factor: 24 },
  ];
  const results: TimeframeHurst[] = [];
  const tfH: { tf: string; h: number; res: TimeframeHurst }[] = [];
  for (const cfg of tfConfigs) {
    const resampled = cfg.factor > 1 ? resampleBars(bars, cfg.factor) : bars;
    const rets = logReturns(resampled);
    if (rets.length < 32) continue;
    const rs = hurstRS(rets);
    const dfa = hurstDFA(rets);
    const avgH = (rs.value + dfa.value) / 2;
    tfH.push({ tf: cfg.tf, h: avgH, res: { timeframe: cfg.tf, barsPerWindow: rets.length, rs, dfa, dislocation: 0 } });
  }
  if (tfH.length === 0) return [];
  const baseH = tfH[0].h; // 1H baseline (first entry if 1H exists)
  for (const t of tfH) {
    t.res.dislocation = Math.abs(t.h - baseH);
    results.push(t.res);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Composite fractal report
// ---------------------------------------------------------------------------
export function computeFractal(symbol: Symbol, bars: Bar[]): FractalReport {
  const n = bars.length;
  // 1H log-returns (the finest timeframe) for MF-DFA + Higuchi.
  const rets1H = logReturns(bars);

  // Multi-timeframe Hurst.
  const timeframes = computeTimeframeHurst(bars);
  let maxDislocation = 0;
  let dislocationTimeframes = "—";
  if (timeframes.length >= 2) {
    for (let i = 0; i < timeframes.length; i++) {
      for (let j = i + 1; j < timeframes.length; j++) {
        const hi = (timeframes[i].rs.value + timeframes[i].dfa.value) / 2;
        const hj = (timeframes[j].rs.value + timeframes[j].dfa.value) / 2;
        const d = Math.abs(hi - hj);
        if (d > maxDislocation) {
          maxDislocation = d;
          dislocationTimeframes = `${timeframes[i].timeframe} vs ${timeframes[j].timeframe}`;
        }
      }
    }
  }

  // MF-DFA on 1H returns.
  const mf = mfdfa(rets1H);

  // Higuchi on 1H close prices.
  const closes = bars.map((b) => b.close);
  const hig = higuchiFD(closes, 8);

  // --- Composite dispatch from fractal analysis ---
  // Primary: average Hurst across timeframes + methods. Higuchi confirms.
  const avgH =
    timeframes.length > 0
      ? timeframes.reduce((s, t) => s + (t.rs.value + t.dfa.value) / 2, 0) / timeframes.length
      : 0.5;
  let dispatch: FractalReport["dispatch"];
  let rationale: string;
  if (avgH > 0.55) {
    dispatch = "momentum";
    rationale = `Hurst H=${avgH.toFixed(2)} (persistent) → momentum endorsed`;
  } else if (avgH < 0.45) {
    dispatch = "mean-reversion";
    rationale = `Hurst H=${avgH.toFixed(2)} (anti-persistent) → mean-reversion endorsed`;
  } else {
    dispatch = "reduce-exposure";
    rationale = `Hurst H=${avgH.toFixed(2)} (random walk) → reduce exposure, no fractal edge`;
  }
  if (maxDislocation > 0.15) {
    rationale += ` · ⚡ ${dislocationTimeframes} dislocation Δ=${maxDislocation.toFixed(2)} (exploitable)`;
  }
  // (MF-DFA complexity note is appended by the gate-modulation block below.)

  // --- Signal-quality trade gate (Higuchi confirms the regime) ---
  // Open: Higuchi confirms trending (D<1.4) when dispatch=momentum, OR confirms
  //       noise (D>1.7) when dispatch=mean-reversion.
  // Caution: Higuchi is ambiguous (1.4 ≤ D ≤ 1.7).
  // Closed: Higuchi contradicts the dispatch (e.g. momentum dispatch but D≈2 noise).
  //
  // MF-DFA complexity MODULATES the gate per the spec ("wide spectrum = complex
  // dynamics, reduce confidence"):
  //   - complex (Δh > 0.4): downgrade open→caution, keep closed as closed
  //   - very-complex (Δh > 0.5): force closed regardless of Higuchi
  //   - simple: no modulation
  let tradeGate: FractalReport["tradeGate"];
  if (dispatch === "reduce-exposure") {
    tradeGate = "closed";
  } else if (hig.signalQuality === "medium") {
    tradeGate = "caution";
  } else {
    const confirms =
      (dispatch === "momentum" && hig.dimension < 1.4) ||
      (dispatch === "mean-reversion" && hig.dimension > 1.7);
    tradeGate = confirms ? "open" : "closed";
  }
  // MF-DFA complexity modulation (the spec's "reduce confidence").
  let complexityNote = "";
  if (mf.deltaH > 0.5) {
    // Very wide spectrum → dynamics too complex to trust → force closed.
    if (tradeGate !== "closed") {
      complexityNote = ` · MF-DFA Δh=${mf.deltaH.toFixed(2)} >0.5 (very complex) → gate forced CLOSED`;
    }
    tradeGate = "closed";
  } else if (mf.deltaH > 0.4) {
    // Complex → downgrade any open gate to caution (reduce confidence).
    if (tradeGate === "open") {
      complexityNote = ` · MF-DFA Δh=${mf.deltaH.toFixed(2)} (complex) → open downgraded to CAUTION`;
      tradeGate = "caution";
    }
  }
  if (complexityNote) rationale += complexityNote;

  return {
    symbol,
    timeframes,
    maxDislocation,
    dislocationTimeframes,
    mfdfa: mf,
    higuchi: hig,
    dispatch,
    dispatchRationale: rationale,
    tradeGate,
    timestamp: bars[n - 1]?.time ?? Date.now(),
  };
}
