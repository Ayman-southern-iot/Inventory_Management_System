import { sql, type Kysely } from 'kysely';

/**
 * Custody: who is holding an issued borrow, as distinct from who asked for it.
 *
 * Ayman, 2026-09-20: an item is issued to one person and ends up with another — the loan moves
 * desk without anything moving shelf. Until now the borrow row had one person on it,
 * `requester_id`, and it was answering two different questions: "who asked for this" and "who
 * has it". The moment those two diverge, one of the answers is a lie, and it is always the
 * second one that matters — the overdue reminder chases the wrong person, and the person
 * actually holding the item has nothing against their name.
 *
 * So `requester_id` is left exactly as written. It records who asked, it is history, and
 * rewriting it would falsify the request. `current_holder_id` is the new answer to "who has
 * it", seeded from the requester because on every row that exists today they are the same
 * person.
 *
 * ---------------------------------------------------------------------------------------------
 * **This migration touches no stock, and the endpoint it serves writes no ledger row** (plan
 * decision D5). The units left the shelf when `issue` ran. Who is holding them afterwards is
 * not a placement fact, and `stock_ledger` must not gain a compensating pair for a correction
 * that moved nothing physical — a RECEIPT/ISSUE pair invented here would make the ledger claim
 * the item came back to a compartment and went out again, which never happened.
 *
 * ---------------------------------------------------------------------------------------------
 * `borrow_holder_changes` is the proof. A custody record whose only evidence is the current
 * value of a column is not proof of anything: it says who has it now and cannot say who had it
 * before, who moved it, or why. The trail is append-only by trigger for the same reason
 * `stock_ledger` and `audit_log` are — the application connects as the database owner in both
 * the compose stack and local development, and an owner bypasses its own grants, so a REVOKE
 * alone does not bind it.
 *
 * ---------------------------------------------------------------------------------------------
 * `rules/40-database.md` asks for nullable → backfill → NOT NULL across two releases. This does
 * all three here, deliberately: `requester_id` is already NOT NULL so the backfill cannot leave
 * a gap, the table is small, and deployment is a single-VM stop/start, so there is no window in
 * which an old instance inserts a row that does not know about the column. The alternative
 * leaves a nullable custody column in production between two releases, and "holder is unknown"
 * is not a state this system should ever be able to represent.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ------------------------------------------------- who is holding it now
  // Nullable → backfill → NOT NULL, in that order, so the existing rows survive. ON DELETE
  // RESTRICT rather than SET NULL: a borrow with no holder is not a state worth representing,
  // and a user who is holding equipment is deactivated, never deleted.
  await sql`
    ALTER TABLE borrow_requests
      ADD COLUMN current_holder_id uuid REFERENCES users (id) ON DELETE RESTRICT
  `.execute(db);

  await sql`UPDATE borrow_requests SET current_holder_id = requester_id`.execute(db);

  await sql`
    ALTER TABLE borrow_requests ALTER COLUMN current_holder_id SET NOT NULL
  `.execute(db);

  // Mirrors `borrow_requests_requester_idx`. "My borrowings" and the dashboard's borrowing
  // card read this column now, and both are per-user lookups ordered by recency.
  await sql`
    CREATE INDEX borrow_requests_holder_idx
    ON borrow_requests (current_holder_id, created_at DESC)
  `.execute(db);

  // --------------------------------------------------------- the custody trail
  await db.schema
    .createTable('borrow_holder_changes')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    /**
     * RESTRICT, not CASCADE. The trail is append-only, so a cascade would fire a DELETE the
     * trigger below refuses — the borrow would simply become undeletable with a confusing
     * error instead of a clear one. Which is the right outcome anyway: a borrow that has been
     * reassigned has custody history, and history is not deleted. `requisition_events` carries
     * the same reasoning (migration 0008).
     */
    .addColumn('borrow_request_id', 'uuid', (col) =>
      col.notNull().references('borrow_requests.id').onDelete('restrict'),
    )
    .addColumn('from_user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('to_user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    /** The IM who made the correction — deliberately separate from both parties. */
    .addColumn('changed_by', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    /**
     * Mandatory, and the CHECK is what makes it mandatory rather than the DTO. A custody
     * reassignment with no reason is an unexplained change of who is liable for equipment;
     * the whole point of the trail is that somebody can read it back in six months.
     */
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('changed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // A reassignment to the person who already has it is a no-op dressed as evidence.
    .addCheckConstraint('borrow_holder_changes_parties_differ', sql`from_user_id <> to_user_id`)
    .addCheckConstraint('borrow_holder_changes_reason_not_blank', sql`length(btrim(reason)) > 0`)
    .execute();

  // The trail for one borrow, in order. That is the only way this table is ever read.
  await sql`
    CREATE INDEX borrow_holder_changes_request_idx
    ON borrow_holder_changes (borrow_request_id, changed_at)
  `.execute(db);

  // ---------------------------------------------------- append-only enforcement
  // The `stock_ledger` / `audit_log` pattern verbatim. A correction is a new row.
  await sql`
    CREATE OR REPLACE FUNCTION borrow_holder_changes_is_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        'borrow_holder_changes is append-only: % is not permitted. Reassign again instead.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER borrow_holder_changes_no_update
    BEFORE UPDATE OR DELETE OR TRUNCATE ON borrow_holder_changes
    FOR EACH STATEMENT EXECUTE FUNCTION borrow_holder_changes_is_append_only()
  `.execute(db);

  // Defence in depth for the day the application stops being the owner.
  await sql`REVOKE UPDATE, DELETE, TRUNCATE ON borrow_holder_changes FROM PUBLIC`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TRIGGER IF EXISTS borrow_holder_changes_no_update ON borrow_holder_changes
  `.execute(db);
  await sql`DROP FUNCTION IF EXISTS borrow_holder_changes_is_append_only()`.execute(db);

  /**
   * Dropping the table loses every recorded reassignment, and dropping the column returns the
   * system to answering "who has it" with "who asked for it". Stated rather than discovered:
   * that is inherent to reversing the feature, not an oversight.
   */
  await db.schema.dropTable('borrow_holder_changes').ifExists().execute();

  await sql`DROP INDEX IF EXISTS borrow_requests_holder_idx`.execute(db);
  await sql`ALTER TABLE borrow_requests DROP COLUMN IF EXISTS current_holder_id`.execute(db);
}
