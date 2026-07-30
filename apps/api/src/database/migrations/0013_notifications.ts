import { sql, type Kysely } from 'kysely';

/**
 * Phase 06 — per-user in-app notifications. Closes G-06, which recorded that task 3.9's
 * reminders and the approve/reject notices to the requester existed only as server log lines.
 *
 * Design notes worth keeping:
 *
 *  - **One row per recipient**, not one row per event with a join table. Twelve users means the
 *    fan-out is tiny, and a per-recipient row makes "unread for me" a single indexed count
 *    instead of a join plus an anti-join against a read-receipts table.
 *
 *  - **The rendered `title` is stored, not derived at read time.** A notification is a record of
 *    what someone was told, so it must keep saying that after the requisition is renamed, the
 *    approver is deactivated, or the copy changes. This is the same freeze-for-history principle
 *    the BOM approval snapshot uses.
 *
 *  - **Not append-only**, unlike `audit_log` and `stock_ledger`. `read_at` is meant to be
 *    updated, and a user clearing their own list is a legitimate delete. The audit log is the
 *    permanent record; this table is a work queue.
 *
 *  - `entity_id` is `text`, not `uuid`: some references are natural keys (a setting key), and a
 *    notification must never fail to be written because of a type mismatch on a display field.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE notification_severity AS ENUM ('info', 'success', 'warning', 'action_required')
  `.execute(db);

  await db.schema
    .createTable('notifications')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // CASCADE: a notification is meaningless without its recipient, and unlike an audit row it
    // carries no accountability value that must outlive the user.
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('severity', sql`notification_severity`, (col) => col.notNull().defaultTo('info'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('body', 'text')
    /** App-relative route the client navigates to. Server-built; never a full URL. */
    .addColumn('link', 'text')
    .addColumn('entity_type', 'text')
    .addColumn('entity_id', 'text')
    .addColumn('entity_ref', 'text')
    /**
     * Snapshot of who caused it, for "Rana approved your requisition". SET NULL rather than
     * CASCADE — deleting the actor must not delete the recipient's notification.
     */
    .addColumn('actor_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('actor_name', 'text')
    .addColumn('read_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('notifications_title_not_blank', sql`length(btrim(title)) > 0`)
    .execute();

  // The list query: "my notifications, newest first".
  await sql`
    CREATE INDEX notifications_user_created_idx
    ON notifications (user_id, created_at DESC, id DESC)
  `.execute(db);

  // The badge query, polled by every signed-in client. Partial on unread only, so the index
  // stays roughly the size of one user's outstanding work rather than of all history.
  await sql`
    CREATE INDEX notifications_unread_idx
    ON notifications (user_id) WHERE read_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('notifications').ifExists().execute();
  await sql`DROP TYPE IF EXISTS notification_severity`.execute(db);
}
