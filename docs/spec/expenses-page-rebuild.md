# Expenses page rebuild — build spec

Reference image: `expenses_mockup.png`. The image is the **layout and hierarchy**, not
the data — every number in it is placeholder. This document is the contract; where the
image and this document disagree, this document wins.

**This is a feature, not a QA defect.** Own session, after the defect round. It reuses the
D-020 reports query and the `REPORTING_TIME_ZONE` date discipline, so it should land *after*
D-020 and the date family are committed, not alongside them.

---

## SPEC classification

`NO-BASIS` on everything below the four-stage header. The requirements document (§10) asks
only that the report be exportable as PDF/CSV; it says nothing about KPI tiles, a month
ledger, a trend, or top items. So the whole page beyond export is a design addition, recorded
as Ayman's decision. **Do not treat the mockup as a requirement** — it's a proposal Ayman
approved. If any piece conflicts with an existing invariant, STOP and report rather than
building to the picture.

---

## The four-stage flow (top block)

Four figures, left to right, each the source of the next:

| Stage | Meaning | Source |
|---|---|---|
| Requested | what the requester asked for | sum of `requested_amount` over in-scope requisitions |
| Approved | what an approver sanctioned | sum of `approved_amount`, **status-filtered** |
| Funded | money actually received back from Accounts | sum of funds received against the requisition |
| Spent | what the IM recorded spent, items + transport | sum of purchase/spend records |

**Status filter is load-bearing and is the D-020 fix.** Approved must sum only requisitions
whose status is `APPROVED` or `FULLY_FUNDED` (i.e. actually approved, not rejected, not
still at IM review, not cancelled). This is the exact predicate committed for D-020 — reuse
it, do not re-derive it. If you write a second unfiltered sum, you have reintroduced D-020.

**Two gaps under the flow, both real and not to be conflated:**
- `approved − funded` = **Awaiting from Accounts** (approved but not yet released)
- `funded − spent` = **In hand, unspent** (received but not yet spent)

The small "Items / Transport" pair under the header splits Spent into its two components
(see below).

**Investigation to run first (INVESTIGATION-ONLY, report before building):** is recorded
spend bounded by funded? You cannot spend money Accounts has not released, so `spent ≤ funded`
should hold. If the schema/service permits spend to exceed funded, that is a D-025-family
validation gap — report it, don't silently design around it.

---

## Items vs transport split

Spent breaks into two numbers that must sum to total spent:
- **Items** — sum of BOM/purchase line totals (per-line: qty × unit cost)
- **Transport** — sum of the per-requisition transportation cost

These live at **different levels** — transport is one value per requisition, items are per
line. Sum them separately and confirm `items + transport == spent` in a test, because the
page's entire promise is "figures reconcile." A footer total that doesn't balance is worse
than no footer.

---

## Month-by-month ledger (table)

One row per calendar month, most recent months, columns: Month · Items · Transport · Total ·
(inline bar). Footer row sums each column.

- Grouped by calendar month in `REPORTING_TIME_ZONE` (`Asia/Dhaka`), **not** UTC. Same
  discipline as the D-014 date family — a spend recorded at 23:00 on the 31st in UTC lands in
  the wrong month otherwise.
- The footer total must equal the sum of the rows, which must equal the flow header's Spent
  for the same range. Three places, one number — assert it.

---

## Spend trend (rolling 12 months)

A line chart, **rolling last 12 calendar months ending with the current month**, auto-updating
with no manual intervention.

- Window = the 12 months ending with the current month, computed from *now* **in
  `REPORTING_TIME_ZONE`**. On the 1st of a month in UTC-6, a UTC "now" is still the previous
  day/month for six hours — the window must not shift. Reuse the timezone helper from the date
  fixes; do not read `new Date()` in UTC.
- The label reads the actual computed range ("Sep 2025 – Aug 2026"), not the word "all time" —
  a named range is honest and self-checking.
- **Empty months render as zero, not omitted.** A month with no spend gets a data point at 0
  so the line touches the axis. `group by month` naturally drops empty months — the query must
  left-join or generate the 12-month series and coalesce to 0. Assert this with a fixture that
  has a gap month.
- Y-axis auto-scales to the data (Chart.js default). Each point = items + transport for that
  month, the same figure as the ledger Total column.

---

## Top items (list)

Ranked bars, item name + total spend, "by spend" = **qty × unit cost aggregated across BOMs**,
this month.

**BLOCKED ON D-002 — build this last, or stub it.** Grouping "by item" requires a stable item
identity. Every requisition line currently has `product_id = null` because the catalogue picker
has been broken since 29 July (D-002). Until D-002 lands and lines carry a real `product_id`,
there is nothing to group by except free-text names, which won't aggregate ("Lenovo T14" and
"lenovo thinkpad" are two rows). Either:
- land D-002 first, then group by `product_id`, or
- ship the page without this panel and add it in a follow-up.

