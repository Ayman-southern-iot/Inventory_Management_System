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
