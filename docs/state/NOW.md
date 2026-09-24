# NOW — cold-start brief

> Auto-injected every session by the `SessionStart` hook. **Keep under ~60 lines.** Deeper, on
> demand: `ASSIST.md` · `SESSION-LOG.md` · `DECISIONS.md` · `OPEN-QUESTIONS.md` · `docs/RUNBOOK.md`.

**Updated:** 2026-09-24

## Where the build is

**Phases 00–10 complete**, and the **CSV product import is built** — `importing_data.md`, parts
A–G and I–L. Export → hand to Claude → edit → import, with a diff a human approves, a backup
taken first, a system-wide lockout while it applies, and one-click restore.

What that means concretely: `GET /inventory/export` writes the round-trip file; uploading one
back validates it against four bulk-loaded maps and parks a diff; confirming applies it in one
transaction through `StockService` with a snapshot taken first; everyone else gets 503 with an
estimate while it runs; Inventory → Bulk import lists every past run and restores any of them.
The Claude skill that shapes loose data into the file is `.claude/skills/ims-product-import`.

**Part H — a batch-aware `StockService` entry point — is deliberately unbuilt.** Optional by
design, and now measurable rather than guessed.

## Next action

**Two measurements the import ships without**, both named in `importing_data.md` §15:

1. `IMPORT_FUZZY_MATCH_THRESHOLD` (0.45) has never met a real catalogue. Doable today.
2. `IMPORT_MAX_CHANGED_SHELVES` (5,000) is arithmetic, not a timing. Benchmark 500 / 5,000 /
   20,000 changed shelves through the real apply, then set it — it can probably go up, now that
   the in-memory progress clock keeps the heartbeat alive during a long run.

Then: nothing assigned. Ask Ayman.

## Green as of 2026-09-24 — measured serially, not remembered

- `pnpm typecheck` clean · `pnpm test` → shared 25 · api 240 · web 450
- `pnpm lint` → **20 pre-existing errors. Not green.** Compare against 20, not zero.
- `pnpm --filter @ims/api test:int` → **914 pass / 0 fail (62 files)**
- `guard-hardcoding.sh --scan-all` → **8**, against a documented baseline of 7.
- Migrations 0001–**0038** applied.

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
- **An import locks the whole API out, and the lock lives in process memory.** While a job is
  `APPLYING` every request but four is refused 503. The flag is a field on `ImportLockService`,
  not a row — so `resetData` cannot clear it, a spec that engages it must release it in
  `afterEach`, and **it breaks the day the API runs two instances**. The heartbeat check in
  `ImportLockGuard` is what lifts a lock whose import died; `release` is the only thing that
  clears either store.

## Open debt

`G-14` · `G-16` · `G-17` · `G-18` · `G-19` · PM 6/12/14/15 · `OQ-30` · `OQ-31` · `OQ-33` ·
`OQ-C` · `OQ-D` · **`OQ-F`** (uncategorised products are treated as trackable) ·
**overdue notifications are unwired on purpose (`OQ-E`, Ayman's call) — not a gap, do not "fix"**
