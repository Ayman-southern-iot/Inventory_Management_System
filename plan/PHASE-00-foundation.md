# Phase 00 — Foundation

**Goal:** a running, typed, migrated skeleton with real authentication and an admin panel that can
create the users every later phase needs.

**Reference:** `docs/reference/03-architecture.md`, `docs/reference/10-permissions.md`

## Tasks

- [x] **0.1 Monorepo scaffold** — pnpm workspaces: `apps/api` (NestJS), `apps/web` (Vite+React+TS),
      `packages/shared` (zod contracts, enums). Root scripts: `dev`, `build`, `test`, `lint`,
      `typecheck`, `db:migrate`, `db:make`, `db:rollback`, `db:seed`.
      *Accept:* `pnpm dev` starts both; `pnpm typecheck` and `pnpm lint` pass on an empty repo.

- [x] **0.2 Config module** — `apps/api/src/config/`: zod schema over `process.env`, frozen typed
      export, boot-time validation that crashes with the offending variable name.
      *Accept:* removing a required env var fails the process at startup with a clear message;
      `grep -rn "process.env" apps/api/src --exclude-dir=config` returns nothing.

- [x] **0.3 Database bootstrap** — Postgres connection, migration runner, `pg_trgm` and enum types,
      seed harness. Migration `0001_init` creates `app_settings`.
      *Accept:* migrate → rollback → migrate is clean; `synchronize` is false everywhere.

- [x] **0.4 Settings service** — reads `app_settings` with a short cache, seeded from env defaults
      on first boot, invalidated on write.
      *Accept:* changing the expense threshold through the service takes effect without a restart.

- [x] **0.5 Users, roles, departments** — tables, `Role` enum (`GENERAL`, `APPROVER`,
      `INVENTORY_MANAGER`, `ADMIN`), **additive** role assignment, `designation` field on users
      (this is what prints on the BOM).
      *Accept:* a user can hold two roles; designation is required and non-empty.

- [x] **0.6 Auth** — JWT access + rotating refresh, argon2/bcrypt hashing, login rate limit,
      logout invalidation, `@Roles()` guard, `req.user` as the only source of actor identity.
      *Accept:* `security-reviewer` finds no CRITICAL or HIGH.

- [x] **0.7 Admin panel** — create/deactivate users, assign role sets, set designation, manage
      departments, configure the expense threshold and approver slots (see OQ-02).
      *Accept:* an admin can create one user of each role; a non-admin gets 403 on every admin route.

- [x] **0.8 App shell** — login, role-aware navigation, protected routes, error boundary, toast
      system, the four loading states as reusable primitives, design tokens, `i18n/en.ts`.
      *Accept:* logging in as each role shows only that role's navigation.

## Exit criteria

- `pnpm typecheck && pnpm lint && pnpm test` green
- Migrations apply from empty and roll back cleanly
- `.claude/hooks/guard-hardcoding.sh --scan-all` clean
- One user of each role exists via seed; each can log in and sees the correct shell
- `docker compose up -d` from `infra/` brings the stack up on a clean machine
