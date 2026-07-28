# Phase 01 — Inventory core

**Goal:** a correct stock register. This is the foundation everything else depends on, and the one
place a bug is permanent. Do not rush it.

**Reference:** `docs/reference/04-domain-model.md`, `docs/reference/07-data-model.md`,
`.claude/rules/40-database.md`

## Tasks

- [ ] **1.1 Categories** — tree, `is_trackable` flag (laptops and R&D hardware on; furniture off,
      extendable per requirements §11). Soft delete only.
      *Accept:* toggling `is_trackable` on a category takes effect without a code change.

- [ ] **1.2 Products** — `product_code` (the Storage ID), name, category, unit,
      `default_returnable`, `is_serialised` (dormant, see OQ-03), soft delete.
      *Accept:* deleting a product referenced by history hides it but preserves the history.

- [ ] **1.3 Locations** — `storage_zones` ("Meta", "Nvidia") → `storage_compartments` ("1A", "3C"),
      unique compartment code per zone, both IM-creatable.
      *Accept:* duplicate compartment code within a zone is rejected by a constraint, not just the UI.

- [ ] **1.4 Placements + ledger** — `stock_placements` with `CHECK (quantity >= 0)` and
      `CHECK (reserved_qty >= 0 AND reserved_qty <= quantity)`, `UNIQUE (product_id, compartment_id)`;
      append-only `stock_ledger` with UPDATE/DELETE revoked from the app DB role.
      *Accept:* an attempt to UPDATE the ledger as the app user fails at the database level.

- [ ] **1.5 StockService** — the only writer. `receive`, `move`, `reserve`, `release`, `issue`,
      `returnStock`, `adjust`. Every operation: one transaction, `SELECT ... FOR UPDATE` ordered by
      placement id, re-read locked values, apply, append exactly one ledger row.
      *Accept:* the concurrency test in 1.8 passes; no other module imports the placement repository.

- [ ] **1.6 Partial move / split** — move N of M from one compartment to another; source row is
      removed when it hits zero; reserved units cannot be moved out from under a pending borrow.
      *Accept:* moving 30 of 70 leaves two placements totalling 70 and writes one MOVE ledger row.

- [ ] **1.7 IM inventory UI** — product list with trigram search, product card showing total plus
      per-location chips in deterministic colours, full CRUD, category and location management,
      move dialog capped at *available* rather than quantity.
      *Accept:* the move updates both chips without a manual refresh (websocket invalidation).

- [ ] **1.8 Concurrency + invariant tests** — N simultaneous reserves against quantity 1: exactly
      one succeeds. Nightly job asserting `SUM(ledger) = placements.quantity` per product.
      *Accept:* both tests exist and pass against real Postgres, not mocks.

## Exit criteria

- Everything in Phase 00's exit criteria, still green
- The concurrency test passes repeatedly (run it 10 times)
- Stock cannot be driven negative through any endpoint, including concurrent ones
- Ledger and placements reconcile after a scripted sequence of 100 random operations
