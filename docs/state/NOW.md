# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` (operating manual, symptom→cause table, landmines) · `SESSION-LOG.md` ·
> `DECISIONS.md` · `OPEN-QUESTIONS.md` · `.claude/rules/70-assist-handoff.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-08-26

## Where the build is

Phases 00–07 complete. **Phase 08 complete: all 10 ledger items**
(`plan/PHASE-08-reversible-stages-and-dashboard.md`). Every money stage between approval and
add-to-inventory is now reversible; the lifecycle tracker derives from status, not from the
append-only event log; the invoice lives inside the verify form; the dashboard shows each
person's own record. A money audit spec walks Ayman's exact scenario end to end.

## Next action

**Transportation on a voided purchase.** Reversals (`215b3cf`) landed before the transportation
fix (`f7c7f72`), and the two have not been reconciled: voiding a purchase removes its total from
`spent`, but the report's `CASE WHEN EXISTS (live purchase)` and the dashboard's equivalent
should then drop the carriage too — and that is untested either way. Reproduce it in
`money-audit.int-spec.ts` first, then fix. **Then** the BOM PDF totals against the same scenario,
which was never checked. After that, phase 06: task 6.2 (nightly invariant job, extended to
`reserved_qty` per G-14) and 6.3 (backup/restore drill).

## Green as of 2026-08-26 — measured, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 13 · api 58 · web 245
- `pnpm --filter @ims/api test:int` → **656 pass / 0 fail (49 files)**
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- Migrations 0001–**0028** applied. 0028 (void columns) verified up → down → up.
- Docker stack rebuilt and serving the current code at http://localhost:5173.

## Needs the operator

1. **`git push` is still not authorised — 145 commits ahead of `main`, 72 ahead of `origin`.**
   Everything since QA round 2 exists on this machine only. Now the single largest risk.
2. **Demo mode is ON in production** — the login page lists five accounts with a shared password.
   Off before the fresh instance holds anything real.
3. Offsite backups (**G-16**) and the restore drill (**G-17**).
4. A fresh install cannot process one requisition until an admin sets the sub-threshold approver,
   approver slots, an Inventory Manager and a department; nothing reaches stock until
   categories/zones/compartments exist. The seed creates none of them.

## Landmines — full list in `ASSIST.md` §9

- **Backticks inside a `` sql`…` `` template end the literal.** Cost two debugging rounds
  (migration 0027, then `reports.repository.ts`). Write SQL comments without them.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract or add an `ErrorCode` and
  it fails against the stale build until `pnpm --filter @ims/shared build`. A green integration
  suite is **not** evidence typecheck is green.
- **`resetData` deliberately keeps requisitions** (their events are append-only), so money
  accumulates across a spec file. Assert report totals as a **delta** or scope by department.
- **Never return `this.funding()` from inside its own transaction** — it runs on another
  connection and returns pre-commit figures. Fixed in all four call sites; do not reintroduce.
- **`pnpm db:up`, not `docker compose up`** for the test DB. **Never `npx`/`npm` at the root.**
- **`test:int -- <spec>` does not filter**; use `vitest run --config vitest.integration.config.ts
  <pattern>`.

## Open debt

`G-18` · `G-19` · PM 6/12/14/15 · **OQ-30** (BOM role checks run after validation, so an
unauthorised malformed request gets 400 before 403) · **OQ-31** (borrowing still says "No
project") · **OQ-32** (transportation vs voided purchase — the next action above).
