# Build progress

> Single source of truth for where this build is. Updated by `/handoff` at the end of every
> session, and after every completed task. If this file is stale, everything else is guesswork.

## Current position

- **Phase:** 03 — Requisitions (backend done, UI not started)
- **Next task:** 3.2 — the requisition form (3.1/3.3/3.4/3.5 are done; 3.6/3.7/3.8/3.9 also outstanding)
- **Working tree:** clean, Phase 03 backend committed
- **Blocked by:** nothing. OQ-01 and OQ-02 were answered on 2026-07-29 and are implemented.
- **Security review:** no CRITICAL, no HIGH — task 0.6's acceptance criterion. Six MEDIUM and
  five LOW findings were fixed; what was deliberately deferred is recorded as G-02 and G-03 in
  `OPEN-QUESTIONS.md`, not lost.

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 00 | Foundation — repo, config, auth, users, admin | ✅ done and verified | 5 migrations, 190 tests |
| 01 | Inventory core — catalogue, locations, placements, ledger | ✅ done and verified | 6 migrations, 213 tests |
| 02 | Borrowing — request, approve, issue, return | ✅ done and verified | 7 migrations, 236 tests |
| 03 | Requisitions — form, approvals, tracker, notifications | 🟡 backend done | 8 migrations, 264 tests. UI (3.2, 3.6–3.9) outstanding |
| 04 | BOM — generation, snapshot, letterhead PDF | ⬜ not started | |
| 05 | Funds & purchasing — receipts, purchases, receive-to-stock | ⬜ not started | |
| 06 | Hardening — exports, audit UI, monitoring, backups drill | ⬜ not started | |

Legend: ⬜ not started · 🟡 in progress · ✅ done and verified

## Task detail

Task-level checkboxes live in each `plan/PHASE-NN-*.md`. This table is the summary; the phase file
is the truth. Tick a phase ✅ only after `/verify` passes its exit criteria.

## What exists after Phase 00

**Commands** — `pnpm dev` (api + web), `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
`pnpm db:up` (starts dev + test Postgres), `pnpm db:migrate`, `pnpm db:rollback`,
`pnpm db:make <name>`, `pnpm db:seed`, `pnpm --filter @ims/api test:int`.

**Ports** — API 3000, web 5173, dev Postgres **5433**, test Postgres **5434**. 5432 and 5430 were
already occupied on the build machine by unrelated stacks; the compose file reflects that.

**Seeded dev logins** (created outside production only) — `admin@ims.local` with the
`SEED_ADMIN_PASSWORD` from `.env`, plus `general@`, `im@`, `approver1@`, `approver2@` at
`@ims.local` with `DevPassword123`.

**Schema** — `app_settings`, `departments`, `users`, `user_roles`, `refresh_tokens`,
`login_attempts`, `approver_slots`, and the `user_role` / `refresh_revocation_reason` enums.

**Tests** — 36 API unit, 212 API integration, 16 web component. All green.

**Verified by hand** — migrate → rollback → migrate from empty; the full production compose stack
(`db`, `migrate`, `api`, `web`, `proxy`) coming up on a clean build and serving the SPA and API
through Caddy; each role's navigation in a real browser.

## Environment gotchas on this machine

Not in any config file, and each one has cost a session time at least once:

- **Docker Desktop stops itself between sessions.** Check `docker info` before any migration or
  test run. To start it:
  `powershell -NoProfile -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -WindowStyle Hidden"`,
  then wait with `until docker info >/dev/null 2>&1; do sleep 5; done`, then
  `docker compose -f infra/docker-compose.dev.yml --env-file .env up -d`.
- **Never run `apps/api` through `tsx`.** esbuild does not emit `design:paramtypes`, so NestJS
  resolves every injected dependency to `undefined` and fails far from the cause. Use
  `pnpm --filter @ims/api build && node dist/src/main.js`, or `pnpm dev`. `tsx` is fine for
  `scripts/migrate.ts` and `scripts/seed.ts` — no DI there.
- The full integration run takes ~50s but has exceeded a 600s shell timeout when the database
  was cold. Redirect it to a file and grep the result rather than streaming it.
- Two tables are append-only by trigger — `stock_ledger` and `requisition_events`. Anything that
  would UPDATE or DELETE them fails loudly, **including** a cascade or an `ON DELETE SET NULL`.
  That is why `resetData` leaves stock, requisitions and the users they reference in place.
