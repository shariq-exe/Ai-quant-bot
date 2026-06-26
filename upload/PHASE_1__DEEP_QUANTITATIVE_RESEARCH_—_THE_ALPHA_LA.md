# PHASE 1: DEEP QUANTITATIVE RESEARCH — THE ALPHA LABORATORY

## 1.1 Market Microstructure & Liquidity Intelligence

**VPIN (Volume-Synchronized Probability of Informed Trading):**
Implement the Easley-López de Prado-O'Hara VPIN metric [1]. Calculate volume buckets rather than time buckets. Classify trade direction using the Bulk Volume Classification (BVC) algorithm. Use VPIN as a real-time toxicity gauge — when VPIN spikes above 2 standard deviations from its rolling mean, it signals institutional flow imbalance. This is your **early warning system** for large directional moves.

Mathematical formulation:
```
VPIN = Σ|V_buy(τ) - V_sell(τ)| / (n × V_bucket)
```
Where τ represents volume buckets, n is the sample size, and V_bucket is the standardized volume per bucket.

**Kyle's Lambda & Price Impact Function:**
Estimate the permanent price impact coefficient λ from the regression: ΔP = λ × SignedVolume + ε [2]. Track λ over rolling windows. When λ is declining, the market is absorbing flow easily (trend continuation). When λ spikes, smart money is forcing price through liquidity — reversal or acceleration imminent.

**Amihud Illiquidity Ratio (adapted for forex):**
```
ILLIQ = (1/D) × Σ(|r_t| / Volume_t)
```
Map illiquidity cycles to volatility expansion. Low liquidity + directional pressure = explosive moves [3].

**Order Flow Imbalance (OFI):**
Calculate the net order flow imbalance at each price level. Compute the cumulative delta divergence between price and volume delta. When price makes new highs but cumulative delta diverges negatively, institutional distribution is occurring.
