## 15. Integration API — API keys and the one-call take

For engineers connecting another system to IMS: the lab drawer panel, the voice assistant, a
script. Decisions of record: Phase 10 (`plan/PHASE-10-api-keys.md`, K1–K9) and
[ADR-0002](../adr/0002-api-keys-and-direct-take.md), with the answered questions OQ-KT1 – OQ-KT9
in `docs/state/OPEN-QUESTIONS.md`.

The admin page (**Admin → API keys → How to use this key**) generates its list of endpoints from
the running server. If this document and that page ever disagree, **the page is right**.

### 15.1 Where to call it

```
https://<ims-hostname>/api/v1
```

**Use the HTTPS hostname.** A key is a bearer credential: anyone who can read it off the wire can
use it until it is revoked. The demo stack's Caddy publishes plain HTTP on port **5173**, and that
port must be firewalled so that only the reverse proxy can reach it (`docs/RUNBOOK.md` §0). No
hostname is recorded in this repository; every runbook line says `<host>`, so ask the operator.

### 15.2 Getting a key

An administrator issues keys under **Admin → API keys**. The raw key (`ims_…`) is shown **once**
and cannot be recovered; losing it means issuing another. Only its SHA-256 hash is stored.

| Kind of key | Needs a service account | Expiry | Can do |
|---|---|---|---|
| Read-only (`inventory:read` only) | No | Any, or never (K6) | Read the catalogue, categories and locations |
| Write (any other scope) | **Yes** | **Required**, at most `API_KEY_WRITE_MAX_LIFETIME_DAYS` (default 180) | The writes its scopes name |

A **service account** is the principal a write key acts as, for example "Lab drawer panel C576".
Every record the key writes (borrow rows, ledger entries, audit rows) names that account, and the
audit row also names the key. A service account:

- cannot sign in;
- never appears as a person (notifications, requisition stages, pickers);
- always holds `GENERAL` and `INVENTORY_MANAGER`.

**Deactivating the account stops every key bound to it at once.**

### 15.3 Authenticating

```bash
curl -H "Authorization: Bearer ims_…" https://<ims-hostname>/api/v1/products
```

`?api_key=ims_…` is accepted **on GET only, and only for a read-only key**, so a person can paste
a link into a browser. It is refused with `400 API_KEY_QUERY_NOT_ALLOWED` in two cases: on any
write, even alongside a valid header, and for any key that holds a write scope, even when reading.
A key in a URL ends up in access logs and browser history.

**Default-deny.** A key reaches a route only if the route declares a scope that the key holds.
Every other route answers `403 API_KEY_SCOPE_DENIED`: auth, admin, users, settings, funds,
requisitions, approvals, borrowing lists and the stock ledger. An integration test walks the live
route table to prove this for every route (`apps/api/test/api-key-writes.int-spec.ts`).

### 15.4 Scopes and routes

| Scope | Routes |
|---|---|
| `inventory:read` | `GET /catalogue`, `GET /products`, `GET /products/:id`, `GET /categories`, `GET /locations`, `GET /locations/rooms` |
| `catalog:write` | `POST /categories`, `PATCH /categories/:id`, `POST /products`, `PATCH /products/:id` |
| `locations:write` | `POST /locations/zones`, `POST /locations/compartments` |
| `stock:receive` | `POST /stock/receive` |
| `stock:take` | `POST /stock/take` — only while `ALLOW_DIRECT_TAKE=true` |

There is **no** scope for borrowing lists or the stock ledger. Both name employees, and Ayman's
K2 keeps them out of key reach (OQ-KT6). For the same reason, `GET /products/:id` returns an
**empty `activeBorrows`** to a key. How much is out still shows in the placements. Scopes narrow
what a key can do; the route's own role check still applies on top.

### 15.5 Examples

The request bodies are the same zod schemas the web app uses (`packages/shared/src/contracts/`).
Fields left out take their defaults.

**Read the catalogue page by page** (`limit` ≤ 100):

```bash
curl -H "Authorization: Bearer $IMS_KEY" \
  "https://<ims-hostname>/api/v1/products?page=1&limit=100"
```

**Create a product** (`catalog:write`). Returns `201` and the product:

```bash
curl -X POST -H "Authorization: Bearer $IMS_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Resistor 10k 0603","unit":"pcs","categoryId":null}' \
  https://<ims-hostname>/api/v1/products
```

**Create a zone** in an existing room (`locations:write`):

```bash
curl -X POST -H "Authorization: Bearer $IMS_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Drawer bank C","roomId":"<room uuid>"}' \
  https://<ims-hostname>/api/v1/locations/zones
```

**Receive stock** (`stock:receive`). Send an `Idempotency-Key` so a retry cannot receive twice.
Returns `200` and every placement of the product:

```bash
curl -X POST -H "Authorization: Bearer $IMS_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"productId":"<uuid>","compartmentId":"<uuid>","quantity":50,"note":"Reel from Mouser"}' \
  https://<ims-hostname>/api/v1/stock/receive
```

**Take stock** (`stock:take`). This is the one call that replaces borrow-create plus approve.
`Idempotency-Key` is **required**:

