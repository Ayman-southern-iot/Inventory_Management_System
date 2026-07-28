import { sql, type Kysely } from 'kysely';

/**
 * Rotating refresh tokens and the login-attempt log the rate limiter reads.
 *
 * Tokens are stored hashed. A dump of this table must not hand an attacker a working session,
 * which is the same reason `users.password_hash` is a hash.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('refresh_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    // One family per login. Presenting an already-rotated token means the token leaked,
    // so the whole family is revoked rather than just that one row.
    .addColumn('family_id', 'uuid', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('replaced_by_id', 'uuid', (col) =>
      col.references('refresh_tokens.id').onDelete('set null'),
    )
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id)`.execute(db);
  await sql`CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id)`.execute(db);
  // The nightly cleanup scans by expiry; without this it is a sequential scan forever.
  await sql`CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at)`.execute(db);

  await db.schema
    .createTable('login_attempts')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('ip', 'text', (col) => col.notNull())
    .addColumn('succeeded', 'boolean', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // The rate limiter counts recent failures for one email+ip pair.
  await sql`
    CREATE INDEX login_attempts_email_created_idx
    ON login_attempts (email, created_at DESC) WHERE NOT succeeded
  `.execute(db);
  await sql`
    CREATE INDEX login_attempts_ip_created_idx
    ON login_attempts (ip, created_at DESC) WHERE NOT succeeded
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('login_attempts').ifExists().execute();
  await db.schema.dropTable('refresh_tokens').ifExists().execute();
}
