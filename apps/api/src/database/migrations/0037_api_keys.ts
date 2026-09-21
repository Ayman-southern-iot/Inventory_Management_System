import { sql, type Kysely } from 'kysely';

/**
 * API keys: a credential issued to a *system* rather than a person.
 *
 * Ayman, 2026-09-21: an external system needs to read the product catalogue. Until now the only
 * way in was to log in as somebody and hold a 15-minute access token, which ties an integration
 * to an employee's account and dies four times an hour. A key is issued from the admin panel,
 * scoped, and revocable on its own without touching anyone's login. Phase 10, decisions K1–K9.
 *
 * **Stored hashed, never recoverable.** `token_hash` is `sha256(raw)`, the same treatment
 * `refresh_tokens` gives its tokens, so a database dump hands out nothing that works. The raw
 * key is shown once at creation and then gone — losing it means issuing a new one. `key_prefix`
 * exists only so the admin list can tell two keys apart; it is a fragment, not a secret.
 *
 * **Deliberately mutable, unlike the ledger.** No append-only trigger here: enabling and
 * disabling a key is the whole point of the table. The permanent record of who issued or
 * revoked what lives in `audit_log` (K8), which is where an auditor would look anyway.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // One member today. A second scope is a migration, which is the correct cost for widening
  // what a credential can reach — see rules/10-no-hardcoding.md on domain constants.
  await sql`CREATE TYPE api_key_scope AS ENUM ('inventory:read')`.execute(db);

  await db.schema
    .createTable('api_keys')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('key_prefix', 'text', (col) => col.notNull().unique())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('scopes', sql`api_key_scope[]`, (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    // Null means never expires. Ayman: "sometimes we need it for forever" (K6).
    .addColumn('expires_at', 'timestamptz')
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('created_by', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revoked_by', 'uuid', (col) => col.references('users.id'))
    .execute();

  // A key that unlocks nothing is a bug in the writer, not a state a caller can reach.
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_scopes_not_empty
    CHECK (array_length(scopes, 1) >= 1)
  `.execute(db);

  // Revocation is final. Without this, "revoke then re-enable" would resurrect a credential the
  // admin believes they destroyed, and the audit trail would say it was only ever disabled.
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_revoked_is_inactive
    CHECK (revoked_at IS NULL OR is_active = false)
  `.execute(db);

  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_revoked_by_with_revoked_at
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
  `.execute(db);

  // The hash is looked up on every request that presents a key, so it carries the only index
  // that matters for the hot path. `unique()` above already provides it; this is the list view.
  await sql`CREATE INDEX api_keys_created_idx ON api_keys (created_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('api_keys').ifExists().execute();
  // After the table, not before — the column depends on the type.
  await sql`DROP TYPE IF EXISTS api_key_scope`.execute(db);
}
