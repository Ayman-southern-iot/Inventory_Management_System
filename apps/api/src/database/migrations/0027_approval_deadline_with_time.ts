import { sql, type Kysely } from 'kysely';

/**
 * `requisitions.approval_deadline` — `date` → `timestamptz`.
 *
 * Ayman's ruling, 2026-08-26: the requester picks a date **and** a time of day, on a 12-hour
 * clock, in Bangladesh Standard Time. A `date` column cannot hold 5:00 PM, so the column changes
 * type. This is the schema change the feature rests on; there is no version of it that avoids
 * one, and collecting a time we then discarded would be worse than not offering it.
 *
 * ---------------------------------------------------------------------------------------------
 * The backfill is the part that rewrites live data, so it is stated plainly.
 *
 * Every existing row holds a calendar day and no time. Each becomes **23:59:59 on that same day,
 * Asia/Dhaka**. A date-only deadline of "26 Aug" has always meant "by the end of 26 Aug", so
 * end-of-day is the only conversion that leaves every existing requisition meaning exactly what
 * it meant yesterday. Midnight would have been the lazy cast and would have made every deadline
 * in the table instantly overdue — firing §5 reminders, at once, on requisitions nobody had
 * touched.
 *
 * The zone is written literally rather than read from `REPORTING_TIME_ZONE`. A migration is a
 * historical fact: it records what these dates meant on the day they were converted, and it must
 * keep producing that same result if it is ever replayed against a restored dump — including on a
 * machine whose config says something else. That is the opposite of the rules/10 case for
 * configuration, and the reason the literal is correct here.
 *
 * ---------------------------------------------------------------------------------------------
 * This walks back part of `532a4ba` (D-014), which made these columns calendar days precisely
 * because treating them as instants shifted every date a day backwards east of Greenwich. That
 * fix is not wrong and is not being undone: `approval_deadline` is now genuinely an instant — a
 * moment in time the requester chose — so an instant type is the honest one. The other `date`
 * columns D-014 covers keep their type and their string handling.
 *
 * `down` casts back to the calendar day in the same zone, which loses the time. That is
 * unavoidable and is what a `down` means here: the information did not exist before this ran.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE requisitions
      ALTER COLUMN approval_deadline TYPE timestamptz
      USING (
        CASE
          WHEN approval_deadline IS NULL THEN NULL
          -- 23:59:59 on the stated day, read in Dhaka's calendar, stored as the instant.
          ELSE ((approval_deadline::text || ' 23:59:59')::timestamp AT TIME ZONE 'Asia/Dhaka')
        END
      )
  `.execute(db);

  // The index was built on a `date`; the type change invalidates it. Rebuilt on the new type so
  // the §5 reminder sweep keeps its index scan rather than falling back to a seq scan.
  await sql`DROP INDEX IF EXISTS requisitions_deadline_idx`.execute(db);
  await sql`
    CREATE INDEX requisitions_deadline_idx
      ON requisitions (approval_deadline)
      WHERE approval_deadline IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE requisitions
      ALTER COLUMN approval_deadline TYPE date
      USING (
        CASE
          WHEN approval_deadline IS NULL THEN NULL
          -- Back to the calendar day the instant falls on in Dhaka. The time is lost, which is
          -- correct: it did not exist before this migration ran.
          ELSE (approval_deadline AT TIME ZONE 'Asia/Dhaka')::date
        END
      )
  `.execute(db);

  await sql`DROP INDEX IF EXISTS requisitions_deadline_idx`.execute(db);
  await sql`
    CREATE INDEX requisitions_deadline_idx
      ON requisitions (approval_deadline)
  `.execute(db);
}
