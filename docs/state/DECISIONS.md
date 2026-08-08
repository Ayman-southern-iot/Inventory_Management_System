# Decisions

One line per decision, newest at the bottom. Anything expensive to reverse gets an ADR in
`docs/adr/` instead, with a pointer here.

Format: `YYYY-MM-DD — <decision> — <why, in one clause>`

---

- 2026-07-28 — Modular monolith, not microservices — 12 users; service boundaries would add
  distributed-systems failure modes for no benefit.
- 2026-07-28 — Quantity-based stock with placements, not per-unit serial tracking — makes
  partial moves work and keeps product IDs stable; serial layer is dormant in the schema
  (`asset_units`) and can be switched on with a migration. Pending Q3.
- 2026-07-28 — No Redis / job queue — reminders are one cron query every 15 minutes and PDFs are
  generated ~6 times a day; a queue server is operational cost with no payoff at this scale.
- 2026-07-28 — Append-only `stock_ledger` as the source of truth, placements as a derived cache —
  makes every discrepancy diagnosable and reversible.
- 2026-07-28 — `approved_amount` stored separately from `requested_amount` — requirements §6
  compares requested vs approved vs funded, which is only meaningful if approval can revise the
  figure. Behind the `allow_amount_revision` flag. Pending Q13's original intent.
- 2026-07-28 — A BOM may span multiple requisitions — requirements §9 says "submission(s)".

## Phase 00 — Foundation

- 2026-07-28 — Kysely + hand-written SQL migrations, not an ORM — rule 3 requires `synchronize`
  off everywhere; Kysely has no such concept at all, so the illegal state is unrepresentable
  rather than merely configured off. Typed query builder still gives `SELECT ... FOR UPDATE`
  and explicit transactions, which Phase 01's stock locking needs.
- 2026-07-28 — `packages/shared` ships dual CJS + ESM builds — NestJS is CommonJS and Rollup
  cannot statically read named exports out of tsc's `__exportStar` CJS wrapper. Two tsc passes
  is cheaper than making either side bend.
- 2026-07-28 — Settings live in a typed registry (`packages/shared/src/settings/registry.ts`)
  keyed to their seed env var — the seeder and the admin UI are data-driven from it, so adding
  a business value is one entry plus one config-schema line, with nothing to keep in sync.
- 2026-07-28 — Env seeds `app_settings` on first boot only, via `ON CONFLICT DO NOTHING` —
  a restart must never reset a value an admin has since changed (requirements §11).
- 2026-07-28 — Roles in their own `user_roles` table, not an array column — makes "every active
  APPROVER" an index scan and stops two concurrent grants from losing one another.
- 2026-07-28 — Refresh tokens rotate with family-wide revocation on reuse — a replayed token
  means it leaked; killing the family logs out the attacker at the cost of logging out the
  legitimate user, which is the correct trade.
- 2026-07-28 — `refresh_tokens.revoked_reason` is recorded, not inferred (migration 0005) — a
  token killed by an admin and one killed by the theft response are otherwise identical, and
  the two must tell the user different things. Inferring it from `replaced_by_id` was tried
  first and was wrong; the integration suite caught it.
- 2026-07-28 — ~~Access tokens carry the role set and are trusted for their 15-minute life.~~
  **Superseded the same day by the security review — see below.**
- 2026-07-28 — Tokens in `localStorage`, not httpOnly cookies — the SPA needs the refresh token
  to rotate proactively, and this is a single-origin internal tool with no third-party embeds.
  Mitigated by the short access TTL and server-side reuse detection. Revisit if it ever becomes
  internet-facing.
- 2026-07-28 — `@Roles()` attaches only `RolesGuard`; `JwtAuthGuard` is global via `APP_GUARD` —
  re-attaching it per controller would force every feature module to import `JwtModule` to
  satisfy the injector.
- 2026-07-28 — `@typescript-eslint/consistent-type-imports` is off for `apps/api/src` — Nest
  resolves DI from `design:paramtypes`, which the compiler only emits for value imports, so the
  rule's autofix silently breaks the container at boot.
- 2026-07-28 — Integration tests transpile with tsc, not esbuild — esbuild cannot emit
  `design:paramtypes`, so Nest DI fails to resolve anything under vitest's default transform.
- 2026-07-28 — Approver slots modelled as `approver_slots` rows with a nullable `department_id`
  (null = company-wide default) — satisfies either answer to OQ-02 without a schema change.

## Phase 03 — Requisitions and approvals

- 2026-07-29 — OQ-01 answered: **1 approver below the threshold**, 2 at or above. Both counts
  are `app_settings` values, so the policy changes without a redeploy.
- 2026-07-29 — OQ-02 answered: **per-department override** on top of a company-wide default.
  Already modelled that way in `approver_slots`, so no migration was needed.
- 2026-07-29 — `requested_amount`, `threshold_at_submit` and `required_approver_count` are
  written once at submit and never recomputed — an admin raising the threshold next week must
  not retroactively add an approver to a request already mid-chain (requirements §11).
