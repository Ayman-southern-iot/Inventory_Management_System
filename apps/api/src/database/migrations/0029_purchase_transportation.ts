import { sql, type Kysely } from 'kysely';

/**
 * The carriage actually paid, recorded with the purchase that paid it.
 *
 * Ayman's ruling, 2026-08-31: "add transportation field, so that maybe sometimes we need less or
 * more so that it can be adjustable."
 *
 * ---------------------------------------------------------------------------------------------
 * Why the feature cannot be built without a schema change.
 *
 * `requisitions.transportation_cost` is the figure the *requester* declared, frozen at submit and
 * baked into `requested_amount` and `approved_amount`. The BOM ceiling compares against it, and
 * the approvers signed it. Overwriting it when the van turns out to cost more would retroactively
 * change what was approved and silently move the BOM's budget — so the actual figure needs
 * somewhere of its own to live.
 *
 * Per **purchase**, not per requisition, for two reasons. A split-vendor requisition genuinely has
 * more than one delivery, each with its own carriage; and a single per-requisition column would
 * have no answer to "which purchase wrote this" when a second one records a different figure.
 * Summing over live purchases has neither problem.
 *
 * ---------------------------------------------------------------------------------------------
 * What this quietly simplifies.
 *
 * OQ-32 established that carriage is spent money only while a live purchase stands, and it was
 * implemented as an `EXISTS (a live purchase)` gate wrapped around the requisition's planned
 * figure. Summing a column that only exists on purchases says the same thing without the gate:
 * no live purchase, no rows, no carriage. Voiding the last purchase drops it automatically.
 *
 * ---------------------------------------------------------------------------------------------
 * The backfill preserves every figure exactly.
 *
 * `NOT NULL DEFAULT 0` would silently zero the carriage on every requisition already purchased,
 * so the planned figure is copied onto the **earliest live purchase** of each requisition, and
 * left at zero on the rest. One van per requisition is what the old model meant, and putting it on
 * every purchase would multiply it by the number of vendors.
 *
 * `down` drops the column. That destroys any actual figure the IM adjusted, and the planned one on
 * the requisition is what the arithmetic falls back to — lossy in the data sense, reversible in
 * the schema sense, and stated here rather than discovered.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE purchases
      ADD COLUMN transportation_cost numeric(14, 2) NOT NULL DEFAULT 0
  `.execute(db);

  // A negative carriage is not a discount, it is a typo that would quietly reduce what the
  // requisition is recorded as having spent.
  await sql`
    ALTER TABLE purchases
      ADD CONSTRAINT purchases_transportation_non_negative
      CHECK (transportation_cost >= 0)
  `.execute(db);

  /*
   * Carry the planned figure onto the first live purchase of each requisition that has one, so
   * every existing `spentInclTransportation`, report total and dashboard figure reads exactly as
   * it did before this migration ran.
   *
   * `DISTINCT ON (requisition_id) … ORDER BY purchased_at, id` picks one row per requisition
   * deterministically — `id` breaks a tie between two purchases recorded in the same instant, so
   * re-running against a restored dump lands on the same row.
   */
  await sql`
    UPDATE purchases AS p
       SET transportation_cost = r.transportation_cost
      FROM requisitions AS r,
           (SELECT DISTINCT ON (requisition_id) id
              FROM purchases
             WHERE voided_at IS NULL
             ORDER BY requisition_id, purchased_at, id) AS first_live
     WHERE p.id = first_live.id
       AND r.id = p.requisition_id
       AND r.transportation_cost IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE purchases
      DROP CONSTRAINT IF EXISTS purchases_transportation_non_negative
  `.execute(db);
  await sql`ALTER TABLE purchases DROP COLUMN IF EXISTS transportation_cost`.execute(db);
}
