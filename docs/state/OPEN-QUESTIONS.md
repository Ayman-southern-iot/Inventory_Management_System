# Open questions

Anything not answered by the requirements doc or the design. **Never silently guess.** If you must
proceed, implement the smallest defensible default, mark it `// OPEN QUESTION: OQ-NN` in the code,
and record the assumption here.

Status: 🔴 blocking · 🟠 needed soon · 🟢 can wait

| ID | Status | Question | Working assumption | Blocks |
|----|--------|----------|--------------------|--------|
| OQ-05 | 🟢 | Should a BOM over the approved amount by >10% bounce back for re-approval? | Yes, tolerance configurable | Phase 04 |
| OQ-06 | 🟢 | Line-level partial approval of a requisition? | No — whole request only | Phase 03 |
| OQ-07 | 🟢 | Self-approval: CFO raises a request and is also Approver 2 | Skip and substitute; substitute undefined | Phase 03 |
| OQ-10 | 🟢 | Is there an SMTP relay available? | No — in-app notifications only for v1 | Phase 03 |
| OQ-11 | 🟠 | Company letterhead asset and exact print margins | Placeholder template until supplied | Phase 04 |
| OQ-12 | 🟠 | How long may a session live before re-authentication is forced? Currently 14 days absolute from login, not extended by rotation. | 14 days | Phase 00 (built), revisit any time |
| OQ-13 | 🟢 | Should an admin be able to see and revoke a user's active sessions? There is no UI for it, so a suspected token theft can only be handled by deactivating the account or resetting the password. | Deactivate/reset is enough for v1 | Phase 06 |
| OQ-14 | 🟡 | "Admin-configurable audit actions" does not say whether an admin may switch off *every* action. Implemented with an always-on core (`AUDIT_ALWAYS_ON_ACTIONS` — the `auth.*`, `user.*`, `settings.update` and `audit.purge` families) that the toggle cannot disable, because an admin able to stop their own actions being recorded defeats the feature. Needs confirming, and the exact membership of that list is a guess. | Always-on core, admin controls the rest | Phase 06 |
| OQ-16 | 🟡 | Who gets notified about what was inferred from the domain, not specified: the IM on a new borrow or a submitted requisition; the money approvers only once the IM has cleared it; the requester on every decision affecting their own request; IMs and Admin when a requisition is fully approved or a BOM is generated. Nobody is notified of their own action. Worth ten minutes of the operator's time to confirm — a wrong audience is the difference between a badge people act on and one they learn to ignore. | As implemented, pending confirmation | Phase 06 |
| OQ-17 | 🟢 | Password policy dropped to **4 characters with no composition rule**, at the operator's explicit instruction (2026-07-30). That is ~1.7M combinations — instantly crackable offline if the database is taken. Accepted because this is an internal tool on one VM behind the office network, with a 10/min per-IP login cap and a per-email throttle. Those two limiters and the hashing cost are now the only defence and **must not be weakened**. | Min 4, no rules | Phase 05 (5.0) |
| OQ-18 | 🔴 | **Blocks task 5.3.** The BOM header must print "Remaining", but which subtraction? (a) Approved − this BOM's subtotal, i.e. budget left against the approval; (b) Approved − actually purchased, which is only known later and would be blank on a fresh BOM; (c) Funded − spent. (a) is the only one knowable at print time, so it is the working assumption, but a document that goes to Accounts should not have a guessed figure on it. | Approved − BOM subtotal | Phase 05 (5.3) |
| OQ-19 | 🟠 | Does "Sent to Accounts" mean anything outside this system — an email, a shared folder, a person to notify — or is it purely a status the IM flips to record that the PDF was handed over? Nothing is wired to Accounts today, and OQ-10 says there is no SMTP relay. | A status the IM sets by hand | Phase 05 (5.4) |
| OQ-20 | 🟠 | The operator described funding as one step ("Money Received"), but the status enum already has `FUNDS_PARTIAL` and money genuinely can arrive in instalments. Keeping partial funding means the tracker shows an outstanding balance; dropping it means a part-payment cannot be recorded at all. Plan assumes partial is kept. | Keep partial funding | Phase 05 (5.4) |
| OQ-21 | 🟢 | A BOM can batch several requisitions, but the new flow (funds → purchase → invoice) is described per requisition. If one payment covers a batched BOM, how is it split? The original 5.2 planned a pro-rata allocation screen; it is dropped from this phase as unrequested complexity. Until answered, record funds per requisition and let the IM split by hand. | Per-requisition receipts only | Phase 05 |
| OQ-22 | 🟠 | On "Borrow to user", may the IM lend to anyone, or only to the person who raised the requisition? Plan defaults the picker to the requester but allows any active user — an item bought on one person's requisition is often handed to a colleague. | Any active user, defaulting to the requester | Phase 05 (5.7) |
| OQ-15 | 🟡 | The audit purge ships disabled by default and an admin must set `AUDIT_RETENTION_DAYS` to enable it. Is there a legal or company retention period this should default to instead? Nothing in the requirements states one, and "no data should be lost in any case" argues for keeping everything until told otherwise. | Disabled by default; admin opts in | Phase 06 |

## Known gaps carried out of Phase 00