- 2026-07-29 — Approval rows are seeded at submit rather than resolved lazily per stage — a
  staffing change mid-flight would otherwise silently reroute an in-progress requisition.
- 2026-07-29 — `requisition_events` is append-only by trigger, like `stock_ledger`, because the
  live tracker is driven from it and must be able to show approved → withdrawn → re-approved.
  A status column can only hold the latest value.
- 2026-07-29 — `requisition_events.actor_id` is ON DELETE RESTRICT, not SET NULL — a SET NULL is
  an UPDATE, which the append-only trigger refuses, and "who did this" must resolve forever.
- 2026-07-29 — A WITHDRAWN approval is decidable again. Withdrawing exists so an approver can
  reconsider; the row carries its latest state and the event log carries the history.
- 2026-07-29 — `estimated_line_total` is a GENERATED column, never written — a line total that
  disagrees with its own inputs is how a requisition total silently drifts.
- 2026-07-29 — The requisition form saves before it submits, so the server totals the *stored*
  lines. What gets frozen is what is on the record, not whatever the browser last calculated.
- 2026-07-29 — Editing a line's text clears its `productId`. A requisition that claims a
  catalogue product whose name no longer matches is worse than an honest free-text line.
- 2026-07-29 — The tracker reads the approval rows *and* the event log. The rows give the
  current state of each node; only the log can show approved → withdrawn → re-approved, which
  is the case task 3.6 is specified against.
- 2026-07-29 — The approver badge polls every 60s rather than blocking on the websocket. The
  acceptance criterion is that the count updates without a refresh; the transport is an
  implementation detail that can be swapped later without touching the UI.
- 2026-07-29 — `requisition_approvals.last_reminded_at` (migration 0009) caps the deadline job
  at one reminder per approval per 24h. Without it the ten-minute job re-sends every tick,
  which is how a reminder becomes noise people filter out.
- 2026-07-29 — The deadline job only chases the stage that is currently actionable — telling an
  approver to act while the IM still holds the request teaches them the reminder is wrong.
- 2026-07-29 — One `RequisitionsPage` serves the requester, the approver and the IM, switched
  by a `mode` prop. The API already decides what each caller may see, so three near-identical
  screens would only be three places to fix the same bug.

## Phase 02 — Borrowing

- 2026-07-29 — Stock is reserved at **submit**, not at approval — otherwise two people are both
  promised the last unit while the IM thinks about it. The row lock in `StockService.reserve`
  is what makes the second submitter fail rather than queue.
- 2026-07-29 — Reservations are released by the *service* on any failure path (rejection,
  cancellation, or a failed insert after a successful reserve) — stock left reserved against a
  request that does not exist is invisible to everyone and impossible to diagnose.
- 2026-07-29 — Decisions and returns are claimed with a **conditional UPDATE**
  (`WHERE status = 'PENDING'`, `WHERE returned_qty = <what we read>`) rather than read-then-write
  — two IMs on a shared screen is the normal case, and zero rows updated is how the loser finds
  out instead of both issuing stock.
- 2026-07-29 — `Idempotency-Key` implemented for borrow create/decide/return, closing gap G-04.
  The unique index is the atomic part; a check-then-act version would let a double-click issue
  stock twice, which is unrecoverable.
- 2026-07-29 — `isOverdue` is computed on read, never stored — a persisted flag is wrong from
  the moment midnight passes.
- 2026-07-29 — OQ-04 implemented as the recorded assumption: an approved borrow may be reverted
  to PENDING only while nothing has been returned and it has not left. After issue the item is
  on someone's desk, and "un-approving" would put units back on the shelf that are not there.
- 2026-07-29 — OQ-09 implemented as name-only projects with a duplicate-name *warning*, not a
  unique constraint — two teams may legitimately run a "Falcon", so the user is told and may
  proceed deliberately.
- 2026-07-29 — Browsing the catalogue is open to every authenticated user; only stock mutation
  and the all-borrows log are IM-gated. A general user must find a product before they can
  borrow it (task 2.7).

## Phase 01 — Inventory core

- 2026-07-29 — Ledger `quantity` is always positive; direction comes from `from_compartment_id`
  / `to_compartment_id` — a MOVE is then net-zero for the product and net-correct per
  compartment, so reconciliation is one query instead of a per-movement-type case analysis
  that someone eventually gets wrong.
- 2026-07-29 — The ledger is append-only by **trigger**, not only by `REVOKE` — the reference
  doc specifies revoking UPDATE/DELETE from the app role, but the application connects as the
  database owner in compose and in dev, and an owner bypasses its own grants. The trigger fails
  loudly for every role including superuser. UPDATE, DELETE and TRUNCATE are all verified.
- 2026-07-29 — Reconciliation is checked per (product, compartment), not per product — a
  per-product check passes while two compartments are individually wrong in opposite
  directions, which is exactly what a bad MOVE leaves behind.
