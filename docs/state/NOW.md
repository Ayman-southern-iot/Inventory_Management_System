# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-10-04

## Where the build is

**Phase 11 (ADR-0002) is merged on GitHub; it is not deployed.** PRs #1–#6 landed in
**`fix/lan-secure-context`, the GitHub default branch** (there is no `origin/main`; local `main` is
old and unrelated). Tip `86de70f`. API keys bound to a **service account** act as it: four write
scopes open seven routes, and `POST /stock/take` issues stock in one idempotent call (off unless
`ALLOW_DIRECT_TAKE`), with a route throttle and a per-service-account daily unit cap. K2 (no person
data to a key) is enforced by one global interceptor and proven by walking the route registry.
Service accounts can be created from the admin panel. Migration **0039**; Python client in
`clients/python/`. Phases 00–10 and CSV import are unchanged.

**Branch `chore/lint-clean`** (from `86de70f`, pushed 2026-10-04, no PR opened yet): lint 20 → **0**.

## Next action

1. **Run `scripts/test-int-keeper.sh` at the merged tip.** Nobody has measured integration since
   `a271479`; the K2 registry-walk and take-limit specs landed after it.
2. **Real client IP behind Cloudflare is IT-owned**, open, and blocks go-live (RUNBOOK §0.7). The
   app side is done: `TRUST_PROXY_HOPS` (default 1). Do not touch the VM, proxy or firewall for it.
3. **Production must run `infra/` first** (RUNBOOK §0 item 0). The VM runs the root demo stack at
   `9f4176d` (operator, 2026-09-27). The switch needs IT in the window. Waiting on Ayman:
   `IMPORT_MAX_CHANGED_SHELVES`.

## Green as of 2026-10-04 (`chore/lint-clean`), measured on Windows

- typecheck clean · unit shared 25 · api 257 · web 478 · **lint 0 (exit 0)** · guard-hardcoding **8**
- integration **992 / 992 (68 files)** is the last measurement, at `a271479` on the keeper. **Not
  re-run:** this Windows box had no Docker. Treat it as stale until item 1 above is done.

## Landmines — full list in `ASSIST.md` §9

- **Postgres never runs locally on the Mac.** Integration gate = **`scripts/test-int-keeper.sh`**
  (~90 s); `ssh -L` tunnels stall and fake timeouts. Node **22** is keg-only on the Mac.
- **Lint is a real gate now (0): any error is new.** `eslint-plugin-react-hooks` is not installed,
  so an `eslint-disable react-hooks/*` comment is itself an error.
- **A branch cut from the default branch tracks `fix/lan-secure-context`.** Push by name
  (`git push -u origin <branch>`), never a bare `git push`.
- **Every role→people query must filter `users.is_service_account = false`** (list in
  `07-data-model.md` §7.5), or a panel gets requisition stages, IM notices and picker slots.
- **A response body that is HTML, or not `{code, message}`, came from another app**, not the API.
  The harness binds 127.0.0.1; do not revert it.
- **Never run two test suites at once.** One shared `db-test`.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared.
- **Two compose files.** Root = demo (what the VM runs today); `infra/` = production.
- **`test-env.int-spec` refuses an unpinned config key.** Pin every new one in `TEST_ENV`.
- **`resetData` keeps requisitions and cannot delete a user who moved stock.** A full run leaves
  >100 users, so anything reading "the first page of users" needs fixtures that sort first.
- **An import locks the whole API out, and the lock lives in process memory.**

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · `G-21` (borrow form 500 on an unknown project) ·
PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` · `OQ-C` · `OQ-D` · `OQ-F` · `OQ-KT8` · `OQ-KT9`
· **overdue notifications are unwired on purpose (`OQ-E`) — not a gap, do not "fix"**
· 8 guard-hardcoding findings (Tailwind arbitrary values, a hex colour, a status literal)
