import { sql, type Kysely } from 'kysely';

/**
 * Drawer lights, part 2 of 2: `locate:read` joins `inventory:read` as a scope that cannot change
 * anything (Phase 13, decided 2026-10-12).
 *
 * 0039's two CHECKs say a key holding anything but `inventory:read` needs a service account and an
 * expiry. Left alone, the light controller's key — which only ever waits for an event — would need
 * both, and would stop working the day it expired. Re-created here with the wider read-only set.
 * `READ_ONLY_API_KEY_SCOPES` in the shared contract mirrors this list; this is the guarantee.
 *
 * **Compared as text, deliberately.** 0040 adds the `locate:read` label, and the migrator runs
 * every pending migration in one transaction, so this normally runs in the transaction that added
 * it — and Postgres refuses to use an enum label in the transaction that created it. A text
 * comparison never parses the label as an enum constant, so it is safe either way. The existing
 * rows' values are read with the column's own output function, which needs nothing new.
 */

const READ_ONLY_NOW = sql`ARRAY['inventory:read', 'locate:read']::text[]`;

/** 0039's form, for the rollback. `inventory:read` predates 0040, so the enum cast is safe. */
const READ_ONLY_0039 = sql`ARRAY['inventory:read']::api_key_scope[]`;

async function dropChecks(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE api_keys DROP CONSTRAINT api_keys_write_scope_needs_expiry`.execute(db);
  await sql`
    ALTER TABLE api_keys DROP CONSTRAINT api_keys_write_scope_needs_service_account
  `.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  // Same names as 0039's, so anything that recognises a violation by constraint name still does.
  await dropChecks(db);
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_write_scope_needs_service_account
    CHECK (service_user_id IS NOT NULL OR scopes::text[] <@ ${READ_ONLY_NOW})
  `.execute(db);
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_write_scope_needs_expiry
    CHECK (expires_at IS NOT NULL OR scopes::text[] <@ ${READ_ONLY_NOW})
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // The narrower CHECKs would reject a `locate:read` key with no account or no expiry. Say so
  // plainly rather than letting the constraint fail with a message that names no key.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM api_keys
        WHERE (service_user_id IS NULL OR expires_at IS NULL)
          AND NOT scopes::text[] <@ ARRAY['inventory:read']
      ) THEN
        RAISE EXCEPTION 'Refusing to roll back 0041: a key with no service account or no expiry holds locate:read. Revoke it and remove the row by hand first.';
      END IF;
    END
    $$
  `.execute(db);

  await dropChecks(db);
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
