# Phase 02 — Borrowing

**Goal:** the complete borrow loop. This is the smallest slice that is useful to real people —
ship it and let them use it while Phase 03 is built.

**Reference:** `docs/reference/05-user-flows.md` §5.1, `docs/reference/06-screen-map.md`

## Tasks

- [x] **2.1 Projects** — create on the fly during a borrow, duplicate-name warning (OQ-09).
      *Accept:* "Falcon" and "falcon" trigger the warning; the user can still proceed deliberately.

- [x] **2.2 Borrow request** — product, quantity, project, returnable/consumable (defaulting from
      the product), expected return date, purpose. Reserves stock on submit.
      *Accept:* `available` drops immediately; rejecting releases it; two users cannot reserve the
      same last unit.

- [x] **2.3 IM approval** — approve issues the stock (quantity and reserved both decrement, ISSUE
      ledger row) and rejects release the reservation. Idempotent under double-click.
      *Accept:* double-submitting the same `Idempotency-Key` issues stock once.

- [x] **2.4 Returns** — full and partial. `borrow_returns` rows, RETURN ledger rows, status moves
      through `PARTIALLY_RETURNED` to `RETURNED`. Consumables never return.
      *Accept:* returning 3 of 5 leaves the request partially returned with 2 outstanding.

- [x] **2.5 Borrow log** — per product, newest first, paginated: borrower, project, quantity,
      borrowed, expected, returned, purpose, status. Overdue rows flagged.
      *Accept:* 10,000 log rows still page in under 200ms.

- [x] **2.6 IM borrow screen** — searchable table (product, taken by, taking date, return date,
      project, status), filters `All / Pending / Out / Returned / Overdue`, inline approve/reject,
      "Approved ✎" with the edit affordance (OQ-04), a Return action per row.
      *Accept:* search and filter compose correctly; approving updates the row without a refresh.

- [x] **2.7 General user screens** — inventory browse and search with per-location availability,
      borrow dialog, My Borrowings.
      *Accept:* a general user cannot see or hit any IM endpoint.

- [x] **2.8 Notifications** — instant socket popup to the IM on a new request (dismissible, stays
      in the pending list), bell to the requester on approve/reject, daily overdue job.
      *Accept:* the popup appears on login for requests raised while the IM was offline.

## Exit criteria

- Everything from Phase 01, still green
- A full loop works end to end: request → approve → issue → partial return → full return, with
  the ledger reconciling at every step
- Permission tests: general user blocked from every IM route
- The system is genuinely usable by the IM for daily stock work
