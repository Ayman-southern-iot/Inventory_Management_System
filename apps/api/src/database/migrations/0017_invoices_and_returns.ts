import { sql, type Kysely } from 'kysely';

/**
 * Phase 05 task 5.5 — the invoice, the verification step, and money that comes back.
 *
 * Two additions:
 *
 *  - **The invoice hangs off `purchases`**, not off the requisition. One requisition can be
 *    bought across several vendors on several days, and each of those has its own invoice. A
 *    single `requisitions.invoice_file_id` would have forced the IM to pick one to keep.
 *
 *  - **`fund_returns` is its own table, not a negative `fund_receipts` row.** "Accounts released
 *    50,000" and "12,000 came back" are different questions, and the expense report has to answer
 *    both separately. Folding them into one signed column makes every future `SUM` a judgement
 *    call about which rows to include, and that judgement gets made differently in each new query.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  /* --------------------------------------------------------------- invoices */

  await db.schema
    .alterTable('purchases')
    // SET NULL rather than CASCADE: losing the file must never delete the purchase record.
    .addColumn('invoice_file_id', 'uuid', (col) =>
      col.references('stored_files.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .alterTable('purchases')
    .addColumn('invoice_uploaded_by', 'uuid', (col) =>
      col.references('users.id').onDelete('restrict'),
    )
    .execute();

  await db.schema.alterTable('purchases').addColumn('invoice_uploaded_at', 'timestamptz').execute();

  /* ---------------------------------------------------------- fund returns */

  await db.schema
    .createTable('fund_returns')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('requisition_id', 'uuid', (col) =>
      col.notNull().references('requisitions.id').onDelete('cascade'),
    )
    .addColumn('amount', 'numeric(14, 2)', (col) => col.notNull())
    /**
     * Required, and enforced here rather than only in the service. "Money came back and nobody
     * said why" is precisely the gap this feature exists to close, so the database refuses it.
     */
    .addColumn('note', 'text', (col) => col.notNull())
    .addColumn('returned_at', 'timestamptz', (col) => col.notNull())
    .addColumn('recorded_by', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('fund_returns_amount_positive', sql`amount > 0`)
    .addCheckConstraint('fund_returns_note_not_blank', sql`length(btrim(note)) > 0`)
    .execute();

  await sql`
    CREATE INDEX fund_returns_requisition_idx ON fund_returns (requisition_id, returned_at)
  `.execute(db);
  // Serves the expense report's date-range scan (5.8), matching fund_receipts.
  await sql`CREATE INDEX fund_returns_returned_at_idx ON fund_returns (returned_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('fund_returns').ifExists().execute();
  await db.schema.alterTable('purchases').dropColumn('invoice_uploaded_at').execute();
  await db.schema.alterTable('purchases').dropColumn('invoice_uploaded_by').execute();
  await db.schema.alterTable('purchases').dropColumn('invoice_file_id').execute();
}
