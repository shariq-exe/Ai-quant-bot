# PROJECT_MEMORY.md

last_updated: 2026-06-26 15:01 Asia/Calcutta
turn_count: 1
last_commit: f165673 (Initial commit — scaffold only; many files still untracked, not yet committed)

## CAPABILITY CHECK
file_io: yes | terminal: yes | git: yes | network: yes
- file_io: Read / Write / Edit / MultiEdit tools confirmed working against /home/z/my-project.
- terminal: Bash confirmed working (git, curl, ps, bun all ran).
- git: confirmed — on branch `main`, HEAD = f165673 (Initial commit). Working tree has many untracked files (Caddyfile, bun.lock, components.json, db/, examples/, mini-services/, next.config.ts, etc.) + one modified file (.gitignore). Commit policy is ACTIVE.
- network: confirmed — localhost:3000 returns HTTP 200; z-ai-web-dev-sdk available for AI skills.

## HANDBOOK — rules and known traps for THIS project (rarely changes)

**Tech stack / architecture (one-liner):**
Next.js 16.1.3 (App Router, Turbopack) + React 19 + TypeScript 5 + Tailwind CSS 4 + shadcn/ui (New York, full set already installed) + Prisma ORM (SQLite, file at db/custom.db) + Zustand + TanStack Query/Table + NextAuth v4 + framer-motion + recharts + zod + z-ai-web-dev-sdk.

**Current project state (as of bootstrap):**
- `src/app/page.tsx` is a placeholder: a centered Z.ai logo. Nothing real has been built yet.
- Prisma schema has only the default `User` and `Post` models — no domain schema has been designed yet.
- Dev server (next dev -p 3000) is RUNNING in the background (pid 1128/1133/1149), serving HTTP 200 on `/`.
- This is effectively a fresh scaffold waiting for a real product to be built on top of it.

**Hard constraints (pulled from system prompt + codebase — DO NOT violate):**
- Only the `/` route (src/app/page.tsx) is user-visible. Do not add other user-facing routes.
- Dev server MUST stay on port 3000, running in the background, single instance (no duplicates). NEVER run `bun run build`.
- z-ai-web-dev-sdk MUST be used backend-only (server components, API routes /route.ts, or mini-services). NEVER import it in a `'use client'` file.
- All API/fetch requests must use RELATIVE paths. For cross-port calls, append `?XTransformPort={Port}` to the query string. NEVER hardcode `http://localhost:{port}` in fetch or socket.io URLs. Socket.io client must connect as `io("/?XTransformPort={Port}")` with path `/`.
- Real-time features MUST use websocket/socket.io via a mini-service (own port, own package.json, `bun --hot` dev). Mini-services live in `mini-services/`.
- Prisma: schema primitive types can't be lists; schema file in `prisma/`; db client file in `db/`; import via `import { db } from '@/lib/db'`. Run `bun run db:push` after schema edits.
- UI: use existing shadcn/ui components (src/components/ui/* already present), don't rebuild. Avoid indigo/blue unless explicitly requested. Footer (if any) MUST be sticky to bottom with `min-h-screen flex flex-col` wrapper + `mt-auto` footer, and push down naturally on long content.
- Use API routes (`src/app/api/...`), NOT server actions.
- Completion requires Agent Browser end-to-end verification on `/` — a clean dev log is NOT sufficient proof of done.

**Anti-patterns to never repeat in this project (will grow as traps are hit):**
- (none yet — bootstrap turn)
- GENERAL RULE (applies always): never silence a known-broken call with a try/catch that returns empty/default data just to stop the error from showing. That hides the bug, it doesn't fix it. Find the real cause.

## GOALS LEDGER — fast-changing, rewrite every turn
(PENDING USER INPUT — no goals have been stated yet. The protocol forbids starting the loop on a guessed goal list. Awaiting the user's list of features/bugs to work through.)

[ ] — (none yet; waiting for user to specify what to build/fix)

## NEWLY DISCOVERED — found mid-work, not yet scoped, do NOT fix inline
(none yet)

## DO NOT RE-ATTEMPT
(none yet)

## NOTES
- Many scaffold files are untracked in git. First real commit should probably stage the scaffold baseline before feature work, so feature commits are clean — but defer this decision to when the first goal is being worked (it touches the commit policy, not a goal itself).
- `examples/websocket/` contains a socket.io demo (frontend.tsx + server.ts) — reference it when building any real-time feature.
