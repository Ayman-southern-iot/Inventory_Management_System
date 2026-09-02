# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-02

## Where the build is

**Phases 00–08 complete, and it is deployed.** A demo stack runs on the VM (`rndserver`) for the
testing round; everything is pushed to `origin/fix/lan-secure-context`. Since phase 08: three QA
rounds, the expenses page rebuilt to spec, and a money surface that refuses what it cannot pay for
and now says what happened to every taka.

Off for this release behind config flags: **partial funding** and **revising the approved amount**.

## Next action

**Nothing is queued — ask before starting.** In the order I would take them:

1. **Split the demo flag** so testing gets five accounts *without* four invented products. ~15 min.
2. **File upload and signatures are still untested** — documents, invoices, approve-with-signature.
   The largest untouched surface, and the likeliest first surprise.
3. **F-5**: every BOM signature prints "for &lt;their own name&gt;", on the document Accounts reads.
4. `G-14`'s prevention half · `OQ-30` · `OQ-31`.

## Green as of 2026-09-02 — measured, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 20 · api 83 · web 318
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `pnpm --filter @ims/api test:int` → **685 pass / 0 fail / 0 skipped (50 files)**
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0030** applied.
- **29/29 MVP end-to-end + 62/62 critical-flow checks** — `IMS-MVP-Readiness.md`.

## Needs the operator

1. **Demo mode is ON on the VM — there is effectively no authentication.** Deliberate for testing.
   `GET /auth/demo-accounts` answers unauthenticated with every email and the shared password.
   Before real data: redeploy via `infra/` (see the `deploy` skill) and do **not** migrate the
   testing database across.
2. Offsite backups (**G-16**) and a restore drill against the real compose stack (**G-17**).
3. A fresh production install accepts no requisition until an admin sets the sub-threshold
   approver, both approver slots, an IM and a department. RUNBOOK §0.

## Landmines — full list in `ASSIST.md` §9

- **Shell heredocs mangle scripts.** Backslashes collapse, backticks end template literals. Write
  scripts with the Write tool, never `<<'EOF'`. The `codemod` skill has the rest; it cost four
  repairs in one session.
- **Two compose files.** Root = demo, secrets hardcoded in the public repo. `infra/` = production.
  Read the `deploy` skill before writing any deployment instruction.
- **Built output goes stale and lies confidently.** A config default does not reach the container
  without `--build`.
- **The API rate limits, correctly** — 300/60s per IP, 10 logins/60s. A harness trips both and it
  reads as a broken app. See the `api-probe` skill.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared.
- **`D-nnn` is the QA defect numbering — never use it for a decision.** Cite by `OQ-*` / `G-*`.
- **`resetData` keeps requisitions**, so money accumulates across a spec file.
- **Never return `this.funding()` from inside its own transaction.**
- Never `npx`/`npm` at the root. **`test:int -- <spec>` does not filter**; use
  `vitest run --config vitest.integration.config.ts <pattern>`.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33`.
**OQ-07, OQ-32, OQ-34 and G-20 closed.**
