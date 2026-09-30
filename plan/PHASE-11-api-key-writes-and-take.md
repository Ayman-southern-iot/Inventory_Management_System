# Phase 11 — API keys that act, and a one-call stock take

**Opened:** 2026-09-29 · **Source:** Arif's brief, 2026-09-29 · **Design of record:**
[ADR-0002](../docs/adr/0002-api-keys-and-direct-take.md), answers OQ-KT1 – OQ-KT7 in
`docs/state/OPEN-QUESTIONS.md` · **Branch:** `feat/api-keys-take` (not pushed, not merged)

Other Southern IoT systems — the lab drawer panel, a voice assistant, scripts — use IMS without a
human login, and issue stock in one call instead of borrow-create + approve. Built as an
extension of Phase 10's keys, not a rebuild: the brief's greenfield table would have collided with
migration 0037.

## Baseline — measured 2026-09-29 on this Mac, before the first code edit

```
pnpm typecheck                      clean
pnpm lint                           20 errors (compare against 20)
pnpm test                           shared 25 · api 242 · web 450, all pass
pnpm --filter @ims/api test:int     924 pass / 3 fail (927, 64 files)
guard-hardcoding.sh --scan-all      8
```

The three integration failures are environmental, not code: two timeouts (the test database runs on
the keeper behind an 18 ms tunnel) and one 426 from another desktop app answering a supertest
request (see the harness fix below).

## Done

- [x] **A. Migration 0039.** New scopes; `users.is_service_account`; `api_keys.service_user_id`
  with a composite FK that only a service account can satisfy; CHECKs that a write scope needs an
  account and an expiry; `audit_log.api_key_id`. Proven up → down → up on empty and seeded data,
  and the negative cases were proven against the database.
- [x] **B. Service accounts.** Created and switched off from the API keys screen. They cannot sign
  in, the user-admin paths refuse them, and every role→people query filters them out.
- [x] **C. The guard.** A bound key acts as its account; an unbound key keeps K4. `?api_key=` is
  refused on writes. The blanket read-only line is replaced by "a read scope never writes". Demo
  mode in production refuses every key. Throttling is per key.
- [x] **D. Seven write routes opened** to their scopes, and `POST /stock/take` added (a thin route
  over `issueFromStock`, idempotency required, capped, product checks, and the IMs notified for a
  key take).
- [x] **E. Admin screen.** Write scopes, a service-account picker and inline create, expiry capped
  for write keys, a service-accounts panel, a demo banner, a Blocked state, and body and
  idempotency on the usage page.
- [x] **F. Tests.** `api-key-writes.int-spec.ts`, `stock-take.int-spec.ts`, and a throttle
  tracker unit spec; red on the base commit before green. The live-route-table walk proves
  default-deny.
- [x] **G. Docs.** `docs/reference/15-integration-api.md`; RUNBOOK §0.1 and §0.8, formerly §0.7 (HTTPS hostname,
  firewall 5173, demo revocation); data model §7.5; the notifications and permissions references;
  AI_PLAYBOOK; ASSIST §9.
- [x] **Harness.** `test/app.ts` listens once on 127.0.0.1, because supertest's per-request
  wildcard listen let other desktop apps answer test requests on macOS.

## Review round (security-reviewer and code-reviewer, 2026-09-29)

No critical, high or blocking findings. Fixed, each test shown red first:

- **A write key in the URL, even on a GET**, is now refused. The URL form is for read-only keys.
- **Throttling** now uses both buckets, per key (a hash of the whole token) and per address (Phase
  10's ceiling), and both classifiers parse exactly as the guard does. As first built, made-up
  keys could be rotated for an unlimited run, a session could dodge its own ceiling with a fake
  `?api_key=`, and a real key's public prefix could spend its budget.
- **Demo-mode production refuses re-enabling** a key or a service account, as well as creating one.
- **`GET /products/:id` gives a key no `activeBorrows`.** The list named borrowers, in breach of
  K2, and had been key-readable since Phase 10.
- **Take:** the placement read-back can no longer fail a committed take, which would have let the
  same Idempotency-Key take twice. An unknown project answers 404 instead of a 500. The
  return-date rule is one shared predicate. Extra audit metadata can no longer overwrite the
  recorded fields.
- **The key list** reports each key's account state (Blocked in the UI). `activeKeyCount` excludes
  expired keys.
- **Migration 0039** now has automated tests in `migrations.int-spec.ts`: the rollback with a read
  key present, both refusals, the CHECKs and FK, and `ON UPDATE RESTRICT`.

Recorded for the lead rather than decided: OQ-KT10, OQ-KT11, OQ-KT12 and G-21.

## Still open

- OQ-KT8 (per-category take limits) and OQ-KT9 (an emptied shelf answers 404, not 409).
- `DIRECT_TAKE_MAX_QTY=10` is a guess.
- The HTTPS hostname and the 5173 firewall are documented, not done. This branch is not deployed; the VM runs `9f4176d` on the demo stack
  (RUNBOOK §0 item 0).
