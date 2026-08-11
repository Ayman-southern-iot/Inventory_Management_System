import { sql, type Kysely } from 'kysely';

/**
 * funding_snapshots — point-in-time capture of money figures at each lifecycle stage.
 *
 * The Requisition Detail page's "Money and purchasing" panel needs to show what the
 * figures looked like at every stage a requisition passed through (BOM / Accounts /
 * Funded / Purchased / Verified), not only the *current* aggregate. Without this table,
 * the only way to reconstruct past figures is to replay `fund_receipts`, `purchases`,
 * and `fund_returns` against the events log — and even that approximation is lossy
 * before the first receipt or purchase is recorded.
 *
 * The hook is the single transition write-site (setStatus + appendEvent) in
 * `funds.service.ts` and `requisitions.service.ts`. Every forward-progress stage
 * transition — submit, IM approve, final approve, BOM generate, send to accounts,
 * funds received, purchased, purchase verified, stocked — appends one row capturing
 * the figures as they existed *at the moment of transition*. Backwards transitions
 * (withdraw, unverify, send-back-for-revision, cancel, reject) do NOT snapshot; they
 * would muddy the "what was true at stage X" semantics.
 *
 * No backfill: older requisitions simply have no stage history before this migration.
 * The frontend pills render disabled for stages without a snapshot.
 *
 * The table is append-only. No trigger is installed because nothing in the current
 * flow would try to UPDATE or DELETE a row, and the absence keeps the migration's
 * `down` trivial. If a future flow needs to delete a snapshot, add a trigger then.
 *
 * Index note: `(requisition_id, status)` is the natural lookup (the detail view
 * loads all snapshots for one requisition, ordered by their natural progression).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('funding_snapshots')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('requisition_id', 'uuid', (col) =>
      col.notNull().references('requisitions.id').onDelete('cascade'),
    )
    // The status the requisition is *entering* at the moment this row is written.
    // Matches `requisitions.status` values (DRAFT is omitted on purpose — the first
    // snapshot is IM_REVIEW, the first real transition after submit).
    .addColumn('status', 'text', (col) => col.notNull())
    // Frozen copies of the requisition's money columns at transition time. None of
    // these are aggregates; the derived figures (`funded`, `spent`, `returned`,
    // `unspent`, `outstanding`) live alongside so a snapshot is self-contained.
    .addColumn('requested_amount', 'numeric(14, 2)')
    .addColumn('approved_amount', 'numeric(14, 2)')
    .addColumn('transportation', 'numeric(14, 2)', (col) => col.notNull().defaultTo('0'))
    .addColumn('funded', 'numeric(14, 2)', (col) => col.notNull().defaultTo('0'))
    .addColumn('spent', 'numeric(14, 2)', (col) => col.notNull().defaultTo('0'))
    .addColumn('returned_to_accounts', 'numeric(14, 2)', (col) => col.notNull().defaultTo('0'))
    .addColumn('unspent', 'numeric(14, 2)', (col) => col.notNull().defaultTo('0'))
    // When the snapshot was taken. Defaulted so the application can omit the column.
    .addColumn('snapshotted_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE INDEX funding_snapshots_requisition_idx
      ON funding_snapshots (requisition_id, status)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('funding_snapshots').ifExists().execute();
}