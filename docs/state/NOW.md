# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-29

## Where the build is

**Phase 11 (ADR-0002) is built on branch `feat/api-keys-take`: not pushed, not merged, not deployed.**
API keys can be bound to a **service account**, a `users` row that is not a person, and act as it.
Seven write routes are opened by four write scopes, and `POST /stock/take` issues stock in one
idempotent call. It is a thin route over `issueFromStock` and is off unless `ALLOW_DIRECT_TAKE`.
Migration **0039**. Follow-up done too: keys must send `Idempotency-Key` on receive
(OQ-KT10), keys cannot archive (OQ-KT12), cap stays 10 (OQ-KT11). `15-integration-api.md` is
corrected, and a test pins its §15.4 to the route registry. The Python client is in
`clients/python/`. Everything before this (phases 00–10, CSV import) is unchanged.

## Next action

1. **Arif reviews and merges** `feat/api-keys-take`. Nothing has been pushed.
2. **Real client IP behind Cloudflare is IT-owned**, open, and blocks go-live, not merge (RUNBOOK
   §0.7: requirement, security condition, acceptance tests). The app side is done: the hop count
   is `TRUST_PROXY_HOPS` (default 1). Do not touch the VM, proxy, Caddyfile or firewall for it.
3. Still waiting on Ayman: `IMPORT_MAX_CHANGED_SHELVES`, and **the VM**. Nothing is deployed there
   and demo mode is ON; keys are refused in production while demo is on (RUNBOOK §0.1, §0.8).

## Green as of 2026-09-29, measured on the M5 (not the old Windows box)

- typecheck clean · unit shared 25 · api 249 · web 477 · lint **20** (the same findings as before)
- integration **989 pass / 1 fail (67 files)**. The 1 is `stock-import-lock` at scale timing out at
  30 s, which the pre-change baseline on this Mac did too (924/3). It is the tunnel latency.
- guard-hardcoding **8** · migrations 0001–**0039** · smokes on the dev DB: 20/20 (E2 fixed to
  compare parsed JSON); Python client smoke 5/5.

## Landmines — full list in `ASSIST.md` §9

- **This Mac: Postgres runs on the keeper, never locally.** `ims-db-test` (5434) and `ims-db-dev`
  (5433) are keeper containers on tmpfs, reached through `ssh -L` tunnels; both vanish with the
  tunnel or a reboot. Node **22** is keg-only: prefix `PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
  `scripts/gate.sh` is Windows-only, so run the steps by hand. A full integration run takes ~30 min.
- **Every role→people query must filter `users.is_service_account = false`** (list in
  `07-data-model.md` §7.5), or a panel gets requisition stages, IM notices and picker slots.
- **A response body that is HTML, or not `{code, message}`, came from another app**, not the API.
  The harness now binds 127.0.0.1; do not revert it.
- **Never run two test suites at once.** One shared `db-test`.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared. Built
  output goes stale and lies confidently: a seed, config or API change needs `--build`.
- **Two compose files.** Root = demo, secrets hardcoded in the public repo. `infra/` = production.
- **`test-env.int-spec` refuses an unpinned config key.** Pin every new one in `TEST_ENV`.
- **`resetData` keeps requisitions and cannot delete a user who moved stock.** A full run leaves
  >100 users, so anything reading "the first page of users" needs fixtures that sort first.
- **An import locks the whole API out, and the lock lives in process memory.**
- **`D-nnn` is the QA defect numbering** — cite decisions by `OQ-*` / `G-*`.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · `G-21` (borrow form 500 on an unknown project) ·
PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` · `OQ-C` · `OQ-D` · `OQ-F` · `OQ-KT8` · `OQ-KT9`
· **overdue notifications are unwired on purpose (`OQ-E`) — not a gap, do not "fix"**
