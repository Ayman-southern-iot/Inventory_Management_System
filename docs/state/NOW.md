# NOW — cold-start brief

> Auto-injected into every session by the `SessionStart` hook. **Keep it under ~60 lines.**
> This file is the whole point of not having to read anything else to get started.
> Update it whenever the answer to "what am I doing next" changes. `/handoff` rewrites it.
>
> Deeper context, only when actually needed:
> `docs/state/SESSION-LOG.md` (history) · `docs/state/DECISIONS.md` (why) ·
> `docs/state/OPEN-QUESTIONS.md` (OQ/G items) · `plan/PHASE-*.md` (the work)

**Updated:** 2026-07-30 (late)

## Where the build is

- Phases 00–04 done and verified. Phase 06 partly done (audit log + notifications).
- **Phase 05 in progress** — `plan/PHASE-05-funds-purchasing.md` is the plan.
  **Done: 5.0** password min 4 · **5.1** file uploads · **5.2** digital signatures (backend + UI)
  · **5.3** BOM document redesign.
- **Next task: 5.4** — the lifecycle past BOM_GENERATED (Sent to Accounts → Money Received →
  Purchased → Purchase Verified). Then 5.5 invoice + money saved, 5.6 add to inventory,
  5.7 borrow to user, 5.8 expense reporting.
- 5.4 groundwork already checked: `requisition_status` is a Postgres enum already holding
  SENT_TO_ACCOUNTS / FUNDS_PARTIAL / FUNDS_RECEIVED / PURCHASED / STOCKED / CLOSED — only
  `PURCHASE_VERIFIED` needs adding. `requisition_events.event_type` is **text**, not an enum, so
  new event types need no migration.

## Green as of last run

`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm --filter @ims/api test:int`
→ **18 files, 305 integration tests, all passing.** Migrations 0001–0015 applied.

## Blocked / needs the operator

- Nothing blocking. **OQ-18 answered:** BOM "Remaining" = Total Requested − Approved.
- OQ-19..OQ-22 still open but not blocking 5.4: what "Sent to Accounts" means outside the system,
  whether partial funding stays, how one payment splits across a batched BOM, who "borrow to
  user" may target. Assumptions are recorded; revisit if the operator contradicts them.

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
- **`boms-pdf.int-spec.ts` overrides `PdfRendererService` with a local `StubRenderer`.** Add any
  new renderer method to that stub too, or the render endpoint 500s in tests while the real
  service is fine. `test/app.ts` also sets `logger: false`, so those 500s arrive with no stack —
  flip it to `['error']` while debugging, and put it back.
- The supplied `SIOT_logo_black (1).png` is **actually a JPEG**. It lives in the repo as
  `apps/api/assets/letterhead/siot-logo.jpg`, and the renderer sniffs magic bytes rather than
  trusting the extension.

## Open engineering debt

`G-11`..`G-15` in OPEN-QUESTIONS.md. **G-14 matters most** — borrow decisions commit status in
one transaction and move stock in another, and the nightly reconciliation cannot see the
resulting stranded reservation because it never checks `reserved_qty`. Fix it before or during
task 5.7, which would otherwise copy the same shape.
