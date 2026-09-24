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

## Next action

Nothing assigned. The two candidates, both needing Ayman first:

1. **§15's end-to-end on the demo stack** — export → edit → import → verify, one broken file, one
   crash mid-apply, one killed task, one restore, one restore after renaming a category and a
   room. **Blocked: no host address is recorded anywhere in this repo.** Every runbook line says
   `<host>`. Ask before touching the VM, and confirm demo vs production first.
2. Raise or keep `IMPORT_MAX_CHANGED_SHELVES` now that the timings exist.

## Green as of 2026-09-24 — measured serially, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 25 · api 240 · web 450
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `pnpm --filter @ims/api test:int` → **926 pass / 0 fail (64 files)**
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