- 2026-07-29 — `move()` creates both placement rows first, then locks them one at a time in
  ascending id order — the mandatory concurrency test proved that locking source-then-
  destination deadlocks when A→B races B→A. A single `ORDER BY id ... FOR UPDATE` is not
  sufficient, because the planner may lock in scan order before applying the sort.
- 2026-07-29 — `reserve` and `release` write no ledger row — a reservation changes availability,
  not the physical shelf, and the ledger records physical reality. Putting them in the ledger
  would break reconciliation.
- 2026-07-29 — Zone chip colour is a pure function of the zone id (FNV-1a into a fixed ring of
  six tokens) — the IM reads the product card by shape before they read it by text, which only
  works if a zone keeps its colour across reloads and machines. A collision is cosmetic; an
  unstable colour is a lie about the data.
- 2026-07-29 — `@nestjs/schedule` in-process rather than a queue service — the nightly
  reconciliation and the retention job are one indexed query each. This also closed gap G-01.
- 2026-07-29 — The test reset deliberately does NOT delete stock rows, and skips users
  referenced by the ledger — `performed_by` is ON DELETE RESTRICT because "who moved this" must
  keep resolving forever. Wiping placements while the append-only ledger survives manufactures
  a discrepancy that cannot occur in production and makes the invariant test lie.

### After the Phase 00 security review

The review found no CRITICAL and no HIGH, which is task 0.6's acceptance criterion. These are
the MEDIUM and LOW findings that were worth acting on rather than carrying forward.

- 2026-07-28 — `JwtAuthGuard` re-validates the session against the database on every request,
  **superseding the stateless-JWT decision above** — one indexed lookup closes deactivation,
  logout, role change and forced password rotation at once, rather than leaving a 15-minute
  window in which a deactivated admin keeps admin access. At 12 users the query cost is noise.
- 2026-07-28 — `must_change_password` is enforced by the API, not only by the SPA — otherwise
  the temporary password an admin sends over chat stays valid forever for anyone willing to
  skip the UI. Exactly three routes are exempt, via `@AllowPendingPasswordChange()`.
- 2026-07-28 — A refresh family keeps its original expiry through every rotation — a sliding
  expiry let a stolen family be rotated indefinitely, so the absolute lifetime never applied.
- 2026-07-28 — The multi-tab refresh race is fixed in the browser with `navigator.locks`, not
  with a server-side grace window. A grace window was written first and reverted: it made reuse
  detection tolerant of exactly the replay it exists to catch, in order to paper over a client
  defect. The client was the thing that was wrong.
- 2026-07-28 — Login throttling counts email and IP separately instead of OR-ing them, and the
  per-account limit is only reported to a caller who already failed the password check — the OR
  let anyone who knew a colleague's address lock that colleague out of their own account, which
  is the exact outcome the code's own comment claimed to avoid.
- 2026-07-28 — Changing your own password ends every *other* session and returns a fresh one —
  revoking the caller's own session mid-flow signed them out the instant they set a new
  password, which reads as a failure.
- 2026-07-28 — CSP is served by nginx on the SPA — the compensating control for holding tokens
  in localStorage, which `helmet()` on the API does not cover because it never sees the HTML.
- 2026-07-28 — The last-admin check runs inside its transaction holding a lock on the ADMIN role
  rows — outside it, two admins demoting each other simultaneously could both pass and leave
  the system with none.
- 2026-07-28 — Production source maps are off — nothing consumes them until Phase 06 adds
  monitoring, so they were 1.5 MB of readable source shipped to every browser for no reader.
- 2026-07-30 — Audit writes whose mutation is already committed are best-effort
  (`AuditService.recordCommitted`), not fail-closed — `record` rethrows so the caller's open
  transaction rolls back, but past the commit there is nothing to roll back, so rethrowing only
  reports a completed action as a 500 and invites a retry of something that already happened.
  On the login path it made authentication unavailable whenever `audit_log` was. Applies to
  exactly two call sites (`auth.login.success`, `auth.password.change`); everything else either
  passes `tx` or was rewritten to.
- 2026-07-30 — `settings.update` and `delegations.create`/`revoke` were wrapped in a transaction
  rather than switched to best-effort — they are single-row writes with nothing external in the
  way, so atomicity was available for free and keeps the fail-closed guarantee.
- 2026-07-30 — Never `sql.lit()` in this codebase. It performs no escaping whatsoever (it emits
  `'` + value + `'`); use a bound parameter with an explicit `::jsonb` cast when a jsonb column
  needs one. Noted here because the original code carried a comment justifying `sql.lit`, and the
  next person will otherwise reintroduce it for the same stated reason.
- 2026-07-30 — Audit filters are actor, entity and date range only, matching PHASE-06 6.1. The
  dropped filters (`action`, `entityId`, `outcome`, `ip`, free-text `search`) each cost an index —
  including a GIN index — on a table written on *every* mutation, to serve combinations a
  twelve-person tool does not reach for. Reversible: re-add the filter and its index together.
