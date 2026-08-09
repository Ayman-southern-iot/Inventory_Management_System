import { sql, type Kysely } from 'kysely';

/**
 * Transportation cost on a requisition.
 *
 * The requester can attach a single rolled-up transportation cost (e.g. "pickup
 * truck to Gazipur") to a requisition. The cost is part of the requested amount:
 * `requested_amount = items_total + transportation_cost`, frozen at submit and
 * snapshot into the BOM PDF so Accounts sees the line that was approved.
 *
 * The pair is one concept, so the DB rejects "cost without description" and
 * "description without cost" structurally. The web form treats 0 as "not set"
 * and clears the description; the API accepts either both-null or both-non-null
 * only.
 *
 * No enum changes, no FK changes. Money as `numeric(14, 2)` matches
 * `requested_amount`/`approved_amount`; the description is capped at 500 chars
 * to match `requisition_items.note`.
 *
 * The columns are nullable with no default — old rows are unaffected, the form
 * starts at null, and the CHECK constraints only kick in once a write actually
 * touches the columns.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE requisitions
      ADD COLUMN transportation_cost numeric(14, 2) NULL,
      ADD COLUMN transportation_description text NULL
  `.execute(db);

  await sql`
    ALTER TABLE requisitions
      ADD CONSTRAINT requisitions_transportation_non_negative
        CHECK (transportation_cost IS NULL OR transportation_cost >= 0)
  `.execute(db);

  // Both-or-neither: the pair is one concept. A cost without a description, or
  // a description without a cost, is a half-formed idea the form would never
  // let through — the DB catches anything that bypasses the schema.
  await sql`
    ALTER TABLE requisitions
      ADD CONSTRAINT requisitions_transportation_pair
        CHECK (
          (transportation_cost IS NULL AND transportation_description IS NULL)
          OR
          (transportation_cost IS NOT NULL AND transportation_description IS NOT NULL)
        )
  `.execute(db);

  await sql`
    ALTER TABLE requisitions
      ADD CONSTRAINT requisitions_transportation_description_len
        CHECK (
          transportation_description IS NULL
          OR length(transportation_description) <= 500
        )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE requisitions
      DROP CONSTRAINT IF EXISTS requisitions_transportation_description_len,
      DROP CONSTRAINT IF EXISTS requisitions_transportation_pair,
      DROP CONSTRAINT IF EXISTS requisitions_transportation_non_negative
  `.execute(db);

  await sql`
    ALTER TABLE requisitions
      DROP COLUMN IF EXISTS transportation_description,
      DROP COLUMN IF EXISTS transportation_cost
  `.execute(db);
}
