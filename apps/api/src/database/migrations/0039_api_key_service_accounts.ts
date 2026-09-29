import { sql, type Kysely } from 'kysely';

/**
 * API keys that can act — ADR-0002, accepted by Arif 2026-09-29.
 *
 * Phase 10 keys could only read, because a key had no principal: `request.user` stayed undefined
 * so no `@Roles` route and no audit row could ever see one (K3, K4). A write needs a principal —
 * `stock_ledger.performed_by`, `borrow_requests.decided_by`, `audit_log.actor_id` and
 * `idempotency_keys.user_id` all reference `users` — and it must never be a *person*, or the
 * audit trail names somebody for an action a machine took. Hence a **service account**: a
 * `users` row flagged `is_service_account`, which a key may be bound to and act as.
 *
 * What this migration makes impossible rather than merely unlikely:
 *
 *  - **A key bound to a human.** The composite FK below can only reference a `users` row whose
 *    `is_service_account` is true. The application checks it too; this is the guarantee.
 *  - **A write-capable key with no principal, or with no end date.** Two CHECKs: any scope other
 *    than `inventory:read` needs a service account and an `expires_at` (OQ-KT3 — how *far* off
 *    that date may be is config, `API_KEY_WRITE_MAX_LIFETIME_DAYS`, so the service enforces it).
 *  - **Flipping a service account back into a person while a key points at it.** The same FK,
 *    `ON UPDATE RESTRICT`.
 *
 * `audit_log.api_key_id` records which key acted. The actor is the service account; the key is
 * the credential it presented, and revoking one key must leave a trail that says which it was.
 */

/** The scopes a key had before this migration. Anything else can write. */
const READ_ONLY_SCOPES = sql`ARRAY['inventory:read']::api_key_scope[]`;