- 2026-07-30 — Some audit actions are always-on and cannot be disabled by an admin
  (`AUDIT_ALWAYS_ON_ACTIONS`, enforced in `SettingsService`, not in the registry schema) — an
  admin able to switch off `auth.*` or `user.*` recording could erase their own tracks, which
  defeats the point of the feature. OQ-14 records that this list was chosen, not specified.
- 2026-07-30 — The audit purge ships **disabled by default** (`AUDIT_RETENTION_DAYS` = keep
  forever) and must be opted into by an admin — the standing requirement is that no data is lost
  in any case, so deleting history is never the default behaviour of an upgrade. The retention
  setting is an explicit preset list (`AUDIT_RETENTION_PRESETS`: 5/10/15 days, 1/3/6 months,
  1/3/5/10 years, Forever) so the persisted day count always matches a label and a hand-typed
  value cannot silently change retention behaviour.
- 2026-07-30 — The `audit_log` append-only trigger keeps rejecting UPDATE and TRUNCATE for every
  role including the owner, but permits DELETE only inside a transaction that has set the
  `ims.audit_purge` flag — the retention job is the one legitimate deleter, and a session flag
  keeps ordinary application code unable to delete even by accident. The purge writes its own
  `audit.purge` row recording the cutoff and the number of rows removed.
- 2026-07-30 — Audit filters are user, date range and approval decision (not entity type) — that
  is what the operator asked for; entity type was an invention of the first cut.
- 2026-07-30 — `requisition.decide` split into `requisition.approve` / `requisition.reject` —
  "approved approvals / rejected approvals" has to be an `action IN (...)` against
  `audit_log_action_idx`; filtering a decision field inside the jsonb metadata cannot use an index.
  It also makes requisitions consistent with borrowing, which already had two actions.
- 2026-07-30 — Notification copy lives in `notifications.copy.ts` on the server, not in
  `apps/web/src/i18n/en.ts` — the title is rendered when the event happens and stored on the row,
  so history keeps saying what the user was actually told after a rename or a copy change. The
  rule's real requirement (wording changes are one file) is preserved; it is just a different file.
- 2026-07-30 — Notifications are written inside the caller's transaction — a notification that
  survives a rolled-back approval is a lie, and one lost after a commit means the approver is
  never told, which is the failure the whole feature exists to prevent. Jobs with no transaction
  use `notifyBestEffort`, which logs and continues so one bad row cannot stop a batch.
- 2026-07-30 — The actor never receives their own notification — being told about the thing you
  just did is noise, and noise is how a badge gets ignored.
- 2026-07-30 — The actor's display name is resolved inside `NotificationsService`, not at each
  call site — the access token carries id, email and roles but no name, so every controller's
  `context.actorName` is null. One lookup in one place is what makes the copy say "approved by
  Rana"; it runs only once there is a recipient.
- 2026-07-30 — Notifications poll every 30s with `refetchIntervalInBackground: false`, and the
  list only loads when the bell is open — with no websocket (ruled out at this scale) the interval
  *is* the system's latency, and the background flag is what stops tabs left open overnight
  polling until morning.
- 2026-07-30 — Sub-threshold approval failures raise their own error naming
  `SUBTHRESHOLD_APPROVER_USER_ID` — the shared "Approver N is not assigned" message sent admins to
  the approver-slots screen, which below the threshold is not the setting in use at all.
- 2026-07-30 — Notification target routes live in `notifications.links.ts`, mirroring the web
  router — the SPA ends in a catch-all redirect, so a link to a route that does not exist fails
  silently by landing on the dashboard. One file plus a test is what makes that failure loud.
- 2026-07-30 — Phase 05 replanned to the operator's specification; lump-sum allocation across a
  batched BOM dropped as unrequested complexity (OQ-21), and `fund_returns` modelled as its own
  table rather than negative receipts so "received" and "returned" never have to be disentangled
  from a signed column.
- 2026-07-30 — BOM "Remaining" = Total Requested − Approved (OQ-18, answered by the operator).
  Note it is a property of the approval decision alone, not of spending, so it is fixed once the
  chain completes and never moves as money is drawn down.
- 2026-07-30 — The BOM document prints one header block per source requisition rather than
  comma-joining requesters/departments/projects across a batched BOM. Collapsing them is what
  made the first draft unreadable, and Accounts needs to see whose spend each figure is.
- 2026-07-30 — Company name, address and logo path are config (`COMPANY_*`), not literals in the
  template — another deployment is another company, and an office move should not be a release.
- 2026-07-30 — Signature images are resolved server-side from the approval snapshot's file id and
  inlined into the PDF; the id, never the image, travels in `BomDetail`. Keeps signature bytes out
  of ordinary API responses while still freezing what a printed document shows.
- 2026-07-30 — Image MIME type is sniffed from magic bytes, not the file extension. The supplied
  logo was named `.png` and was a JPEG; trusting the extension would have emitted a data URI that
  some renderers accept and others silently drop.
