# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-24

## Where the build is

**Phases 00–10 complete, and the CSV product import is complete — `importing_data.md` parts A–L,
all of them.** Export → hand to Claude → edit → import, with a diff a human approves, a backup
taken first, a system-wide lockout while it applies, one-click restore, and history.

Both unmeasured numbers are measured. `IMPORT_FUZZY_MATCH_THRESHOLD` is **0.7** (0.684 is both a
real duplicate and a sibling SKU, so it is a judgement call on a curve — closed, not answered).
`IMPORT_MAX_CHANGED_SHELVES` stays **5,000**: 500 / 5,000 / 20,000 shelves take 2.4 s / 37.7 s /
126.8 s, linear, and the apply is a full outage throughout. Raising it is now a policy call.

**§15's end-to-end ran against the rebuilt local demo stack and found two blockers, both fixed**
(`importing_data.md` §15 has the table): the importer refused its own unedited export, and a
crash mid-apply refused every later import for ever. Re-verified after.

## Next action

Nothing assigned. Two things waiting on Ayman:

1. **Raise or keep `IMPORT_MAX_CHANGED_SHELVES`** now the timings exist.
2. **The VM.** Nothing has been deployed there — all of the above is the *local* demo stack. It is
   still on old code (the rate-limit fix `03426df` is pushed, not deployed) and **demo mode is ON**
   (`GET /auth/demo-accounts` answers unauthenticated). **No host address is recorded anywhere in
   this repo**; every runbook line says `<host>`. Ask, and settle demo vs production, first.
   Offsite backups (**G-16**) and a restore drill (**G-17**) are still owed.

## Green as of 2026-09-24 — measured serially, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 25 · api 242 · web 450
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `pnpm --filter @ims/api test:int` → **927 pass / 0 fail (64 files)**
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0038** applied. Benchmarks are in `apps/api/test/bench/`, run by hand via
  `vitest.bench.config.ts` — **not** in the suite; they take minutes and leave undeletable rows.

## Landmines — full list in `ASSIST.md` §9

- **Never run two test suites at once.** One shared `db-test`; two runs truncate each other and
  produce a *convincing fake regression* in a random innocent spec. Use `scripts/gate.sh`.
- **Shell heredocs and `node -e` mangle prose**, and a `sed` substitution hits every matching line
  in the file, not the one you meant. Write code with the Write/Edit tools.
- **A green suite said nothing about whether the import worked.** Two blockers in five minutes of
  running it for real; a spec that builds its own world reaches neither. A test that calls the
  recovery function *by hand* has tested the function, not the path.
- **A long `OR` list cannot be compiled.** Kysely walks the tree by recursion, so a few thousand
  terms overflow the stack *while building the SQL*, non-deterministically — it passed at 5,000
  one run and failed the next. Chunk any `eb.or` built from a collection (`stock/constants.ts`).
- **Built output goes stale and lies confidently.** A seed or config change needs `--build`.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared.
- **Two compose files.** Root = demo, secrets hardcoded in the public repo. `infra/` = production.
- **`test-env.int-spec` refuses an unpinned config key.** A new `config.schema.ts` key must be
  pinned in `TEST_ENV` or the suite fails.
- **`resetData` keeps requisitions and cannot delete products**, so both accumulate across a run.
  Make every fixture value run-unique and filter by id, never by a name substring.
- **An import locks the whole API out, and the lock lives in process memory** — `resetData` cannot
  clear it, a spec that engages it must release it in `afterEach`, and it breaks the day the API
  runs two instances. `release` is the only thing that clears it.
- **`D-nnn` is the QA defect numbering** — cite decisions by `OQ-*` / `G-*`.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-C` · `OQ-D` · **`OQ-F`** (uncategorised products are treated as trackable) ·
**overdue notifications are unwired on purpose (`OQ-E`, Ayman's call) — not a gap, do not "fix"**
