# IMS — Critical flow run

The twenty most critical flows from `IMS-Flow-Catalogue.md` Part 8, plus the expenses-spec
investigation and a full UI sweep. Run unattended, 2026-09-02.

**Against:** `2efcb5a` · the Docker stack on port 8173
**Method:** the API directly for refusals and reversals, the browser for anything a person looks at

The UI was the right tool for the happy path — it is what a user touches. It is the wrong tool for
refusals: every one of these is "the server must say no", and clicking through four roles to learn
a 409 spends minutes on what one request answers.

---

## 1. Headline

**38 of 38 checks pass.** No failures, no workarounds.

| Group | Result |
|---|---|
| Critical flows (money, reversals, permissions, ids) | 27 / 27 |
| Reconciliation (three surfaces, one number) | 8 / 8 |
| D-020 regression, tested with a real rejection | 3 / 3 |
| UI sweep — 20 routes | all render, **0 console errors** |
| Responsive at 390px — 6 heaviest pages | no sideways scroll anywhere |

**The one that mattered most: TC-319 passes.** Voiding a purchase takes its carriage out of
`spent` with it — OQ-32, decided and built on 2026-09-01 and never once exercised until now.

```
TC-318  voiding a purchase drops spent                       spent 10000 -> 0
TC-319  the carriage follows the voided purchase out          transportation 1000 -> 0
TC-323  the funding panel still reconciles after a void       unspent 11000 of funded 11000
TC-321  a fresh purchase can be recorded after the void       accepted
```

---

## 2. The money chain and its reversals

Every one of these was untested before today.

| ID | Flow | Result |
|---|---|---|
| TC-318 | Voiding a purchase drops `spent` | ✅ 10,000 → 0 |
| TC-319 | **The carriage follows it out (OQ-32)** | ✅ 1,000 → 0 |
| TC-321 | A fresh purchase can be recorded afterwards | ✅ |
| TC-323 | The funding panel still reconciles | ✅ unspent returns to the full funded amount |
| TC-290 | A purchase past funded is refused | ✅ `PURCHASE_EXCEEDS_FUNDED` |
| TC-290b | The refused purchase left no trace | ✅ spent still 0 |
| TC-283 | Funding past approved is refused | ✅ `FUNDING_EXCEEDS_APPROVED` |
| TC-313 | Undo send-to-accounts returns to `BOM_GENERATED` | ✅ |
| TC-314 | Undo refused once money has been released | ✅ `CANNOT_UNDO_SEND_WITH_RECEIPTS` |
| TC-316 | A receipt cannot be voided under a standing purchase | ✅ `CANNOT_VOID_RECEIPT_WITH_PURCHASES` |

Each refusal returns its own specific code, not a generic 409 — which matters because the SPA
selects its message by `code`.

## 3. The BOM ceiling

| ID | Flow | Result |
|---|---|---|
| TC-225 | A BOM past the approved amount | ✅ `BOM_EXCEEDS_APPROVED_AMOUNT` |
| TC-226 | Items 7,000 + carriage 1,000 against approved 8,000 | ✅ accepted at exactly the ceiling |
| TC-241 | A second live BOM for the same requisition | ✅ `BOM_ALREADY_ON_LIVE_BOM` |

## 4. Approvals

| ID | Flow | Result |
|---|---|---|
| TC-152 | Acting on the same approval twice | ✅ `APPROVAL_ALREADY_ACTED` |
| TC-153 | Acting on someone else's approval | ✅ `NOT_YOUR_APPROVAL` |
| TC-161 | Revising *above* the requested amount | ✅ `APPROVED_EXCEEDS_REQUESTED` |

## 5. Permissions — tested at the API, not by hidden menus

| ID | Attempt | Result |
|---|---|---|
| TC-461 | Gina → `/admin/users` | ✅ 403 |
| TC-465 | Gina → `/admin/settings` | ✅ 403 |
| TC-469 | **IM** → `/admin/audit-log` | ✅ 403 |
| TC-475 | Gina → `/boms` | ✅ 403 |
| TC-487 | Gina → `/stock/adjust` | ✅ 403 |
| TC-493 | Gina → `/reports/expenses` | ✅ 403 |
| TC-462 | No token at all | ✅ 401 |
| TC-503 | Unknown but well-formed id | ✅ clean 404 |
| TC-504 | Malformed uuid | ✅ 400 `VALIDATION_FAILED`, not a 500 |

## 6. Stock

| ID | Flow | Result |
|---|---|---|
| TC-129 | Borrowing 61 of 11 available | ✅ refused (400 `VALIDATION_FAILED`) |

Worth noting rather than filing: this is refused by *validation* rather than by
`INSUFFICIENT_STOCK`. The outcome is correct and stock cannot go negative, but the code the SPA
receives is the generic one. Only matters if the copy needs to name the shortfall.

---

## 7. The expenses spec — investigation and preconditions

The spec at `docs/spec/expenses-page-rebuild.md` demands one investigation **before** any
building, and depends on four prior fixes. All were checked before touching anything.

### The mandatory investigation: is spend bounded by funded?

**Yes.** `FundsService.recordPurchase` computes
`alreadySpent + alreadyCarried + thisTotal + thisCarriage` and refuses when it exceeds
`sumReceipts`, under the row lock the transaction already holds — so two purchases racing cannot
both take the same headroom.

There is one deliberate escape: the check is skipped when `alreadyFunded === 0`. **It is not
reachable through the API.** A purchase requires `FUNDS_RECEIVED`, `FUNDS_PARTIAL` or `PURCHASED`;
the first two are only set by a receipt, voiding the last receipt returns the requisition to
`SENT_TO_ACCOUNTS`, and `CANNOT_VOID_RECEIPT_WITH_PURCHASES` stops receipts being removed under a
purchase. Verified live: `spent 56,000 ≤ funded 104,000` across the whole book, and no requisition
in the database has ever exceeded its funding.

