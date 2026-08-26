# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` (operating manual, symptom→cause table, landmines) · `SESSION-LOG.md` ·
> `DECISIONS.md` · `OPEN-QUESTIONS.md` · `.claude/rules/70-assist-handoff.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-08-26

## Where the build is

Phases 00–06 complete. **Phase 07 complete: the QA round 2 defect list is closed, 22 of 22**
(`plan/PHASE-07-qa-round-2-defects.md` has the ledger, classification and commit per item).
`EX-02` shipped with it, so **no REQUIRED obligation in the requirements document is now
unimplemented**. `IMS_QA_Test_Plan.xlsx` has been corrected — its Status column reflects the repo
and a "Fixed In (commit)" column names what closed each row.

## Next action

**Task 6.2, the nightly invariant job**: `SUM(stock_ledger) = stock_placements.quantity` per
product. Extend it to `reserved_qty` in the same pass (G-14) — it cannot currently see a stranded
reservation, which is the whole failure mode G-14 describes. Then **6.3, the backup and restore
drill**, the highest-value remaining task given the no-data-loss requirement.

## Green as of 2026-08-26 — measured, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 13 · api 58 · web 163
- `pnpm --filter @ims/api test:int` → **606 pass / 0 fail (45 files)**
  **Fully green for the first time.** The long-standing single failure was a real defect
  (oversized JSON body answered 500, not 413) and is fixed in `4efbf75`.
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- Phase 07 added **no migration**. Migrations 0001–0025 applied.

## Needs the operator

1. **`git push` is still not authorised — 63 commits exist on this machine only**, including both
   Criticals and EX-02. This is now the single largest risk to the work.
2. **Demo mode is ON in production** — the login page lists five accounts including Admin with a
   shared password and one-click sign-in. Off before the fresh instance holds anything real.
3. Offsite backups (**G-16**) and the restore drill (**G-17**).
4. A fresh install cannot process one requisition until an admin sets the sub-threshold approver,
   approver slots, an Inventory Manager and a department; nothing reaches stock until
   categories/zones/compartments exist. The seed creates none of them.

## Landmines — full list in `ASSIST.md` §9

- **`pnpm typecheck` reads `packages/shared/dist`, not source.** Change a shared contract or add
  an `ErrorCode` and it fails against the stale build until `pnpm --filter @ims/shared build`.
  The integration suite passes throughout, so a green suite is **not** evidence typecheck is green.
- **`pnpm db:up`, not `docker compose up`.** The root compose file is the production-shaped stack
  and leaves 5434 unbound; every int-spec then dies on `ECONNREFUSED 127.0.0.1:5434`.
- **Never `npx`/`npm` at the repo root** — it deletes `node_modules/.pnpm` and `vitest` with it.
- **`test:int -- <spec>` does not filter**; use `vitest run --config vitest.integration.config.ts
  <pattern>`, space-separated.
- **A spec that writes a setting must call `restoreSeededSettings(ctx)` in `afterAll`.**
- **Red-before-green is not enough** — revert the fix, check the test goes red *again*.
- **Check a command's effect, not its exit code.** **Docker Desktop stops itself between sessions.**

## Open debt

`G-18` · `G-19` · PM 6/12/14/15 · money unformatted in error copy · **OQ-30** (`POST /boms` and
`/boms/:id/void` are guarded in `BomsService`, not by `@Roles` — a real control, but it runs after
validation, so an unauthorised malformed request gets 400 before 403) · **OQ-31** (borrowing still
says "No project"; the personal-development ruling was applied to requisitions only).
