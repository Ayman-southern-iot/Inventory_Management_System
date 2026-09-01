import { sql, type Kysely } from 'kysely';

/**
 * A requisition may require zero approvers.
 *
 * Forced by Ayman's ruling of 2026-09-01: a requester's own approval stage is not created, so an
 * approver raising a requisition drops their own slot, and the person who is both the Inventory
 * Manager and the designated sub-threshold approver drops every stage there is. `required_approver
 * _count` is the number of *other people* who must sign, and for that requisition it is none.
 *
 * Migration 0008 wrote `BETWEEN 1 AND 2`, which was right while the chain always resolved somebody
 * — under the old model, a requisition nobody could approve was refused at submit rather than
 * stored. It is now reachable, and a CHECK is exactly the wrong place to find that out: the
 * failure surfaces as a 500 from the database rather than as a decision the code made.
 *
 * ---------------------------------------------------------------------------------------------
 * The upper bound stays at 2 on purpose. It is the one thing this constraint still usefully
 * catches — `APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD` is an admin-editable setting, and a typo of 20
 * would otherwise seat twenty approvals nobody can clear. Zero is a legitimate outcome of the
 * skip rule; twenty is still a mistake.
 *
 * Additive in effect: every existing row satisfies the wider range, so nothing is rewritten and
 * `down` is safe unless a zero-approver requisition has been created in the meantime — which is
 * inherent to narrowing a range again, and is stated here rather than discovered.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE requisitions
      DROP CONSTRAINT IF EXISTS requisitions_approver_count_range
  `.execute(db);

  await sql`
    ALTER TABLE requisitions
      ADD CONSTRAINT requisitions_approver_count_range
      CHECK (required_approver_count IS NULL OR required_approver_count BETWEEN 0 AND 2)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE requisitions
      DROP CONSTRAINT IF EXISTS requisitions_approver_count_range
  `.execute(db);

  await sql`
    ALTER TABLE requisitions
      ADD CONSTRAINT requisitions_approver_count_range
      CHECK (required_approver_count IS NULL OR required_approver_count BETWEEN 1 AND 2)
  `.execute(db);
}
