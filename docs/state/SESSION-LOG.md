# Session log

Newest entry at the top. Written by `/handoff`. This is what lets a fresh session pick up cold.

Format:

```md
## YYYY-MM-DD — Phase NN
**Did:** what now works that didn't before
**Decisions:** anything chosen that wasn't specified
**Landmines:** anything half-done, skipped, or shortcut — be blunt
**Next:** the single next action, specific enough to start without thinking
```

## 2026-07-30 (end) — Phase 05 re-specified and planned; two live bugs fixed

**Did:**
- **Fixed a reported blocker.** Submitting a sub-threshold requisition failed with "Approver 1 is
  not assigned" while the approver slots screen showed both slots correctly filled. Root cause:
  below `EXPENSE_THRESHOLD_BDT` (14,000 here) the chain does not use the slots at all — it uses
  `SUBTHRESHOLD_APPROVER_USER_ID`, which was `null`. Both failure paths raised the same
  slot-shaped error, so the message pointed the admin at the wrong screen. Added
  `SubthresholdApproverUnassignedError` naming the real setting, with separate wording for the
  "unset" and "deactivated approver" cases, and a test that leaves the slots populated so the
  confusion cannot come back. **The operator still needs to set that setting** — the code fix
  only makes the message honest.
- **Fixed dead notification links (my own bug from earlier this session).** I had pointed borrow
  notifications at `/borrowing/:id`, which does not exist. The web router ends in a catch-all
  redirect, so clicking one silently landed on the dashboard rather than erroring — it would have
  looked like the feature simply did not work. Routes now come from `notifications.links.ts`,
  which mirrors `apps/web/src/routes/paths.ts`, borrow notifications point at the right list per
  recipient (IM queue vs. My borrowings), and a test fails if any notification links somewhere the
  app does not serve.
- **Rewrote `plan/PHASE-05-funds-purchasing.md`** against the operator's real specification:
  password minimum 4, file-upload foundation, digital signatures on approvals, a redesigned BOM
  document with the Southern IoT letterhead, the lifecycle extension (Sent to Accounts → Money
  Received → Purchased → Purchase Verified → Stocked / Borrowed out → Closed), invoice upload with
  money-saved returns, add-to-inventory, borrow-to-user, and expense reporting. Nine ordered tasks
  with dependencies, schema, and acceptance criteria.
- Suite green throughout: **288 integration tests**, typecheck and lint clean.

**Decisions:** the plan carries its own reasoning inline. The two worth knowing without opening it:
`fund_returns` is a separate table rather than negative `fund_receipts` rows, so every future `SUM`
stays unambiguous; and a signature upload inserts a new `stored_files` row rather than overwriting,
so a BOM printed in July keeps rendering the signature that was actually used.

**Landmines:**
- **OQ-18 blocks task 5.3.** The BOM header must print "Remaining" and nobody has said which
  subtraction that is. Do not guess on a document that goes to Accounts.
- The password change (5.0) is a deliberate, operator-instructed weakening. OQ-17 records why it
  is acceptable and what must not be touched as a result.
- Nothing in Phase 05 is implemented. The plan is a plan.
- G-11..G-15 remain open. **G-14 in particular must be dealt with before or during 5.7**, which
  would otherwise copy the same split-transaction shape.

**Next:** task 5.0 (password policy), then 5.1 (file uploads). Get OQ-18 answered before 5.3.

## 2026-07-30 (later) — Phase 06: notifications, filter rework, green suite

Continuation of the entry below. Everything the previous entry listed as a landmine is now closed.

**Did:**
- **Suite is green: 17 files, 286 integration tests**, plus unit and web. `typecheck` and `lint`
  clean. Migrations 0011, 0012 and 0013 all applied *and* rollback-verified.
- **Reworked the audit filters to what the user actually wanted** — user, date range, and
  approved/rejected approvals. The previous cut filtered by entity type, which nobody asked for.
  To make "approved / rejected" an indexed filter rather than a scan of the metadata blob, the
  single `requisition.decide` audit action was split into `requisition.approve` and
  `requisition.reject`, matching the borrowing actions that were already separate. The user
  filter is a picker over real users (inactive included — they still own historical rows), not a
  typed name.
