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

## 2026-08-26 — Phase 08
**Did:**
- Every money stage between approval and add-to-inventory is now reversible. `undo-send-to-accounts`,
  void one fund receipt, void one purchase, alongside the `unverify-purchase` that already existed.
  One entry per press and repeatable, so a requisition funded in three instalments does not lose two
  of them to a click. Each refusal names the step that has to be undone first rather than returning a
  generic transition error. `STOCKED` and borrow-out stay one-way: stock has moved by then.
- Migration **0028** makes `fund_receipts` and `purchases` voidable — `voided_at` / `voided_by` /
  `void_reason`, all three or none by CHECK, plus a partial index. The row survives as evidence and
  leaves the arithmetic. Ten read sites (not the four the plan first claimed) learned to skip them.
- The lifecycle tracker lit the stage that had just *finished* instead of the one waiting. Root cause:
  `stateOfStage` checked `currentStatuses` before the done-events and four stages listed their own
  completing status as "current". Stage state now derives from status alone, which also lets it walk
  backwards when a stage is reversed — the event log is append-only, so it never could.
- The invoice attach control moved into the verify-purchase form, which is the step that *requires*
  it. The IM was previously refused by a form that could not fix the problem it raised.
- `GET /dashboard/me` and the personal record page: requisitions raised/approved/rejected/in-flight,
  borrowing with the three damage conditions counted in **units**, and spend.
- **The money audit.** Walked Ayman's exact scenario end to end (5 × 100 + 500 van = 1,000 requested,
  bought at 5 × 50) asserting every figure on every screen. Found the Expenses report and the
  dashboard both reporting `spent` as `SUM(purchases.total_amount)` alone — under by exactly the
  carriage on every requisition that had any, and self-contradictory: net cash 750 beside spent 250
  with 250 returned. Fixed, with the two halves shown separately so the total can be reconciled.
- A free-text purchase line can now be received onto an **existing** catalogue product instead of
  forking a duplicate. Ayman's ESP32 case worked already when the requester picked from the list;
  it did not when they typed the name, and only `product_code` is unique, so nothing caught it.

**Decisions:**
- Migration 0028 approved by Ayman (a STOP). Additive columns only, reversible down, verified
  up → down → up against a real database and the CHECK proven to reject an unattributed void.
- Undo depth: one entry per press, repeatable. Ruled by Ayman.
- Dashboard visibility: own figures only. No user parameter on the endpoint at all, so there is
  nothing to authorise beyond being signed in — `/dashboard/me`, never `/dashboard/:userId`.
- `spent` means everything that left the company, transportation included, everywhere it is
  reported. Recorded in DECISIONS.md with the reasoning.
- Transportation is attributed to the purchase and counted only once there is one: nothing has been
  carried until something has been bought.
- Reversal reasons are mandatory, matching `unverify-purchase`. Not asked — consistency.
- Invoice stays **required** to verify. Ayman chose "as today" after I had described today wrongly
  as optional; the status quo is that `funds.service.ts` throws `INVOICE_MISSING`, and it stands.

**Landmines:**
- **Transportation vs a voided purchase is unreconciled and untested.** The reversals landed before
  the transportation fix. Voiding a purchase drops its total from `spent`; whether the carriage
  follows it out is not asserted anywhere, in either the report or the dashboard. This is the next
  action, and it is a real gap, not a tidy-up.
- **The BOM PDF totals were never checked against this scenario.** Everything else that prints a
  money figure was; that one was not.
- No concurrency test on the reversals. Two IMs voiding the same receipt at once is guarded by
  `voided_at IS NULL` in the UPDATE predicate and covered sequentially, but not with `Promise.all`.
- The suggestion list and the date picker are portalled and positioned from `getBoundingClientRect`,
  which jsdom reports as all zeros — flip-up placement near the bottom of a long form is untested.
- Two `FundsPanel.back.test.tsx` cases were **re-grounded, not deleted**: they asserted the absence
  of a Back button at `FUNDS_RECEIVED` and `PURCHASED`, which was true until Ayman's ruling replaced
  the rule they encoded.
- `lint` is still 20 pre-existing errors. Unchanged all session, and still nobody's.

**Next:** Reproduce transportation-on-a-voided-purchase in `money-audit.int-spec.ts` — void the
purchase on the 1,000/500 scenario and assert what `spent` should read in both the expenses report
and `/dashboard/me` — then make the two agree. After that, the BOM PDF totals against the same
scenario. Then phase 06 task 6.2.

## 2026-08-26 — Phase 07, QA round 2 defect burndown

**Did:**
- **Closed the QA round 2 defect list, 22 of 22.** Started by reconciling
  `IMS_QA_Test_Plan.xlsx` against git: it reported 29 Open, but 10 were already fixed locally and
  2 partly, so the spreadsheet overstated the work by a third. The real list was 21, which became
  22 when Ayman's D-006 ruling produced a second item. Ledger in
  `plan/PHASE-07-qa-round-2-defects.md`.
