# 0002 — API keys that can act, and a one-call stock take

- **Status:** Accepted — Arif, 2026-09-29, with the amendments folded into the table below
  (answers to OQ-KT1 – OQ-KT7 are in `docs/state/OPEN-QUESTIONS.md`)
- **Date:** 2026-09-29
- **Supersedes:** none. Amends Phase 10 decisions **K3** (keys are read-only) and **K4** (a key is
  never a `RequestUser`) in `plan/PHASE-10-api-keys.md`. **K2 stands** and **OQ-G1 stays closed**:
  there is no `borrow:read` scope.

## Context

Other Southern IoT systems (the lab drawer panel, a voice assistant, scripts) need to issue stock
without a human login, in one call. Two pieces of this already exist, so this ADR extends them and
does not rebuild them:

- **Phase 10 API keys** (migration `0037`, `modules/api-keys`, the admin page). Keys are sha256-hashed
  and shown once. They are presented as `Authorization: Bearer ims_…`, or as `?api_key=` on a GET.
  Access is default-deny, by `@ApiKeyScopes`. `last_used_at` is debounced and keys have their own
  `apiKey` throttle tier. There is one scope, `inventory:read`. They are **read-only by
  construction**: `JwtAuthGuard` refuses any non-GET, and it leaves `request.user` undefined so
  neither `@Roles` nor the audit log can see a key.
- **`POST /borrowing/issue-from-stock`** (Phase 09 E-a, `BorrowingService.issueFromStock`) does the
  whole handover in one transaction:
  1. reserve the stock;
  2. insert a borrow row, with the requester set to the borrower;
  3. claim it straight to `ISSUED`, with `decided_by` = the actor and `decision_note` = the purpose;
  4. `StockService.issue`, with `ref_type` `BORROW`;
  5. write the audit row `borrowing.issue_on_behalf`;
  6. send the borrower `borrowing.issued_to_you`.

What actually binds the design:

1. **A write needs a principal.** `stock_ledger.performed_by`, `borrow_requests.decided_by`,
   `audit_log.actor_id` and `idempotency_keys.user_id` all reference `users`, and `GET /borrowing`
   reads `@CurrentUser`. The K4 model, in which a key has no user, cannot write anything.
2. **K4's reasons still hold.** A key must never satisfy `@Roles(ADMIN)`, and the audit log must
   never attribute an action to a person who did not perform it.
3. **Holding `INVENTORY_MANAGER` changes what a user is sent, not only what it may do.**
   `requisitions.service.ts:377` hands a requisition's IM stage to *any* active IM, and
   `usersWithRole` sends IM notifications to every IM (`borrowing.service.ts:139`,
   `projects.service.ts:104`, `requisitions.service.ts:770`, `boms.service.ts:688`). If the service
   principal were an ordinary user row, it would be handed requisitions that no human can review.
4. **Create followed by approve is two transactions, not one** (`create` at `borrowing.service.ts:70`,
   `decide` at `:182`, gap G-14). Writing "exactly what create + approve writes" would also
   reproduce the `borrowing.requested` notification to every IM, which a take has no reason to send.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Keys A.** Build afresh, as the brief is worded: a new `api_keys` table, `X-API-Key`, `text[]` scopes | Matches the brief's wording | Collides with `0037`. Puts a second credential path beside the shipped one, and throws away the generated usage page, the log redaction and the 23 tests in `api-keys.int-spec.ts`. |
| **Keys B.** Keep keys principal-less (K4) and give each write service a "system actor" branch | Keeps K4 literally | Every write path gains a nullable-actor branch, the FKs to `users` break, and audit rows name nobody |
| **Keys C.** Extend Phase 10: a key may be **bound to a service account**, which is a `users` row flagged `is_service_account` and filtered out of every query that picks human users | RBAC, FKs, audit and idempotency work unchanged. K4's two hazards are closed by the flag plus default-deny, not by the key having no user. | Every query that turns a role into a list of people has to filter the flag. Miss one, and a panel is handed a requisition. |
| **Take A.** Refactor `decide` so that it and take share one function | Follows the brief's wording | `decide` starts from a PENDING row whose stock was reserved in an earlier transaction. Sharing it means touching the G-14 path for no gain. |
| **Take B.** `POST /stock/take` as a thin route over `issueFromStock` | Already one transaction, already writes the right records, already tested | Its audit action and notification differ from create + approve. That is correct: nobody requested anything. |