- **Built the notification system** (closes **G-06**, which had recorded that reminders and
  approve/reject notices existed only as server log lines):
  - `0013_notifications` — one row per recipient; the rendered title is stored so history keeps
    saying what the user was told; *not* append-only, unlike `audit_log`, because `read_at` is
    the point. Two indexes: `(user_id, created_at DESC)` for the list, and a **partial** index on
    unread for the badge, which every signed-in client polls.
  - `NotificationsService.notify(input, tx)` writes inside the caller's transaction, so a
    notification cannot survive a rollback or go missing after a commit. It deduplicates
    recipients and **drops the actor** — nobody is told about their own action.
  - Wired into every state change that has an audience: requisition submit / IM-approve /
    approve / reject / withdraw / cancel, borrow request / approve / reject / revert / cancel /
    return, BOM generated / bounced / voided, delegation granted / revoked, password reset and
    role change. The approval deadline job now sends a real notification instead of a log line.
  - Copy lives in one file, `notifications.copy.ts`, with severity next to each sentence.
  - Bell in the app header with an unread badge, 30s poll, `refetchIntervalInBackground: false`.
    The list only fetches when the panel is open, so an idle tab costs one small count query.
- **10 notification integration tests**, covering the parts that actually break: fan-out to the
  right role, the actor being excluded, one user never seeing or marking another's notifications,
  and re-marking not moving the read timestamp.
- **Added the missing X-Forwarded-For regression test.** The SQLi and BOM-authz regressions were
  already written in the previous session.
- **Measured the load** the user asked about — see the numbers in `PROGRESS.md`. 4 virtual users
  × 7 concurrent operations = 28 in-flight against a pool of 10, 700 requests, zero failures,
  p95 405ms. Roughly ten times the real peak, comfortably.

**Decisions:** notification copy on the server rather than in `i18n/en.ts`, and why; notifications
written in-transaction; the actor excluded from their own fan-out; the actor's display name
resolved centrally in `NotificationsService` because the JWT deliberately carries no name. All in
`DECISIONS.md`.

**Landmines:**
- The notification fan-out — *who* gets told about *what* — was inferred from the domain, not
  specified anywhere. It is recorded as **OQ-16**. If it is wrong, it is wrong in one file
  (`notifications.copy.ts`) plus the `notify` call sites, not spread through the services.
- **G-11 through G-15 are still open and untouched** — the sanitiser's redaction gaps, the PDF
  error leaking its reason discriminator, the unbounded `page`, and the two borrowing
  status-vs-stock split-transaction bugs. G-14 in particular should be picked up with 6.2, since
  the invariant job is the thing that would otherwise catch a stranded `reserved_qty` and does not.
- There is no "see all notifications" page yet — only the bell panel, which shows the most recent
  page. The i18n key `viewAll` exists and is unused.

**Next:** task 6.2, the nightly invariant job — and extend it to `reserved_qty`, per G-14.

## 2026-07-30 — Phase 06 (audit hardening) + cross-cutting concurrency fixes

Session brief was not a phase: "find any critical bug, make it stable for 2–3 concurrent users,
no data loss ever", plus the four open audit-log tasks. So this entry spans phases.

**Did:**
- **Fixed the reported `Cannot GET /api/v1/admin/audit-log`.** Two causes, neither in the routing
  code: migration `0011_audit_log` had never been applied to the dev database, and the API process
  serving :3000 had been started at 21:07 from a build that predated the audit module entirely.
  Applied 0011, rebuilt, restarted; the route now returns 200 with rows, verified with a real
  admin login. The "Something went wrong" the user also saw was a *different* bug — login itself
  was returning 500 (see below).
- **Fixed a CRITICAL SQL injection in `audit.repository.ts`.** The insert used
  `sql.lit(JSON.stringify(metadata))`. Kysely's `sql.lit` does not escape — it emits
  `'` + value + `'` verbatim, and `JSON.stringify` escapes `"` and `\` but never `'`. Verified by
  compiling the real statement: `VALUES ($1, '{"note":"it's fine"}'::jsonb)`. Every authenticated
  user could reach it through any audited free-text field (an approval `note`, a borrow
  `conditionNote`, a void `reason`), and because an audit failure inside a transaction rolls the
  mutation back, it was *also* a guaranteed 500 the first time anyone typed an apostrophe.
  Replaced with bound parameters + `::jsonb` cast.
