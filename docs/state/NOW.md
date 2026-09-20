# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-20

## Where the build is

**Phases 00–08 complete and deployed. Phase 09 is open and part-done** —
`plan/PHASE-09-taxonomy-location-and-custody.md`, nine asks from Ayman in dependency order.
Landed: Part G (approver plural, BOM digital-approval footnote), Part F (projects are proposed
by anyone, accepted by the IM), Part E-a (IM issues straight from shelf stock to a person), plus
a rate-limit defect found on the way. **Ten commits, local only — `origin` is ten behind.**

## Next action

**Part E-b — holder reassignment.** Migration `0032`: `borrow_requests.current_holder_id` plus an
append-only `borrow_holder_changes` trail. It touches no stock and writes no ledger row — issued
units already left the shelf, so who holds them is not a placement fact.

The care is in the read sites, enumerated in the plan: `requester_id` stays as "who asked" (cancel
check, display joins); "who has it" moves to `current_holder_id` (my-borrows, dashboard,
return/revert notifications). Then Part C (categories), then A→B (rooms, shelf IDs).

## Green as of 2026-09-20 — measured serially, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 25 · api 83 · web 336
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `pnpm --filter @ims/api test:int` → **711 pass / 0 fail / 0 skipped (51 files)**
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0031** applied.

## Needs the operator

1. **Ten commits are local only.** Ayman declined to push; the remote is public GitHub.
2. **The rate-limit fix has not reached the VM.** Until it does, every user there is refused on
   their 11th request in a minute. It is one commit (`03426df`) and independent of the rest.
3. **Demo mode is ON on the VM** — `GET /auth/demo-accounts` answers unauthenticated with every
   email and the shared password. Before real data: redeploy via `infra/`, do not migrate the
   testing database across.
4. Offsite backups (**G-16**) and a restore drill (**G-17**).

## Landmines — full list in `ASSIST.md` §9

- **Never run two test suites at once.** The integration suite is `singleFork` against one shared
  `db-test`; two runs truncate each other mid-assertion and produce a *convincing fake regression*
  in a random innocent spec. It cost three wasted investigations in one session. Use
  `scratchpad/gate.sh`, which waits for any live `vitest` before starting — and check for a
  background gate you already started before launching another.
- **Shell heredocs mangle scripts.** Write scripts with the Write tool, never `<<'EOF'`.
- **Two compose files.** Root = demo, secrets hardcoded in the public repo. `infra/` = production.
- **Built output goes stale and lies confidently.** A config default needs `--build`.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared.
- **`D-nnn` is the QA defect numbering** — cite decisions by `OQ-*` / `G-*`.
- **`resetData` keeps requisitions**, so money accumulates across a spec file.
- Never `npx`/`npm` at the root. **`test:int -- <spec>` does not filter**; use
  `vitest run --config vitest.integration.config.ts <pattern>`.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-A`–`OQ-D` (phase 09) · **overdue notifications are dead code** — `borrowing.due_soon` and
`borrowing.overdue` have copy but nothing sends them; the job only logs.
