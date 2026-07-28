# Build progress

> Single source of truth for where this build is. Updated by `/handoff` at the end of every
> session, and after every completed task. If this file is stale, everything else is guesswork.

## Current position

- **Phase:** 01 — Inventory core (complete)
- **Next task:** Phase 02 — Borrowing, task 2.1
- **Working tree:** clean, Phase 01 committed
- **Blocked by:** nothing for Phase 02. OQ-04 (what the IM edit does after issue) and OQ-09 (project fields) shape it and should be confirmed, but both have recorded assumptions.
- **Security review:** no CRITICAL, no HIGH — task 0.6's acceptance criterion. Six MEDIUM and
  five LOW findings were fixed; what was deliberately deferred is G-01..G-05 in
  `OPEN-QUESTIONS.md`, not lost.

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 00 | Foundation — repo, config, auth, users, admin | ✅ done and verified | 5 migrations, 190 tests |
| 01 | Inventory core — catalogue, locations, placements, ledger | ✅ done and verified | 6 migrations, 213 tests |
| 02 | Borrowing — request, approve, issue, return | ⬜ not started | |
| 03 | Requisitions — form, approvals, tracker, notifications | ⬜ not started | |
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

**Tests** — 36 API unit, 161 API integration, 16 web component. All green.

**Verified by hand** — migrate → rollback → migrate from empty; the full production compose stack
(`db`, `migrate`, `api`, `web`, `proxy`) coming up on a clean build and serving the SPA and API
through Caddy; each role's navigation in a real browser.