- **Fixed client-controlled `X-Forwarded-For` reaching an `inet` column** (`audit-context.ts`).
  The code read the raw header and took the *leftmost* entry, defeating Express's `trust proxy: 1`,
  and Caddy appends — so the leftmost value was always attacker-supplied. `X-Forwarded-For: x`
  produced pg 22P02 and rolled back every audited mutation in the system. Now uses `req.ip` and
  validates before writing; anything unrecognised is stored as NULL, never handed to pg.
- **Closed an authorization hole on the BOM read endpoints.** `GET /boms`, `GET /boms/:id` and
  `GET /boms/:id/pdf-url` had no `@Roles` and no service-side check (`signDownloadUrl` even named
  the parameter `_actorId`), so any General user could read every BOM — vendor names, unit costs,
  approver footprints across all departments — and mint a signed PDF URL. Added
  `@Roles(INVENTORY_MANAGER, ADMIN)` to all three.
- **Decoupled authentication from the audit table.** `auth.login.success` used the fail-closed
  `audit.record`, *after* the session had been issued and `last_login` stamped — so an audit-write
  problem returned 500 on a login that had already succeeded, and nobody could sign in at all.
  Added `AuditService.recordCommitted` for audits whose mutation is already committed and cannot
  be rolled back; login and self-service password change now use it.
- **Made the three genuinely-non-transactional audit sites atomic instead of fail-open.**
  `settings.update` and `delegations.create`/`revoke` now wrap the write and its audit row in one
  transaction (settings cache is invalidated *after* commit). Everywhere else in the codebase
  already passed `tx` correctly — this was not a systemic problem, only these five call sites.
- **Fixed the requisition approval races.** `claimApproval` ran on the pool and auto-committed
  *before* the caller's transaction opened, so a later failure left an approval marked decided
  against a requisition whose status, event log and audit row never happened — unrecoverable,
  because `expectedActions` no longer matched. Added `lockRequisition` (`SELECT … FOR UPDATE`) as
  the first statement of both `decide` and `withdraw`, moved the claim inside the transaction.
  This also closes the two-approvers-at-once double-`FULLY_APPROVED` and the
  withdrawal-silently-reinstated-as-APPROVED interleavings.
- **Found and fixed a bug the audit missed: rejections and IM approvals were never audited.**
  Both branches of `decide` returned early, before the audit call at the end of the method. Task
  6.1's acceptance criterion is "every state-changing action appears". Hoisted the audit row into
  a `recordDecision()` closure that every branch calls before returning.