- 2026-07-30 — Funding is derived from `SUM(fund_receipts)` on every read, never stored as a
  running total. A cached balance is a number that can silently disagree with the rows that
  justify it, and money that contradicts its own audit trail is worse than money that is slow to
  add up. The partial/full status follows from the sum, not from which endpoint was called.
- 2026-07-30 — Recording funding beyond the approved amount is refused (409), not clamped.
  Accounts releasing an unexpected amount is a real event wanting a human decision; accepting it
  quietly would make the approved figure meaningless and the expense report wrong.
- 2026-07-30 — Money inputs are rejected past two decimal places rather than rounded. The columns
  are `numeric(14,2)`, so a third decimal would be silently rounded by Postgres — exactly the
  class of bug nobody notices until reconciliation.
- 2026-07-30 — Sums are computed in Postgres, not JavaScript. `numeric` addition is exact; adding
  parsed floats would reintroduce the drift the NUMERIC columns exist to prevent.
- 2026-07-30 — The requester is notified when funding *completes*, not on each instalment, and the
  IM is never notified of their own recording. Instalment noise is how a badge gets ignored.
- 2026-07-30 — The invoice hangs off `purchases`, not the requisition. One requisition bought
  across three vendors has three invoices on three days; a single `requisitions.invoice_file_id`
  would have forced the IM to choose one to keep.
- 2026-07-30 — Invoice upload is a separate call from verification, for the same reason: the IM
  must be able to file the first invoice before the last one arrives.
- 2026-07-30 — `fund_returns` is its own table rather than a negative `fund_receipts` row.
  "Accounts released X" and "Y came back" are different questions and the expense report answers
  both; one signed column would make every future SUM a judgement call about which rows to include.
- 2026-07-30 — A return is capped at `funded − spent − alreadyReturned` and requires a note, both
  enforced in the service *and* by database constraints. Money handed back with no stated reason
  is precisely the gap this step exists to close.
- 2026-07-30 — Invoices are streamed to authorised callers rather than served by signed URL, unlike
  the BOM PDF. The BOM leaves the building; an invoice never does, so a shareable link would be
  capability with no purpose. Permitted: IM, Admin, the requester, and that requisition's approvers.
- 2026-07-30 — `StockService.receive` gained an optional transaction parameter so a caller can
  make the stock movement and its own status change atomic. StockService remains the only writer
  (ADR-0001) — callers hand in a transaction, never SQL. This is the shape G-14 should be fixed
  into; 5.6 was built that way from the start rather than reproducing the bug.
- 2026-07-30 — Receiving into stock is all-or-nothing across every line in the request, including
  any catalogue products created for free-text lines. A half-applied delivery would leave stock on
  the shelf that the requisition does not account for, and the nightly reconciliation cannot see
  that class of drift because the ledger and the placements would still agree with each other.
- 2026-07-30 — A free-text requisition line becomes a real catalogue product the first time
  anything is received against it, and the requisition item is repointed at it. That is what makes
  an item that entered as typed text indistinguishable afterwards from one the IM catalogued.
- 2026-07-30 — `received_quantity` is a counter on the purchase line, not a boolean, and is capped
  at the purchased quantity by a CHECK. Part-deliveries are normal; receiving more than was bought
  is not a partial state but a mistake, and the database is the right place to refuse it.
- 2026-07-30 — `StockService.issue` and `receiveAndHold` gained the same optional-transaction
  parameter as `receive`, so borrow-to-user is atomic end to end. This is the shape G-14 should be
  fixed into; the three stock entry points a caller needs now all support it.
- 2026-07-30 — Borrow-to-user still moves the units through a compartment: `receiveAndHold` then
  `issue`, so the ledger records a RECEIPT and an ISSUE exactly as an ordinary borrow does. It
  would have been shorter to write the borrow row straight as ISSUED, and it would have left the
  ledger unable to explain where the item came from.
- 2026-07-30 — `issueOnBehalf` takes `requesterId` and `actorId` as separate parameters: the borrow
  row records whose item it is, the audit row records who handed it over. Collapsing them is how
  "issued on behalf of" quietly becomes "issued to myself".
- 2026-07-30 — Issuing to a deactivated user is refused: it would create a borrow nobody can
  return, and an outstanding item nobody is accountable for.
- 2026-07-31 — The expense report is one SQL query with the per-requisition money pre-aggregated in
  scalar subqueries. Joining `requisitions` to `fund_receipts`, `purchases` and `fund_returns` at
  once multiplies the rows and inflates every figure by the size of the other two tables. That
  fan-out is silent — the report looks plausible and is simply wrong — so there is a test with two
  receipts, two purchases and a return on one requisition that would fail if anyone "simplified"
  the query into joins.
- 2026-07-31 — Report date ranges are calendar days in `REPORTING_TIME_ZONE` (default Asia/Dhaka),
  resolved to instants by Postgres via `AT TIME ZONE`. Coercing them to `Date` in JavaScript
  anchored both ends to UTC midnight, so a requisition submitted at 3am Dhaka on the 31st — 9pm
  UTC on the 30th — fell outside a range that plainly contained it.
