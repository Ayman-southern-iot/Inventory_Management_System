# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-10-04

## Where the build is

**Phase 11 (ADR-0002) is merged on GitHub; it is not deployed.** PRs #1–#6 landed in
**`fix/lan-secure-context`, the GitHub default branch** (there is no `origin/main`; local `main` is
old and unrelated). Tip `86de70f`. Keys bound to a **service account**, `POST /stock/take` (take
throttle and daily cap), K2 enforced by one global interceptor, service accounts creatable from
the admin panel. Migration **0039**; Python client in `clients/python/`. Phases 00–10 unchanged.

**`chore/lint-clean`** (from `86de70f`, local only): lint 20 → **0**, bulk import shows **"Coming soon"**
(UI only; the import API is still live, no env flag), and the Playwright audit (`docs/playwright_audit.md`,
skill `playwright-audit`, 104 ops, 9 findings). **`fix/professional-messages`** (on top of it, local only,
no PR): `docs/message_audit.md` M1–M10 fixed — zod wording, per-call overrides, `errorsPlain`, 6 new
`ErrorCode`s (duplicate dept/room/zone/compartment, department in use, location holds stock), `role=alert`
toasts. The local `api` and `web` containers run this branch with demo mode **off**; the VM is untouched.

## Next action

1. **Push both branches and open the PRs** (nothing is pushed). Owner decisions left open: a
   `USER_EMAIL_IN_USE` code (user management is on the auth STOP list), confirmations on user/
   compartment deactivation and borrow reject (M6), expense threshold of 0 (M11), and whether "Coming
   soon" should also close the import API. Audit F1 (stale requisition after a BOM,
   `features/boms/api.ts:81-84`) and F2 (403 on every requisition page, `FundsPanel.tsx:47`) are unfixed.
2. **Real client IP behind Cloudflare is IT-owned**, open, and blocks go-live (RUNBOOK §0.7). The
   app side is done: `TRUST_PROXY_HOPS` (default 1). Do not touch the VM, proxy or firewall for it.
3. **Production must run `infra/` first** (RUNBOOK §0 item 0). The VM runs the root demo stack at
   `9f4176d` (operator, 2026-09-27). The switch needs IT in the window. Waiting on Ayman:
   `IMPORT_MAX_CHANGED_SHELVES`.

## Green as of 2026-10-04 (`fix/professional-messages`), measured on Windows

- typecheck clean · unit shared 25 · api 257 · web **524** · **lint 0 (exit 0)** · guard-hardcoding **8**
- integration **1022 / 1022 (70 files)**, 289 s, local `db-test` (`docker compose -f
  infra/docker-compose.dev.yml up -d db-test`, port 5434). Was 1013 / 69 (+9 for the new codes).

## Landmines — full list in `ASSIST.md` §9

- **Postgres never runs locally on the Mac.** Integration gate = **`scripts/test-int-keeper.sh`**
  (~90 s); `ssh -L` tunnels stall and fake timeouts. Node **22** is keg-only on the Mac.
- **Lint is a real gate now (0): any error is new.** `eslint-plugin-react-hooks` is not installed,
  so an `eslint-disable react-hooks/*` comment is itself an error.
- **A branch cut from the default branch tracks `fix/lan-secure-context`.** Push by name
  (`git push -u origin <branch>`), never a bare `git push`.
- **Five failed logins from one address lock every login from it for 900 s** (in-memory; restart
  the local `api` to clear). Never run negative-login tests against a real email or the VM.
- **Every role→people query must filter `users.is_service_account = false`** (list in
  `07-data-model.md` §7.5), or a panel gets requisition stages, IM notices and picker slots.
- **A response body that is HTML, or not `{code, message}`, came from another app**, not the API.
- **Never run two test suites at once** (one shared `db-test`). **`pnpm typecheck` reads
  `packages/shared/dist`:** change a contract, rebuild shared.
- **Two compose files.** Root = demo (what the VM runs today); `infra/` = production.
- **`test-env.int-spec` refuses an unpinned config key.** Pin every new one in `TEST_ENV`.
- **`resetData` keeps requisitions and cannot delete a user who moved stock.** A full run leaves
  >100 users, so anything reading "the first page of users" needs fixtures that sort first.
- **An import locks the whole API out, and the lock lives in process memory.**

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · `G-21` (borrow form 500 on an unknown project) ·
PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` · `OQ-C` · `OQ-D` · `OQ-F` · `OQ-KT8` · `OQ-KT9`
· **overdue notifications are unwired on purpose (`OQ-E`) — not a gap, do not "fix"**
· 8 guard-hardcoding findings
