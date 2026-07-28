---
paths:
  - apps/api/**
---

# Backend rules (NestJS)

## Module shape

Every feature is a module directory, no exceptions, no shared "utils" dumping ground:

```
src/modules/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts      HTTP only: parse, authorize, delegate, serialise
├── <feature>.service.ts         business rules, transactions
├── <feature>.repository.ts      SQL / query builder
├── dto/                         zod schemas + inferred types
├── entities/
└── <feature>.service.spec.ts
```

Controllers contain no business logic. If a controller has an `if` that isn't a guard clause,
it belongs in the service.

## Validation

Every request body, query and param is parsed by a zod schema at the controller boundary.
An unvalidated `any` reaching a service is a bug. Types are *inferred from* the schema
(`z.infer<typeof X>`) — never declared twice.

## Transactions

Anything touching more than one row runs inside one transaction, passed explicitly as a
parameter. No ambient/implicit transaction context.

```ts
await this.db.transaction(async (tx) => {
  const placement = await this.stock.lockPlacement(tx, placementId); // SELECT ... FOR UPDATE
  ...
});
```

Rules:
- Lock rows in a **consistent order** (always by `placement.id` ascending) or you will deadlock.
- Never call an external service (email, PDF) inside a transaction. Enqueue it for after commit.
- Idempotency: mutating endpoints accept an `Idempotency-Key` header, stored with a unique index.
  A repeat key returns the original response instead of acting twice.

## Authorization

- `@Roles(Role.INVENTORY_MANAGER)` for coarse role checks.
- Ownership and state checks live in the service, not the guard — "can this approver withdraw
  *this* approval right now" depends on the requisition's status.
- Never trust a client-supplied user id. The actor is always `req.user.id`.

## What never goes in the backend

- `process.env` outside `config/`
- Business values as literals (see `10-no-hardcoding.md`)
- Direct writes to `stock_placements` or `stock_ledger` from outside `StockService`
- `synchronize: true`, `db push`, or any auto-schema behaviour
