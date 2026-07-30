import { sql, type Kysely } from 'kysely';

/**
 * Phase 05 task 5.4 — the lifecycle past `BOM_GENERATED`.
 *
 * The requisition already walks DRAFT → … → BOM_GENERATED. This adds the money half:
 *
 *   BOM_GENERATED → SENT_TO_ACCOUNTS → FUNDS_PARTIAL ⇄ FUNDS_RECEIVED → PURCHASED
 *                → PURCHASE_VERIFIED → STOCKED / borrowed out → CLOSED
 *
 * Every status except `PURCHASE_VERIFIED` already exists in the `requisition_status` enum, and
 * `requisition_events.event_type` is `text`, so the new event names need no schema change at all.
 *
 * Two modelling decisions worth keeping:
 *
 *  - **Funding is derived, never stored as a running total.** `FUNDS_PARTIAL` versus
 *    `FUNDS_RECEIVED` is decided by `SUM(fund_receipts.amount)` against `approved_amount` at read
 *    time. A cached total is a number that can drift from the rows that justify it, and money
 *    that disagrees with its own audit trail is worse than money that is slow to add up.
 *
 *  - **Receipts and returns are separate tables** (the return side lands in 5.5). Modelling a
 *    return as a negative receipt would make every future `SUM` ambiguous — "received" and "came
 *    back" are different questions and the expense report has to answer both.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Postgres cannot add an enum value inside a transaction on older servers, and the addition is
  // irreversible either way — see `down`.
  await sql`ALTER TYPE requisition_status ADD VALUE IF NOT EXISTS 'PURCHASE_VERIFIED'`.execute(db);

  /* ------------------------------------------------------------ fund receipts */

  await db.schema
    .createTable('fund_receipts')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Per requisition, never per BOM (requirements §6): a BOM may batch several requisitions,
    // and Accounts releases money against the request that was approved.
    .addColumn('requisition_id', 'uuid', (col) =>
      col.notNull().references('requisitions.id').onDelete('cascade'),
    )
    .addColumn('amount', 'numeric(14, 2)', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) => col.notNull())
    /** Accounts' own reference — cheque number, transfer id. Free-form by design. */
    .addColumn('reference', 'text')
    .addColumn('note', 'text')
    .addColumn('recorded_by', 'uuid', (col) => col.notNull().references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // A zero or negative receipt is not a receipt. Returns are their own table (5.5).
    .addCheckConstraint('fund_receipts_amount_positive', sql`amount > 0`)
    .execute();

  await sql`
    CREATE INDEX fund_receipts_requisition_idx ON fund_receipts (requisition_id, received_at)
  `.execute(db);
  // Serves the expense report's date-range scan (5.8).
  await sql`CREATE INDEX fund_receipts_received_at_idx ON fund_receipts (received_at)`.execute(db);

  /* ---------------------------------------------------------------- purchases */

  await db.schema
    .createTable('purchases')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('requisition_id', 'uuid', (col) =>
      col.notNull().references('requisitions.id').onDelete('cascade'),
    )
    .addColumn('vendor', 'text', (col) => col.notNull())
    .addColumn('invoice_no', 'text')
    .addColumn('purchased_at', 'timestamptz', (col) => col.notNull())
    .addColumn('total_amount', 'numeric(14, 2)', (col) => col.notNull())
    .addColumn('note', 'text')
    .addColumn('recorded_by', 'uuid', (col) => col.notNull().references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('purchases_total_non_negative', sql`total_amount >= 0`)
    .addCheckConstraint('purchases_vendor_not_blank', sql`length(btrim(vendor)) > 0`)
    .execute();

  await sql`
    CREATE INDEX purchases_requisition_idx ON purchases (requisition_id, purchased_at)
  `.execute(db);
  await sql`CREATE INDEX purchases_purchased_at_idx ON purchases (purchased_at)`.execute(db);

  /* ----------------------------------------------------------- purchase lines */

  await db.schema
    .createTable('purchase_lines')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('purchase_id', 'uuid', (col) =>
      col.notNull().references('purchases.id').onDelete('cascade'),
    )
    /**
     * The requisition item this line satisfies. RESTRICT rather than CASCADE: deleting a
     * requisition item that has already been bought must fail loudly, not quietly erase the
     * record of a purchase.
     */
    .addColumn('requisition_item_id', 'uuid', (col) =>
      col.notNull().references('requisition_items.id').onDelete('restrict'),
    )
    /** Nullable: a purchase can exist against a requisition whose BOM was later voided. */
    .addColumn('bom_line_id', 'uuid', (col) => col.references('bom_lines.id').onDelete('set null'))
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('unit_cost', 'numeric(14, 2)', (col) => col.notNull())
    /** Set when the IM knowingly bought more than the BOM line called for; the note says why. */
    .addColumn('over_bom_quantity', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('over_bom_note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('purchase_lines_quantity_positive', sql`quantity > 0`)
    .addCheckConstraint('purchase_lines_unit_cost_non_negative', sql`unit_cost >= 0`)
    // Exceeding the BOM quantity is allowed only with a stated reason. A constraint rather than a
    // service check, because this is the rule an auditor will ask about.
    .addCheckConstraint(
      'purchase_lines_over_bom_needs_note',
      sql`over_bom_quantity = false OR length(btrim(coalesce(over_bom_note, ''))) > 0`,
    )
    .execute();

  await sql`CREATE INDEX purchase_lines_purchase_idx ON purchase_lines (purchase_id)`.execute(db);
  await sql`
    CREATE INDEX purchase_lines_requisition_item_idx ON purchase_lines (requisition_item_id)
  `.execute(db);

  // `updated_at` maintenance matches every other mutable table in this schema.
  await sql`
    CREATE TRIGGER purchases_set_updated_at
    BEFORE UPDATE ON purchases
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS purchases_set_updated_at ON purchases`.execute(db);
  await db.schema.dropTable('purchase_lines').ifExists().execute();
  await db.schema.dropTable('purchases').ifExists().execute();
  await db.schema.dropTable('fund_receipts').ifExists().execute();

  // `PURCHASE_VERIFIED` is deliberately NOT removed. Postgres cannot drop an enum value, and
  // faking it (rename the type, recreate without the value, repoint every column) would rewrite
  // requisitions.status on a table this migration does not own. Rolling back leaves an unused
  // label, which is inert — `up` re-adds it with IF NOT EXISTS.
}
