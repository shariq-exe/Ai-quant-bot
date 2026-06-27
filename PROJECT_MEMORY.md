# PROJECT_MEMORY.md

last_updated: 2026-06-27 10:12 Asia/Calcutta
turn_count: 11
last_commit: 209ff6b (G17+G18 multivariate HMM) — PUSHED to GitHub

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
- [x] G10 — Push codebase to GitHub (https://github.com/shariq-exe/Ai-quant-bot) — VERIFIED: refs/heads/main=6f428f5 synced, .env/db untracked, token never persisted to .git/config, dev server still HTTP 200
- [x] G11 — Phase 1.2 volatility intelligence: GARCH(1,1) MLE + 3-state regime classification, Barndorff-Nielsen-Shephard bipower-variation jump detection (z-test), Gaussian HMM (Baum-Welch + Viterbi + forward probs) master switch → strategy dispatch — VERIFIED, commit d5684b0
- [x] G12+G13 — /api/volatility endpoint + VolatilityPanel (GARCH regime badge + σ_t sparkline, HMM state bars, jump indicator, dispatch banner) — VERIFIED, commit e8ad97b
- [x] G14 — Agent Browser verify volatility panel — VERIFIED (6 sections render, no errors, real GARCH/HMM/jump data, click dispatch works)
- [x] G5 — Final regression pass — CLEAN (3 VALID strategies, 6 endpoints 200, all 6 dashboard sections, lint clean)

**Phase 1.2 master-switch wiring (continued from "where I stopped"):**
- [x] G15 — Wire HMM master switch → live signals: tag each signal with `regimeActive` (strategy type vs active dispatch family; carry always eligible), /api/signals returns dispatch context, SignalCard emphasizes active (amber ring) / dims suppressed (opacity-45), regime note per card, dashboard adds regime-filter toggle + per-symbol dispatch banner — VERIFIED, commit d5e1fbc
- [x] G16 — Agent Browser verify regime-aware signals — VERIFIED (ACTIVE/SUPPRESSED badges render, filter toggle works both ways: ON→only active visible, OFF→all 8 back, no errors, 6 sections intact, footer sticky)
- [x] G5 — Final regression pass — CLEAN (6 endpoints 200, lint clean, 3/8 VALID, pushed e8ad97b..d5e1fbc)

**Phase 1.2 spec-compliance (continued from "where I stopped"):**
- [x] G17 — Upgrade HMM to multivariate: 4 features (log-returns, realized vol, volume skewness, spread proxy) with diagonal-covariance Gaussian emissions. `extractHMMFeatures` standardizes features; Baum-Welch/Viterbi/forward operate on T×4 matrix; states sorted by realized-vol mean. Implements the spec sentence exactly: "Train a Gaussian HMM with 3-4 hidden states using features: log-returns, realized volatility, volume profile skewness, and spread dynamics." — VERIFIED, commit 578c36e
- [x] G18 — Agent Browser verify multivariate HMM + add feature matrix table to VolatilityPanel (4 features × 3 states + current values, active state column highlighted) — VERIFIED (table renders real values, no errors, regime-gated signals still ACTIVE=4/SUPPRESSED=4, 6 sections, footer sticky), commit 209ff6b
- [x] G5 — Final regression pass — CLEAN (6 endpoints 200, 3/8 VALID, lint clean, pushed d5e1fbc..209ff6b)

**ALL GOALS VERIFIED.** Phase 1.2 now fully spec-compliant (multivariate HMM + master-switch wiring). Pushed to GitHub (209ff6b). Awaiting next phase file.

## NEWLY DISCOVERED
- SECURITY: user shared a GitHub PAT in plaintext in chat. Token was used one-shot (not written to .git/config). **User should rotate this token at https://github.com/settings/tokens — it is now exposed in the chat history.**
- `.env` (containing only `DATABASE_URL=file:/home/z/my-project/db/custom.db` — a local path, NOT a real secret) is in the initial commit f165673's history. Assessed as non-sensitive (no API key/password). Did NOT rewrite history. If the user later adds real secrets to .env, the historical commit is harmless but future commits are protected by .gitignore.

## DO NOT RE-ATTEMPT
- Forcing z-score-mr valid via threshold loosening — destroys the honest signal. It's legitimately negative after costs on this synthetic data.
- Per-bar trend drift > baseSigma * 0.2 — causes price collapse/explosion over long runs.
- Using blue/sky/indigo colors for dispatch families — project constraint forbids blue/indigo. Use emerald (mean-reversion), amber (breakout-prep), violet (momentum) instead. Caught in G15: initially used `text-sky-400`/`#60a5fa` for momentum, fixed to violet `#a78bfa`.
- Univariate HMM on log-returns only — Phase 1.2 spec explicitly lists 4 features (log-returns, realized vol, volume skewness, spread dynamics). Must use multivariate diagonal-covariance Gaussian emissions. Caught in G17: original HMM was univariate, upgraded to 4-feature.

## AGENT BROWSER NOTES
- After `agent-browser reload`, the session sometimes drops to `about:blank`. Use `agent-browser open http://localhost:3000/` + a 8-9s wait to re-establish.
- Strategy-table row refs: use `agent-browser snapshot -i` and look for `^- row ` entries (the `<tr>` elements, refs like @e14–@e21). The `generic` wrappers (@e1733+) inside rows are NOT the click targets — clicking them won't fire the row's onClick.
- Click → backtest fetch takes ~300ms; wait ≥3s (preferably 5s) before checking the heading updated, or the polling re-render may mask the change. Verify via `GET /api/backtest?...` in dev.log, not just the heading text.

## NOTES
- Dev server running (pid 1128/1133/1149/1179), port 3000, HTTP 200.
- Quant engine caches series per symbol (96k bars, deterministic seeds) + 5-min TTL on backtest suite cache. Microstructure ~55ms, volatility ~85ms per symbol (fresh each call).
- 3 validated strategies: decay-mom EUR/USD (Sharpe 3.70, p=0.0019, 1155 trades), carry-proxy EUR/USD (Sharpe 3.57, p=0.0003, 1719 trades), carry-proxy XAU/USD (Sharpe 3.60, p=0.0003, 1645 trades).
- Agent Browser session open; viewport 1280×900. Screenshots in /home/z/my-project/upload/.
- Phase 1 file sections done: 1.1 (microstructure) + 1.2 (volatility intelligence). User may send 1.3+.
- examples/websocket/ has a socket.io demo for any future real-time feature.
- GitHub: https://github.com/shariq-exe/Ai-quant-bot (main branch, HEAD 209ff6b).
