# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-21

## Where the build is

**Phases 00–10 complete.** All nine of Ayman's Phase 09 asks are built and on the demo stack, and
**Phase 10 (API keys) landed this session** — `plan/PHASE-10-api-keys.md`.

Phase 09 landed rooms above zones, shelf-slot Storage IDs, nested categories, borrow custody and
three rounds of Ayman's design feedback. It also turned up a shipped defect — inline project
creation on the Borrow form had never worked (`55d123a`, see the sentinel landmine).

**Phase 10 — API keys.** An external system can read products, categories and locations with a
credential of its own. Admin panel issues, disables and revokes; sha256 at rest, shown once.
Scope `inventory:read`, read-only, **default-deny by route**: a key reaches a route only if it
carries `@ApiKeyScopes`, and `request.user` stays undefined so `@Roles` and the audit actor are
closed by construction. Integration docs generate from the live route table.

## Next action

No assigned task. Ask Ayman. Unrequested candidates: clickable category breadcrumb on the
product page (spec §6), inventory search by shelf label (OQ-B), category move/merge.

## Green as of 2026-09-21 — measured serially, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 25 · api 90 · web 404
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `pnpm --filter @ims/api test:int` → **762 pass / 0 fail / 0 skipped (53 files)**
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0037** applied.

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
- **`pg` cannot parse a custom enum array** and hands back the literal `"{a,b}"`. A string that
  passes `.includes('a')` by substring — every single-value test still green. Read such a column
  as `::text[]` (see `api_keys.scopes`).
- **An import's snapshot is not yet the guarantee `importing_data.md` §5.5 claims.** Step 1 of
  that list is "Engage the lockout (§8). Before anything else", and step 2 says the snapshot is
  "a faithful pre-image of exactly what is about to be overwritten" **because the lockout is
  already up**. The lockout is part I and is not built, so that sentence is currently false: a
  write landing between the snapshot and the transaction leaves the rollback file quietly wrong
  about that one change (§16.5). Small window, rare imports, not zero. The call site in
  `import-apply.service.ts` carries the same note; **part I landing is what makes §5.5 true.**

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-C` · `OQ-D` · **`OQ-F`** (uncategorised products are treated as trackable) ·
**overdue notifications are unwired on purpose (`OQ-E`, Ayman's call) — not a gap, do not "fix"**
