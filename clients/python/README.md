# IMS Python client

A small client for the IMS integration API, for the lab drawer panel, the voice assistant and
scripts. The contract is [`docs/reference/15-integration-api.md`](../../docs/reference/15-integration-api.md).
If this client, that document and the admin page **API keys → How to use this key** disagree,
the admin page is right.

## Configuration

Environment only; never hard-code a key.

| Variable | Meaning |
|---|---|
| `IMS_BASE_URL` | `https://ims.siot.solutions`, the HTTPS hostname. Never an IP, never port 5173. |
| `IMS_API_KEY` | `ims_…`, issued by an admin under **Admin → API keys**. Preferred for machines. |
| `IMS_EMAIL` / `IMS_PASSWORD` | A person's sign-in, for scripts run by hand. Service accounts cannot sign in. |

## Scopes a lab panel needs

- `inventory:read`, to search and see what is in which cell;
- `stock:take`, to take stock (the server must have `ALLOW_DIRECT_TAKE=true`);
- `stock:receive`, only if the panel also books goods in;
- `catalog:write` / `locations:write`, only for an import script. A key can create and edit
  products and categories, but never archive or re-activate them.

A key that can write must bind a service account and must expire (at most 180 days by default).

## Examples

```bash
uv run python ims_client.py search "esp32"
uv run python ims_client.py where <productId>
```

```python
from ims_client import ImsClient, ImsCredentialDead, ImsError

ims = ImsClient.from_env()
cell = ims.compartment_id("A3", "1B", room="Cabinet 1")
hits = ims.search("esp32-s3", in_stock_only=True)["items"]
try:
    result = ims.take(hits[0]["id"], cell, 1, purpose="Rafiq, bench 4", channel="panel")
except ImsCredentialDead as e:          # the key will not work again until a person acts
    alert_a_person(e.code)
except ImsError as e:
    if e.code == "NOT_FOUND":           # the cell is empty (15.5)
        show("Drawer empty")
    elif e.code == "INSUFFICIENT_STOCK":
        show(f"Only {e.details['available']} left")
    else:
        raise
```

## Behaviour worth knowing

- **Every write carries an `Idempotency-Key`**, one per call. It is reused on the client's own
  retries, so a retry can never act twice. If you retry at a higher level, for example after a
  crash, pass your own `idempotency_key=`.
- **What it retries:**
  - `429`, waiting for the largest `Retry-After-*` header the server sent;
  - a `409 CONFLICT` on a keyed write;
  - timeouts, dropped connections and `5xx`, but only on reads and keyed writes.
- **What it never retries:** `400`, `403`, `404` and `409 INSUFFICIENT_STOCK`.
- `ImsCredentialDead` covers `API_KEY_INVALID`, `API_KEY_DISABLED` and `API_KEYS_DISABLED_IN_DEMO`.
  Stop and alert a person.
- `compartment_id(zone, code)` raises if the same drawer name exists in two rooms; pass `room=`.

## Smoke test

`smoke_client.py` runs against a **local** API only; it refuses any non-loopback base URL. It
creates its own dedicated SMOKE product and cell, a service account and a key, and cleans up the
key afterwards. The API must be running with `ALLOW_DIRECT_TAKE=true`.

```bash
IMS_BASE_URL=http://127.0.0.1:3901 IMS_SMOKE_ADMIN_EMAIL=… IMS_SMOKE_ADMIN_PASSWORD=… \
  uv run python smoke_client.py
```