Not questions for the user — engineering work deliberately deferred, recorded so it is not
rediscovered as a surprise.

| ID | Gap | Why deferred | Land it in |
|----|-----|--------------|------------|
| G-06 | ✅ **CLOSED 2026-07-30.** Was: task 3.9's reminders and the approve/reject notices to the requester existed only as server log lines — no `notifications` table, no bell. Now delivered by the notifications module (migration 0013): per-recipient rows written in the causing transaction, a polled unread badge in the header, and the deadline job raising a real `requisition.approval_reminder`. In-app only, per OQ-10. | — | Done |
| G-07 | The requisition form loads 200 products and filters them in the browser. | Correct at this scale and much simpler; it becomes wrong somewhere in the low thousands. Swap to a server-side search on `/products?search=` when the catalogue grows. | When the catalogue exceeds ~1000 products |
| G-02 | Token expiry is untested — both the access and refresh expiry branches are unexecuted, because asserting them honestly needs a clock rather than a `sleep`. | Wants an injectable clock, which is a small refactor better done alongside the deadline logic that needs one anyway. | Phase 03 |
| G-03 | `LoginThrottleService` counts with an unlocked `SELECT`, so N simultaneous wrong passwords can all pass the check before any row is written. | Real in principle, negligible at 12 users; the per-IP `ThrottlerGuard` still caps the burst. | Phase 06 |
| G-11 | The audit sanitiser's redaction is an exact-name key allowlist plus whole-string-anchored JWT/Bearer regexes. A token embedded in prose (`"retried with Bearer eyJ…"` inside a free-text note) is stored verbatim; the PDF signing token is two segments so the three-segment JWT regex never matches it; and keys named `tokenHash`, `sessionToken`, `tempPassword`, `pwd` are not redacted. No current call site passes one — but the file header promises a guarantee the code does not provide. | Found on 2026-07-30 alongside a CRITICAL and two HIGHs; fixing the matcher properly wants its own slice with tests per shape, and no live call site leaks today. | Phase 06 |
| G-12 | `PdfDownloadTokenInvalidError` passes its `reason` discriminator as `details`, and the exception filter copies `details` into the response — so a 403 tells the caller `malformed` vs `mismatch` vs `expired`, i.e. whether their signature verified but the bomId did not. | Low severity: the token is already unforgeable (HMAC-SHA256, dedicated secret, `timingSafeEqual`). One-line fix, just not this session. | Phase 06 |
| G-13 | `page` in the shared pagination schema has no upper bound, so `?page=100000000` produces an unbounded `OFFSET` plus a full `countAll`. `limit` *is* correctly clamped to 100, so nobody can pull a large result set. | An annoyance at twelve users, not an outage. Fix is `.max(10_000)` on the shared schema. | Phase 06 |
| G-14 | `borrowing.decide` and `borrowing.cancel` commit the status flip in one transaction and move stock in a second. The `catch` covers a failing query but not a crash or lost connection between the two, which strands a reservation forever — and the nightly reconciliation cannot see it, because it only checks `SUM(ledger) = quantity` and never touches `reserved_qty`. | Needs `StockService` to accept an optional `tx` on `issue`/`release`, which is a wider change to the one-writer boundary than this session should make unreviewed. Worth doing with a reconciliation check on `reserved_qty` at the same time. | Phase 06 |
| G-15 | `borrowing.insertReturn` runs after its claim transaction has committed, and the compensating `rollbackReturn` is an unconditional `returned_qty - quantity` using a status read *before* the claim. A second partial return landing in between makes `returned_qty` and `status` disagree with `borrow_returns`. | Same shape as G-14 and best fixed with it. | Phase 06 |

## Resolved

- **OQ-01 — Below the 15,000 BDT threshold, how many approvers?** → **1.** At or above the
  threshold it stays 2. Both are `app_settings` values, so the counts change without a
  redeploy. Answered by the user 2026-07-29.
- **OQ-02 — Are Approver 1 and 2 fixed company-wide or per department?** → **Per-department
  override**, on top of a company-wide default. Already modelled that way in `approver_slots`
  (a null `department_id` is the global default), so no migration was needed. Answered by the
  user 2026-07-29.

- **OQ-04 — What does the IM's edit on an approved borrow do once the item has left?** →
  Implemented as the working assumption and left open for confirmation: revert to PENDING is
  offered only while nothing has been returned and the item has not physically gone. After
  issue the correct action is a return, not an edit.
- **OQ-09 — Do projects need a code, owner, or budget?** → Name only, with a case-insensitive
  duplicate-name warning the user may override. A code, owner or budget would be additive
  columns, so the minimum costs nothing later.

- **OQ-03 — Do laptops need serial-level tracking?** → **No.** Quantity-based only. The
  `asset_units` layer stays dormant in the schema so it can be switched on with a migration
  if that ever changes. Answered by the user 2026-07-28.
- **OQ-08 — Is consumable a product flag or a per-borrow choice?** → **Both.** The product
  carries a default (`default_returnable`) and the borrow form may override it per line.
  Handles the cable that is usually consumed but occasionally returned, without needing an
  admin to edit the catalogue. Answered by the user 2026-07-28.
