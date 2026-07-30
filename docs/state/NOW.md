# NOW — cold-start brief

> Auto-injected into every session by the `SessionStart` hook. **Keep it under ~60 lines.**
> This file is the whole point of not having to read anything else to get started.
> Update it whenever the answer to "what am I doing next" changes. `/handoff` rewrites it.
>
> Deeper context, only when actually needed:
> `docs/state/SESSION-LOG.md` (history) · `docs/state/DECISIONS.md` (why) ·
> `docs/state/OPEN-QUESTIONS.md` (OQ/G items) · `plan/PHASE-*.md` (the work)

**Updated:** 2026-07-30

## Where the build is

- Phases 00–04 done and verified. Phase 06 partly done (audit log + notifications).
- **Next up: Phase 05** — `plan/PHASE-05-funds-purchasing.md`, rewritten 2026-07-30 to the
  operator's real spec. Nine tasks, ordered, with dependencies.
- **Start at 5.0** (password → min 4 chars, ~20 min), then **5.1** (file-upload foundation —
  everything else with an image or invoice depends on it).
- Working tree clean. Last commit `1f952a7`.

## Green as of last run

`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm --filter @ims/api test:int`
→ **17 files, 288 integration tests, all passing.** Migrations 0001–0013 applied and each
rollback-verified.

## Blocked / needs the operator

- **OQ-18 blocks task 5.3.** The BOM PDF must print "Remaining" and nobody has said which
  subtraction it is. Do not guess on a document that goes to Accounts.
- OQ-19..OQ-22 are softer: what "Sent to Accounts" means outside the system, whether partial
  funding stays, how one payment splits across a batched BOM, who "borrow to user" may target.

## Landmines (each has cost a session before)

- **Docker Desktop stops itself between sessions.** `docker info` before any migration or test.
- **Never run `apps/api` through `tsx`** — esbuild drops the decorator metadata Nest DI needs.
  Use `pnpm dev`, or `pnpm --filter @ims/api build && node dist/src/main.js`.
- **A stale API process is not a code bug.** Two "impossible" bugs this month were a server
  started before the code existed. Check the process start time against `dist/` mtime.
- Dev DB is on **5433**, test DB on **5434**. Never `docker compose down -v`.
- `stock_ledger`, `requisition_events` and `audit_log` are **append-only by trigger** — an
  UPDATE/DELETE fails loudly, including via cascade.
- Redirect the integration run to a file and grep it; streaming it has blown the shell timeout.

## Open engineering debt

`G-11`..`G-15` in OPEN-QUESTIONS.md. **G-14 matters most** — borrow decisions commit status in
one transaction and move stock in another, and the nightly reconciliation cannot see the
resulting stranded reservation because it never checks `reserved_qty`. Fix it before or during
task 5.7, which would otherwise copy the same shape.
