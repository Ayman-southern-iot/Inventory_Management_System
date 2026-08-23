# Build progress

> Single source of truth for where this build is. Updated by `/handoff` at the end of every
> session, and after every completed task. If this file is stale, everything else is guesswork.

## Current position

- **2026-08-23 — QA round 2: both Criticals and three Highs closed, plus the baseline itself.**
  Fourteen commits. **Working tree clean**; `IMS_QA_Test_Plan.xlsx` is untracked at the repo root
  and now carries a row 24 for REQ-000013, the record created to reproduce D-014.
  Branch `fix/lan-secure-context`, **92 commits ahead of `main`, 27 ahead of `origin`.**
  - **Next task:** D-002 — `RequisitionFormPage.tsx:50` requests `limit: 200` against a
    `PAGINATION_MAX_LIMIT` of 100, so the catalogue 400s on every load and the item picker has
    never worked. Needs no ruling. Everything else is blocked on Ayman (see NOW.md).
  - **Verified green:** typecheck clean · unit shared 13 / api 58 / web 112 · integration
    **497 pass / 1 fail (498, 41 files)** · `pnpm lint` **20 pre-existing errors**, not green.
  - **The baseline was wrong, not just stale.** Three of the four remaining integration failures
    were a settings leak from `audit.int-spec` (EXPENSE_THRESHOLD_BDT dropped to 9,999 and never
    restored), attributed to `requisitions.int-spec` for months. `audit + reports` reproduces
    them; `requisitions + reports` passes 51/51. Fixed, and `restoreSeededSettings` closes the
    class. The suite is deterministic for the first time and the one remaining failure is real.
  - **Fixed:** D-014 (dates stored a day early, cumulative — a pg DATE type parser) and the whole
    clock family (three sites answering "what day is it" three ways, plus the §5 reminder job) ·
    D-030 bar five held sites (audit `actor_name` resolved once at the insert; nine fabricated
    actor names deleted) · D-028 (BOM quantity blanked on the source value) · D-024 (expense
    export returned the SPA shell; now `api.blob()`).
  - **Found, not fixed:** D-002 · `EX-02` — inventory export does not exist and is the only
    unimplemented REQUIRED §10 obligation, with no defect ID in the workbook · demo mode is ON in
    production · a fresh install has four configuration gaps before the first requisition can be
    submitted · D-023 and the borrow-to-user picker are blocked on one absent endpoint.

- **2026-08-20 — QA round 1 and harness repair.** Phase work is finished; this session was the
  project manager's first QA pass plus the test-harness repair that made its results
  trustworthy. Nine commits. **Working tree clean, nothing outstanding uncommitted.**
  Branch `fix/lan-secure-context`, 82 commits ahead of `main`, still unmerged.
  - **Next task:** step 5c — `returnedAmount` defaults to `funding.unspent` rather than `'0'`
    (`FundsActionDialog.tsx:82`). Then 5d (not-in-the-future date bound), then two ASSIST §8 rows.
  - **Verified green:** typecheck clean · unit shared 7 / api 51 / web 102 · integration
    **484 pass / 7 fail (491, 40 files)**. `pnpm lint` has **21 pre-existing errors** and is not
    green — see NOW.md.
  - The 7 integration failures are fully attributed for the first time: 3 cross-file
    `app_settings` pollution in `reports`, 3 Chromium-not-installed, 1 real defect (413 vs 500).
    The previously documented "8 pre-existing failures" was wrong in both halves.

