import { sql, type Kysely } from 'kysely';

/**
 * Phase 05 task 5.6 — receiving a verified purchase into stock.
 *
 * `received_quantity` tracks how much of each purchase line has actually reached a shelf. It
 * exists because receiving is legitimately partial: a vendor part-ships, or the IM puts half a
 * delivery in one compartment and half in another, and the tracker has to say so rather than
 * flipping to STOCKED on the first line.
 *
 * It is a counter rather than a boolean for the same reason, and it is capped at the purchased
 * quantity by a CHECK — receiving more than was bought is not a partial state, it is a mistake,
 * and the database is the right place to refuse it (rules/40-database.md).
 *
 * `product_id` on the requisition item is filled in here too: a free-text line ("2m USB-C cable")
 * becomes a real catalogue product the first time it is received, and the link back is what makes
 * the item searchable and borrowable afterwards.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('purchase_lines')
    .addColumn('received_quantity', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await sql`
    ALTER TABLE purchase_lines
    ADD CONSTRAINT purchase_lines_received_within_quantity
    CHECK (received_quantity >= 0 AND received_quantity <= quantity)
  `.execute(db);

  // The "what is still outstanding on this requisition?" query behind the partial-stocked state.
  await sql`
    CREATE INDEX purchase_lines_outstanding_idx
    ON purchase_lines (purchase_id) WHERE received_quantity < quantity
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS purchase_lines_outstanding_idx`.execute(db);
  await sql`
    ALTER TABLE purchase_lines DROP CONSTRAINT IF EXISTS purchase_lines_received_within_quantity
  `.execute(db);
  await db.schema.alterTable('purchase_lines').dropColumn('received_quantity').execute();
}