- **Fixed the CRITICAL BOM/withdrawal race.** `loadAndValidateSources` checked `status = APPROVED`
  on a pooled connection outside the transaction, and the write was an unconditional
  `UPDATE requisitions SET status = 'BOM_GENERATED'`. An approver withdrawing in that window was
  erased, and the frozen snapshot carried a retracted signature onto a PDF bound for Accounts.
  Now locks all source requisitions `FOR UPDATE ORDER BY id` inside the transaction, re-asserts
  APPROVED, and predicates the UPDATE on it. Also passed `tx` into `freezeFootprints` (it was
  reading the snapshot on a second pooled connection, outside the transaction's own snapshot) and
  into `setPdfPath`, and added `.forUpdate()` to the `is_void` guard in `void`.
- **Fixed permanent phantom stock on borrow revert.** `revertToPending` called
  `stock.receive()` then `stock.reserve()` — two transactions. In the gap the units were free; a
  competing borrow could take them, `reserve` then failed, and the committed receipt left units on
  the shelf in the ledger that were still on someone's desk. Reconciliation cannot see this because
  `SUM(ledger)` and `quantity` still agree. Added `StockService.receiveAndHold` — one transaction,
  one lock, one RECEIPT row, quantity and reserved_qty moving together so availability never
  changes.
- **Added idempotency to `POST /stock/receive` and `/stock/adjust`.** They were the only two
  mutating endpoints with no natural double-apply guard (`move` has `expectedVersion`, borrow
  decisions are conditional on status). A double-clicked "Receive 50" received 100, invisibly.
- **Atomic PDF writes** — `pdf-renderer.store` now writes to a temp file and `rename`s, so a
  concurrent `GET /boms/:id/pdf` cannot read a truncated document. Idempotency keys are scoped per
  user, so an IM and an Admin really can render the same BOM simultaneously.
- **Task: audit filters restricted to three fields** — actor, entity, date range — which is what
  `plan/PHASE-06-hardening.md` 6.1 actually specifies. Dropped `action`, `entityId`, `outcome`,
  `ip` and free-text `search` from the contract, repository and admin page.
- **Task: admin-configurable audit actions** — new `AUDIT_ENABLED_ACTIONS` setting; `AuditService`
  skips actions not in the set, with an always-on core that cannot be switched off.
- **Task: time-based audit purge** — new `AUDIT_RETENTION_DAYS` setting wired into `RetentionJob`,
  plus migration `0012_audit_retention` to give the purge a controlled path through the
  append-only trigger.

**Decisions:** all added to `DECISIONS.md` — the post-commit audit rule, the always-on audit
actions, purge defaulting to disabled, and the purge escape hatch in the append-only trigger.

**Landmines — read these before you touch anything:**
- **The test suite is NOT green and I did not get it green.** Last `test:int` run had **5
  failures**. At least two are understood: (a) my new "metadata containing a single quote" test
  posted to `/admin/departments`, but the real route is `/departments` (the test client adds the
  `/api/v1` prefix itself) — **this one is now fixed, but the fix has not been run**; (b) an
  existing audit test filters
  by `action`, which no longer exists now that filters are restricted to three fields — that test
  needs rewriting, not the code reverting. **The other three failures I never diagnosed.** Do not
  assume they are all my edits; diagnose each.
- **Migration `0012_audit_retention` is written but NEVER APPLIED and NEVER ROLLBACK-VERIFIED.**
  Docker Desktop stopped itself mid-session (the usual landmine) and I did not restart it. Nothing
  that depends on 0012 — the whole purge path — has been executed even once.
- **Nothing is committed.** The working tree carries this entire session plus the previously
  uncommitted Phase 04.2+ BOM module and Phase 06 audit module. `git status` is ~84 files.
- `apps/api/test_audit5.mjs` was an untracked scratch file with a hardcoded test-DB password.
  Already deleted — noted only so nobody goes looking for it.
- The security review also raised, and I did **not** fix: the audit sanitiser's redaction is an
  exact-name key allowlist plus whole-string-anchored JWT regexes, so a token embedded in prose or
  a key named `tempPassword`/`tokenHash` passes through unredacted; `PdfDownloadTokenInvalidError`
  leaks its `reason` discriminator to the caller; and `page` has no upper bound so the offset is
  unbounded. Written up in `OPEN-QUESTIONS.md` as G-11, G-12, G-13.
- The concurrency audit also flagged, and I did **not** fix: `borrowing.decide`/`cancel` flip
  status in one transaction and move stock in another (a crash between them strands a reservation
  that reconciliation cannot see, because it only checks `SUM(ledger) = quantity` and never
  `reserved_qty`); and `rollbackReturn` is an unconditional subtraction against a stale read.
  G-14 and G-15.
- I never got to the **load calculation** the user asked for. Pool max is 10
  (`POSTGRES_POOL_MAX`), `statement_timeout` 60s. BOM generation used to hold two pool connections
  at once — that is fixed — but no measurement was taken.

**Next:** start Docker Desktop, `pnpm db:migrate`, then `pnpm db:rollback && pnpm db:migrate` to
rollback-verify 0012. Then run `pnpm --filter @ims/api test:int > /tmp/int.log 2>&1` and work the
5 failures one at a time.

---

## 2026-07-29 — Phase 03 (Requisitions) — complete

**Did:** the remaining five tasks, so Phase 03 is done end to end. The requisition form (3.2)
with the two zones requirements §3 scopes and a catalogue combobox that never blocks a free-text
item; the live tracker (3.6) read from the approval rows and the event log; the approver portal
and IM lists (3.7, 3.8) as one screen with a mode; and the deadline reminder job (3.9) with a
`last_reminded_at` column added by migration 0009.

277 tests green (36 API unit, 219 API integration, 22 web). Typecheck, lint and the
no-hardcoding guard clean. The whole chain was then driven against the running dev stack:
20,000 BDT → two approvers → IM first → approvers in parallel → approved with a revised amount
→ withdrawn → re-approved; 5,000 BDT → one approver; a single rejection killing a request while
the other approver is never asked.

**Decisions:** the approver badge polls once a minute rather than waiting for the websocket —
the transport is not the point of the acceptance criterion, a count that moves without a reload
is. The deadline job runs every ten minutes and repeats every 24 hours per approval, which is
what `last_reminded_at` is for; without it the job would re-send on every tick and train people
to ignore it. It also only chases the stage that can actually act, so an approver is never told
to do something the IM has not released yet.

**Landmines:**
- **Notifications are logs, not notifications.** The deadline job writes a warning line. There
  is no in-app notification table, no bell, and no websocket — OQ-10 says there is no SMTP
  relay, and the delivery mechanism was never built. Task 3.9's acceptance criterion (a
  deadline passing while nobody is logged in still produces the reminder) is met and tested,
  but a human only sees it in the server log. This is the largest gap in the phase.
