DONEpending |DONEpending |DONEpending |DONEpending |DONEpending |# Phase 08 — reversible post-approval stages, lifecycle truth, per-person dashboard

**Opened:** 2026-08-26 · **Source:** Ayman, 2026-08-26 (four asks in one message)
**Baseline commit:** `52a1e9e`

Four pieces of work, in dependency order. Part C is independent and lands first because Part A
depends on the tracker telling the truth about a status that has moved backwards.

## Baseline for this phase — measured 2026-08-26, before the first edit

```
pnpm typecheck                      exit=0, clean
pnpm lint                           20 errors   (compare against 20, not zero)
pnpm test                           shared 13 · api 58 · web 221, all pass
pnpm --filter @ims/api test:int     612 pass / 0 fail (46 files)
```

## The chain this phase is about

| # | Stage | Status | Reverse before this phase |
|---|---|---|---|
| 1 | Generate BOM | `BOM_GENERATED` | ✅ void BOM → `APPROVED` |
| 2 | Send to Accounts | `SENT_TO_ACCOUNTS` | ❌ |
| 3 | Record money received | `FUNDS_PARTIAL` / `FUNDS_RECEIVED` | ❌ |
| 4 | Record purchase | `PURCHASED` | ❌ |
| 5 | Verify purchase | `PURCHASE_VERIFIED` | ✅ `unverify-purchase` |
| 6 | Add to inventory | `STOCKED` | ❌ — and stays that way, by ruling |
| 6b | Borrow to user | `STOCKED` | ❌ — same class as 6: stock has moved |

Ayman's list named 3–6 and asked what was missing: stages 1, 2 and 6b.

## Why stages 3 and 4 needed a migration

`FUNDS_PARTIAL` vs `FUNDS_RECEIVED` is **derived at every read** from `SUM(fund_receipts.amount)`
against `approved_amount` — migration 0016 chose that deliberately, so the money can never drift
from the rows that justify it. A consequence nobody had hit until now: you cannot undo a receipt by
flipping the status, because the next read re-derives it straight back. The receipt has to leave the
sum, and deleting a money row in a system with an audit trail is not an option.

Hence `voided_at` / `voided_by` / `void_reason`: the row stays as evidence, the arithmetic skips it.

**Every read of the two tables — the complete list, ten sites.** The plan first said four; that
was wrong, and the correction is the point. Enumerating properly before writing the filter is what
this list is for, because a missed site does not fail — it silently counts money that was undone.

`funds.repository.ts` (8):

- `listReceipts`, `sumReceipts`
- `listPurchases`, `sumPurchases`
- `lockPurchaseLine` — the purchase-context read. A voided purchase now yields no context, so
  receiving one of its lines refuses rather than booking goods against an undone purchase.
- `countOutstandingLines` — voided lines are not outstanding, they are gone
- `findPurchase` — used by invoice attach and download
- `countPurchasesWithoutInvoice`

`reports.repository.ts` (2): the `funded` and `spent` subqueries.

`computeCurrentFunding` needs no change of its own — it delegates to `sumReceipts`,
`sumPurchases` and `sumReturns`. `fund_returns` is untouched: a return is money genuinely handed
back, not a mistake being undone.

An eleventh site appearing later is the failure mode to watch. The guard against it is the
integration test that voids one row and asserts every derived figure moves, not the list above.

## Rulings taken 2026-08-26 (all recorded in DECISIONS.md)

| Question | Ruling |
|---|---|
| Migration 0028 | **Approved.** Additive columns only, reversible down. |
| Invoice required to verify? | **Yes — unchanged.** Ayman chose "as today"; I had described today wrongly as optional. `funds.service.ts:504` has always thrown `INVOICE_MISSING`. The status quo stands and B-1 becomes more useful, not less: the requirement is now satisfiable inside the form that enforces it. |
| Dashboard visibility | **Own figures only.** No permission change, nothing near the auth boundary. |
| Undo depth | **One entry per press, repeatable.** A three-instalment requisition must not lose two receipts to one click. |
| Reversal actor | IM/Admin, matching the forward action on the same stage. Not asked — follows the existing `@Roles`. |
| Reason on a reversal | Required, matching `unverify-purchase`. Not asked — consistency. |

## Tracking ledger

Status values: `TODO` · `IN PROGRESS` · `DONE` (gate green, handoff block issued) · `BLOCKED`.

| # | Item | SPEC | Status | Commit |
|---|---|---|---|---|
| C-1 | Lifecycle tracker: derive stage state from status, not from append-only events | NO-BASIS (defect in shipped surface) | DONE | `8633384` |
| A-0 | Migration 0028 — void columns on `fund_receipts` and `purchases` | DERIVED (ruling 2026-08-26) | TODO | |
| A-1 | Exclude voided rows from all four read sites | DERIVED | TODO | |
| A-2 | `undo-send-to-accounts` → `BOM_GENERATED` (no rows voided) | DERIVED | TODO | |
| A-3 | Void one fund receipt; status re-derives from the remaining sum | DERIVED | TODO | |
| A-4 | Void one purchase; status re-derives from what remains | DERIVED | TODO | |
| A-5 | `FundsPanel`: a Back button at every reversible stage, with a naming confirm | DERIVED | TODO | |
| B-1 | Invoice attach moves into the Verify purchase form; `InvoiceRow` becomes download-only | DERIVED | TODO | |
| D-1 | `GET /dashboard/me` — requisition, borrowing and spend counters for the caller | DERIVED | TODO | |
| D-2 | Dashboard page renders the three blocks | DERIVED | TODO | |

## Invariants this phase comes near

- **Only `StockService` writes stock.** No reversal in this phase touches `stock_placements` or
  `stock_ledger`. That is the whole reason `STOCKED` has no Back button: undoing it would mean a
  stock movement, which is a different and deliberately harder operation.
- **Append-only event log.** Reversals *append* a `*_VOIDED` event. Nothing is deleted or rewritten.
- **Money is derived, never cached.** The void columns preserve that: the sum still decides the
  status, it just sums fewer rows.
- **Permissions unchanged.** Every new endpoint carries the same `@Roles` as its forward twin, and
  the dashboard reads only the caller's own rows.

## Explicitly out of scope

- Undoing `STOCKED` or a borrow-out. Stock has moved; the correction is a stock adjustment.
- Editing a receipt or purchase in place. Void and re-record — an edited money row has no history.
- Voiding a receipt on a requisition that already has a live purchase. Undo the purchase first;
  the endpoint refuses, rather than leaving a purchase funded by money that no longer exists.
