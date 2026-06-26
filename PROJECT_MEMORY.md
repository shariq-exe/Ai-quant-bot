# PROJECT_MEMORY.md

last_updated: 2026-06-26 15:48 Asia/Calcutta
turn_count: 4
last_commit: 254ae4e (G7+G8 microstructure endpoint + panel)

## CAPABILITY CHECK
file_io: yes | terminal: yes | git: yes | network: yes
- All confirmed and exercised across G1–G9.

## HANDBOOK — rules and known traps for THIS project

**Tech stack:**
Next.js 16.1.3 (App Router, Turbopack) + React 19 + TS 5 + Tailwind 4 + shadcn/ui (full set) + Prisma/SQLite (db/custom.db) + Zustand + TanStack Query/Table + NextAuth v4 + framer-motion + recharts + zod + z-ai-web-dev-sdk.

**Project: QUANT·DESK** — a quantitative trading system for EUR/USD & XAU/USD. Deep-research-to-execution: regime-aware synthetic market data → validated strategies (p<0.05) → live signals → microstructure intelligence → Bloomberg-terminal dashboard with TradingView charts.

**Hard constraints (DO NOT violate):**
- Only `/` route (src/app/page.tsx) is user-visible.
- Dev server on port 3000, background, single instance. NEVER `bun run build`.
- z-ai-web-dev-sdk backend-only (never in `'use client'`).
- Relative API paths only; cross-port via `?XTransformPort={Port}`. Socket.io via `io("/?XTransformPort={Port}")`.
- Real-time via socket.io mini-service (own port + package.json + `bun --hot`).
- Prisma: no list primitives; schema in `prisma/`; `import { db } from '@/lib/db'`; `bun run db:push` after edits.
- UI: existing shadcn/ui components; no indigo/blue; sticky footer (`min-h-screen flex flex-col` + `mt-auto`).
- API routes not server actions. Agent Browser verification required for "done".

**Anti-patterns caught and fixed in this project (DO NOT repeat):**
1. **Runaway drift in market-data sim** — per-bar trend drift of `baseSigma * 0.4..1.0` compounded over 48k+ bars collapsed price to ~0 or exploded it. FIX: drift must be tiny per-bar AND a global mean-reversion pull toward basePrice must bound the series over long runs. See `market-data.ts` `globalPull` + `boundedPull`.
2. **Position sizing blow-up** — `size = equity*risk/stopDist` with a fixed 0.5% stopDist but signal-space stops (z=3.5) meant actual price stops were ~3.5σ → enormous notional → equity explosion. FIX: strategies must supply a price-based `stopDistance` on entry signals; backtester sizes risk-parity off that (`stopDistance × size = equity × riskPerTrade`), with a floor and a 20x leverage cap. See `SignalResult.stopDistance` + `backtest.ts computeSize`.
3. **O(n²) strategy hot path** — strategies called `bars.map(b=>b.close)` inside every bar's signal fn → 2.3B ops over 48k bars (40s suite). FIX: use windowed helpers that slice only the lookback (`windowCloses`, `windowStd`). Suite dropped 40s → 0.7s.
4. **Carry signal was inverted** — initial carry-proxy went long on positive slope, but the synthetic data mean-reverts extreme slopes. Honest fix: flip to fade-the-extreme (validated empirically; Sharpe went negative→positive). Do NOT just flip blindly — confirm with backtest stats first.
5. **Over-loosening thresholds dilutes edge** — dropping decay-mom threshold from 0.7→0.5 added trades (543→1642) but destroyed Sharpe (4.86→0.25). The honest way to get more trades at the same threshold is MORE DATA (extended 48k→96k bars → 11y), not lower thresholds.
6. **z-score MR is genuinely negative on this data** — 65% hit rate but negative Sharpe even after stops. This is an honest research finding, not a bug. Don't force it valid.

**GENERAL RULE:** never silence a known-broken call with a try/catch returning empty/default. Find the real cause.

## GOALS LEDGER
- [x] G1 — Backend quant engine: Prisma schema + market-data sim + statistics + backtest framework + 4 strategies (3/8 validated) — VERIFIED, commit 058852c
- [x] G2 — API routes: /api/strategies, /signals, /backtest, /market-data — VERIFIED, commit (G2)
- [x] G3 — Frontend dashboard: TradingView charts, signal cards, strategy table, equity curve, stats, trade blotter, sticky footer, responsive — VERIFIED, commit (G3)
- [x] G4 — Agent Browser e2e verification — VERIFIED (title, no errors, all sections, click works, polling, sticky footer, responsive)
- [x] G6 — Phase 1 microstructure library: VPIN (BVC), Kyle's Lambda, Amihud ILLIQ, OFI + composite toxicity/liquidity — VERIFIED, commit a549565
- [x] G7+G8 — /api/microstructure endpoint + MicrostructurePanel in dashboard — VERIFIED, commit 254ae4e
- [x] G9 — Agent Browser verify microstructure panel — VERIFIED (gauges, sparkline, metric rows, interpretation render; no errors; no regressions)
- [x] G5 — Final regression pass — CLEAN (3 VALID strategies, 5 endpoints 200, all 5 dashboard sections render, lint clean, click works)

**ALL GOALS VERIFIED.** Awaiting next phase file from user.

## NEWLY DISCOVERED
- (none open)

## DO NOT RE-ATTEMPT
- Forcing z-score-mr valid via threshold loosening — destroys the honest signal. It's legitimately negative after costs on this synthetic data.
- Per-bar trend drift > baseSigma * 0.2 — causes price collapse/explosion over long runs.

## NOTES
- Dev server running (pid 1128/1133/1149/1179), port 3000, HTTP 200.
- Quant engine caches series per symbol (96k bars, deterministic seeds) + 5-min TTL on backtest suite cache. Microstructure computes fresh each call (~55ms).
- 3 validated strategies: decay-mom EUR/USD (Sharpe 3.70, p=0.0019, 1155 trades), carry-proxy EUR/USD (Sharpe 3.57, p=0.0003, 1719 trades), carry-proxy XAU/USD (Sharpe 3.60, p=0.0003, 1645 trades).
- Agent Browser session open; viewport 1280×900. Screenshots in /home/z/my-project/upload/.
- Phase 1 file (`upload/PHASE_1__..._.md`) covered microstructure (1.1). User may send more sections (1.2+).
- examples/websocket/ has a socket.io demo for any future real-time feature.
