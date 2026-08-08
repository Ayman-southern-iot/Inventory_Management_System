# Build progress

> Single source of truth for where this build is. Updated by `/handoff` at the end of every
> session, and after every completed task. If this file is stale, everything else is guesswork.

## Current position

- **Project Hub (2026-08-07):** Tasks 1–7 complete. Every role can open `/projects`, create a
  project, and inspect `/projects/:projectId`; the detail page shows one row per issued borrow with
  IN_USE/RETURNED tags, server-side usage filtering, pagination, and requisitions charged to that
  project. IM/Admin may detach project attribution without touching the borrow or stock ledger. The
  requisition form also received its premium visual pass. Verified: typecheck/lint/web tests green;
  integration suite at the documented baseline (**400 pass / 8 pre-existing failures** in
  `demo-accounts`, `login-backoff`, `reports`, `throttling`).

- **Supporting document on a requisition (2026-08-08):** a requester can attach one PDF/PNG/JPEG
  to a DRAFT (auto-saved on pick), and the requester / IM / Admin / any approver assigned to that
  requisition can open it. Approver sees a paper thumbnail card above the status panel on the
  detail page; clicking opens the file in a new tab. Migration 0023, `SUPPORTING_DOCUMENT` enum
  value, insert-only file model preserved on replace. 17 new integration tests cover attach /
  replace / remove / oversized / magic-byte / missing / read-authorisation matrix / audit rows.
- **Pre-draft supporting document (orphan upload + claim on create, 2026-08-08):** the
  requester can pick a file on the empty Make Requisition form, **before** the draft row
  exists — the file uploads immediately to `POST /uploads/supporting-document` and is
  claimed atomically when the draft is saved (`POST /requisitions` reads the new
  optional `pendingSupportingDocumentId` field and claims the orphan in the same
  transaction). A `@Cron` daily sweep deletes orphans older than 24h. Migration 0024,
  `stored_files.pending_claim_by` column, 10 new integration tests cover orphan row,
  ownership gate, atomic claim, sweep. The existing DRAFT-only endpoint is unchanged.
- **Phase:** 05 complete. Phase 06 in progress — 6.1 (audit log UI) effectively done, 6.2–6.7 open.
- **Next task:** **6.2, the nightly invariant job** (`SUM(stock_ledger) = stock_placements.quantity`
  per product). Extend it to `reserved_qty` at the same time, per G-14 — it currently cannot see a
  stranded reservation, which is the whole failure mode G-14 describes. Then **6.3, the backup and
  restore drill**, which is the highest-value remaining task given the no-data-loss requirement.
- **Working tree:** clean. Everything is committed and verified green: `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, and `pnpm --filter @ims/api test:int` (**21 files, 351 integration
  tests**; 27 new on top of the baseline, 17 for the supporting-doc endpoint and 10 for
  the pre-draft orphan flow). Migrations 0001–0024 applied; 0014–0024 each
  rollback-verified.
- **Blocked by:** nothing. OQ-18 and OQ-19 are answered. OQ-14, OQ-15, OQ-16, OQ-20 and OQ-22 are
  recorded assumptions, not hard blocks.
- **Operator action outstanding:** Settings → Sub-threshold approver is unset, so requisitions
  below the 14,000 threshold refuse to submit. Configuration, not a defect.
- **Measured load (2026-07-30):** a concurrency probe at **4 virtual users × 7 different
  operations fired simultaneously** — 28 in-flight requests against `POSTGRES_POOL_MAX=10`, about
  ten times the stated real peak of 2–3 people — ran **700 requests with zero failures**,
  101 req/s, p95 405ms, max 567ms. Single-user baseline is p50 63–93ms. The system is far from
  its limits at this scale; the pool is not the constraint.
- **Security review:** the 2026-07-30 pass found **one CRITICAL, three HIGH** in code written
  since the Phase 00 review — a SQL injection through `sql.lit` in the audit insert, a
  client-controlled `X-Forwarded-For` that could roll back every audited mutation, unguarded BOM
  read endpoints, and authentication coupled to the audit table. **All four are fixed**, but the
  fixes have **no regression tests yet** and have not been exercised by a green suite. Five further
  gaps are carried as G-11..G-15 in `OPEN-QUESTIONS.md`.

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 00 | Foundation — repo, config, auth, users, admin | ✅ done and verified | 5 migrations, 190 tests |
| 01 | Inventory core — catalogue, locations, placements, ledger | ✅ done and verified | 6 migrations, 213 tests |
| 02 | Borrowing — request, approve, issue, return | ✅ done and verified | 7 migrations, 236 tests |
| 03 | Requisitions — form, approvals, tracker, notifications | ✅ done and verified | 9 migrations, 277 tests |
| 04 | BOM — generation, snapshot, letterhead PDF | ✅ done and verified | 10 migrations |
| 05 | Funds, purchasing, signatures, finished BOM | done and verified | 19 migrations, 351 int tests |
| 06 | Hardening — invariant job, backups, monitoring, runbook | 6.1 done; 6.2-6.7 open | |

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

**Tests** — 36 API unit, 219 API integration, 22 web component. All green.

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
- **A smoke script that logs in repeatedly will trip its own rate limit.** `/auth/login` is
  capped at 10 per minute per IP. Re-running a script that signs in five users a few times in a
  row returns `429 RATE_LIMITED`, and the resulting `undefined` token then reads as a confusing
  401. Log in once and reuse the token, or wait the window out. The limit is working correctly —
  this is not a bug to "fix".
- Settings changed by hand in the dev database **persist**. A smoke run that leaves the expense
  threshold at 25,000 will make the next run's "two approvers" assertion fail for a legitimate
  reason. Reset it to 15,000, or read the live value rather than assuming it.