- Two dev-environment traps cost time this session and are now written into PROGRESS.md: a
  smoke script that logs in repeatedly trips the 10/minute login throttle and then fails with a
  confusing 401, and settings changed by hand in the dev database persist between runs (a stale
  25,000 threshold made a correct "two approvers" assertion fail).
- The requisition form holds the catalogue in memory (200 products) and filters client-side.
  Fine at this scale, wrong at ten thousand — it should become a server-side search first.

**Next:** Phase 04 — BOM generation. Task 4.1. OQ-11 (the letterhead asset and exact print
margins) and OQ-05 (whether a BOM more than 10% over the approved amount bounces back) both
land in this phase; both have recorded assumptions, so neither hard-blocks a start.

## 2026-07-29 — Phase 03 (Requisitions) — backend slice only

**Did:** the approval engine, end to end on the server. Migration `0008_requisitions` adds
`requisitions`, `requisition_items`, `requisition_approvals`, `requisition_events` (append-only
by trigger) and `delegations`. `RequisitionsService` implements submit (task 3.3), the approval
chain (3.4) and delegation (3.5); `ProjectsService`/`DelegationsService` alongside it.
28 new integration tests, 212 integration + 36 unit + 16 web all green. Typecheck, lint and the
no-hardcoding guard clean.

The rules that are now enforced and tested: the IM acts first and gates the approvers; approvers
act in parallel in any order; **any single rejection is terminal**; an approver may withdraw
until BOM generation and may then re-approve; `requested_amount`, `threshold_at_submit` and
`required_approver_count` are frozen at submit so a later settings change cannot reshuffle an
in-flight request (the test the plan singles out).

**Decisions:** OQ-01 and OQ-02 were answered by the user — one approver below the threshold,
per-department override on top of a company-wide default. Both matched what was already built,
so no rework. A withdrawn approval is decidable again (`expectedActions: [PENDING, WITHDRAWN]`),
because withdrawing exists precisely so the approver can think again; the row carries its latest
state and the event log carries the history. `requisition_events.actor_id` is `ON DELETE
RESTRICT`, not `SET NULL` — a SET NULL is an UPDATE, which the append-only trigger refuses, and
"who did this" must keep resolving anyway.

**Landmines — read this before continuing:**
- **Phase 03 is half done.** Tasks 3.1, 3.3, 3.4, 3.5 are ticked. **3.2 (requisition form),
  3.6 (live tracker), 3.7 (approver portal), 3.8 (IM screens) and 3.9 (deadline job +
  notifications) are NOT built.** There is no requisition UI at all yet — the backend is
  reachable only by HTTP.
- The API was **not** re-run against the dev database after the Phase 03 work; only the test
  database (5434) has exercised it. Rebuild and smoke it before trusting the dev stack.
- `resetData` in `test/factories.ts` can no longer delete users referenced by requisitions or
  the stock ledger (both are append-only downstream). Those rows accumulate across the suite.
  One test already broke on this — `users.int-spec.ts` "excludes deactivated users" now scopes
  itself by a unique designation instead of reading page one. Any new test that asserts against
  an unfiltered list will hit the same thing.
