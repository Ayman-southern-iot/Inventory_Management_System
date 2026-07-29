import { sql, type Kysely } from 'kysely';

/**
 * Records when an approver was last nudged about an overdue approval (task 3.9).
 *
 * Without it the fifteen-minute job would re-send on every tick, which trains people to ignore
 * the reminder — the opposite of what it is for. Nullable and additive: an existing pending
 * approval simply has never been reminded, which is true.
 *
 * A separate migration rather than an edit to 0008: that one is already applied here and to
 * the test database, and editing an applied migration is how two environments quietly diverge.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('requisition_approvals')
    .addColumn('last_reminded_at', 'timestamptz')
    .execute();

  // The job's predicate is (action, last_reminded_at); this keeps it off a sequential scan.
  await sql`
    CREATE INDEX requisition_approvals_reminder_idx
    ON requisition_approvals (last_reminded_at)
    WHERE action = 'PENDING'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS requisition_approvals_reminder_idx`.execute(db);
  await db.schema.alterTable('requisition_approvals').dropColumn('last_reminded_at').execute();
}
