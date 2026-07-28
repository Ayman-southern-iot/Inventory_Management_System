# Open questions

Anything not answered by the requirements doc or the design. **Never silently guess.** If you must
proceed, implement the smallest defensible default, mark it `// OPEN QUESTION: OQ-NN` in the code,
and record the assumption here.

Status: 🔴 blocking · 🟠 needed soon · 🟢 can wait

| ID | Status | Question | Working assumption | Blocks |
|----|--------|----------|--------------------|--------|
| OQ-01 | 🔴 | Below the 15,000 BDT threshold, how many approvers? | 1 approver | Phase 03 |
| OQ-02 | 🔴 | Are Approver 1 and 2 fixed company-wide, or per department? | Global default, per-department override | Phase 00 (admin), 03 |
| OQ-04 | 🟠 | What does the IM's ✎ Edit on an approved borrow do once the item has left? | Revert to pending, only before physical issue | Phase 02 |
| OQ-05 | 🟢 | Should a BOM over the approved amount by >10% bounce back for re-approval? | Yes, tolerance configurable | Phase 04 |
| OQ-06 | 🟢 | Line-level partial approval of a requisition? | No — whole request only | Phase 03 |
| OQ-07 | 🟢 | Self-approval: CFO raises a request and is also Approver 2 | Skip and substitute; substitute undefined | Phase 03 |
| OQ-09 | 🟢 | Do projects need a code, owner, or budget? | Name only, with a duplicate-name warning | Phase 02 |
| OQ-10 | 🟢 | Is there an SMTP relay available? | No — in-app notifications only for v1 | Phase 03 |
| OQ-11 | 🟠 | Company letterhead asset and exact print margins | Placeholder template until supplied | Phase 04 |
| OQ-12 | 🟠 | How long may a session live before re-authentication is forced? Currently 14 days absolute from login, not extended by rotation. | 14 days | Phase 00 (built), revisit any time |
| OQ-13 | 🟢 | Should an admin be able to see and revoke a user's active sessions? There is no UI for it, so a suspected token theft can only be handled by deactivating the account or resetting the password. | Deactivate/reset is enough for v1 | Phase 06 |

## Known gaps carried out of Phase 00

Not questions for the user — engineering work deliberately deferred, recorded so it is not
rediscovered as a surprise.

| ID | Gap | Why deferred | Land it in |
|----|-----|--------------|------------|
| G-01 | `login_attempts` and expired `refresh_tokens` are never pruned. `LoginThrottleService.deleteOlderThan` and `RefreshTokenRepository.deleteExpiredBefore` exist but have no caller. | There is no scheduler yet; `node-cron` arrives with reminder jobs. | Phase 03 |
| G-02 | Token expiry is untested — both the access and refresh expiry branches are unexecuted, because asserting them honestly needs a clock rather than a `sleep`. | Wants an injectable clock, which is a small refactor better done alongside the deadline logic that needs one anyway. | Phase 03 |
| G-03 | `LoginThrottleService` counts with an unlocked `SELECT`, so N simultaneous wrong passwords can all pass the check before any row is written. | Real in principle, negligible at 12 users; the per-IP `ThrottlerGuard` still caps the burst. | Phase 06 |
| G-04 | `Idempotency-Key` (rules/20-backend.md) is not implemented on any mutating endpoint. | No Phase 00 endpoint is expensive to repeat. Stock writes are, so it lands with them. | Phase 01 |
| G-05 | The departments deactivation guard ("move the N active users out first") has no test. | Written and manually exercised, but below the testing rules' priority line for Phase 00. | Phase 01 |

## Resolved

- **OQ-03 — Do laptops need serial-level tracking?** → **No.** Quantity-based only. The
  `asset_units` layer stays dormant in the schema so it can be switched on with a migration
  if that ever changes. Answered by the user 2026-07-28.
- **OQ-08 — Is consumable a product flag or a per-borrow choice?** → **Both.** The product
  carries a default (`default_returnable`) and the borrow form may override it per line.
  Handles the cable that is usually consumed but occasionally returned, without needing an
  admin to edit the catalogue. Answered by the user 2026-07-28.
