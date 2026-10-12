import { sql, type Kysely } from 'kysely';

/**
 * Drawer lights, part 1 of 2: the two API-key scopes (Phase 13, decided 2026-10-12).
 *
 *  - `locate:read`  — the cabinet's light controller waits for the next event (`GET /locate/next`).
 *  - `locate:write` — the voice unit reports a search (`POST /locate`).
 *
 * This migration only teaches the enum the labels. Making `locate:read` count as read-only is
 * 0041's job, and it is a separate file on purpose — but **not** because a separate file gets its
 * own transaction: the migrator applies every pending migration in one transaction
 * (`kysely/dist/esm/migration/migrator.js`, `db.transaction().execute(run)`), so 0040 and 0041
 * normally run together. A label added in a transaction cannot be *used* in it, which is why 0041
 * compares scopes as text and never names the new label as an enum constant.
 */

/** The labels this migration adds, in the order the shared contract lists them. */
const ADDED = ['locate:read', 'locate:write'] as const;

/** The labels the enum held after 0039, for the rebuild on the way down. */
const BEFORE_0040 = sql`'inventory:read', 'catalog:write', 'locations:write', 'stock:receive', 'stock:take'`;

/** 0039's read-only set, written exactly as 0039 wrote it, so a rollback restores its CHECKs. */
const READ_ONLY_0039 = sql`ARRAY['inventory:read']::api_key_scope[]`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // `IF NOT EXISTS`: a label survives a rollback that failed half-way, and a re-apply must not trip on it.
  for (const label of ADDED) {
    await sql`ALTER TYPE api_key_scope ADD VALUE IF NOT EXISTS ${sql.lit(label)}`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM api_keys WHERE scopes::text[] && ARRAY['locate:read', 'locate:write']
      ) THEN
        RAISE EXCEPTION 'Refusing to roll back 0040: a key holds a locate scope. Revoke it and remove the row by hand first.';
      END IF;
    END
    $$
  `.execute(db);

  /*
   * Postgres has no `DROP VALUE`, so the enum is rebuilt, as 0039's rollback does. The two CHECKs
   * name the type, and the column cannot change type underneath them, so they come off first and
   * go back on afterwards exactly as 0039 left them (0041's rollback has already restored that
   * form). The guard above has proved no row holds a removed label, so the cast cannot fail.
   */
  await sql`ALTER TABLE api_keys DROP CONSTRAINT api_keys_write_scope_needs_expiry`.execute(db);
  await sql`
    ALTER TABLE api_keys DROP CONSTRAINT api_keys_write_scope_needs_service_account
  `.execute(db);

  await sql`ALTER TYPE api_key_scope RENAME TO api_key_scope_0040`.execute(db);
  await sql`CREATE TYPE api_key_scope AS ENUM (${BEFORE_0040})`.execute(db);
  await sql`
    ALTER TABLE api_keys
    ALTER COLUMN scopes TYPE api_key_scope[] USING scopes::text[]::api_key_scope[]
  `.execute(db);
  await sql`DROP TYPE api_key_scope_0040`.execute(db);

  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_write_scope_needs_service_account
    CHECK (service_user_id IS NOT NULL OR scopes <@ ${READ_ONLY_0039})
  `.execute(db);
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_write_scope_needs_expiry
    CHECK (expires_at IS NOT NULL OR scopes <@ ${READ_ONLY_0039})
  `.execute(db);
}
