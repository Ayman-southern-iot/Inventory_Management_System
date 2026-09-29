# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-29

## Where the build is

**Phase 11 (ADR-0002) is built on branch `feat/api-keys-take`: not pushed, not merged, not deployed.**
API keys can be bound to a **service account**, a `users` row that is not a person, and act as it.
Seven write routes are opened by four write scopes, and `POST /stock/take` issues stock in one
idempotent call. It is a thin route over `issueFromStock` and is off unless `ALLOW_DIRECT_TAKE`.
Migration **0039**. Everything before this (phases 00–10, CSV import) is unchanged.
Integrators read `docs/reference/15-integration-api.md`.

## Next action

1. **Arif reviews and merges** `feat/api-keys-take` (4 commits after the ADR). Nothing has been pushed.
2. Answer **OQ-KT10** (require `Idempotency-Key` on receive for keys?), **OQ-KT11** (the cap number,
   10 is a guess) and **OQ-KT12** (may `catalog:write` archive products?).
3. Still waiting on Ayman: `IMPORT_MAX_CHANGED_SHELVES`, and **the VM**. Nothing is deployed there,
   demo mode is ON, and no host address is recorded. Keys are refused in production while demo is
   on. RUNBOOK §0.1 and §0.7 list what to do before any key is issued.

## Green as of 2026-09-29, measured on the M5 (not the old Windows box)

- typecheck clean · unit shared 25 · api 249 · web 477 · lint **20** (the same findings as before)
- integration **981 pass / 1 fail (66 files)**. The 1 is `stock-import-lock` at scale timing out at
  30 s, which the pre-change baseline on this Mac did too (924/3). It is the tunnel latency.
- guard-hardcoding **8** · migrations 0001–**0039** · live smoke on the dev DB: 19/20 PASS; the one
  FAIL is a byte-identity check on an idempotent replay (the same data in jsonb key order).

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
PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` · `OQ-C` · `OQ-D` · `OQ-F` · `OQ-KT8`–`KT12`
· **overdue notifications are unwired on purpose (`OQ-E`) — not a gap, do not "fix"**