## Decision

**Keys C and Take B.** Phase 10 keys may now be bound to a service account and act as it, and
`POST /stock/take` issues stock through `issueFromStock`.

| Topic | Decision | The brief asked for |
|---|---|---|
| Transport | Unchanged: `Authorization: Bearer ims_…`. `?api_key=` is **refused on every non-GET** with `API_KEY_QUERY_NOT_ALLOWED`, because a key in a URL must not be able to write. Key clients must use the HTTPS hostname, and the deploy docs require port 5173 to be firewalled so only the proxy can reach it. No client uses `X-API-Key` (OQ-KT7). | `X-API-Key` |
| JWT and key both sent | On a non-GET, a Bearer JWT plus `?api_key` returns 400. On a GET the header still wins, as `api-keys.int-spec.ts:175` pins; changing that means rewriting a test, which is a STOP. | 400 always |
| Principal | `api_keys.service_user_id` is a nullable FK. A CHECK requires it for any scope other than `inventory:read`. A bound key sets `request.user` to its service account, with the account's roles re-read on each request, and it also sets `request.apiKey`. A key whose account is deactivated answers `403 API_KEY_DISABLED`: the key is real but switched off, which is the case OQ-G2 already gives that code. An unbound key behaves exactly as K4 describes. | `NOT NULL`; 401 for an inactive account |
| Service accounts | New column `users.is_service_account`. A service account cannot log in or have its password reset. `/users/selectable`, `usersWithRole`, `findAnyActiveUserWithRole` and the demo-account listing all exclude it. It may hold only `GENERAL` and `INVENTORY_MANAGER`, and only an admin can create one, from the API-keys screen. A key can be bound **only** to a service account; binding it to a person would put that person's name on actions they never took. | any `users.id` |
| Scopes | Keep the Postgres enum `api_key_scope`, extended by migration, because rule 10 says domain constants live in an enum. Keep `inventory:read`, which is the brief's `catalog:read`. Add `catalog:write`, `locations:write`, `stock:receive` and `stock:take`. **No `borrow:read`**: K2 stands (OQ-KT6), so `GET /borrowing` and `GET /stock/ledger` stay closed to keys. | `text[]` plus a CHECK; `borrow:read` |
| Expiry | A key holding any write scope must have an expiry, of at most `API_KEY_WRITE_MAX_LIFETIME_DAYS` (default 180). The database enforces that the expiry is present; the service enforces the limit, because the limit is config. A read-only key follows K6, so `null` still means never (OQ-KT3). | optional |
| Non-GET guard | The "read-only" line is deliberately removed. In its place: a non-GET route must name a scope other than `inventory:read`. | — |
| `@Roles` | Still applies on top of scopes: a key reaches an IM route only if its service account holds IM | same |
| Audit | New column `audit_log.api_key_id`, a nullable FK filled from `AuditContext`. The actor is the service account. There is no `channel` column, because `api_key_id IS NOT NULL` already says the channel was the API. The `channel` in the take body is caller-declared, so it goes into take's audit metadata and nothing decides on it. | channel on audit |
| Throttle | The existing `apiKey` tier is tracked **per key** rather than per IP, because several lab devices sit behind one office IP. It keeps the existing `THROTTLE_APIKEY_*` keys. A 256-bit secret cannot be guessed, so per-key tracking gives up no brute-force protection. | new tier |
| Flags | **No `API_KEYS_ENABLED`** (amended at acceptance). With `NODE_ENV=production` and `DEMO_ACCOUNTS_ENABLED=true`, the guard refuses every key with its own code, `API_KEYS_DISABLED_IN_DEMO`. The same condition also refuses **creating** keys and service accounts: in demo mode anyone can sign in as admin, and a key minted then would come alive the day demo mode is turned off. Outside that condition, read-only keys behave exactly as they do today. `ALLOW_DIRECT_TAKE` defaults to false and refuses with `DIRECT_TAKE_DISABLED`. The generated usage page leaves out any route that is switched off. | `API_KEYS_ENABLED` plus a boot refusal |
| Admin API | Keep the existing `/admin/api-keys` routes: GET, POST, PATCH to enable or disable, DELETE to revoke. POST gains `serviceUserId`. Add `POST /admin/api-keys/service-accounts`. Expiry stays `expiresInDays`, with `null` meaning never (K6). | `POST …/:id/revoke`, `expiresAt` |
| Debounce | Keep the existing `API_KEY_TOUCH_INTERVAL_SECONDS` | `API_KEY_LAST_USED_DEBOUNCE_SECONDS` |
| Take | `POST /stock/take` requires an `Idempotency-Key`. **The holder is always the caller**: the service account for a key, the signed-in person for a session. There is no `takenForUserId`; a key may write a name into `purpose` (OQ-KT1). A call may take at most `DIRECT_TAKE_MAX_QTY` (OQ-KT2). `isReturnable` defaults to `products.default_returnable`, and the call goes through `issueFromStock`. The response carries **ids, quantities and the updated placement only, and no person names** (OQ-KT6). Every take made with a key notifies the IMs in-app (OQ-KT4). The route lives in the borrowing module under `@Controller('stock')`, because StockModule importing BorrowingModule would create a cycle. Ledger `ref_type` stays `BORROW` (OQ-KT5), so a take and its returns share one ref. Returns use the existing `POST /borrowing/:id/returns`. | shared with `decide`; `takenForUserId` |

