---
paths:
  - apps/api/src/database/**
  - apps/api/src/modules/stock/**
---

# Database and stock integrity

The part of this system where a bug is permanent. Slow down here.

## Migrations

- Every schema change is a checked-in, reviewed migration file. `synchronize` is `false` everywhere.
- **Additive first.** Add nullable → backfill → enforce not-null in a later migration.
- **Never rename in place.** Add the new column, copy, ship, drop the old one next release.
- **Never drop a column in the same release that stops writing to it.** Release N stops using it;
  release N+1 drops it. Otherwise a rollback loses data.
- Every migration is tested by running it against a copy of seeded data, then rolling back.
- Migrations never contain business data. Seeds do, and seeds are idempotent (`ON CONFLICT DO NOTHING`).

## Constraints belong in the database

Application checks are advisory; constraints are guarantees. Required on stock:

```sql
CHECK (quantity >= 0)
CHECK (reserved_qty >= 0 AND reserved_qty <= quantity)
UNIQUE (product_id, compartment_id)
```

If a rule can be expressed as a constraint, it is a constraint — not only a service check.

## StockService is the only writer

No other module issues INSERT/UPDATE against `stock_placements` or `stock_ledger`. Every operation:

1. Opens a transaction
2. `SELECT ... FOR UPDATE` on the affected placement rows, **ordered by id ascending**
3. Re-reads quantities from the locked rows — never trusts a value read earlier in the request
4. Applies the change
5. Appends exactly one `stock_ledger` row describing it
6. Commits

`available = quantity - reserved_qty`. Borrow requests reserve; issuing decrements both;
returns increment quantity. A consumable is issued and never returns.

## The ledger is append-only

No UPDATE, no DELETE, enforced by revoking those grants on the application DB role. A correction
is a new compensating row, never an edit. `SUM(ledger) = placements.quantity` per product is checked
by a nightly job; a mismatch is an alert, not a warning.

## Queries

- Every list endpoint is paginated. No unbounded `SELECT *` on ledger or borrow history.
- N+1 queries are a review blocker. Use joins or a dataloader, and check the query count in tests.
- Index before you need it on: product name (trigram), ledger by product+date, approvals by
  assignee+action, notifications by user+read.
