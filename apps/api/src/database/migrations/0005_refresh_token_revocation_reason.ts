import { sql, type Kysely } from 'kysely';

/**
 * Records *why* a refresh token was revoked.
 *
 * Without this the reason had to be inferred from `replaced_by_id`, which cannot tell an
 * administrator ending a session apart from a token killed as part of a theft response — both
 * leave it null. That mattered because the two cases must tell the user different things: one
 * is routine, the other says "you may have been compromised".
 *
 * Nullable and backfill-free: existing rows are already revoked and nobody is going to refresh
 * them, so guessing a reason for history would be inventing data.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE refresh_revocation_reason AS ENUM (
      'ROTATED', 'REUSE_DETECTED', 'ADMIN_REVOKED', 'LOGOUT', 'UNKNOWN'
    )
  `.execute(db);

  await db.schema
    .alterTable('refresh_tokens')
    .addColumn('revoked_reason', sql`refresh_revocation_reason`)
    .execute();

  // Backfill before constraining (rules/40-database.md: add nullable → backfill → enforce).
  //
  // `replaced_by_id` is only ever set by a rotation, so ROTATED is a fact for those rows.
  // For the rest the reason genuinely was not recorded, and UNKNOWN says so rather than
  // inventing a plausible-looking value that a future reader would trust. UNKNOWN is treated
  // as untrustworthy by AuthService, which is the safe direction to be wrong in.
  await sql`
    UPDATE refresh_tokens
    SET revoked_reason = CASE
      WHEN replaced_by_id IS NOT NULL THEN 'ROTATED'::refresh_revocation_reason
      ELSE 'UNKNOWN'::refresh_revocation_reason
    END
    WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL
  `.execute(db);

  // A reason without a revocation, or a revocation without a reason, is a bug in the writer.
  await sql`
    ALTER TABLE refresh_tokens
    ADD CONSTRAINT refresh_tokens_revocation_consistent
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_revocation_consistent
  `.execute(db);
  await db.schema.alterTable('refresh_tokens').dropColumn('revoked_reason').execute();
  await sql`DROP TYPE IF EXISTS refresh_revocation_reason`.execute(db);
}