- 2026-07-31 — Report totals are summed from the buckets already on screen, not by a second SQL
  aggregate. A separate query is a second chance to disagree with the rows the reader is looking
  at, which is what makes a report untrustworthy.
- 2026-07-31 — `GROUP BY 1` positionally rather than repeating the group expression. Interpolating
  the same Kysely `sql` fragment twice re-emits its bound parameters with different placeholder
  numbers, so Postgres reads the two as different expressions and rejects the query.
- 2026-07-31 — The permissions spec no longer asserts that its own department appears in the
  departments list. `resetData` cannot delete departments that requisitions reference, so the test
  database accumulates them and the row eventually falls off page one. The spec's subject is the
  permission boundary; ownership of the list's contents belongs to the departments spec.
- 2026-07-31 — The nightly job now checks a second invariant: `stock_placements.reserved_qty` must
  equal the total quantity of PENDING borrows for that product and compartment. `reserved_qty`
  never appears in the ledger, so the original `SUM(ledger) = quantity` check balanced perfectly
  while units sat reserved against a borrow that had been rejected minutes earlier. That blind
  spot was G-14, and it reaches a human as "the shelf has six but the system will only lend four".
- 2026-07-31 — G-14/G-15 fixed at the source, not just detected: `borrowing.decide`, `cancel` and
  `recordReturn` now do their stock movement inside the same transaction as the status change.
  `StockService.issue`, `release`, `returnStock`, `receive` and `receiveAndHold` all take an
  optional transaction, so there is no window to fall into and nothing to compensate.
- 2026-07-31 — `BorrowingRepository.rollbackReturn` deleted rather than left unused. It performed
  an unconditional `returned_qty - quantity` with a status captured before the claim; a second
  partial return landing in between made it subtract from the newer total and stamp the older
  status back. A hand-rolled compensation is the bug, so leaving it available invites its return.
- 2026-07-31 — The backup script now verifies the archive it just wrote before pruning anything.
  `pg_dump` exiting 0 only means it finished writing; a truncated file or a full disk still exits 0
  and leaves a useless artefact nobody finds until a restore. The check reads the dump back with
  `pg_restore --list`, and both branches were tested — a good dump passes, a truncated one fails.
  Note `pg_restore --list /dev/stdin` rejects *good* archives, so the dump is copied into the
  container and read from a real path; the tidier-looking form would have failed every backup.
- 2026-07-31 — The restore drill is written up in `docs/state/BACKUP-DRILL.md` with measured times
  (4.2s end to end at 11 MB) rather than estimates, and with an explicit list of what it did *not*
  prove. The largest remaining risk is recorded as G-16: backups still live on the same VM as the
  database, because choosing where they go offsite is the operator's decision, not mine.
- 2026-07-31 — The monitoring floor checks four things: database, disk headroom, whether the
  storage directory is genuinely writable, and how old the newest backup is. The last three are
  the point — none of them raises an error on its own. A full disk surfaces as an unrelated 500,
  a read-only volume fails only uploads, and a backup job that stopped looks exactly like a
  healthy system until someone needs a restore.
- 2026-07-31 — The storage check writes and deletes a real file rather than calling `access()`.
  A full or read-only-remounted volume passes a permission check and still fails every upload.
- 2026-07-31 — Disk headroom is measured from blocks available *to this user*, not total free.
  Most filesystems reserve a few percent for root, so a naive used/total figure reads comfortable
  while the process can no longer write.
- 2026-07-31 — Monitoring alerts fire on the **transition** into failure, not every sweep.
  Re-notifying hourly that the disk is still 84% full is how a badge becomes wallpaper and the
  next real alert goes unread with it. Delivery is in-app only (OQ-10, no SMTP), which is a real
  limitation: an admin who never signs in never sees it. The log line is written regardless.
- 2026-07-31 — Disk and backup detail sit behind an admin-only endpoint, not on public `/health`.
  Free space and backup timing tell an attacker when the host is under pressure and whether anyone
  is watching; the compose healthcheck needs one bit and already has it.
- 2026-07-31 — The BOM list resolves its source requisition numbers with one grouped query for
  the page, not one per row. Found by logging every statement the database ran and counting the
  queries per list request rather than by reading code — it was the only endpoint with a repeated
  query shape. Every other list endpoint is 2-3 flat queries.
- 2026-07-31 — Five endpoints deliberately stay unpaginated (`categories`, `locations`,
  `admin/settings`, `borrowing/projects`, `boms/candidates`). Three are reference data bounded by
  admin action, and paginating them would break the tree and the dropdowns that consume them. The
  two that grow with usage are small at twelve users. Recorded as G-19 rather than hidden.
- 2026-07-31 — **Self-approval is now prevented at submit and at decide** (requirements §10,
  OQ-07). It was specified, marked resolved, and never implemented: the Inventory Manager raising
  a requisition was assigned their own IM approval and could clear it on the happy path. The
  requester is excluded when the chain is resolved, and `decide` refuses independently so the rule
  is an invariant rather than a property of one code path.