**No D-025-family gap. The spec may assume `spent ≤ funded`.**

### Preconditions

| Dependency | State |
|---|---|
| **D-020** — Approved must be status-filtered | ✅ Already fixed, and the code names D-020 in its own comment. Verified with a real rejection, below |
| **D-014 / timezone** | ✅ `reports.repository.ts` already does `AT TIME ZONE Asia/Dhaka` for both range boundaries *and* month grouping |
| **Items / transport split** | ✅ Already exists — the query returns `purchased` and `transportation` separately, and `spent` as their sum |
| **D-002** — lines carry a real `product_id` | ✅ Verified 2026-09-01: catalogue picks link correctly. Top items is unblocked |

### D-020, tested rather than assumed

The earlier assertion passed against a book with no rejected requisitions, which proved nothing.
So the condition was created:

```
D-020-setup  approved_amount is written at submit, before anyone approves
             approvedAmount 40000 while status IM_REVIEW
D-020-a      a merely submitted requisition is not counted as Approved   144700 -> 144700
D-020-b      rejecting it does not add its figure to Approved
             status REJECTED; approved 144700 -> 144700 (the requisition carries 40,000)
```

A requisition carrying a full 40,000 in `approved_amount`, rejected, never enters the Approved
total. D-020 is genuinely fixed.

### Reconciliation — the page's whole promise

```
TC-325   purchases + transport == spent      52,000 + 4,000 = 56,000 vs spent 56,000
TC-560   month buckets sum to the totals     1 bucket: 56,000 vs 56,000
TC-560b  every bucket reconciles internally  September 2026: 56,000
gap 1    approved - funded = awaiting        144,700 - 104,000 = 40,700
gap 2    funded - spent = in hand, unspent   104,000 - 56,000 = 48,000
TC-564   the CSV export carries the same figure as the page
```

Both of the spec's gaps compute, and both are non-negative.

---

## 8. Two conflicts in the spec — read before building

The spec says to STOP and report rather than build to the picture where it conflicts with an
invariant. Both of these are that case.

### 8.1 `FULLY_FUNDED` is not a status

The spec says Approved must sum requisitions "whose status is `APPROVED` or `FULLY_FUNDED`".
There is no `FULLY_FUNDED` in `RequisitionStatus`. The nearest is `FUNDS_RECEIVED`.

### 8.2 The spec's filter is narrower than the committed D-020 predicate, and would undercount

The shipped predicate is `APPROVAL_STANDING_STATUSES` — nine statuses:

```
APPROVED · BOM_GENERATED · SENT_TO_ACCOUNTS · FUNDS_PARTIAL · FUNDS_RECEIVED
PURCHASED · PURCHASE_VERIFIED · STOCKED · CLOSED
```

Building to the spec's two-status reading would **drop every requisition that has moved past
approval** — everything bought, verified or shelved would fall out of Approved, and the figure
would collapse the moment money started moving. On today's data that is 144,700 becoming a small
fraction of itself.

**Recommendation: keep the shipped nine-status predicate and correct the spec.** The spec's own
instruction supports this — "reuse it, do not re-derive it". The two-status phrasing appears to be
shorthand written before the money stages existed, not a deliberate narrowing.

**Nothing has been built against either reading.** This is the report the spec asks for.

---

## 9. UI sweep

All 20 routes, as admin. Every one renders with real content; **zero console errors** across the
whole sweep.

Dashboard · Inventory · My borrowings · My requisitions · Projects · Approvals · Expenses ·
Borrowing · All requisitions · Categories · Locations · Bills of Materials · Users · Departments ·
Settings · Audit log · New requisition · New BOM · My account · Change password

**Responsive at 390 × 844**, on the six heaviest pages (Dashboard, Expenses, All requisitions,
BOMs, Audit log, Inventory): no page scrolls sideways, and every wide table has its own
`overflow-x` container rather than pushing the layout. TC-605 and TC-606 pass.

One cosmetic find, same family as F-3 in the happy-path report: `/all-requisitions` sets the tab
title to "Requisitions", not "All requisitions".

---

## 10. What this run did not cover

Honest scope. This was the critical set, not the catalogue.

- **File upload and signatures** (TC-113–126, TC-593–604) — still entirely untouched, and still
  the highest-risk untested surface.
- **Delegation** (TC-193–200) — untouched.
- **Stock operations** — move, adjust, dispose, quarantine release (TC-357–380). Only the
  borrow-overdraw guard was exercised.
- **Damaged / not-working returns → quarantine** (TC-343–345).
- **Admin CRUD and a live settings change** (TC-381–432) — the pages render; nothing was created
  or edited, so "takes effect immediately, without a redeploy" is still unverified.
- **Concurrency** (TC-567–580) — needs genuinely parallel clients.
- **The four paused reversal tests** (G-20) — still blocked on the harness override.

## 11. Notes for the next session

- The API rate limits are real and correct: `THROTTLE_AUTHENTICATED_LIMIT` 300/60s shared per IP,
  and a login burst limit of 10/60s. A test harness will trip both. The one in
  `scratchpad/api.js` paces at 400ms, caches tokens to disk, and backs off 20s on a 429 — without
  all three it looks like the app is broken when it is the defence working.
- **Port 5173 binds again.** The Windows reservation that blocked it has cleared, so the
  integration suite should be runnable — that is the cheapest coverage still on the table.