- **IM-side BOM customisation + 1-item over-budget send-back (2026-08-10):** the
  IM at the BOM-generate step used to have only `unitCost` and `vendor` editable, so a
  multi-item approved requisition where `approvedAmount < requestedAmount` had no
  path back to fit. Two new affordances close the gap: (a) **multi-item** IM can
  shrink `quantity` (clamped to `[1, sourceQuantity]`), toggle a `removed` checkbox
  to drop the line, or change `unitCost` — the source `requisition_items.quantity` is
  never modified, the override lives only on the BOM line (the office is small; the
  IM coordinates budget changes verbally with the requester). (b) **single-item** the
  IM cannot shrink, so the Generate button is replaced by **Send back for revision**:
  a new `POST /requisitions/:id/send-back-for-revision` (IM/Admin only) flips the
  requisition `APPROVED → DRAFT`, clears `approved_amount` / `decided_at`, and asks
  the requester to revise. The detail page shows a **For revise** pill on the DRAFT
  status; once the requester re-submits it flips to **Revised**. Two `requisitions_events`
  rows (`SEND_BACK_FOR_REVISION`, `SUBMITTED`) drive the pill via a derived view field
  (`requiresRevisionTag`, `revisedAfterSendBack`) — no status-enum pollution. New
  audit action `requisition.send_back_for_revision`, new notification type
  `requisition.sent_back_for_revision` for the requester. Migration-free:
  `requisition_events.event_type` is `text`, not enum. 8 new integration tests
  (`boms-customize-lines` 4, `requisitions-send-back` 4) and 4 new web tests
  (`BomGeneratePage.test.tsx` 2, `RequisitionDetailPage.pills.test.tsx` 2) all green.
  Web suite 85/85 (was 81). Integration suite 469 pass / 8 pre-existing failures
  unchanged (the new test files all pass cleanly in isolation).
- **IMS UI/Backend fixes (2026-08-10):** nine user-facing fixes bundled into nine commits.
  (1) Approval deadline disables past dates in the native picker (`min={todayLocal()}`).
  (2) Quarantined items no longer count as available in `move` / `reserve` / `adjust` — a
  long-standing bug where a DAMAGED return would leave the units physically counted as
  available. (3) `InsufficientStockError` carries the quarantined count so the dialog can
  say "Only 4 are available — 2 are in quarantine" once the popup lands in a follow-up.
  (4) Transportation cost is folded into the verify-purchase unspent figure, so the IM
  isn't handed back money they already spent on a van. (5) Verify-purchase gains a
  server-side `unverify-purchase` endpoint (`POST /requisitions/:id/unverify-purchase`,
  IM/Admin): flips `PURCHASE_VERIFIED → PURCHASED` for re-recording, refuses if any
  `fund_returns` exist. (6) Return reversals: a `POST /borrowing/:id/returns/:returnId/
  reverse` endpoint writes a compensating `ADJUST` ledger row, decrements `returned_qty`,
  recomputes status, and decrements `quarantined_qty` for DAMAGED/NOT_WORKING returns —
  the original `borrow_returns` row is preserved (append-only ledger). Plus a per-borrow
  Returns list view. (7) General users no longer see "Add Product" on `/products` (the
  server already returned 403 — the button was a dead end). (8) Recent Movements shows
  a Condition column populated by `LEFT JOIN LATERAL borrow_returns` keyed on
  `ref_id`/`ref_type='BORROW'`, pinned to the most recent return at-or-before the ledger
  timestamp. (9) `findViewById` accepts a transaction handle so the reverse-return
  response reflects the post-update state instead of the pre-transaction view (a real
  bug surfaced by the new test). 11 new integration tests across
  `borrowing-return-reverse` (3), `stock-quarantine` (3), `stock-ledger-condition` (2),
  and 3 new cases in `funds.int-spec.ts` (transportation fold, unverify happy path,
  refuses with returns). Verified: typecheck green on shared/api/web, lint clean for
  the changed files, web suite 81/81, integration suite at the documented baseline
  (**458 pass / 8 pre-existing failures** unchanged in `reports`, `throttling`).
- **Dev compose pinned to a single host port (2026-08-10):** `docker-compose.yml` at the
  repo root only ever served on 5173 via the Caddy proxy, but the ports mapping was
  parameterised by `$WEB_PORT` (so anyone could quietly change the host-facing port) and the
  `proxy` service took `IMS_DOMAIN` from the host env (which would silently push Caddy into
  HTTPS mode if set). Hard-code `5173:80` and pin `IMS_DOMAIN: ':80'` so the host port is
  unambiguous and the Caddyfile template renders consistently. The api (3000), web (80) and
  db (5432) mentioned elsewhere are internal container ports — Caddy routes `/api/*` to
  `api:3000` and the SPA to `web:80`. `infra/docker-compose.yml` (prod, 80+443 for real
  HTTPS) and `infra/docker-compose.dev.yml` (host dev workflow, 5433+5434 to dodge host
  port conflicts) are intentionally untouched. Verified: `docker compose config` shows
  one port mapping (`5173:80`); `curl http://localhost:5173/` and `/health` return 200.