**The hash stays sha256 (K5).** The secret is 32 random bytes, so there is no dictionary to attack,
and a slow KDF would only add latency to every request.

## Consequences

**Easy.** An integration is one key bound to one named account. Its ledger rows, borrows and audit
rows name that account and the key. Revoking the key stops that integration, and deactivating the
account stops every key bound to it.

**Hard.** Every query that turns a role into a list of people has to filter out service accounts,
and that stays true for all future code. A test pins it: a service account holding IM must never
receive a requisition stage, a notification or a place in a picker. A second test proves
default-deny by walking the live route table with `DiscoveryService`, as `api-key-docs.service.ts`
already does, rather than working from a hand-written list.

**Committed to.** One reversible migration, `0039`, which:

- adds the new enum values (its `down` swaps the type back, and refuses to run if a key still holds
  one of the new values);
- adds `api_keys.service_user_id` and its two CHECKs (a write scope needs an account and an expiry);
- adds `users.is_service_account`, with a composite FK so that a key can only ever reference a row
  that is a service account;
- adds `audit_log.api_key_id`.

It also adds three config keys, all pinned in `TEST_ENV`: `ALLOW_DIRECT_TAKE`,
`DIRECT_TAKE_MAX_QTY` and `API_KEY_WRITE_MAX_LIFETIME_DAYS`. And it adds three `ErrorCode`s:
`API_KEYS_DISABLED_IN_DEMO`, `API_KEY_QUERY_NOT_ALLOWED` and `DIRECT_TAKE_DISABLED`.

**Revisit if:**

- a panel has to record *who* took an item, rather than which panel did. OQ-KT1 answered no, so
  today the name can only go in `purpose`. Making it a field would turn it into a delegation model.
- the API runs as more than one instance. The throttle counters live in memory, as the import lock
  does.
- keys are used from outside the office LAN. Key clients are required to use the HTTPS hostname,
  and port 5173 is to be firewalled so only the proxy reaches it. Whether the deployed VM actually
  enforces that is UNKNOWN, because nothing has been deployed there.