```bash
curl -X POST -H "Authorization: Bearer $IMS_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"productId":"<uuid>","compartmentId":"<uuid>","quantity":2,
       "purpose":"Rafiq, bench 4","channel":"panel"}' \
  https://<ims-hostname>/api/v1/stock/take
```

```json
{
  "borrowId": "…", "borrowNo": "BR-000123", "status": "ISSUED",
  "productId": "…", "compartmentId": "…", "quantity": 2,
  "isReturnable": false, "expectedReturnDate": null,
  "placement": { "quantity": 8, "reservedQty": 0, "quarantinedQty": 0, "availableQty": 8, "…": "…" }
}
```

What a take does:

- **It is recorded against the caller.** For a key that is its service account; for a person,
  themselves. There is no field to name someone else (OQ-KT1). If a person at the panel should be
  on record, put their name in `purpose`.
- **`isReturnable` defaults to the product's own setting.** A returnable item needs
  `expectedReturnDate` (`YYYY-MM-DD`); a consumable must not have one.
- **At most `DIRECT_TAKE_MAX_QTY` units per call** (default 10). Anything larger goes through a
  borrow request.
- **The response carries ids and quantities only, with no names.** `placement` is `null` when the
  take emptied the shelf.
- **It is the IM's issue-from-stock handover** (`BorrowingService.issueFromStock`): one
  transaction, a borrow row going straight to `ISSUED`, a ledger `ISSUE` with `ref_type = BORROW`,
  and one audit row, `borrowing.issue_on_behalf`, with `via: "stock.take"` and the declared
  `channel`.
- **A take made with a key notifies every IM in-app** (`borrowing.taken_by_key`, OQ-KT4).
- **A returnable item comes back through the ordinary `POST /borrowing/:id/returns`**, done by an
  IM, with no special case.
- **`channel`** (`api` | `voice` | `panel` | `web`) is what the caller *says*. It is stored and
  decides nothing. Which key acted is recorded separately, in `audit_log.api_key_id`.

### 15.6 Idempotency

Send `Idempotency-Key: <fresh UUID>` on each distinct write. A request repeated with the same key
returns the **first** answer and does nothing again. If the first attempt is still running, the
repeat gets `409 CONFLICT`: retry after a moment. Keys are scoped to the caller and the operation,
so two panels cannot collide, and they are kept for one day. It is **required** on
`POST /stock/take` (`400 VALIDATION_FAILED` without it) and accepted on `POST /stock/receive`.

### 15.7 Rate limits

`THROTTLE_APIKEY_LIMIT` requests per `THROTTLE_APIKEY_TTL_SECONDS` (default 120 per 60 s), per
endpoint, counted twice:

- **per key**, so a key's budget follows it whichever host uses it;
- **per address**, across every key sent from that address, so made-up keys cannot be rotated
  for unlimited attempts.

Over either limit, the answer is `429 RATE_LIMITED`.

### 15.8 Errors

Every error body is `{ "code", "message", "details"? }`. Branch on `code`, never on `message`.

| Status | `code` | Meaning and what to do |
|---|---|---|
| 401 | `API_KEY_INVALID` | Unknown, revoked or expired key. Get a new one. |
| 403 | `API_KEY_DISABLED` | The key, or its service account, is switched off. Ask an admin. |
| 403 | `API_KEY_SCOPE_DENIED` | The route is not open to keys, or not to this key's scopes. |
| 403 | `API_KEYS_DISABLED_IN_DEMO` | Production is running with demo accounts on; every key is refused. |
| 400 | `API_KEY_QUERY_NOT_ALLOWED` | A key in the URL on a write. Use the header. |
| 403 | `DIRECT_TAKE_DISABLED` | `ALLOW_DIRECT_TAKE` is off. Raise a borrow request instead. |
| 403 | `FORBIDDEN` | The service account lacks the role the route requires. |
| 400 | `VALIDATION_FAILED` | Bad body, a missing `Idempotency-Key` on take, or a take over the per-call cap. `details` names the field. |
| 409 | `INSUFFICIENT_STOCK` | Not enough available on that shelf. Nothing changed. |
| 404 | `NOT_FOUND` | Also returned for **an emptied shelf**: its row is removed at zero (OQ-KT9). |
| 409 | `CONFLICT` | Archived product, or the same idempotent request is still in flight. |
| 429 | `RATE_LIMITED` | Slow down. |

### 15.9 Switching it on

| Setting | Default | Effect |
|---|---|---|
| `ALLOW_DIRECT_TAKE` | `false` | Opens `POST /stock/take`. Off: `403 DIRECT_TAKE_DISABLED`, and the route is not listed on the usage page. |
| `DIRECT_TAKE_MAX_QTY` | `10` | Units per take. The number is a guess sized for a drawer panel (OQ-KT11). |
| `API_KEY_WRITE_MAX_LIFETIME_DAYS` | `180` | The longest a write key may live. |
| `THROTTLE_APIKEY_LIMIT` / `_TTL_SECONDS` | `120` / `60` | Per key and per address, each per endpoint. |

Keys work only while demo mode is off in production. Before relying on them, see
`docs/RUNBOOK.md` §0: turn demo mode off, reset the seeded passwords, and **revoke any key or
service account created while demo mode was on**.
