import { sql, type Kysely } from 'kysely';

/**
 * Return condition and quarantine.
 *
 * Before this change, every returned unit went straight back to the available pool regardless of
 * its state. A cable with a chewed end sat on the same shelf as a fresh one, and a product page
 * said only "On hand 4, Reserved 0, Available 4" — the kind of figure that gets loaned out and
 * comes back broken.
 *
 * This migration adds a structured `condition` column to `borrow_returns` so the IM records what
 * shape the item is in, and a `quarantined_qty` column to `stock_placements` so damaged stock is
 * physically present on the shelf but excluded from `available`. Two distinct quantities of the
 * same product can now sit at the same location: four sound units and one quarantined unit,
 * counted correctly and lent correctly.
 *
 * Quarantine is held inside `stock_placements` rather than a separate `quarantine` table because
 * the units are still physically present and the nightly reconciliation against the ledger stays
 * a single comparison. The CHECK constraint refuses `reserved + quarantined > quantity` so an
 * over-quarantine is caught at write time rather than at borrow time.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE return_condition AS ENUM (
      'GOOD', 'PARTIALLY_DAMAGED_USABLE', 'DAMAGED', 'NOT_WORKING'
    )
  `.execute(db);

  // Existing rows predate the dropdown and would otherwise block the NOT NULL backfill. Treat
  // them as "good" — the only honest default given nothing was recorded — and let the IM adjust
  // through future returns rather than guess the historical state.
  await sql`
    ALTER TABLE borrow_returns
      ADD COLUMN condition return_condition NOT NULL DEFAULT 'GOOD'
  `.execute(db);
  await sql`ALTER TABLE borrow_returns ALTER COLUMN condition DROP DEFAULT`.execute(db);

  await sql`ALTER TABLE borrow_returns DROP COLUMN condition_note`.execute(db);

  // Quarantine sits on the placement so `available = quantity - reserved_qty - quarantined_qty`
  // remains a single-row calculation. The CHECK is the structural guarantee: nothing the
  // service does can over-quarantine, including a partial return that hits a fully-quarantined
  // placement.
  await sql`
    ALTER TABLE stock_placements
      ADD COLUMN quarantined_qty integer NOT NULL DEFAULT 0
  `.execute(db);
  await sql`
    ALTER TABLE stock_placements
      ADD CONSTRAINT stock_placements_quarantined_within_qty
      CHECK (quarantined_qty >= 0 AND quarantined_qty + reserved_qty <= quantity)
  `.execute(db);

  // The nightly reconciliation compares placement quantity against the ledger. Quarantine is a
  // subset of `quantity`, not a separate row, so no reconciliation change is needed.
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE stock_placements
      DROP CONSTRAINT IF EXISTS stock_placements_quarantined_within_qty
  `.execute(db);
  await sql`ALTER TABLE stock_placements DROP COLUMN IF EXISTS quarantined_qty`.execute(db);
  await sql`ALTER TABLE borrow_returns ADD COLUMN condition_note text`.execute(db);
  await sql`ALTER TABLE borrow_returns DROP COLUMN condition`.execute(db);
  await sql`DROP TYPE IF EXISTS return_condition`.execute(db);
}
