# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-24

## Where the build is

**Phases 00–10 complete, and the CSV product import is complete — `importing_data.md` parts A–L,
all of them.** Export → hand to Claude → edit → import, with a diff a human approves, a backup
taken first, a system-wide lockout while it applies, one-click restore, and history.

Both numbers that used to ship unmeasured are measured. `IMPORT_FUZZY_MATCH_THRESHOLD` is **0.7**
(0.684 is both a real duplicate and a sibling SKU — the classes overlap, so it is a judgement call
on a curve, and the question is closed rather than answered). `IMPORT_MAX_CHANGED_SHELVES` stays
**5,000**, now a policy choice: measured 2.4 s / 37.7 s / 126.8 s for 500 / 5,000 / 20,000 changed
shelves, linear, and the apply is a full outage for that whole time. Raising it is Ayman's call.

**§15's end-to-end ran 2026-09-24 against the rebuilt local demo stack and found two blockers,
both now fixed.** The importer refused its own unedited export (a category may be *named* with a
slash, and the path separator is ` / ` — `OQ-IMP-2`), and a crash mid-apply left the row `APPLYING`
for ever so every later import was refused 409. Re-verified after: 50 / 100 / 500 / 3,000 new rows
all apply and verify, re-import a no-op each time; broken file refused with the catalogue
unchanged; restore and restore-after-rename correct; SIGKILL four seconds into a 3,657-shelf apply
rolls back whole and is reclaimed 60 s later. Table in `importing_data.md` §15.

## Next action

Nothing assigned. Two things waiting on Ayman:

1. **Raise or keep `IMPORT_MAX_CHANGED_SHELVES`** now the timings exist.
2. **The VM.** Nothing has been deployed there — all of the above is the *local* demo stack.
   **No host address is recorded anywhere in this repo**; every runbook line says `<host>`. Ask,
   and confirm demo vs production, before touching it.

## Green as of 2026-09-24 — measured serially, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 25 · api 240 · web 450
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `pnpm --filter @ims/api test:int` → **927 pass / 0 fail (64 files)** (api unit is now 242)
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0038** applied.
- Benchmarks live in `apps/api/test/bench/`, run by hand via `vitest.bench.config.ts`. **Not** in
  the integration suite: they take minutes and leave tens of thousands of undeletable rows.

## Needs the operator

1. **The VM is still on old code** — the rate-limit fix (`03426df`) is pushed, not deployed.
2. **Demo mode is ON on the VM.** `GET /auth/demo-accounts` answers unauthenticated.
3. Offsite backups (**G-16**) and a restore drill (**G-17**).

## Landmines — full list in `ASSIST.md` §9

- **Never run two test suites at once.** One shared `db-test`; two runs truncate each other and
  produce a *convincing fake regression* in a random innocent spec. Use `scripts/gate.sh`.
- **Shell heredocs and `node -e` mangle prose**, and a `sed` substitution hits every matching line
  in the file, not the one you meant. Write code with the Write/Edit tools.
- **A green test suite said nothing about whether the import worked.** Two blockers in the first
  five minutes of running it for real: one needed a real data shape (a `/` inside a category
  name), one needed a real process death. A spec that builds its own world reaches neither. When
  a test calls the recovery function *by hand*, it has tested the function, not the path.
- **A long `OR` list cannot be compiled.** Kysely walks the tree by recursion, so a few thousand
  terms overflow the stack *while building the SQL*, non-deterministically — it passed at 5,000
  one run and failed the next. Chunk any `eb.or` built from a collection (`stock/constants.ts`).
- **Built output goes stale and lies confidently.** A seed or config change needs `--build`.
- **`pnpm typecheck` reads `packages/shared/dist`.** Change a contract, rebuild shared.
- **Two compose files.** Root = demo, secrets hardcoded in the public repo. `infra/` = production.
- **A Storage ID is immutable by trigger.** Renaming a room does not rewrite it. By design.
- **`test-env.int-spec` refuses an unpinned config key.** A new `config.schema.ts` key must be
  pinned in `TEST_ENV` or the suite fails.
- **`resetData` keeps requisitions and cannot delete products**, so both accumulate across a run.
  Make every fixture value run-unique and filter by id, never by a name substring.
- **`pg` cannot parse a custom enum array** and hands back the literal `"{a,b}"`, which passes
  `.includes('a')` by substring. Read such a column as `::text[]`.
- **An import locks the whole API out, and the lock lives in process memory** — `resetData` cannot
  clear it, a spec that engages it must release it in `afterEach`, and it breaks the day the API
  runs two instances. `release` is the only thing that clears it.
- **A sentinel in a validated form field kills `handleSubmit` silently.** Keep `__new__`-style
  values outside the form.
- **`D-nnn` is the QA defect numbering** — cite decisions by `OQ-*` / `G-*`.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-C` · `OQ-D` · **`OQ-F`** (uncategorised products are treated as trackable) ·
**overdue notifications are unwired on purpose (`OQ-E`, Ayman's call) — not a gap, do not "fix"**
