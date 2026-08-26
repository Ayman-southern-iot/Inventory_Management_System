import { sql, type Kysely } from 'kysely';

/**
 * Phase 08 — `fund_receipts` and `purchases` become voidable.
 *
 * Ayman's ruling, 2026-08-26: every stage between approval and add-to-inventory needs a way back.
 * "I accidentally accept the record money received and go to the record purchase, but there is no
 * way of going back."
 *
 * ---------------------------------------------------------------------------------------------
 * Why the feature cannot be built without a schema change.
 *
 * `FUNDS_PARTIAL` versus `FUNDS_RECEIVED` is **derived at every read**, from
 * `SUM(fund_receipts.amount)` against `approved_amount`. Migration 0016 chose that deliberately —
 * a cached total is a number that can drift from the rows that justify it. The consequence nobody
 * had hit until now is that you cannot undo a receipt by flipping the status back: the next read
 * re-derives it straight from the rows and puts it back. The receipt has to leave the sum.
 *
 * The two ways to make a row leave a sum are deleting it and marking it. Deleting a money row in
 * a system with an append-only audit trail is not a real option: the evidence that someone
 * recorded 40,000 BDT and then took it back is exactly what an auditor asks about. So the row
 * stays and the arithmetic learns to skip it.
 *
 * ---------------------------------------------------------------------------------------------
 * Additive only. No column is dropped, renamed or rewritten, and every existing row reads as
 * "not voided" without being touched — `voided_at IS NULL` is the default state, not a backfill.
 *
 * The CHECK is the point of doing this in the schema rather than in a service: a voided row
 * without an actor and a reason is unattributable, and "who voided this and why" is the whole
 * reason for keeping the row. A constraint is the only version of that rule an auditor can trust,
 * because it also holds for a hand-run UPDATE at 3pm on a Tuesday.
 *
 * `down` drops the three columns from each table. That destroys the void markers, which means a
 * voided receipt would silently re-enter every sum. It is reversible in the schema sense and
 * lossy in the data sense; that is inherent to rolling back a feature whose whole content is the
 * marker, and it is stated here rather than discovered.
 */
const TABLES = ['fund_receipts', 'purchases'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`
      ALTER TABLE ${sql.ref(table)}
        ADD COLUMN voided_at timestamptz,
        ADD COLUMN voided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
        ADD COLUMN void_reason text
    `.execute(db);

    // Voided means: we know when, who, and why. All three or none of them.
    await sql`
      ALTER TABLE ${sql.ref(table)}
        ADD CONSTRAINT ${sql.ref(`${table}_void_is_attributed`)}
        CHECK (
          voided_at IS NULL
          OR (voided_by IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) > 0)
        )
    `.execute(db);

    // Every read of these tables filters on `voided_at IS NULL`, and both are scanned by
    // requisition. A partial index costs nothing on the voided rows, which are the rare case.
    await sql`
      CREATE INDEX ${sql.ref(`${table}_live_idx`)}
        ON ${sql.ref(table)} (requisition_id)
        WHERE voided_at IS NULL
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`DROP INDEX IF EXISTS ${sql.ref(`${table}_live_idx`)}`.execute(db);
    await sql`
      ALTER TABLE ${sql.ref(table)}
        DROP CONSTRAINT IF EXISTS ${sql.ref(`${table}_void_is_attributed`)}
    `.execute(db);
    await sql`
      ALTER TABLE ${sql.ref(table)}
        DROP COLUMN IF EXISTS voided_at,
        DROP COLUMN IF EXISTS voided_by,
        DROP COLUMN IF EXISTS void_reason
    `.execute(db);
  }
}