- Docker Desktop stopped itself twice during this session. Check `docker info` before any test
  or migration run.

**Next:** build task 3.2, the requisition form — two zones per requirements §3 (per-request
header: department, project, urgency, approval deadline, reason; per-line items: name, quantity,
unit amount), a combobox over `/products` with a free-text escape hatch, and the green in-stock
hint that is advisory and never blocks adding a line. The contracts are already written in
`packages/shared/src/contracts/requisitions.ts` — build to `saveRequisitionSchema`. Endpoints
that exist: `POST /requisitions`, `PUT /requisitions/:id`, `POST /requisitions/:id/submit`,
`GET /requisitions`, `GET /requisitions/:id`, `POST /requisitions/approvals/:approvalId/decision`,
`.../withdraw`, `GET /requisitions/awaiting-count`.

## 2026-07-28 — Phase 00 (Foundation)

**Did:** Phase 00 end to end, all eight tasks. A working system: `pnpm db:up && pnpm db:migrate
&& pnpm db:seed && pnpm dev` gives you a login screen, and each seeded role sees only its own
navigation. Monorepo (`apps/api`, `apps/web`, `packages/shared`), config module validated at
boot, Kysely with five migrations, settings service reading `app_settings`, users with additive
roles and required designation, JWT auth with rotating refresh, admin panel for users /
departments / settings / approver slots, and the app shell with design tokens, i18n and the four
loading states. 190 tests green; typecheck, lint and the no-hardcoding guard clean. The full
production compose stack was built and brought up on this machine and serves the SPA and API
through Caddy.

**Decisions:** the long list is in `DECISIONS.md`. The ones a future session will trip over:
Kysely rather than an ORM (no `synchronize` to leave on); `packages/shared` is a dual CJS+ESM
build because Nest is CJS and Rollup cannot read tsc's `__exportStar`; integration tests
transpile with tsc because esbuild cannot emit `design:paramtypes` and Nest DI needs it;
`consistent-type-imports` is off for `apps/api/src` for the same reason — its autofix silently
breaks the DI container at boot.

**Landmines:** be blunt about these.
- The dev database is on **5433** and the test database on **5434**. 5432 and 5430 were already
  taken on this machine by unrelated stacks. If you move to another machine, the ports in
  `infra/docker-compose.dev.yml` and `.env` are the only place that matters.
- `apps/api` **must** be built with `nest`/tsc, never run through `tsx`. tsx uses esbuild, which
  drops decorator metadata, and Nest DI then fails at runtime with a confusing "cannot read
  properties of undefined". `pnpm dev` is correct; `tsx src/main.ts` is not.
- Running the production compose stack binds port **80**. It is currently stopped, not removed;
  `docker compose -f infra/docker-compose.yml stop` is the safe way to free the port. Never
  `down -v` — that is the database.
- `infra/.env` exists on this machine with real generated secrets, and is gitignored. It is not
  the same file as the repo-root `.env` used by `pnpm dev`.
- Five deferred gaps are written up as **G-01..G-05** in `OPEN-QUESTIONS.md`. G-01 (nothing
  prunes `login_attempts` or expired refresh tokens) is the one that quietly grows forever.
- The security review's own note: token *expiry* is untested, because doing it honestly needs an
  injectable clock rather than a `sleep`. Both expiry branches are unexecuted.
- nginx discards every inherited header the moment a `location` declares its own `add_header`.
  The security headers live in `apps/web/security-headers.conf` and must be `include`d in ANY
  new location block that adds a header of its own, or they silently vanish from that route.
  This already bit once: the CSP was added, committed, and served nowhere.

**Next:** `/resume`, then Phase 01 task 1.1 — the product catalogue. Before finalising the
schema, get OQ-03 (serial-level tracking for laptops?) and OQ-08 (is `consumable` a product flag
or a per-borrow choice?) answered, because both change the catalogue's shape and are cheap to
ask and expensive to migrate. Phase 01 also carries the mandatory concurrency test from
`rules/50-testing.md`: N simultaneous borrows against stock 1, exactly one wins, exactly one
ledger row.
