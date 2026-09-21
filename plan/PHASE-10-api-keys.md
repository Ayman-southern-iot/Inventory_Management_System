# Phase 10 — API keys for external read access

**Opened:** 2026-09-21 · **Source:** Ayman, 2026-09-21, in conversation
**Baseline commit:** `47222c8` (clean tree apart from untracked QA scratch files)

Ayman asked whether an external system can fetch all products over the API. It can, but only by
logging in as a person and holding a 15-minute token. This phase gives that job its own
credential: an **API key** issued from the admin panel, scoped, revocable, with an expiry the
admin controls, and a usage page generated from the live route table so nobody has to read the
codebase to integrate.

## Baseline for this phase — measured 2026-09-21, before the first edit

```
pnpm typecheck                      exit=0, clean
pnpm lint                           20 errors   (compare against 20, not zero)
pnpm test                           shared 25 · api 90 · web 394, all pass
pnpm --filter @ims/api test:int     744 pass / 0 fail (52 files)
guard-hardcoding.sh --scan-all      8            (documented baseline 8)
migrations                          0001–0036 applied
```

---

## The decisions that shaped this plan

Made in conversation with Ayman, 2026-09-21. Not derivable from the code.

| # | Decision | Consequence |
|---|---|---|
| K1 | An **API key**, not a long-lived JWT | A JWT cannot be revoked without a database check on every request, which is the same cost as a key lookup but with none of the enable/disable affordance Ayman asked for. |
| K2 | Scope is **`inventory:read` only** for v1 | Products, categories, locations. No borrowing (names employees), no requisitions or expenses (money), no users, no audit log. Ayman's explicit choice from four offered. |
| K3 | **Read-only.** No write scopes | A leaked key is an embarrassment, not an incident. Also sidesteps the audit-actor problem: no service on a key's reachable path writes an audit row, because none of them mutate. |
| K4 | **Default-deny by route.** A key reaches a route only if that route carries `@ApiKeyScopes(...)` | Same reasoning as the existing global `JwtAuthGuard`: a forgotten decorator must produce a 403, never an exposure. An API key is *not* a `RequestUser` and can never satisfy `@Roles`. |
| K5 | Stored **hashed** (`sha256`), shown **once** at creation | Reuses `hashToken` from `refresh-token.repository.ts`. Nobody, including us, can read an issued key back out of the database. Losing it means issuing a new one. |
| K6 | Expiry in days, **`null` means never** | Ayman: "sometimes we need it for forever". The UI defaults to 90 days so *forever* is a deliberate choice, not the fallback. |
| K7 | Usage docs are **generated from the route table**, not written by hand | The problem being solved is "so that we dont have to search codebase again". Hand-written docs rot on the first parameter rename; a list derived from `@ApiKeyScopes` metadata cannot drift. |
| K8 | Usage is recorded as **`last_used_at`**, not an audit row per request | A row per read would swamp `audit_log`. Create / enable / disable / revoke *are* audited — those are the decisions worth keeping. |
| K9 | **Admin only** may issue keys | Matches the rest of the admin panel. The IM manages stock, not credentials. |

### Open questions this phase files

- **OQ-G1** — should `GET /stock/ledger` be inside `inventory:read`? It is the movement history
  and it names the actor on each row, which makes it closer to personal data than to a product
  catalogue. **Left out of v1.** Ask before adding.
- **OQ-G2** — should an expired or disabled key answer `401` or `403`? Currently planned as
  `401 API_KEY_INVALID` for unknown/expired and `403 API_KEY_DISABLED` for a key that exists but
  is switched off, so the integrator can tell "wrong key" from "ask your admin".

---

## Part A — migration 0037, the `api_keys` table

**STOP first.** Schema change: print the STOP block, get the go-ahead, then write it.

```
api_key_scope           postgres enum, one member for now: 'inventory:read'

api_keys
  id            uuid pk default gen_random_uuid()
  name          text not null                    -- "Nightly product sync"
  key_prefix    text not null unique             -- 'ims_a4f21c8e' — for the list, not a secret
  token_hash    text not null unique             -- sha256 of the whole key
  scopes        api_key_scope[] not null         -- CHECK: at least one
  is_active     boolean not null default true
  expires_at    timestamptz                      -- null = never (K6)
  last_used_at  timestamptz
  created_by    uuid not null references users(id)
  created_at    timestamptz not null default now()
  revoked_at    timestamptz
  revoked_by    uuid references users(id)
```

- Unique index on `token_hash` — it is the lookup key on every request.
- `CHECK (array_length(scopes, 1) >= 1)` — a key that unlocks nothing is a bug, not a state.
- `CHECK (revoked_at is null or is_active = false)` — a revoked key cannot read as enabled.
- **No** append-only trigger. Unlike `stock_ledger`, this table is mutable by design: toggling
  and revoking are its whole purpose. The audit trail lives in `audit_log` (K8).
- A real `down()` that drops the table and then the enum, in that order.

## Part B — the `api-keys` module

`apps/api/src/modules/api-keys/` — repository, service, controller, following the shape of
`modules/auth`.

- `generate()` → `ims_` + 32 random bytes base64url. Returns the raw key **once**; persists only
  `sha256(raw)` and the display prefix.
