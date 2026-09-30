# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-30

## Where the build is

**Phase 11 (ADR-0002) is built on branch `feat/api-keys-take`: not pushed, not merged, not deployed.**
API keys bound to a **service account** (a `users` row that is not a person) act as it: four write
scopes open seven routes, and `POST /stock/take` issues stock in one idempotent call (off unless
`ALLOW_DIRECT_TAKE`). Migration **0039**. Keys need `Idempotency-Key` on receive (OQ-KT10) and
cannot archive (OQ-KT12). `TRUST_PROXY_HOPS` makes the proxy hop count config. Python client in
`clients/python/`. Everything before this (phases 00–10, CSV import) is unchanged.

## Next action

1. **Arif reviews and merges** `feat/api-keys-take`. Nothing has been pushed.
2. **Real client IP behind Cloudflare is IT-owned**, open, and blocks go-live, not merge (RUNBOOK
   §0.7: requirement, security condition, acceptance tests). The app side is done: the hop count
   is `TRUST_PROXY_HOPS` (default 1). Do not touch the VM, proxy, Caddyfile or firewall for it.
3. **Production must run `infra/` first** (RUNBOOK §0 item 0). The VM runs the root demo stack at
   `9f4176d` (operator, 2026-09-27): demo on, Phase 11 settings not passed. The switch needs IT in
   the window (5173 → 80/443). Still waiting on Ayman: `IMPORT_MAX_CHANGED_SHELVES`.

## Green as of 2026-09-30 (`9f0d716`), measured on the M5

- typecheck clean · unit shared 25 · api 257 · web 477 · lint **20** (the same findings as before)
- integration **992 / 992 (68 files), no known failures**, via `scripts/test-int-keeper.sh` at
  `a271479`, 80 s. The old `stock-import-lock` timeouts were the SSH tunnel (DECISIONS 2026-09-30).
- guard-hardcoding **8** · migrations 0001–**0039** · smokes on the dev DB: 20/20 (E2 fixed to
  compare parsed JSON); Python client smoke 5/5.

## Landmines — full list in `ASSIST.md` §9

- **This Mac: Postgres runs on the keeper, never locally.** Integration gate =
  **`scripts/test-int-keeper.sh`** (runs beside `ims-db-test`, ~90 s). The `ssh -L` tunnels
  (5434/5433, keep-alives in AI_PLAYBOOK §7) are for ad-hoc dev only: they stall and fake timeouts.
  Node **22** is keg-only: `PATH=/opt/homebrew/opt/node@22/bin:$PATH`. `scripts/gate.sh` is Windows-only.
- **Every role→people query must filter `users.is_service_account = false`** (list in
  `07-data-model.md` §7.5), or a panel gets requisition stages, IM notices and picker slots.
- **A response body that is HTML, or not `{code, message}`, came from another app**, not the API.
  The harness now binds 127.0.0.1; do not revert it.
- **Never run two test suites at once.** One shared `db-test`.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared. Built
  output goes stale and lies confidently: a seed, config or API change needs `--build`.
- **Two compose files.** Root = demo (and what the VM runs today); `infra/` = production.
- **`test-env.int-spec` refuses an unpinned config key.** Pin every new one in `TEST_ENV`.
- **`resetData` keeps requisitions and cannot delete a user who moved stock.** A full run leaves
  >100 users, so anything reading "the first page of users" needs fixtures that sort first.
- **An import locks the whole API out, and the lock lives in process memory.**
- **`D-nnn` is the QA defect numbering** — cite decisions by `OQ-*` / `G-*`.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · `G-21` (borrow form 500 on an unknown project) ·
PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` · `OQ-C` · `OQ-D` · `OQ-F` · `OQ-KT8` · `OQ-KT9`
· **overdue notifications are unwired on purpose (`OQ-E`) — not a gap, do not "fix"**
