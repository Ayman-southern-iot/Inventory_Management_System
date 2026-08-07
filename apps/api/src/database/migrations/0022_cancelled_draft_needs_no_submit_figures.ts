import { sql, type Kysely } from 'kysely';

/**
 * Lets a DRAFT be cancelled.
 *
 * `requisitions_submitted_is_frozen` read:
 *
 *   status = 'DRAFT' OR (submitted_at, requested_amount, required_approver_count,
 *                        threshold_at_submit are all NOT NULL)
 *
 * which made cancelling a draft impossible: `cancel` explicitly permits DRAFT, but the moment
 * the status left 'DRAFT' the row needed submit figures a draft has never had. The user got a
 * 500 and the draft could not be got rid of at all.
 *
 * Replaced by two constraints that together say the same thing about every *live* status while
 * allowing the one case the original forbade by accident:
 *
 *   1. the four submit figures travel together — `submitted_at` implies the other three;
 *   2. any status other than DRAFT or CANCELLED must have been submitted.
 *
 * A requisition cancelled *after* submit still carries its figures, because nothing clears them;
 * this only stops the database demanding figures from a row that never reached submit.
 *
 * NOTE: each statement is guarded with `IF EXISTS` / `IF NOT EXISTS` so this migration is safe
 * to apply against a database that was brought forward by hand. The original
 * `requisitions_submitted_is_frozen` constraint has already been replaced at the SQL level;
 * the DROP here is a defensive no-op when the constraint no longer exists.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_submitted_is_frozen`.execute(db);

  await sql`
    ALTER TABLE requisitions
    ADD CONSTRAINT requisitions_submit_figures_together
    CHECK (
      submitted_at IS NULL
      OR (
        requested_amount IS NOT NULL
        AND required_approver_count IS NOT NULL
        AND threshold_at_submit IS NOT NULL
      )
    )
  `.execute(db);

  await sql`
    ALTER TABLE requisitions
    ADD CONSTRAINT requisitions_live_status_was_submitted
    CHECK (status IN ('DRAFT', 'CANCELLED') OR submitted_at IS NOT NULL)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_live_status_was_submitted`.execute(
    db,
  );
  await sql`ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_submit_figures_together`.execute(
    db,
  );

  // Restoring the original would fail against any draft cancelled while it was relaxed, so
  // those rows go back to DRAFT first. They carry no submit figures either way.
  await sql`UPDATE requisitions SET status = 'DRAFT' WHERE status = 'CANCELLED' AND submitted_at IS NULL`.execute(
    db,
  );

  await sql`
    ALTER TABLE requisitions
    ADD CONSTRAINT requisitions_submitted_is_frozen
    CHECK (
      status = 'DRAFT'
      OR (
        submitted_at IS NOT NULL
        AND requested_amount IS NOT NULL
        AND required_approver_count IS NOT NULL
        AND threshold_at_submit IS NOT NULL
      )
    )
  `.execute(db);
}