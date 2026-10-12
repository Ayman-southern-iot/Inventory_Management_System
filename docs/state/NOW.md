# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-10-12 · **The lead is the only developer and the only one who merges.**

## Where the build is

**`main` @ `e760422`, CI green. PRs #1–#35 merged, #26 closed unmerged.** Phase 13 (drawer lights)
is merged but **not released**. The GitHub *default* branch is still `fix/lan-secure-context`, so
`gh pr create --base main`. Phases 00–13 done.

**Production runs `v1.1.0` since 2026-10-09 04:37Z** (RUNBOOK §0 record):

- the **root** compose stack plus its untracked `docker-compose.override.yml` (demo off, direct
  take on), **not `infra/`**. Ingress unchanged: Cloudflare → NPM → the stack's Caddy;
- drawer plan loaded (4 rooms, 17 zones, 150 compartments). **43 active products, 280 units**
  since the 2026-10-12 Shenzhen import (37 added through the integration API); reconciliation 0/0;
- nightly backup pulled to the keeper at 02:30 Asia/Dhaka, 14 days kept;
- the lab kiosk shows `/panel` signed in as `lab-panel` (GENERAL only).

## Next action

1. **Release `v1.2.0`** (Phase 13, migrations 0040–0041): plan ready, **production writes only on
   the lead's "go release"** (RUNBOOK §3). Rollback = the old image on the new schema.
2. **The lead's keys after release:** `drawer-lights-a`, `drawer-lights-b` (`locate:read`),
   `voice-p4-v2` (`inventory:read` + `locate:write`, service account, 180 days).
3. **Open:** `/room` on an integrated-GPU office PC; dc-a568b PR #13 (kiosk blocklist) to merge.
4. **2026-10-16:** the VM's `:v1.0.0` rollback tags may go. **Ask the lead first.**

## Green — `main` @ `e760422`, 2026-10-12

- typecheck · lint **0** · unit shared **25** · api **301** · web **743** · guard-hardcoding **9** · integration
  **1065 / 1065 (72 files)**, the baseline · `/panel` bundle **67 B** under its limit: re-baseline next time

## Blocked — needs the operator

- **Real client IP (RUNBOOK §0.7) is deferred:** `TRUST_PROXY_HOPS=3` waits until NPM accepts
  Cloudflare only; on the root stack Caddy must also trust NPM. Do not touch the VM, proxy or firewall.
- **Parked by the lead:** the DB password rotation (do not raise it) and the `infra/` switch.
- **Owner calls open:** OQ-35, OQ-36, a reason on borrow reject, "Coming soon" closing the import API, F4, F5.

## Landmines — full list in `ASSIST.md` §9

- **Production is the root stack + override, not `infra/`.** RUNBOOK §1–§4 still describe `infra/`.
- **Never `tail` the migrate log:** the seed prints last. Grep the whole log and check the exit code.
- **All pending migrations run in ONE transaction** (Kysely): a new enum label cannot be used by a
  later file in the same run. **The locate feed is process memory**, like the import lock.
- **No Postgres on the Mac:** gate = **`scripts/test-int-keeper.sh`**; Node **22**. The keeper dev DB is
  tmpfs: after a restart run `scripts/dev-api-keeper.sh`, then `drawer-plan-keeper.sh --apply`.
- **Lint is a gate (0)**; a `react-hooks/*` disable is an error. **5 failed logins lock an address 900 s.**
- **Every role→people query must filter `users.is_service_account = false`** (`07-data-model.md` §7.5).
- **Never run two suites at once** (one `db-test`). **`pnpm typecheck` reads `packages/shared/dist`.**
  **`test-env.int-spec` refuses an unpinned config key.** **An import locks the whole API out.**

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · `G-21` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-C` · `OQ-D` · `OQ-F` · `OQ-KT8` · `OQ-KT9` · issues #31 #32 #33 · 9 guard-hardcoding findings
· **overdue notifications are unwired on purpose (`OQ-E`) — not a gap, do not "fix"**
