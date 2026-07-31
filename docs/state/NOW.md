# NOW — cold-start brief

> Auto-injected into every session by the `SessionStart` hook. **Keep it under ~60 lines.**
> This file is the whole point of not having to read anything else to get started.
> Update it whenever the answer to "what am I doing next" changes. `/handoff` rewrites it.
>
> Deeper context, only when actually needed:
> `docs/state/SESSION-LOG.md` (history) · `docs/state/DECISIONS.md` (why) ·
> `docs/state/OPEN-QUESTIONS.md` (OQ/G items) · `plan/PHASE-*.md` (the work) ·
> `docs/RUNBOOK.md` (deploy, restore, incidents)

**Updated:** 2026-07-31

## Where the build is

- **Phases 00–06 are all done.** There is no next phase file. The build is feature-complete
  against the plan and hardened; what remains is go-live, not construction.
- Phase 06 closed with: the nightly invariant job, a drilled backup/restore, an hourly
  monitoring floor, a performance pass, a security review, and `docs/RUNBOOK.md`.

## Green as of last run

`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm --filter @ims/api test:int`
→ **23 files, 368 integration tests, all passing.** Migrations 0001–0018 applied.

## Before go-live — the operator's list, not the code's

1. **Offsite backups (G-16).** Backups sit on the same VM as the database. Uncomment one of the
   rclone/aws lines in `infra/backup.sh` and give it credentials. Survives a bad migration
   today, not a dead VM.
2. **Run the restore drill on the production stack (G-17).** Drilled against a scratch DB only.
3. **Set the three settings** that have no safe default: Approver slots 1/2, **Sub-threshold
   approver** (a separate setting, and the most commonly missed), expense threshold.
4. Appoint a **second Inventory Manager and a third approver** — nobody may approve their own
   requisition, so a lone IM or approver cannot submit one.

## Remaining engineering debt

`G-18` (integration tests write uploads into the dev storage dir) and `G-19` (five endpoints
return a bare array rather than `Paginated<T>` — deliberate, revisit past ~1000 rows).
Unconfirmed assumptions: **OQ-16** notification audience · **OQ-20** part-payments kept ·
**OQ-22** borrow-to-user may target any active user.

## Landmines (each has cost a session before)

- **Docker Desktop stops itself between sessions.** `docker info` before any migration or test.
- **Never run `apps/api` through `tsx`** — esbuild drops the decorator metadata Nest DI needs.
- **A stale API process is not a code bug.** Check process start time against `dist/` mtime.
  The built entrypoint is `apps/api/dist/src/main.js`, not `dist/main.js`.
- Dev DB **5433**, test DB **5434**. Never `docker compose down -v`.
- The **web dev server binds IPv6 only** — `localhost:5173` works, `127.0.0.1:5173` does not.
- `stock_ledger`, `requisition_events` and `audit_log` are **append-only by trigger**.
- `resetData` cannot delete requisitions, departments or users, so the **test DB accumulates
  them**. Never assert "exactly one row" or "it is on page one" — scope by an id you created.
- `boms-pdf.int-spec.ts` overrides `PdfRendererService` with a local stub: add any new renderer
  method there too. `test/app.ts` sets `logger: false`, so a 500 arrives with no stack.
- Interpolating the same Kysely `sql` fragment twice re-emits its parameters with **different**
  placeholder numbers, so `GROUP BY <expr>` will not match `SELECT <expr>`. Group positionally.
- **The web app selects error copy by `code`, not message.** A new failure mode needs a new
  `ErrorCode` member, or the UI shows the old sentence however good the server's message is.
- `approver_slots.slot_no` is constrained to **(1, 2)** — there is no slot 3 to fall back to.
