# 0001 — Stock as placements plus an append-only ledger

- **Status:** Accepted
- **Date:** 2026-07-28
- **Supersedes:** none

## Context

Stock must support a product held in several compartments at once, partial moves between them
("move 30 of 70"), a stable product identity across moves, and a full history of location changes.
Concurrent borrow approvals must never oversell. And when a number eventually looks wrong, someone
has to be able to find out why — the physical shelf and the database silently diverging is the
failure mode that destroys trust in a system like this.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Single `quantity` column on the product | Simplest | Cannot express multiple locations at all |
| Per-unit rows (one row per physical item) | Exact, supports serials | Heavy for consumables; 70 rows to move 30; overkill at this scale |
| Placements (product × compartment × qty) + append-only ledger | Handles splits naturally, stable product ID, auditable | Two structures to keep in agreement |

## Decision

Stock is `stock_placements` (product × compartment × quantity, with `reserved_qty`), and every
mutation appends an immutable row to `stock_ledger`. The ledger is authoritative; placement
quantities are a derived cache. `StockService` is the only writer, and every operation runs in one
transaction with `SELECT ... FOR UPDATE` on the affected placements, ordered by id.

## Consequences

**Easy:** partial moves, per-location display, concurrent safety, and answering "how did this
number get here" for any product on any date.

**Hard:** two structures must agree, so a nightly job asserts
`SUM(ledger) = placements.quantity` per product and alerts on a mismatch. Serial-number tracking is
not available without turning on the dormant `asset_units` table.

**We revisit this if** finance starts requiring per-asset custody ("which laptop does Saad have"),
at which point `asset_units` becomes primary for serialised categories while consumables stay
quantity-based.
