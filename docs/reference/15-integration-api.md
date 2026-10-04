## 15. Integration API — API keys and the one-call take

For engineers connecting another system to IMS: the lab drawer panel, the voice assistant, a
script. Decisions of record: Phase 10 (`plan/PHASE-10-api-keys.md`, K1–K9) and
[ADR-0002](../adr/0002-api-keys-and-direct-take.md), with the answered questions OQ-KT1 – OQ-KT9
in `docs/state/OPEN-QUESTIONS.md`.

The admin page (**Admin → API keys → How to use this key**) generates its list of endpoints from
the running server. If this document and that page ever disagree, **the page is right**.

### 15.1 Where to call it

```
https://ims.siot.solutions/api/v1
```

**`ims.siot.solutions` is the canonical HTTPS hostname**, with Cloudflare in front and Caddy
behind (Arif, 2026-09-29). Its DNS answers with Cloudflare addresses.

**Use that hostname, never an IP or port 5173.** A key is a bearer credential: anyone who can read
it off the wire can use it until it is revoked. The demo stack's Caddy publishes plain HTTP on port
**5173**, and that port must be firewalled so that only the reverse proxy can reach it
(`docs/RUNBOOK.md` §0).

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
curl -H "Authorization: Bearer ims_…" https://ims.siot.solutions/api/v1/products
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

**`catalog:write` creates and edits, but never archives.** A key that sends `isActive` in
`PATCH /products/:id` or `PATCH /categories/:id` gets `403 API_KEY_SCOPE_DENIED`, whether the
value is `false` (archive) or `true` (re-activate). Archiving takes an item out of circulation,
and that is a person's decision in the web app (OQ-KT12). Every other field stays editable.

**What a key cannot do with locations.** Rooms cannot be created or changed with a key:
`POST /locations/rooms`, and every `PATCH` of a room, zone or compartment, is session-only
(Inventory Manager or Admin). A room must exist before a key can create zones in it. The two reads
return different shapes (`?includeInactive=true` adds archived entries to either):

```jsonc
// GET /locations — a FLAT list of zones, each with its compartments
[{ "id": "…", "name": "Drawer A3", "roomId": "…", "roomName": "Cabinet 1", "isActive": true,
   "compartments": [{ "id": "…", "zoneId": "…", "zoneName": "Drawer A3", "roomId": "…",
                      "roomName": "Cabinet 1", "code": "1B", "storageId": "…",
                      "isActive": true, "placementCount": 2 }] }]

// GET /locations/rooms — the TREE, Room → Zone → Compartment
[{ "id": "…", "name": "Cabinet 1", "isActive": true,
   "zones": [{ "id": "…", "name": "Drawer A3", "…": "…", "compartments": [ /* as above */ ] }] }]
```

### 15.5 Examples

The request bodies are the same zod schemas the web app uses (`packages/shared/src/contracts/`).
Fields left out take their defaults.

**Read the catalogue page by page** (`limit` ≤ 100):

```bash
curl -H "Authorization: Bearer $IMS_KEY" \
  "https://ims.siot.solutions/api/v1/products?page=1&limit=100"
```

**Create a product** (`catalog:write`). Returns `201` and the product:

```bash
curl -X POST -H "Authorization: Bearer $IMS_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Resistor 10k 0603","unit":"pcs","categoryId":null}' \
  https://ims.siot.solutions/api/v1/products
```

**Create a zone** in an existing room (`locations:write`):

```bash
curl -X POST -H "Authorization: Bearer $IMS_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Drawer bank C","roomId":"<room uuid>"}' \
  https://ims.siot.solutions/api/v1/locations/zones
```

**Receive stock** (`stock:receive`). An `Idempotency-Key` is **required** from a key, so a retry
cannot receive twice (OQ-KT10). Returns `200` and every placement of the product:

```bash
curl -X POST -H "Authorization: Bearer $IMS_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"productId":"<uuid>","compartmentId":"<uuid>","quantity":50,"note":"Reel from Mouser"}' \
  https://ims.siot.solutions/api/v1/stock/receive
```

**Take stock** (`stock:take`). This is the one call that replaces borrow-create plus approve.
`Idempotency-Key` is **required**:

