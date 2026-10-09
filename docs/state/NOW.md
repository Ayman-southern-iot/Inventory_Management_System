# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-10-09 · **The lead is the only developer and the only one who merges.**

## Where the build is

**`main` @ `63f2fbc` = tag `v1.0.0`, CI green. PRs #1–#25 merged, #26 closed unmerged.** The GitHub
*default* branch is still `fix/lan-secure-context`, so `gh pr create --base main`. Phases 00–11 done.

**Production has run `v1.0.0` since 2026-10-08** (record: RUNBOOK §0, "Go-live record"):

- the **root** compose stack plus its untracked `docker-compose.override.yml` (demo off, direct
  take on), **not `infra/`**. Ingress unchanged: Cloudflare → NPM → the stack's Caddy;
- demo data zeroed through the ledger and archived, nothing deleted. Drawer plan loaded: 4 rooms,
  17 zones, 150 compartments. The 6 CTO items sit in their v4 cells; reconciliation 0/0;
- nightly backup pulled to the keeper at 02:30 Asia/Dhaka, 14 days kept. First scheduled run OK;
- the lab kiosk shows `/panel` signed in as `lab-panel` (GENERAL only).

## Next action

1. **Phase 12: a 3D room view at `/room`, for PCs only.** Discovery first; the lead then picks the
   port option and approves `three`. Branch `feat/room-3d`. The kiosk never loads `/room`, and
   the `/panel` chunk must not grow.
2. Release `v1.1.0` by the `v1.0.0` pattern (RUNBOOK §0 go-live record), on the lead's separate go.

## Green — CI on `main` @ `63f2fbc`, 2026-10-08

- typecheck · lint **0** · unit shared **25** · api **270** · web **685** · guard-hardcoding **8**
- integration **1035 / 1035 (71 files)**, the baseline (DECISIONS 2026-10-08)

## Blocked — needs the operator

- **Real client IP (RUNBOOK §0.7) is deferred:** `TRUST_PROXY_HOPS=3` waits until NPM accepts
  Cloudflare only; on the root stack Caddy must also trust NPM. Do not touch the VM, proxy or firewall.
- **Parked by the lead:** the DB password rotation (do not raise it) and the `infra/` switch.
- **Undated since the switch was dropped:** the API-key revocations and P6 items (DECISIONS 2026-10-08).
- **Owner calls open:** OQ-35, OQ-36, a reason on borrow reject, "Coming soon" closing the import API, F4, F5.

## Landmines — full list in `ASSIST.md` §9

- **Production is the root stack + override, not `infra/`.** RUNBOOK §1–§4 still describe `infra/`.
- **Postgres never runs locally on the Mac.** Integration gate = **`scripts/test-int-keeper.sh`**;
  `ssh -L` tunnels stall and fake timeouts. Node **22**, keg-only (Node 25 breaks jsdom).
- **CI's warm pnpm cache skips puppeteer's postinstall**; the integration job installs Chrome (#17).
- **Lint is a gate (0).** No `eslint-plugin-react-hooks`, so a `react-hooks/*` disable is an error.
- **5 failed logins from one address lock all its logins for 900 s** (restart the local `api`). Never
  run negative-login tests against a real email or production.
- **Every role→people query must filter `users.is_service_account = false`** (`07-data-model.md` §7.5).
- **A response body that is HTML, or not `{code, message}`, came from another app**, not the API.
- **Never run two suites at once** (one `db-test`). **`pnpm typecheck` reads `packages/shared/dist`.**
  **`test-env.int-spec` refuses an unpinned config key.** **An import locks the whole API out.**

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · `G-21` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-C` · `OQ-D` · `OQ-F` · `OQ-KT8` · `OQ-KT9` · 8 guard-hardcoding findings
· **overdue notifications are unwired on purpose (`OQ-E`) — not a gap, do not "fix"**
