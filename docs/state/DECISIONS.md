# Decisions

One line per decision, newest at the bottom. Anything expensive to reverse gets an ADR in
`docs/adr/` instead, with a pointer here.

Format: `YYYY-MM-DD — <decision> — <why, in one clause>`

---

- 2026-07-28 — Modular monolith, not microservices — 12 users; service boundaries would add
  distributed-systems failure modes for no benefit.
- 2026-07-28 — Quantity-based stock with placements, not per-unit serial tracking — makes
  partial moves work and keeps product IDs stable; serial layer is dormant in the schema
  (`asset_units`) and can be switched on with a migration. Pending Q3.
- 2026-07-28 — No Redis / job queue — reminders are one cron query every 15 minutes and PDFs are
  generated ~6 times a day; a queue server is operational cost with no payoff at this scale.
- 2026-07-28 — Append-only `stock_ledger` as the source of truth, placements as a derived cache —
  makes every discrepancy diagnosable and reversible.
- 2026-07-28 — `approved_amount` stored separately from `requested_amount` — requirements §6
  compares requested vs approved vs funded, which is only meaningful if approval can revise the
  figure. Behind the `allow_amount_revision` flag. Pending Q13's original intent.
- 2026-07-28 — A BOM may span multiple requisitions — requirements §9 says "submission(s)".

## Phase 00 — Foundation

- 2026-07-28 — Kysely + hand-written SQL migrations, not an ORM — rule 3 requires `synchronize`
  off everywhere; Kysely has no such concept at all, so the illegal state is unrepresentable
  rather than merely configured off. Typed query builder still gives `SELECT ... FOR UPDATE`
  and explicit transactions, which Phase 01's stock locking needs.
- 2026-07-28 — `packages/shared` ships dual CJS + ESM builds — NestJS is CommonJS and Rollup
  cannot statically read named exports out of tsc's `__exportStar` CJS wrapper. Two tsc passes
  is cheaper than making either side bend.
- 2026-07-28 — Settings live in a typed registry (`packages/shared/src/settings/registry.ts`)
  keyed to their seed env var — the seeder and the admin UI are data-driven from it, so adding
  a business value is one entry plus one config-schema line, with nothing to keep in sync.
- 2026-07-28 — Env seeds `app_settings` on first boot only, via `ON CONFLICT DO NOTHING` —
  a restart must never reset a value an admin has since changed (requirements §11).
- 2026-07-28 — Roles in their own `user_roles` table, not an array column — makes "every active
  APPROVER" an index scan and stops two concurrent grants from losing one another.
- 2026-07-28 — Refresh tokens rotate with family-wide revocation on reuse — a replayed token
  means it leaked; killing the family logs out the attacker at the cost of logging out the
  legitimate user, which is the correct trade.
- 2026-07-28 — `refresh_tokens.revoked_reason` is recorded, not inferred (migration 0005) — a
  token killed by an admin and one killed by the theft response are otherwise identical, and
  the two must tell the user different things. Inferring it from `replaced_by_id` was tried
  first and was wrong; the integration suite caught it.
- 2026-07-28 — Access tokens carry the role set and are trusted for their 15-minute life — the
  alternative is a database read on every request for a role change that happens monthly.
  Deactivation revokes refresh tokens immediately, so the exposure is bounded by that TTL.
- 2026-07-28 — Tokens in `localStorage`, not httpOnly cookies — the SPA needs the refresh token
  to rotate proactively, and this is a single-origin internal tool with no third-party embeds.
  Mitigated by the short access TTL and server-side reuse detection. Revisit if it ever becomes
  internet-facing.
- 2026-07-28 — `@Roles()` attaches only `RolesGuard`; `JwtAuthGuard` is global via `APP_GUARD` —
  re-attaching it per controller would force every feature module to import `JwtModule` to
  satisfy the injector.
- 2026-07-28 — `@typescript-eslint/consistent-type-imports` is off for `apps/api/src` — Nest
  resolves DI from `design:paramtypes`, which the compiler only emits for value imports, so the
  rule's autofix silently breaks the container at boot.
- 2026-07-28 — Integration tests transpile with tsc, not esbuild — esbuild cannot emit
  `design:paramtypes`, so Nest DI fails to resolve anything under vitest's default transform.
- 2026-07-28 — Approver slots modelled as `approver_slots` rows with a nullable `department_id`
  (null = company-wide default) — satisfies either answer to OQ-02 without a schema change.
