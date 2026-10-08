# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-10-08 · **Arif is the only developer and the lead from 2026-10-08**: every
decision, review and merge is his. Nothing routes to Ayman any more.

## Where the build is

**`main` is the PR base, green at `d3a19f6`: PRs #1–#17 merged, none open.** The GitHub *default*
branch is still `fix/lan-secure-context`, so `gh pr create --base main`. Phases 00–11 are done.
**Nothing new is deployed:** the VM runs the root demo stack at `9f4176d` (operator, 2026-09-27).
Since 10-04: lint 0 + message audit (#8, #9); lab kiosk `/panel`, no person data (#12); an
unreachable API no longer signs anyone out (#11, #15); CI on every PR to `main` (#14, #16, #17).

## Next action — chosen by Arif on 2026-10-08, in this order

1. **Done: kiosk refuses a non-GENERAL sign-in (OQ-P3)**, #19 (`513457b`). Client-side, not a boundary.
2. **Drawer plan into IMS by a script through the API**: `features/panel/layout/ims-import-v4.csv`
   (4 rooms, 17 zones, 150 compartments), dry run first, creates only what is missing via the
   Locations endpoints. Keeper dev DB first, the VM after `infra/`. The importer only *matches*
   shelves (`import-lookups.ts:195`). Until then the panel shows no cell contents.
3. **Panel go-live, outside the repo:** Chromium lockdown (policy names unverified),
   `DEMO_ACCOUNTS_ENABLED` off on the panel's server, the `lab-panel` account (RUNBOOK).

## Green — CI on `main` @ `d3a19f6`, 2026-10-08

- typecheck · lint **0** · unit shared **25** · api **257** · web **670** · guard-hardcoding **8**
- integration **1035 / 1035 (71 files)**, the baseline (DECISIONS 2026-10-08)

## Blocked — needs the operator

- **Real client IP behind Cloudflare is IT-owned** and blocks go-live (RUNBOOK §0.7). The app
  side is done (`TRUST_PROXY_HOPS`). Do not touch the VM, proxy or firewall.
- **Production must run `infra/` first** (RUNBOOK §0 item 0); needs IT in the window. Open for
  Arif: `IMPORT_MAX_CHANGED_SHELVES`.
- **Owner calls open:** OQ-35, OQ-36, a reason on borrow reject, "Coming soon" closing the import API, F4, F5.

## Landmines — full list in `ASSIST.md` §9

- **Postgres never runs locally on the Mac.** Integration gate = **`scripts/test-int-keeper.sh`**;
  `ssh -L` tunnels stall and fake timeouts. Node **22**, keg-only (Node 25 breaks jsdom).
- **CI's warm pnpm cache skips puppeteer's postinstall**, so the integration job installs Chrome
  itself (#17). Drop that step and every PDF spec returns 500.
- **Lint is a gate (0).** No `eslint-plugin-react-hooks`, so a `react-hooks/*` disable is an error.
- **5 failed logins from one address lock all its logins for 900 s** (restart the local `api`). Never
  run negative-login tests against a real email or the VM.
- **Every role→people query must filter `users.is_service_account = false`** (`07-data-model.md` §7.5).
- **A response body that is HTML, or not `{code, message}`, came from another app**, not the API.
- **Never run two test suites at once** (one `db-test`). **`pnpm typecheck` reads `packages/shared/dist`.**
- **Two compose files:** root = demo (the VM today), `infra/` = production. **`test-env.int-spec`
  refuses an unpinned config key.** **An import locks the whole API out** (lock in process memory).

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · `G-21` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-C` · `OQ-D` · `OQ-F` · `OQ-KT8` · `OQ-KT9` · 8 guard-hardcoding findings
· **overdue notifications are unwired on purpose (`OQ-E`) — not a gap, do not "fix"**
