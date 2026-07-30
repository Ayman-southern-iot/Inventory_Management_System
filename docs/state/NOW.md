# NOW — cold-start brief

> Auto-injected into every session by the `SessionStart` hook. **Keep it under ~60 lines.**
> This file is the whole point of not having to read anything else to get started.
> Update it whenever the answer to "what am I doing next" changes. `/handoff` rewrites it.
>
> Deeper context, only when actually needed:
> `docs/state/SESSION-LOG.md` (history) · `docs/state/DECISIONS.md` (why) ·
> `docs/state/OPEN-QUESTIONS.md` (OQ/G items) · `plan/PHASE-*.md` (the work)

**Updated:** 2026-07-31

## Where the build is

- **Phases 00–05 are done.** Phase 06 is partly done (audit log UI + notifications).
- Phase 05 includes the IM funds panel, so the whole money lifecycle is reachable from the
  browser rather than API-only. The expense report is live under **Expenses** in the nav.
- **Next: Phase 06** — `plan/PHASE-06-hardening.md`. 6.1 is effectively done. Open: **6.2**
  nightly invariant job · **6.3** backup/restore drill · **6.4** monitoring · **6.5** performance
  pass · **6.6** security review · **6.7** operator runbook.
- **6.3 is the one not to skip.** Backups that have never been restored are not backups, and the
  operator's stated requirement is that no data is ever lost.

## Green as of last run

`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm --filter @ims/api test:int`
→ **20 files, 341 integration tests, all passing.** Migrations 0001–0018 applied.

## Blocked / needs the operator

- Nothing blocking. **OQ-18** (BOM "Remaining" = Requested − Approved) and **OQ-19** ("Sent to
  Accounts" is a status plus a note) are both answered.
- Assumed but unconfirmed: **OQ-20** part-payments are kept · **OQ-22** borrow-to-user may target
  any active user · **OQ-16** who gets notified about what.
- Operator action outstanding: **Settings → Sub-threshold approver is unset**, so any requisition
  below the 14,000 threshold refuses to submit. Config, not code.

## Landmines (each has cost a session before)

- **Docker Desktop stops itself between sessions.** `docker info` before any migration or test.
- **Never run `apps/api` through `tsx`** — esbuild drops the decorator metadata Nest DI needs.
- **A stale API process is not a code bug.** Check process start time against `dist/` mtime.
- Dev DB **5433**, test DB **5434**. Never `docker compose down -v`.
- `stock_ledger`, `requisition_events` and `audit_log` are **append-only by trigger**.
- `resetData` cannot delete requisitions, departments or users, so the **test DB accumulates
  them**. Never assert "exactly one row" or "it is on page one" — scope by an id you created.
- `boms-pdf.int-spec.ts` overrides `PdfRendererService` with a local stub: add any new renderer
  method there too. `test/app.ts` sets `logger: false`, so a 500 arrives with no stack — flip it
  to `['error']` while debugging, then put it back.
- Interpolating the same Kysely `sql` fragment twice re-emits its parameters with **different**
  placeholder numbers, so `GROUP BY <expr>` will not match `SELECT <expr>`. Group positionally.

## Open engineering debt

`G-11`..`G-15` in OPEN-QUESTIONS.md. **G-14/G-15 are now cheap**: `StockService.receive`, `issue`
and `receiveAndHold` all take an optional transaction, which is exactly the shape those bugs need.
Tasks 5.6 and 5.7 were built that way; `borrowing.decide`, `cancel` and `recordReturn` were not
retrofitted. Do it alongside 6.2, and extend the invariant job to `reserved_qty` — it cannot
currently see a stranded reservation.