- **BOM header + per-source breakdown carry transportation (2026-08-10):** the BOM-detail
  header's `BOM subtotal` cell was items-only while `approvedAmount` on every source row
  was items + transportation — the page showed a variance that was structurally wrong by
  the transportation delta. Header now splits into Approved total · Items subtotal ·
  Transportation (conditional) · BOM subtotal (items + transport) · Variance. Each
  per-source card mirrors the PDF: item subtotal, transportation (only when > 0), total
  amount. `BomGeneratePage` drops the Ceiling cell / bounce banner / `TOLERANCE_PCT`
  constants (the over-budget gate was retired 2026-08-09; those were dead UI). The PDF
  items table, when transportation exists, now prints three tfoot rows: Transportation
  per source (dropped the `REQ-XXXX — ` prefix — the source is already in the header
  block above), Items subtotal, Grand total; with no transportation it stays a single
  Subtotal row. 1 new web component test (`BomSourceSection.test.tsx`, 3 cases) and
  updated assertions in `bom-transportation.int-spec.ts` (8 cases). Verified: typecheck
  green, lint clean for the changed files, web suite 81/81, integration suite at the
  documented baseline (**450 pass / 8 pre-existing failures** unchanged).
- **BOM over-budget ceiling retired (2026-08-09):** a unit cost going up between approval and
  BOM generation is a normal slowdown, not a policy violation. The generation gate that
  bounced BOMs and flipped sources back to AWAITING_APPROVAL is gone — over-budget BOMs
  now generate cleanly, and the variance is visible on the PDF. The
  `BOM_OVER_BUDGET_TOLERANCE_PCT` setting and `over_budget_bounced` column are kept for
  historical rows and audit vocabulary; the service no longer reads either. 3 tests
  rewritten (`boms.int-spec.ts`, `boms-pdf.int-spec.ts`, `e2e-requisition-to-bom.int-spec.ts`).
- **Requisition form Total fix (2026-08-09):** the bottom-of-form Total was stuck at 0.00
  while the per-row line totals worked. Cause: Controller-wrapped inputs update form state
  through `setValue`, which `form.watch('items')` (the array-level proxy) lagged on by one
  render. Switching to `useWatch({ control, name: 'items' })` makes the Total re-render in
  step with the rows. 1 new regression test pins the user flow (4 × 399.99 → 1,599.96).
- **Transportation cost on a requisition (2026-08-09):** a requester can attach a single
  rolled-up transportation cost (e.g. "pickup truck to Gazipur") to a DRAFT requisition.
  The cost is part of `requested_amount` at submit, frozen alongside the items total, and
  the BOM PDF renders a per-source "Transportation" line above the subtotal so Accounts
  can see what was transportation vs. goods. Description is required when the cost is
  non-zero; the form clears the description when the cost drops to 0; a DB CHECK
  enforces the both-or-neither invariant as a structural guard. Migration 0025 (two
  columns + three CHECK constraints), 22 new integration tests across
  `requisitions-transportation` (16) and `bom-transportation` (6). Verified: typecheck
  green; integration suite at the documented baseline (**400 pass / 8 pre-existing
  failures** unchanged in `demo-accounts`, `login-backoff`, `reports`, `throttling`).
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
  `pnpm lint`, `pnpm test`, and `pnpm --filter @ims/api test:int` (**32 files, 458
  integration tests**; 450 pass, 8 pre-existing failures unchanged in `demo-accounts`,
  `login-backoff`, `reports`, `throttling`). Migrations 0001–0025 applied; 0014–0025
  each rollback-verified.
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
