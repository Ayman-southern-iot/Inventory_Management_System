---
name: verify
description: Check that a phase genuinely meets its exit criteria before it is marked complete. Use at the end of a phase, or when the user asks whether something is really done.
argument-hint: "[phase number]"
---

```!
pnpm typecheck 2>&1 | tail -15
```
```!
pnpm lint 2>&1 | tail -15
```
```!
pnpm test 2>&1 | tail -30
```

## Your task

Verify phase **$ARGUMENTS** against its **Exit criteria** section in `plan/`.

For each criterion, do not reason about whether the code looks right — **exercise it**. Run the
endpoint, query the database, check the row. Report each as:

```
✅ <criterion>   — evidence: <what you actually ran and saw>
❌ <criterion>   — <what is missing>
```

Mandatory checks regardless of phase:

- `pnpm typecheck`, `pnpm lint`, `pnpm test` all green (output above)
- **Integration: `scripts/test-int-keeper.sh`**, run by hand; it takes a couple of minutes and is
  not in the blocks above. It runs the suite on the keeper beside `ims-db-test`. Never gate
  through the SSH tunnel: it stalls, and its timeouts look like lock waits but are not
  (2026-09-30). The current baseline is in `docs/state/DECISIONS.md`.
- No new hardcoded values: `bash .claude/hooks/guard-hardcoding.sh --scan-all`
- Migrations apply from an empty database **and** roll back cleanly
- If this phase touched stock: the concurrency test exists and passes, and
  `SUM(stock_ledger) = stock_placements.quantity` for every product

Finish with a one-line verdict: **PASS** or **NOT DONE**, and if not done, the shortest list of
what remains. Do not soften a failure — a phase marked complete that isn't is worse than a phase
that took an extra session.