- **The integration suite is fully green for the first time: 606 pass / 0 fail across 45 files**,
  from a 516/1 baseline. The long-standing single failure was a real defect — express's
  body-parser throws an `http-errors` object, not a Nest `HttpException`, so a 413 fell through
  to the generic 500 branch (`4efbf75`).
- **`EX-02` is built** (`3323e7f`): `GET /reports/inventory{,/export.csv,/export.pdf}`, current
  stock by product with its location breakdown. This was the **last REQUIRED obligation in the
  requirements document with no implementation at all** — §10 asks for the BOM *and* inventory
  records as PDF, and only the BOM half had shipped. QA had filed it under D-024 with no defect
  ID of its own, which is how it survived two QA rounds.
- **Proved the authorisation controls rather than assuming them** (`749722a`): 70 cases across 23
  routes. D-013 was an unproven control, not a broken one, and it holds — every guarded route
  refuses the wrong role with 403 and anonymous with 401.
- Corrected `IMS_QA_Test_Plan.xlsx` so it stops contradicting the repo: Status column rewritten
  from the actual state, plus a new "Fixed In (commit)" column. QA's own cells are untouched.

**Decisions:** Ayman's D-006 ruling (department, approval deadline and reason required **at
submit only**; project optional, and no project means **personal development**) is in
`DECISIONS.md` with its reasoning. Two reports turned out to be wrong on the facts and are
recorded as such rather than "fixed": **D-031** claimed settings audit entries capture neither
value — they always did, since `084a462`, and the detail drawer renders them; the real defect was
that the *summary* said nothing, so the values went there. **D-013** was unverified, not broken.

**Landmines:**
- **Nothing was pushed. 63 commits exist on one machine only**, including both Criticals and
  EX-02. This is the largest risk carried out of this session.
- **D-006 cost 17 spec files of fixture churn** — 154 tests failed on the first run because almost
  every fixture predated the rule. No test was skipped, deleted or weakened. Three specs
  (`approval-deadline`, `reports`, `date-columns`) had their **setup** re-grounded where D-006 and
  D-003 closed the route they used to reach a state that still exists in older rows; every
  assertion in them is unchanged and both cases are in `DECISIONS.md`. Worth re-reading before
  trusting those three.
- Two new landmines added to `ASSIST.md` §9 and playbook §16: `pnpm typecheck` reads
  `packages/shared/dist` so a green int suite is not evidence typecheck is green; and `pnpm db:up`
  is not `docker compose up` — the root compose file leaves 5434 unbound.
- **OQ-30 is a finding, not a fix.** `POST /boms` and `POST /boms/:id/void` carry no `@Roles`;
  they are genuinely enforced inside `BomsService`, but after validation rather than before it,
  so my first version of the permissions test passed against a route it never exercised. Adding
  `@Roles` touches permissions, which is a STOP — recorded, not done.
- Demo mode is still ON in production.

**Next:** Task 6.2, the nightly invariant job — `SUM(stock_ledger) = stock_placements.quantity`
per product, extended to `reserved_qty` in the same pass per G-14.

## 2026-08-23 — correction to the QA round 2 entry below

**Did:** nothing but check. Two `NOW.md` fixes were ordered and **both were already correct**,
landed by `cf02fc8`: line 55 already reads "A missing tool binary is a skipped postinstall →
`pnpm install`", and the integration baseline at line 37 already reads 497 pass / 1 fail. No
edit was made for either; reporting the no-op rather than an imaginary diff.

**Decisions:** the guard baseline was likewise already in `DECISIONS.md` (2026-08-23, all seven
files named, alongside lint 20). What was genuinely missing and has now been added is the
**current integration and unit baseline** — the newest dated figure in that file was still
2026-08-20's 484/7 and shared 7 / api 51 / web 102, which is exactly the copied-forward-number
failure that entry was written to stop.

**Landmines:** `NOW.md`'s web unit count said 112 and is now 126 — D-002 (`a6c1355`) added 14
tests. Any baseline quoted from a message older than that commit is one D-002 behind.

**Next:** D-030's five `users.service.ts` sites.

## 2026-08-23 — QA round 2 (no phase; post-Phase-06)

**Did:**
- **Triaged all 31 defect rows in `IMS_QA_Test_Plan.xlsx`** against
  `requirements-verbatim.md`. The workbook says 32 failures; there are 31 defect rows, four
  Fails are second reproductions, and `EX-02` — **inventory export, REQUIRED §10, entirely
  unimplemented** — has no defect ID. It is the only unmet REQUIRED obligation found.