- 2026-07-31 — The self-approval substitute is "remaining configured slots first, then any other
  active approver, oldest account first". `slot_no` is constrained to (1, 2) by migration 0004, so
  "skip to the next configured slot" alone would make every above-threshold requisition raised by
  an approver unsubmittable. The approver **count** is never reduced to route around a missing
  substitute — that would quietly weaken the control the expense threshold exists to enforce.
  Refusing the submit is the fallback, with its own error code so an admin is told to appoint
  another approver rather than to fill in a slot that is already filled.
- 2026-07-31 — `GET /requisitions/:id/funding` now authorises the object, not just the session.
  It shipped with no guard at all while carrying vendor names, invoice numbers and purchase
  totals, and `GET /stock/ledger` is readable by every authenticated user and returns the
  requisition ids. Same reader set as the invoice download, which already had the check.
- 2026-07-31 — Upload size limits moved onto the multipart interceptor. Multer buffers the whole
  body into memory before the handler runs, so the `FileStorageService` check could only report an
  oversized upload that had already landed — it could not stop one from exhausting the heap.
- 2026-07-31 — `infra/.env.example` was missing `PDF_SIGNING_SECRET`, which has no default, so a
  fresh production deploy would have crashed at boot. Found by running the real config validator
  against the template rather than by reading it. The template is now boot-tested, and the same
  check is worth repeating whenever a required variable is added.
- 2026-07-31 — The api container now mounts `./backups` read-only. Without it `MONITOR_BACKUP_DIR`
  could only ever be blank in production, which the health check reports as "not configured" and
  passes — so the backup-freshness alarm built in 6.4 would have been inert exactly where it
  matters, and a stopped cron job would have looked like a healthy system.
- 2026-07-31 — Per-line freight lives in its own `numeric(14,2)` column rather than inside
  `estimatedUnitPrice`. Hiding it would distort every unit-cost figure and, worse, let a
  requisition slip under the expense threshold that decides how many approvers it needs.
- 2026-07-31 — Post-submit requisition edits accept **freight changes only**. The edit window was
  widened to APPROVED so a late shipping quote does not need a round-trip through the approver
  queue, but `replaceItems` rewrites the whole set — without the guard an approved requisition
  could be rewritten while `requested_amount` stayed frozen at the sanctioned figure, and a
  modest edit would sit inside the over-budget tolerance and never bounce.
- 2026-07-31 — `main.ts` and the integration harness now share one `configureApp`. They had
  configured themselves separately and drifted: the body-size cap and helmet existed only in
  production, so the spec asserting oversized bodies are refused could not pass and every other
  spec ran against a server that differed from production in a way no assertion could see.
- 2026-07-31 — The exception filter maps body-parser failures explicitly. body-parser rejects
  before Nest sees the request and throws a plain Error carrying `type`, so an oversized or
  malformed body became a generic 500 that told the caller the server had broken.
- 2026-07-31 — The API image installs Alpine's chromium and points puppeteer at it through
  `PDF_BROWSER_EXECUTABLE_PATH`. Puppeteer's bundled build is linked against glibc and cannot
  run on Alpine, so PDF rendering would have failed in the container while working in dev. The
  image also copies `assets/`, which it never did — the BOM letterhead resolved to nothing.
- 2026-07-31 — LAN deployment uses `IMS_DOMAIN=:80`: Caddy serves plain HTTP on any Host, which
  is what reaching the system by bare IP requires. No CA issues certificates for an IP address,
  so this mode has no HTTPS by construction and is only defensible on a trusted network.
- 2026-07-31 — Demo mode (`DEMO_ACCOUNTS_ENABLED`) seeds the five personas with one shared
  password and lists them on the login page. It is **off by default** and enabled explicitly in
  the root compose file, because it removes authentication in practice: anyone who can open the
  login page can act as the administrator. Requested deliberately for an internal LAN trial.
  Real passwords are argon2id and cannot be read back, so the page advertises the single
  configured demo password rather than anything stored — and says on the page that an
  admin-changed password stops matching it. The account list itself is read live from the
  database, so the admin panel stays the one place users are managed.
- 2026-07-31 — The `migrate` one-shot now runs the seed after the migrations. The seed is
  idempotent by design, so a fresh machine needs exactly one command to get a working stack.
- 2026-08-07 — Removing an item from a project **detaches** it (`borrow_requests.project_id = NULL`)
  rather than deleting the borrow. The borrow drives stock issue and return, so deleting it would
  orphan `stock_ledger` rows and break `SUM(ledger) == SUM(placements)` — the one invariant the
  nightly job exists to catch. Detach writes no ledger row, because no stock moved.
- 2026-08-07 — The Project Hub's item list is **derived from `borrow_requests`**, not stored: a
  `project_items` table would be a second copy of quantity and returned quantity, free to drift
  from the borrow that actually moved the stock. `ProjectsService` moved out of `borrowing/` into
  its own module and `GET`/`POST /borrowing/projects` were removed in favour of `/projects` —
  two routes for one resource is how the next person calls the wrong one.
