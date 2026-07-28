---
name: add-endpoint
description: Add a new API endpoint following this project's module conventions. Use when adding, changing, or reviewing a backend route.
argument-hint: "[METHOD /path — purpose]"
---

Add endpoint: **$ARGUMENTS**

Follow the existing module pattern exactly. Find the closest existing endpoint first and match it —
consistency beats your preference.

## Checklist

- [ ] **Contract first.** Add the zod request/response schemas to `packages/shared/src/contracts/`
      so the frontend imports the same types. Never define the shape twice.
- [ ] **Controller** — route, `@Roles(...)`, zod parse, delegate to service, serialise. No logic.
- [ ] **Service** — the actual rules. Transaction if more than one row changes. Typed domain
      exceptions, never bare strings.
- [ ] **Repository** — SQL. Parameterised always. Paginated if it returns a list.
- [ ] **Authorization** — role guard for the coarse check; ownership and state checks in the
      service. Actor is `req.user.id`, never from the body.
- [ ] **Idempotency** if it mutates: accept `Idempotency-Key`, unique-indexed.
- [ ] **Events** — if this changes requisition or borrow state, append the `requisition_events` /
      ledger row in the same transaction, and emit the websocket invalidation after commit.
- [ ] **Tests** — happy path, each validation failure, each permission denial, and the concurrent
      case if it touches stock.
- [ ] **No hardcoding** — thresholds from `SettingsService`, config from the config module.

## Before you finish

Re-read the endpoint as if you were the frontend engineer consuming it. Is the error shape usable?
Does a 409 tell them what to refetch? If not, fix it now.
