# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-21

## Where the build is

**Phases 00–08 complete. Phase 09 is complete except Part E-a/E-b polish** —
`plan/PHASE-09-taxonomy-location-and-custody.md`. All nine of Ayman's asks are built and on the
demo stack. **Everything is pushed** — `origin/fix/lan-secure-context` is at `2107a79`.

Landed this session: **E-b** custody (`current_holder_id` + append-only trail, both parties
notified, UI), **A** rooms above zones, **B** auto Storage IDs on shelf slots, **C** optional
nested categories with depth/cycle triggers and the ~200-node seed tree, **D** cascading picker
with inline create + post-create navigation to receive stock, and a **UI for E-a** (issue from
the shelf), which had shipped headless.

Then three rounds of Ayman's design feedback: the category tree, the New product form and the
issue-from-stock form all rebuilt to his mockups. The last of those found a **shipped defect** —
a `__new__` sentinel written into a react-hook-form field whose schema validates it as a uuid
killed `handleSubmit` silently, so **inline project creation on the Borrow form had never
worked**. Fixed in both forms (`55d123a`), sentinel now held outside the form.

## Next action

No assigned task. Phase 09 is done; ask Ayman what is next. Obvious candidates, none requested:
the clickable category breadcrumb on the product page (spec §6 — the path is shown flat, not as
links), searching the inventory by shelf label (OQ-B says it is not built), and the standalone
category-management screen's move/merge affordances.

## Green as of 2026-09-21 — measured serially, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 25 · api 90 · web 389
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `pnpm --filter @ims/api test:int` → **744 pass / 0 fail / 0 skipped (52 files)**
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0036** applied.

## Needs the operator

1. **The VM is still on old code.** The rate-limit fix (`03426df`) is pushed but not deployed —
   `infra/deploy.sh` has not been run. Until it is, every user there is refused on their 11th
   request in a minute.
2. **Demo mode is ON on the VM** — `GET /auth/demo-accounts` answers unauthenticated with every
   email and the shared password. Before real data: redeploy via `infra/`, do not migrate the
   testing database across.
3. Offsite backups (**G-16**) and a restore drill (**G-17**).

## Landmines — full list in `ASSIST.md` §9

- **Never run two test suites at once.** One shared `db-test`; two runs truncate each other and
  produce a *convincing fake regression* in a random innocent spec. Use `scripts/gate.sh`.
- **Shell heredocs and `node -e` mangle prose.** Backticks and `${...}` in a comment get eaten by
  bash. Write files with the Write/Edit tools, not shell string surgery.
- **Built output goes stale and lies confidently.** A seed or config change needs `--build`; a
  "fix" verified against `dist/` that was built before the edit proves nothing.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared.
- **Two compose files.** Root = demo, secrets hardcoded in the public repo. `infra/` = production.
- **A Storage ID is immutable by trigger.** Renaming a room does not rewrite it. By design.
- **`test-env.int-spec` refuses an unpinned config key.** A new `config.schema.ts` key must be
  pinned in `TEST_ENV` or the suite fails.
- **`resetData` keeps requisitions**, so money accumulates across a spec file.
- **`D-nnn` is the QA defect numbering** — cite decisions by `OQ-*` / `G-*`.
- **A sentinel in a validated form field kills `handleSubmit` silently.** No error, no toast, the
  button just does nothing. Keep `__new__`-style values in their own state, outside the form.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-C` · `OQ-D` · **`OQ-F`** (uncategorised products are treated as trackable) ·
**overdue notifications are unwired on purpose (`OQ-E`, Ayman's call) — not a gap, do not "fix"**
