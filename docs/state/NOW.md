# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-08-27

## Where the build is

**Phases 00–08 complete.** OQ-32, phase 08's last thread, is closed: transportation is spent money
only while a live purchase stands, on all three surfaces that report it. The BOM PDF was audited
against the same scenario and needed no change — it prints what was asked for, not what was spent.
**Phase 06 was already done and the pointers lied:** 6.2 (invariant job, `reserved_qty` included)
and 6.3 (restore drill, measured) landed 2026-07-31, and `PROGRESS.md` carried a stale "next task:
6.2" under "phases 00–06 complete" that this file inherited. Both re-verified against the code.

## Next action

**Nothing is queued — ask before starting.** In the order I would take them:

1. **G-14's remaining half, which wants a ruling not a patch.** `BorrowingService.create` reserves
   in one transaction and inserts in a second (`borrowing.service.ts:66`, `:81`) because
   `StockService.reserve` never got the `existingTx` that `release` and `issue` have
   (`stock.service.ts:315`). A crash between commits strands a reservation: the 02:00 job detects
   it, nothing prevents it. Collapsing it widens the one-writer boundary.
2. **The operator blockers below**, worth more than any code right now.
3. `OQ-30` · `OQ-31` — both small, both recorded as deliberate non-fixes.

## Green as of 2026-08-27 — measured, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 13 · api 58 · web 245
- `pnpm --filter @ims/api test:int` → **663 pass / 0 fail (49 files)**; baseline 656, +7 new here.
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `guard-hardcoding.sh --scan-all` → **10** against a documented baseline of 7; the three extra
  (`all-exceptions.filter.ts`, `DateField.tsx`, `RequisitionFormPage.tsx`) accreted since
  2026-08-23 and were untouched this session. Fix them or re-baseline.
- Migrations 0001–**0028** applied. This session added none.

## Needs the operator

1. **`git push` is still not authorised — 146 commits ahead of `main`, 73 ahead of `origin`.**
   Everything since QA round 2 exists on this machine only. The single largest risk.
2. **Demo mode is ON in production** — login lists five accounts with a shared password.
3. Offsite backups (**G-16**) and a drill against the real compose stack (**G-17**); the drill
   that ran proved the commands, not the production stack.
4. A fresh install processes no requisition until an admin sets the sub-threshold approver,
   approver slots, an IM and a department. The seed creates none of them.

## Landmines — full list in `ASSIST.md` §9

- **Backticks inside a `` sql`…` `` template end the literal.** Cost two debugging rounds.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract and it fails against the
  stale build until `pnpm --filter @ims/shared build`.
- **`D-nnn` is the QA defect numbering — never use it for a decision.** `D-030` was nearly
  assigned twice. Cite decisions by `OQ-*` / `G-*` id or by date.
- **`resetData` keeps requisitions**, so money accumulates across a spec file. Assert report
  totals as a delta or scope by department.
- **Never return `this.funding()` from inside its own transaction.**
- **`pnpm db:up`, not `docker compose up`.** Never `npx`/`npm` at the root. **`test:int -- <spec>`
  does not filter**; use `vitest run --config vitest.integration.config.ts <pattern>`.

## Open debt

`G-14` (prevention half, above) · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · **OQ-30** ·
**OQ-31**. **OQ-32 closed.**
