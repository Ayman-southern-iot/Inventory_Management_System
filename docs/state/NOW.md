# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` (operating manual, symptom→cause table, landmines) · `SESSION-LOG.md` ·
> `DECISIONS.md` · `OPEN-QUESTIONS.md` · `.claude/rules/70-assist-handoff.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-08-23

## Where the build is

Phases 00–06 complete. **QA round 2** is in flight: `IMS_QA_Test_Plan.xlsx` (untracked, repo
root) — 186 cases, **31 defect rows, not 32**; four Fails are second reproductions, and `EX-02`
(inventory export, the only unimplemented **REQUIRED §10** obligation) has no defect ID at all.
Full triage in `SESSION-LOG.md`. Both Criticals fixed, three Highs fixed. The tested instance
`erp.southerneleven.com` runs `f68ff53`, **27 commits behind local**; Ayman says it is a test
instance and they go fresh once the defects clear.

## Next action

**D-002 landed** (`a6c1355`): `limit` is the imported `PAGINATION_MAX_LIMIT`, a failed
catalogue says so with a retry, and `api/list-queries.contract.test.ts` parses every exported
client query constant through its schema and fails on an unregistered new one. Left open by it:
the picker still truncates in silence past 100 products — needs the `fetchAllProjects` paging
treatment, no ruling required.

**All six rulings given, 2026-08-23** — D-030's five sites GO · D-020 "Approved" = *currently*
approved · D-032 setting REMOVED · `GET /users/selectable?role=` GO · one live delegation per
approver (new rule, guard + probable partial unique index) · **`git push` still not authorised**:
28 commits including both Criticals exist on one machine only. Order: docs, D-030, D-020,
delegation guard + endpoint, D-032, then the Mediums.

## Green as of 2026-08-23 — measured, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 13 · api 58 · web **126** (112 + 14 from D-002)
- `pnpm --filter @ims/api test:int` → **497 pass / 1 fail (498 tests, 41 files)**
  The one failure is a **real defect**: oversized JSON body returns 500 not 413.
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- The old "3 reports failures" were a **settings leak** blamed on `requisitions.int-spec` for
  months. The suite is deterministic now — do not expect 493/4 or 486/7.

## Needs the operator

1. **Demo mode is ON in production** — the login page lists five accounts including Admin with a
   shared password and one-click sign-in. Off before the fresh instance holds anything real.
2. A fresh install cannot process one requisition until an admin sets the sub-threshold
   approver, approver slots, an Inventory Manager and a department, and nothing reaches stock
   until categories/zones/compartments exist. Rehearsed — the seed creates none of them.
3. Offsite backups (**G-16**) and the restore drill (**G-17**).

## Landmines — full list in `ASSIST.md` §8/§9

- **Never `npx`/`npm` at the repo root** — it deletes `node_modules/.pnpm` and `vitest` with it.
  A missing tool binary is a skipped postinstall → `pnpm install`.
- **`test:int -- <spec>` does not filter**; use `vitest run --config vitest.integration.config.ts
  <pattern>`, space-separated — `"a|b|c"` matches as a substring and finds nothing.
- **A spec that writes a setting must call `restoreSeededSettings(ctx)` in `afterAll`.**
- **Red-before-green is not enough** — revert the fix, check the test goes red *again*.
- **Check a command's effect, not its exit code** — several here silently do nothing.
- **Docker Desktop stops itself between sessions.** `docker info` first.

## Open debt

`G-18` · `G-19` · PM 6/12/14/15 · money unformatted in error copy · `EX-02` (REQUIRED §10) ·
D-027 (web BOM header omits the project; the PDF carries it) · D-003 (past deadline accepted
server-side) · D-016 (drafts render `?? 0` for a null requested amount).
