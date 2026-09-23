---
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - apps/api/test/**
---

# Testing

## What is worth testing here

Priority order, because test budget is finite:

1. **Stock arithmetic and concurrency.** Reserve, issue, return, move, split, oversell prevention.
   These get integration tests against a real Postgres, not mocks.
2. **Approval state machine.** Every legal transition, and the illegal ones rejected.
3. **Threshold and approver-count logic**, including that a threshold change does not affect
   in-flight requisitions.
4. **Permission boundaries.** Each role hitting each endpoint it should not reach.
5. Everything else: happy path only.

Do not write tests that assert a mock was called. Assert on observable behaviour.

## The concurrency test is mandatory

Phase 1 is not done without a test that fires N simultaneous borrow requests against a product
with stock 1 and asserts exactly one succeeds and the ledger has exactly one ISSUE row. Use
`Promise.all` with real connections. This test is the reason the locking exists.

## Rules

- **Every fixture value a spec later matches on must be run-unique.** `resetData` cannot delete
  products or categories — every foreign key to them is `ON DELETE RESTRICT` — so they accumulate
  across the whole integration run, and a spec that assumes it has the database to itself is
  wrong by the second file. Suffix with `randomUUID().slice(0, 8)`, and **filter by id, never by
  a name substring**: `line.includes('Doomed')` also catches the `Doomed …` another spec left
  behind. This has now bitten twice — once as a `categories_root_name_key` collision, once as a
  phantom second deactivation — and both passed in isolation and failed in the suite.
- Integration tests run against a throwaway Postgres (testcontainers or a compose service),
  migrated from scratch each run. Never against the dev database.
- Each test creates its own data via factories and cleans up in a transaction rollback.
  No shared fixtures that tests mutate — that is how you get order-dependent flakes.
- No `sleep`. Await the actual condition.
- A flaky test is deleted or fixed the day it appears. A tolerated flake trains everyone to
  ignore red.