- `authenticate(raw)` → looks up by hash; rejects unknown, inactive, revoked and past-expiry.
  Returns the scopes. Touches `last_used_at` at most once per `API_KEY_TOUCH_INTERVAL_SECONDS`
  so a busy integration does not write once per read.
- Controller is `@Roles(Role.ADMIN)` throughout (K9): list, create, patch (enable/disable),
  delete (revoke).
- The list response never contains `token_hash`. Only `key_prefix`.

**New config keys** — `API_KEY_TOUCH_INTERVAL_SECONDS`, `THROTTLE_APIKEY_LIMIT`,
`THROTTLE_APIKEY_TTL_SECONDS`. **All three must be pinned in `TEST_ENV`** or
`test-env.int-spec` fails — this is a documented landmine, not a surprise.

## Part C — the guard

The riskiest part of the phase. Touched with its own gate, per the handoff rule.

1. `JwtAuthGuard.canActivate` — when the bearer value starts with `ims_`, hand off to
   `ApiKeyService.authenticate` and set `request.apiKey`. Everything else is unchanged; a JWT
   still takes exactly the path it takes today.
2. `request.user` stays **undefined** for a key. An API key is not a person, and anything that
   reads `request.user` must fail loudly rather than silently accept a synthetic one.

   **The tempting shortcut, and why it is wrong.** The obvious implementation is to have the key
   populate `request.user` with `{ id, email, roles }` like a JWT does — one guard, nothing else
   changes. It was suggested during research and it is a trap. `RolesGuard` reads
   `request.user.roles`, so a key carrying roles could satisfy `@Roles(Role.ADMIN)` and reach the
   admin API, including the endpoint that *mints more keys*. And `auditContextFromRequest` reads
   the same object, so every audited action would be attributed to a person who did not perform
   it. Leaving `request.user` undefined makes both failures impossible by construction:
   `RolesGuard` already throws when it is missing, so every `@Roles` route is closed to keys with
   no extra code, and the audit context already tolerates a null actor.
3. New `@ApiKeyScopes(...)` decorator plus a guard that runs after authentication: if
   `request.apiKey` is set and the handler declares no matching scope, `403`. Default-deny (K4).
4. Belt and braces: a key is refused on any non-`GET` method regardless of decorator, because
   every scope in v1 is `:read` and a future write scope should have to remove this check
   deliberately.
5. New throttle tier `apiKey`, added to the `only(...)` tier list in `common/throttling.ts` —
   forgetting that list is the trap the helper's comment already warns about.

## Part D — open the five read routes

Add `@ApiKeyScopes(ApiKeyScope.INVENTORY_READ)` to exactly these, and nothing else:

| Route | Controller |
|---|---|
| `GET /products` | `products.controller.ts:27` |
| `GET /products/:id` | `products.controller.ts:34` |
| `GET /categories` | `categories.controller.ts:28` |
| `GET /locations` | `locations.controller.ts:42` |
| `GET /locations/rooms` | `locations.controller.ts:53` |

`GET /stock/ledger` is deliberately excluded — see OQ-G1.

## Part E — the generated usage document

`GET /api-keys/meta/usage` (admin only) walks Nest's route table via `DiscoveryService`,
collects every handler carrying `@ApiKeyScopes`, and returns method + path + scope + the query
parameters its zod schema declares.

The frontend composes the base URL from its own origin, so there is **no new config key** for a
public URL and the instructions are always correct for whoever is reading them.

This is what makes K7 true: decorate a new route in Part D and the usage page gains it with no
further work.

## Part F — the admin page

`apps/web/src/features/admin/pages/ApiKeysPage.tsx`, beside Users / Departments / Settings.

- Table: name, prefix, scopes, status, expires, last used, created by.
- Create dialog: name, scope checkboxes, expiry (30 / 90 / 365 days / never).
- **The raw key is shown exactly once**, in a panel with a copy button and an explicit warning
  that it cannot be retrieved again. Closing the panel is the point of no return.
- Enable / disable toggle, and revoke behind a confirm.
- A "How to use this key" panel per key, rendered from Part E: base URL, the endpoints that
  key's scopes unlock, a copy-paste `curl`, the `limit=100` ceiling and the rate limit.

## Part G — tests

Integration, against real Postgres. Rule 50 puts permission boundaries at priority 4 and this
phase is almost entirely a permission boundary, so the bar is higher than "happy path".

- A valid key reads `GET /products`; the same key is refused on `GET /borrowing` (`403`).
- A key is refused on `POST /products` (`403`) even though the route exists.
- A disabled key, a revoked key and an expired key are each refused, with the right code.
- A key with `expires_at = null` still works after the clock is wound forward.
- A JWT is **unaffected** on every one of the five opened routes — the regression that matters.
- `token_hash` never appears in any response body.
- `last_used_at` moves on first use and does not move again inside the touch interval.

Web: the create dialog shows the key once, and does not show it again after close.

---

## Definition of done

- The gate is at baseline: typecheck clean, lint 20, integration 744+ / 0 fail.
- Every new behaviour has a test that fails without the change.
- `docs/state/PROGRESS.md` ticked, `DECISIONS.md` carries K1–K9, `OPEN-QUESTIONS.md` carries
  OQ-G1 and OQ-G2.
- `AI_PLAYBOOK.md` §6 (new module), §8, §11 (new config keys), §16 (landmines) updated.
- A key issued on the demo stack, used from `curl`, then disabled and proven refused.