Do not group top-items by free-text name as a workaround — it produces wrong totals that look
right.

---

## Export

Keep the existing CSV/PDF actions, now fixed by D-024 (blob download, correct prefix). The
export must reflect the same filtered figures as the page — if the page filters Approved to
approved-only, the export must too, or Accounts gets two different numbers for the same month.

---

## Build order

1. **Flow header + items/transport split + two gaps** — reuses the D-020 query, lowest risk.
2. **Month ledger** — same query grouped by Dhaka month; assert the three-way reconciliation.
3. **Trend** — rolling 12-month window, empty-months-as-zero, timezone-correct.
4. **Top items** — only after D-002; otherwise omit.

## Gate

Own gate — this touches money and dates. In addition to the standard suite:
- a test asserting `items + transport == spent`
- a test asserting ledger-footer == flow-Spent == trend-sum for one range
- a test with a gap month proving the trend emits a 0, not a hole
- a test proving the rolling window is computed in `Asia/Dhaka` (fails under `TZ=UTC` if the
  helper is wrong — same shape as the D-014 offset guard)
- confirm Approved is status-filtered (the D-020 predicate) — a rejected requisition must not
  appear in Approved

## What NOT to do

- Do not treat the mockup's numbers as real or its layout as a requirement.
- Do not add a second unfiltered `approved_amount` sum (that is D-020).
- Do not compute any month boundary or "now" in UTC.
- Do not group top-items by free-text name.
- Do not let the export and the page show different figures for the same range.

---

## Build log — 2026-09-02

**Built and shipped.** All four build-order steps landed; nothing was omitted.

| Step | State |
|---|---|
| 1. Flow header + items/transport + two gaps | Done — `ExpenseFlow.tsx`, reusing the D-020 totals |
| 2. Month ledger | Done — `ExpenseLedger.tsx`, footer reconciles with the flow |
| 3. Trend | Done — `GET /reports/expenses/trend`, `SpendTrendChart.tsx` |
| 4. Top items | Done — `GET /reports/expenses/top-items`, `TopSpendItems.tsx` |

### The investigation this document required, answered

**Spend is bounded by funded.** `FundsService.recordPurchase` refuses when
`alreadySpent + alreadyCarried + thisTotal + thisCarriage` exceeds `sumReceipts`, under the row
lock the transaction already holds. Its one escape (`alreadyFunded === 0`) is unreachable through
the API: a purchase requires `FUNDS_RECEIVED`, `FUNDS_PARTIAL` or `PURCHASED`; the first two are
only set by a receipt, voiding the last receipt returns the requisition to `SENT_TO_ACCOUNTS`, and
`CANNOT_VOID_RECEIPT_WITH_PURCHASES` stops receipts being removed under a purchase.

**No D-025-family gap.**

### Preconditions, all already met

D-020 fixed and status-filtered · D-014 timezone discipline already in the repository ·
items/transport already split in the query · D-002 verified: lines carry a real `product_id`, so
Top items was never actually blocked.

### Three deviations, each deliberate

1. **Approved keeps the shipped nine-status predicate**, not the two this document names. There is
   no `FULLY_FUNDED` status, and the two-status reading would drop every requisition past approval
   out of the figure — on live data, 144,700 collapsing to a fraction the moment money moves. This
   document's own instruction, *"reuse it, do not re-derive it"*, settles it in favour of the
   committed predicate. The prose appears to predate the money stages.
2. **Top items ranks `purchase_lines`, not `bom_lines`.** A BOM is a plan; a purchase is what was
   paid. Ranking the plan would give a list that does not add up to the Items figure directly above
   it. Verified live: the ranked rows sum to exactly the Items total (52,000).
3. **The trend reuses `expenses()`** with the window and the gap-filling done in the service,
   rather than new SQL with `generate_series`. Same guarantees — twelve points always, real zeros
   for empty months, window computed in Asia/Dhaka — without a second copy of the status predicate,
   which is how D-020 happened the first time.

### Gate

- `items + transport == spent` — asserted live and in the trend unit tests
- ledger footer == flow Spent == trend point for the month — verified against the running stack
- a gap month emits 0, not a hole — unit test with two non-adjacent months of spend
- the rolling window is computed in Asia/Dhaka — unit test that **fails when the zone is dropped**,
  proven with a red run before the green one
- Approved is status-filtered — verified by rejecting a requisition carrying 40,000 and watching
  the Approved total not move

Typecheck clean · lint 20 (baseline) · unit 13 / 83 / 302 · guard 8 (baseline).