- **D-014 (Critical) fixed.** pg parses `date` into a JS Date at the server's local midnight and
  every reader formatted it with `.toISOString()`, i.e. UTC. On UTC+6 a deadline came back a day
  early, and the edit form posts the stored value back, so each save lost another day.
  Reproduced live as REQ-000013: 27 → 26 → 25. A DATE type parser removes the class.
- **The clock family, closing D-014 properly.** Three sites answered "what day is it" three ways
  — two in UTC, one via SQL `current_date` (the *database* container's zone). All now resolve
  `REPORTING_TIME_ZONE`, including the §5 reminder job, which otherwise could have stayed silent
  while the badge said Overdue. `REPORTING_TIME_ZONE` is validated against `Intl` at boot.
- **D-030 (High) fixed bar five sites.** Not 19 call sites but ~53: `auditContextFromRequest`
  sets `actorName: null` itself and the JWT has no name to give it. Resolved once, at the insert,
  with a COALESCE subselect. Nine services had already "fixed" the null by passing whatever name
  was in scope — the category's, the zone's, the product's — which is worse than a blank and also
  masked the real fix. Five more in `users.service.ts` are held pending a ruling.
- **D-028 and D-024 (High) fixed.** The BOM quantity box blanked when you typed the source value,
  because empty-string meant both "cleared" and "equals source". The expense export was an
  `<a href download>` with no `/api/v1` — 200, text/html, 722 bytes of SPA shell — and would have
  401'd even corrected, since a browser cannot attach a bearer token to a navigation.
- **Fixed the baseline itself.** Three of the four remaining integration failures were a settings
  leak from `audit.int-spec`, blamed on `requisitions.int-spec` for months. Whether they appeared
  depended on file scheduling, so every baseline number ever quoted was partly a function of
  timing. **486/7 → 497/1**, and the one survivor is a real defect.
- **Rehearsed the fresh install** on a scratch DB: migrations apply from empty (the 0020/0021 gap
  is a non-event), the seed is idempotent — and leaves a system where the first requisition
  cannot be submitted for four separate reasons.

**Decisions:** DATE stays text at the driver, not fixed at seven call sites · one clock,
`REPORTING_TIME_ZONE`, for every user-visible "is it overdue" · audit actor names resolved at
write time rather than joined on read, preserving the deliberate snapshot · export downloads use
`api.blob()` (the `SupportingDocumentCard` precedent), not a signed URL (the BOM precedent),
because the report never leaves the app. All in DECISIONS.md.

**Landmines:**
- **`npx puppeteer browsers install chrome` — the remedy in this file and NOW.md — was wrong and
  destructive.** Run at the repo root it installed puppeteer 25.8.0 over the pinned 23.11.1 and
  deleted `node_modules/.pnpm` outright. The fix was always `pnpm install`; puppeteer's own
  postinstall fetches the pinned Chrome. Recovered with `git checkout -- package.json`,
  `rm package-lock.json`, `pnpm install`. Corrected in ASSIST §8 and NOW.md.
- **Demo mode is ON in production.** The login page offers one-click sign-in as Administrator.
- **D-002 is unfixed and it is the entry point of the whole flow** — the catalogue request 400s
  on every load, so no requisition line has ever been linked to a product, and
  `in_stock_qty_at_submit` has therefore never been written for any line in the system.
- Two green tests were found *defending* defects (the export path, the BOM quantity field). Both
  were written by describing the code rather than deciding the behaviour.
- Five `users.service.ts` audit sites still name the affected user as the actor, in an
  append-only table. Held, not forgotten.

**Next:** D-002 — import `PAGINATION_MAX_LIMIT` at `RequisitionFormPage.tsx:50`, surface
`catalogue.isError`, and add a unit test parsing every exported query constant through its
schema. Then the six rulings in NOW.md, then `git push` — 27 commits including both Critical
fixes exist on one machine only.

## 2026-08-20 — QA round 1 + harness repair (no phase; post-Phase-06)

**Did:**
- **Onboarded a second engineer (Zai).** New `ASSIST.md` (operating manual: how to run the
  stack, debug playbook, symptom→cause table, invariants it may not touch, known doc drift) and
  `.claude/rules/70-assist-handoff.md` (evidence-carrying report format with a `SPEC` label
  classifying every behaviour REQUIRED/DERIVED/NO-BASIS before it is fixed).
- **Committed the customer requirements document** at `docs/reference/_source/requirements-verbatim.md`.
  It had never been in the repo, so the top of the authority chain was unreadable to anyone
  working here and everyone was reasoning from unverified transcriptions.
- **Measured the integration baseline for the first time.** Documented figure was 458/11 wrong:
  actual was 473 pass / 11 fail, not 458/8. Triaged all 11 to root cause; four were harness bugs
  and are now fixed. Baseline is **484/7** at session end.
- **Found and fixed `test:int -- <spec>` silently running all 39 files** — the command both
  engineers were told to produce per-block evidence with.
- **PM QA round:** 18 items triaged. Fixed the wheel-scroll data corruption (11 numeric fields,
  one shared `TextField`), the "correct the highlighted fields" lie, six domain errors sharing
  one `ErrorCode`, the approver cap, the sidebar route collision, and the empty Approved tab.

**Decisions:** approved may not exceed requested (Ayman, recorded in DECISIONS.md) · PM item 14
declined (prefilling the purchase form's unit cost defeats the invoice check) · `approvedByMe`
matches `assigned_user_id` so delegated approvals land on the assignee · `FieldIssue` lifted to
`@ims/shared` · trailer kept as `Claude Opus 5` rather than matching the branch's `Opus 4.8`,
because attribution is not style.

**Landmines:**
- **`pnpm lint` is not green** — 21 pre-existing errors across 8 files. The repo cannot meet its
  own definition of done. Compare the count, do not expect zero.
- **Chromium was never installed** (`npx puppeteer browsers install chrome` in `apps/api`).
  3 of the 7 remaining failures. Nobody here can verify the BOM PDF path until it is run.
- **3 `reports` failures are cross-file `app_settings` pollution** — they pass in isolation and
  fail in the suite. `requisitions.int-spec.ts` mutates the expense threshold; `reports` depends
  on being sub-threshold. Not fixed.
- **1 real product defect left:** oversized JSON body returns 500 not 413. `express.json()` errors
  are plain `Error` with a `status` property, so they never reach `codeForStatus`'s
  `PAYLOAD_TOO_LARGE` arm. `PAYLOAD_TOO_LARGE`'s enum comment describes only the multipart path
  and needs widening when this is fixed.
- I twice asserted a causal claim as fact that turned out insufficient (the Alpine Chromium path).
  The `R`/`D` tagging in the handoff rule is what kept that cheap — keep using it.

**Next:** 5c — `returnedAmount` defaults to `funding.unspent` instead of `'0'` in
`FundsActionDialog.tsx:82`. Then 5d (bound `purchasedAt`/`receivedAt` to not-in-the-future,
backdating still allowed), then two `ASSIST.md` §8 rows: "a refusal shows the wrong copy though
the server's message is correct → the error reuses another code; assert `body.code`, not just
status", and "`Cannot find module` from the repo root proves nothing under pnpm — re-run from the
owning workspace".

## 2026-07-31 — Phase 05 finished: expense report and the IM funds panel

**Did:**
- **5.8 expense report** — six figures per bucket (requested, approved, funded, spent, returned,
  net), grouped by month / department / project, with range and preset filters. Visible to
  Approvers, IMs and Admin, not to General. Backend, UI and 8 integration tests.
- **The IM funds panel**, which was the real remaining gap: tasks 5.4–5.7 were working APIs with
  no screens, so the Inventory Manager could not reach any of the money lifecycle from a browser.
  It sits on the requisition detail page, shows the money summary, and offers exactly **one** next
  action driven by the status — the server refuses anything out of turn, so six buttons of which
  five return 409 would only teach the user to expect errors.
- **OQ-19 answered** by the operator: "Sent to Accounts" is a status change and a note, nothing
  more. The endpoint now takes an optional note that lands on the tracker event and the audit row.
- **Fixed the sub-threshold approver error properly.** The previous fix changed the server message
  but reused `APPROVER_SLOT_UNASSIGNED`, and the web app selects copy by *code* — so the clearer
  wording never reached the screen. It has its own code now, and the test asserts the code.

**Three bugs found while building 5.8, all of the looks-fine-is-wrong kind:**
- A **fan-out**: joining a requisition to `fund_receipts`, `purchases` and `fund_returns` at once
  multiplies the rows and inflates every figure by the size of the other two. The money is
  pre-aggregated per requisition, and a test with two receipts, two purchases and a return guards
  it.
- A **timezone bug the operator's own data triggered**: ranges were resolved in UTC, but at 4am in
  Dhaka the UTC date is still yesterday, so asking for "today" found nothing. Ranges are now
  calendar days in `REPORTING_TIME_ZONE`, resolved by Postgres via `AT TIME ZONE`.
- Interpolating the same Kysely `sql` fragment twice re-emits its bound parameters with
  **different** placeholder numbers, so `GROUP BY` did not match `SELECT` and Postgres rejected
  the query. Grouped positionally instead.

**Landmines added to NOW.md:** the test database accumulates requisitions, departments and users
because `resetData` cannot delete them — never assert "exactly one row" or "it is on page one".
A latent flake in the permissions spec had been depending on exactly that, and my new spec tipped
it over; it is fixed.

**Next:** Phase 06. Task 6.2 (nightly invariant job, extended to `reserved_qty` per G-14), then
6.3 (backup and restore drill) — the one not to skip given the no-data-loss requirement.

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