export async function up(db: Kysely<unknown>): Promise<void> {
  /*
   * `IF NOT EXISTS` so a rollback followed by a re-apply cannot fail on a label that survived.
   * Safe inside the migration's transaction because nothing below *uses* the new values — the
   * CHECKs reference only 'inventory:read' — the same reasoning as migrations 0023 and 0038.
   */
  await sql`ALTER TYPE api_key_scope ADD VALUE IF NOT EXISTS 'catalog:write'`.execute(db);
  await sql`ALTER TYPE api_key_scope ADD VALUE IF NOT EXISTS 'locations:write'`.execute(db);
  await sql`ALTER TYPE api_key_scope ADD VALUE IF NOT EXISTS 'stock:receive'`.execute(db);
  await sql`ALTER TYPE api_key_scope ADD VALUE IF NOT EXISTS 'stock:take'`.execute(db);

  // A constant default makes this a catalogue-only change on Postgres 11+: no table rewrite.
  await sql`
    ALTER TABLE users ADD COLUMN is_service_account boolean NOT NULL DEFAULT false
  `.execute(db);
  // The target of the composite FK. `id` alone is already unique, so this costs one small index
  // and buys the database refusing a key bound to a person.
  await sql`
    ALTER TABLE users
    ADD CONSTRAINT users_id_is_service_account_key UNIQUE (id, is_service_account)
  `.execute(db);

  await sql`ALTER TABLE api_keys ADD COLUMN service_user_id uuid`.execute(db);
  // Always true, and not writable: it exists only to be the second half of the FK, so the
  // referenced row must be (id, true) — a service account — and never (id, false).
  await sql`
    ALTER TABLE api_keys
    ADD COLUMN service_user_is_service_account boolean GENERATED ALWAYS AS (true) STORED
  `.execute(db);
  // MATCH SIMPLE (the default): a null `service_user_id` skips the check, which is exactly an
  // unbound read-only key.
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_service_user_fk
    FOREIGN KEY (service_user_id, service_user_is_service_account)
    REFERENCES users (id, is_service_account)
    ON DELETE RESTRICT ON UPDATE RESTRICT
  `.execute(db);
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_write_scope_needs_service_account
    CHECK (service_user_id IS NOT NULL OR scopes <@ ${READ_ONLY_SCOPES})
  `.execute(db);
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_write_scope_needs_expiry
    CHECK (expires_at IS NOT NULL OR scopes <@ ${READ_ONLY_SCOPES})
  `.execute(db);
  // "Which keys act as this account" — the service-accounts list and deactivation both ask it.
  await sql`
    CREATE INDEX api_keys_service_user_idx ON api_keys (service_user_id)
    WHERE service_user_id IS NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE audit_log
    ADD COLUMN api_key_id uuid REFERENCES api_keys (id) ON DELETE RESTRICT
  `.execute(db);
  // "What did this key do" — partial, because almost every row was written by a person.
  await sql`
    CREATE INDEX audit_log_api_key_idx ON audit_log (api_key_id, created_at DESC)
    WHERE api_key_id IS NOT NULL
  `.execute(db);
}

/**
 * Reverses everything above, **and refuses once reversing would lose meaning**.
 *
 * Before any service account exists, this is a clean inverse. After one does, dropping
 * `is_service_account` would silently turn every panel into a person — eligible for requisition
 * stages, IM notifications and every picker — and dropping `audit_log.api_key_id` would erase
 * which key performed each recorded action. Neither is recoverable, so the rollback stops and
 * says so. Rolling *forward* (deactivate the accounts, revoke the keys) is the way out then.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM users WHERE is_service_account) THEN
        RAISE EXCEPTION 'Refusing to roll back 0039: service accounts exist, and dropping the flag would turn them into people. Deactivate them and roll forward instead.';
      END IF;
      IF EXISTS (SELECT 1 FROM audit_log WHERE api_key_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Refusing to roll back 0039: audit rows record which API key acted, and dropping the column would erase that.';
      END IF;
      IF EXISTS (SELECT 1 FROM api_keys WHERE NOT scopes <@ ARRAY['inventory:read']::api_key_scope[]) THEN
        RAISE EXCEPTION 'Refusing to roll back 0039: a key holds a write scope. Revoke it and remove the row by hand first.';
      END IF;
    END
    $$
  `.execute(db);

  await sql`DROP INDEX IF EXISTS audit_log_api_key_idx`.execute(db);
  await sql`ALTER TABLE audit_log DROP COLUMN IF EXISTS api_key_id`.execute(db);

  await sql`DROP INDEX IF EXISTS api_keys_service_user_idx`.execute(db);
  await sql`
    ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_write_scope_needs_expiry
  `.execute(db);
  await sql`
    ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_write_scope_needs_service_account
  `.execute(db);
  await sql`ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_service_user_fk`.execute(db);
  await sql`
    ALTER TABLE api_keys DROP COLUMN IF EXISTS service_user_is_service_account
  `.execute(db);
  await sql`ALTER TABLE api_keys DROP COLUMN IF EXISTS service_user_id`.execute(db);

  await sql`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_is_service_account_key
  `.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS is_service_account`.execute(db);

  /*
   * Postgres has no `DROP VALUE`, so the enum is rebuilt: rename the widened type aside, recreate
   * the original, move the column across, drop the old one. Unlike 0023/0038, which left their
   * extra labels behind, this one is worth doing — a leftover 'stock:take' would let a row claim
   * a scope that no code on this side of the rollback understands. The guard above has already
   * proved no row holds one, so the cast cannot fail.
   */
  await sql`ALTER TYPE api_key_scope RENAME TO api_key_scope_0039`.execute(db);
  await sql`CREATE TYPE api_key_scope AS ENUM ('inventory:read')`.execute(db);
  await sql`
    ALTER TABLE api_keys
    ALTER COLUMN scopes TYPE api_key_scope[] USING scopes::text[]::api_key_scope[]
  `.execute(db);
  await sql`DROP TYPE api_key_scope_0039`.execute(db);
}