- 2026-08-07 — `AUDIT_ENABLED_ACTIONS` is **reconciled on every boot against a second stored row,
  `AUDIT_KNOWN_ACTIONS`** — the only setting not left alone once seeded. Its stored value is a
  materialised snapshot of a code-level list (the empty env seed expands to `[...AUDIT_ACTIONS]`),
  and `AuditService` reads that array as an explicit allow-list — so an action added by a later
  release is missing from the snapshot and is silently never recorded on every database except one
  that has never booted. That is how `project.item.detach` would have shipped with its audit row
  dropped while being documented as the only trace of an item leaving a project. Chosen over a
  migration (the plan forbids one) and over widening the "record everything" fallback (which would
  ignore the admin's list entirely). `AUDIT_KNOWN_ACTIONS` records the action set the code knew at
  the last reconciliation, so boot appends `AUDIT_ACTIONS - KNOWN` only: missing **and** unknown is
  a new release, missing but known is an admin opt-out and stays off for good — a restart never
  resets a value an admin changed (rules/10-no-hardcoding.md). It is an `InternalSettingKey`, not a
  `SettingKey`: no `seedEnvVar`, invisible to `SettingsService.list()` and to the admin panel,
  rejected by `PUT /admin/settings`. On a database that predates the row it is seeded from the
  *current enabled list*, never from `AUDIT_ACTIONS` — seeding it from the code would declare every
  action already known and leave `project.item.detach` unaudited forever, which is the bug being
  fixed. Residual cost, one boot only: on that first upgrade an action disabled before the upgrade
  is still indistinguishable from one that did not exist, so it comes back once.
- 2026-08-08 — Supporting document on a requisition is a single nullable FK column on
  `requisitions` (`supporting_document_file_id`), not a join table. Mirrors the
  `purchases.invoice_file_id` precedent set on 2026-07-30, but skips the join-table reasoning
  that decision cites for invoices — invoices have a 1-to-many shape (one purchase, multiple
  vendors), whereas the supporting document is a fixed 1-to-1 by user choice. The
  `stored_file_kind` enum gains one value, `SUPPORTING_DOCUMENT`; the `stored_files` row is
  insert-only, so replacing an attachment inserts a new row and repoints the FK (the old row
  survives for the audit trail). Edit window tracks the amount-freeze rule: only the requester
  can attach, replace, or remove, and only while the requisition is DRAFT — the same row lock
  the submit path uses guards the status check against a racing submit. The document is
  deliberate reference material for the **decision**, not part of the **payable document**, so
  it is not frozen into `bom_requisitions.approval_snapshot` and is not rendered on the BOM PDF.
  Read authorization is requester + IM + Admin + any approver assigned to this requisition —
  distinct from the funds-module predicate (which is requester + IM + Admin only) because the
  document can swing a decision, so an approver acting on this requisition must be able to read
  it.
- 2026-08-08 — Pre-draft supporting document (orphan upload + claim on create). The
  DRAFT-only edit window on the existing endpoint means the requester had to save a draft
  first, then attach — but the user wants to pick a file on the empty Make Requisition
  form, before any requisition row exists, and have it become the requisition's supporting
  document when the draft is saved. The new flow is additive (the existing endpoint is
  unchanged): `POST /uploads/supporting-document` writes a `stored_files` row immediately
  with `kind = 'SUPPORTING_DOCUMENT'`, `uploaded_by = actor.id`, and
  `pending_claim_by = actor.id`; `POST /requisitions` accepts an optional
  `pendingSupportingDocumentId` and claims the orphan **in the same transaction** as the
  row insert (lookup, ownership check, FK repoint, `pending_claim_by = null`, audit row with
  `via: 'claim-on-create'`). The two-row audit chain (`requisition.supporting_document_pending`
  on upload, `requisition.supporting_document_attached` on claim) lets you follow a
  supporting document from "user picked a file" to "draft saved". A `@Cron` daily job
  (`PendingUploadSweepJob` at 04:00) deletes SUPPORTING_DOCUMENT rows where
  `pending_claim_by IS NOT NULL`, `created_at < now() - 24h`, and no requisition points at
  them — row delete first, then bytes (best-effort, `unlink` swallows ENOENT). The 24h
  window is generous so a user who opens the form, picks a file, and walks away has plenty
  of time to come back. The atomic claim prevents two concurrent creates from both
  pointing at the same orphan; the ownership gate (`pending_claim_by === actor.id`)
  prevents one user from attaching another's orphan. The `stored_files.pending_claim_by`
  column is the orphan flag and the sweep predicate. The partial index that would make
  the sweep index-only is intentionally **not** added by migration 0024 — Kysely's
  migrator runs every migration in a single outer Postgres tx, and Postgres refuses to
  evaluate a partial-index predicate against a new enum value in the same tx that added
  it. The index is added in a follow-up migration after the outer tx commits. The runtime
  WHERE filter is fine at this scale (`stored_files` has tens of rows in production).
