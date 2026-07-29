# Session log

Newest entry at the top. Written by `/handoff`. This is what lets a fresh session pick up cold.

Format:

```md
## YYYY-MM-DD — Phase NN
**Did:** what now works that didn't before
**Decisions:** anything chosen that wasn't specified
**Landmines:** anything half-done, skipped, or shortcut — be blunt
**Next:** the single next action, specific enough to start without thinking
```

---

## 2026-07-29 — Phase 03 (Requisitions) — backend slice only

**Did:** the approval engine, end to end on the server. Migration `0008_requisitions` adds
`requisitions`, `requisition_items`, `requisition_approvals`, `requisition_events` (append-only
by trigger) and `delegations`. `RequisitionsService` implements submit (task 3.3), the approval
chain (3.4) and delegation (3.5); `ProjectsService`/`DelegationsService` alongside it.
28 new integration tests, 212 integration + 36 unit + 16 web all green. Typecheck, lint and the
no-hardcoding guard clean.

The rules that are now enforced and tested: the IM acts first and gates the approvers; approvers
act in parallel in any order; **any single rejection is terminal**; an approver may withdraw
until BOM generation and may then re-approve; `requested_amount`, `threshold_at_submit` and
`required_approver_count` are frozen at submit so a later settings change cannot reshuffle an
in-flight request (the test the plan singles out).

**Decisions:** OQ-01 and OQ-02 were answered by the user — one approver below the threshold,
per-department override on top of a company-wide default. Both matched what was already built,
so no rework. A withdrawn approval is decidable again (`expectedActions: [PENDING, WITHDRAWN]`),
because withdrawing exists precisely so the approver can think again; the row carries its latest
state and the event log carries the history. `requisition_events.actor_id` is `ON DELETE
RESTRICT`, not `SET NULL` — a SET NULL is an UPDATE, which the append-only trigger refuses, and
"who did this" must keep resolving anyway.

**Landmines — read this before continuing:**
- **Phase 03 is half done.** Tasks 3.1, 3.3, 3.4, 3.5 are ticked. **3.2 (requisition form),
  3.6 (live tracker), 3.7 (approver portal), 3.8 (IM screens) and 3.9 (deadline job +
  notifications) are NOT built.** There is no requisition UI at all yet — the backend is
  reachable only by HTTP.
- The API was **not** re-run against the dev database after the Phase 03 work; only the test
  database (5434) has exercised it. Rebuild and smoke it before trusting the dev stack.
- `resetData` in `test/factories.ts` can no longer delete users referenced by requisitions or
  the stock ledger (both are append-only downstream). Those rows accumulate across the suite.
  One test already broke on this — `users.int-spec.ts` "excludes deactivated users" now scopes
  itself by a unique designation instead of reading page one. Any new test that asserts against
  an unfiltered list will hit the same thing.
- Docker Desktop stopped itself twice during this session. Check `docker info` before any test
  or migration run.

**Next:** build task 3.2, the requisition form — two zones per requirements §3 (per-request
header: department, project, urgency, approval deadline, reason; per-line items: name, quantity,
unit amount), a combobox over `/products` with a free-text escape hatch, and the green in-stock
hint that is advisory and never blocks adding a line. The contracts are already written in
`packages/shared/src/contracts/requisitions.ts` — build to `saveRequisitionSchema`. Endpoints
that exist: `POST /requisitions`, `PUT /requisitions/:id`, `POST /requisitions/:id/submit`,
`GET /requisitions`, `GET /requisitions/:id`, `POST /requisitions/approvals/:approvalId/decision`,
`.../withdraw`, `GET /requisitions/awaiting-count`.

## 2026-07-28 — Phase 00 (Foundation)

**Did:** Phase 00 end to end, all eight tasks. A working system: `pnpm db:up && pnpm db:migrate
&& pnpm db:seed && pnpm dev` gives you a login screen, and each seeded role sees only its own
navigation. Monorepo (`apps/api`, `apps/web`, `packages/shared`), config module validated at
boot, Kysely with five migrations, settings service reading `app_settings`, users with additive
roles and required designation, JWT auth with rotating refresh, admin panel for users /
departments / settings / approver slots, and the app shell with design tokens, i18n and the four
loading states. 190 tests green; typecheck, lint and the no-hardcoding guard clean. The full
production compose stack was built and brought up on this machine and serves the SPA and API
through Caddy.

**Decisions:** the long list is in `DECISIONS.md`. The ones a future session will trip over:
Kysely rather than an ORM (no `synchronize` to leave on); `packages/shared` is a dual CJS+ESM
build because Nest is CJS and Rollup cannot read tsc's `__exportStar`; integration tests
transpile with tsc because esbuild cannot emit `design:paramtypes` and Nest DI needs it;
`consistent-type-imports` is off for `apps/api/src` for the same reason — its autofix silently
breaks the DI container at boot.

**Landmines:** be blunt about these.
- The dev database is on **5433** and the test database on **5434**. 5432 and 5430 were already
  taken on this machine by unrelated stacks. If you move to another machine, the ports in
  `infra/docker-compose.dev.yml` and `.env` are the only place that matters.
- `apps/api` **must** be built with `nest`/tsc, never run through `tsx`. tsx uses esbuild, which
  drops decorator metadata, and Nest DI then fails at runtime with a confusing "cannot read
  properties of undefined". `pnpm dev` is correct; `tsx src/main.ts` is not.
- Running the production compose stack binds port **80**. It is currently stopped, not removed;
  `docker compose -f infra/docker-compose.yml stop` is the safe way to free the port. Never
  `down -v` — that is the database.
- `infra/.env` exists on this machine with real generated secrets, and is gitignored. It is not
  the same file as the repo-root `.env` used by `pnpm dev`.
- Five deferred gaps are written up as **G-01..G-05** in `OPEN-QUESTIONS.md`. G-01 (nothing
  prunes `login_attempts` or expired refresh tokens) is the one that quietly grows forever.
- The security review's own note: token *expiry* is untested, because doing it honestly needs an
  injectable clock rather than a `sleep`. Both expiry branches are unexecuted.
- nginx discards every inherited header the moment a `location` declares its own `add_header`.
  The security headers live in `apps/web/security-headers.conf` and must be `include`d in ANY
  new location block that adds a header of its own, or they silently vanish from that route.
  This already bit once: the CSP was added, committed, and served nowhere.

**Next:** `/resume`, then Phase 01 task 1.1 — the product catalogue. Before finalising the
schema, get OQ-03 (serial-level tracking for laptops?) and OQ-08 (is `consumable` a product flag
or a per-borrow choice?) answered, because both change the catalogue's shape and are cheap to
ask and expensive to migrate. Phase 01 also carries the mandatory concurrency test from
`rules/50-testing.md`: N simultaneous borrows against stock 1, exactly one wins, exactly one
ledger row.