```bash
curl -X POST -H "Authorization: Bearer $IMS_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"productId":"<uuid>","compartmentId":"<uuid>","quantity":2,
       "purpose":"Rafiq, bench 4","channel":"panel"}' \
  https://ims.siot.solutions/api/v1/stock/take
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
- **At most `DIRECT_TAKE_DAILY_UNITS_PER_ACCOUNT` units a day per service account** (default 100),
  counted across all of that account's keys and reset at midnight in the business time zone. Over
  it, a take answers `429 DIRECT_TAKE_DAILY_LIMIT_REACHED` with `{ limit, takenToday, requested }`
  and takes nothing. A person taking in the web app has no daily allowance.
- **Takes have their own, tighter rate limit** (§15.7).
- **The response carries ids and quantities only, with no names.**
- **When a take empties a cell:**
  - The response has `placement: null`, because the stock row for an emptied cell is removed.
  - The **next** take on that cell answers `404 NOT_FOUND` ("Stock in that compartment"), and so
    does a take on a cell that never held the product (OQ-KT9).
  - **Treat that 404 as "cell empty", not as a fault.** `409 INSUFFICIENT_STOCK` means the cell
    holds some, but fewer than you asked for.
  - The same `404 NOT_FOUND` also answers an unknown `productId` or `projectId`, and the code does
    not tell them apart. The reading is safe for a client that sends ids it looked up
    (`GET /products`, `GET /locations`); one that sends typed-in ids should check them first.
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
so two panels cannot collide, and they are kept for one day.

It is **required** on `POST /stock/take`, and on `POST /stock/receive` for API-key callers
(OQ-KT10). Without it both answer `400 VALIDATION_FAILED`, with `details` naming the header. A
signed-in person may still receive without one.

### 15.7 Rate limits

`THROTTLE_APIKEY_LIMIT` requests per `THROTTLE_APIKEY_TTL_SECONDS` (default 120 per 60 s), per
endpoint, counted twice:

- **per key**, so a key's budget follows it whichever host uses it;
- **per address**, across every key sent from that address, so made-up keys cannot be rotated
  for unlimited attempts.

Over either limit, the answer is `429 RATE_LIMITED`.

**`POST /stock/take` has its own window:** `THROTTLE_TAKE_LIMIT` takes per
`THROTTLE_TAKE_TTL_SECONDS` (default 10 per 60 s), counted the same two ways, and apart from the
caller's other requests. The eleventh take in the window answers `429 RATE_LIMITED`. At the
defaults that is at most 10 calls × 10 units a minute, and the daily allowance (§15.5) caps the day.

**There is no plain `Retry-After` header.** Each limit that trips sends its own header, a whole
number of **seconds** until that bucket reopens:

- `Retry-After-apiKey` for the per-key limit;
- `Retry-After-apiKeyAddress` for the per-address limit.

Every key response also carries both limits' current state:

- `X-RateLimit-Limit-apiKey`, `X-RateLimit-Remaining-apiKey`, `X-RateLimit-Reset-apiKey`;
- the same three with `-apiKeyAddress`.

Wait for the larger of the `Retry-After-*` values present.

### 15.8 Errors

Every error body is `{ "code", "message", "details"? }`. Branch on `code`, never on `message`.

| Status | `code` | Meaning and what to do |
|---|---|---|
| 401 | `API_KEY_INVALID` | Unknown, revoked or expired key. Get a new one. |
| 403 | `API_KEY_DISABLED` | The key, or its service account, is switched off. Ask an admin. |
| 403 | `API_KEY_SCOPE_DENIED` | The route is not open to keys, or not to this key's scopes, or a key tried to archive or re-activate a product or category. |
| 403 | `API_KEYS_DISABLED_IN_DEMO` | Production is running with demo accounts on; every key is refused. |
| 400 | `API_KEY_QUERY_NOT_ALLOWED` | A key in the URL on any write, or any write-capable key in the URL even for a read. Use the header. |
| 403 | `DIRECT_TAKE_DISABLED` | `ALLOW_DIRECT_TAKE` is off. Raise a borrow request instead. |
| 403 | `FORBIDDEN` | The service account lacks the role the route requires. |
| 400 | `VALIDATION_FAILED` | Bad body; a missing `Idempotency-Key` on take, or on receive from a key; or a take over the per-call cap. `details` names the field. |
| 409 | `INSUFFICIENT_STOCK` | Not enough available on that shelf. Nothing changed. |
| 404 | `NOT_FOUND` | Also returned for **an empty cell**: its row is removed at zero (OQ-KT9). On a take, read it as "cell empty". |
| 409 | `CONFLICT` | Archived product, or the same idempotent request is still in flight. The code does not tell the two apart; see §15.10. |
| 409 | `DUPLICATE_ZONE_NAME` | `POST /locations/zones`: that room already has a zone with that name. `details`: `{ zoneName, roomName }`. Was a bare `CONFLICT` before 2026-10-04; still 409. |
| 409 | `DUPLICATE_COMPARTMENT_CODE` | `POST /locations/compartments`: that zone already has a compartment with that code. `details`: `{ code, zoneName }`. Was a bare `CONFLICT` before 2026-10-04; still 409. |
| 429 | `RATE_LIMITED` | Slow down. See `Retry-After-apiKey` / `Retry-After-apiKeyAddress` (§15.7). |
| 429 | `DIRECT_TAKE_DAILY_LIMIT_REACHED` | The service account has taken its daily allowance. `details`: `{ limit, takenToday, requested }`. |

### 15.9 Switching it on

| Setting | Default | Effect |
|---|---|---|
| `ALLOW_DIRECT_TAKE` | `false` | Opens `POST /stock/take`. Off: `403 DIRECT_TAKE_DISABLED`, and the route is not listed on the usage page. |
| `DIRECT_TAKE_MAX_QTY` | `10` | Units per take. Kept at 10 (OQ-KT11); to be reviewed after one month of use against the largest take in the ledger. |
| `API_KEY_WRITE_MAX_LIFETIME_DAYS` | `180` | The longest a write key may live. |
| `THROTTLE_APIKEY_LIMIT` / `_TTL_SECONDS` | `120` / `60` | Per key and per address, each per endpoint. |
| `THROTTLE_TAKE_LIMIT` / `THROTTLE_TAKE_TTL_SECONDS` | `10` / `60` | `POST /stock/take` only, per key, per address and per session. |
| `DIRECT_TAKE_DAILY_UNITS_PER_ACCOUNT` | `100` | Units a service account may take per calendar day (business time zone). People are not counted. |

Keys work only while demo mode is off in production. Before relying on them, see
`docs/RUNBOOK.md` §0: turn demo mode off, reset the seeded passwords, and **revoke any key or
service account created while demo mode was on**.

### 15.10 Client behaviour — for panel and script authors

How a machine client should react to each answer. Branch on `code`, never on `message`.

**Terminal: stop, and alert a person. Never retry.** Nothing the client does will change the answer:

| `code` | What a person has to do |
|---|---|
| `API_KEY_INVALID` (401) | Issue a new key. This one is unknown, revoked or expired. |
| `API_KEY_DISABLED` (403) | Re-enable the key, or its service account. |
| `API_KEYS_DISABLED_IN_DEMO` (403) | Turn demo mode off in production. |
| `API_KEY_SCOPE_DENIED` (403) | Issue a key with the right scope, or do the action in the web app (archiving, rooms). |
| `DIRECT_TAKE_DISABLED` (403) | Set `ALLOW_DIRECT_TAKE=true`, or use a borrow request. |
| `DIRECT_TAKE_DAILY_LIMIT_REACHED` (429) | Stop taking for the day, or use a borrow request. Retrying today will not succeed. |
| `FORBIDDEN` (403) | The service account lacks the role the route needs. |

**Retryable: retry the same request, a bounded number of times.**

- `429 RATE_LIMITED`: wait the larger of `Retry-After-apiKey` and `Retry-After-apiKeyAddress`, both
  in seconds (§15.7). There is no plain `Retry-After`.
- `409 CONFLICT` on a write that carries an `Idempotency-Key`: the first attempt is still running.
  Retry with the **same** key after a second or two. The same code also means a state conflict,
  such as an archived product, so **stop after about three tries** and treat it as terminal.
- Network timeouts, dropped connections and `5xx`: retry GETs, and writes that carry an
  `Idempotency-Key` (with the same key). A write without one must not be retried blindly: it may
  already have happened.

**Never retry.** The same request gets the same answer:

- `400 VALIDATION_FAILED`: fix the request (`details` names the field).
- `409 INSUFFICIENT_STOCK`: take less, or pick another cell.
- `404 NOT_FOUND` on a take: the cell is empty (§15.5), not a fault.

**One `Idempotency-Key` per logical action.** Generate a fresh UUID when the action starts ("take 2
of X for Rafiq"), reuse it for every retry of that action, and never reuse it for a different
action. The server scopes a key to the caller, the operation and the target: product and cell for
a take, product for a receive. So a key reused on the same target with a different quantity gets
the **first** action's stored answer back and does nothing new. The same key on a different target
is treated as a new action. Neither is what you meant. The keys are kept for one day.
