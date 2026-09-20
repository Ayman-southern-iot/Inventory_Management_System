import { sql, type Kysely } from 'kysely';

/**
 * An auto-generated Storage ID for every shelf slot.
 *
 * Ayman, ask #1: the IM should not be typing an identifier by hand. Ruling of 2026-09-21,
 * against warehouse practice he checked: the ID names a **shelf slot**, not a product and not
 * a unit. That is fixed slotting — the location carries the identity, the label is stuck on the
 * shelf edge, and whatever product happens to sit there this month is a separate question.
 * It is also what plan decisions D1/D2 already said.
 *
 * ---------------------------------------------------------------------------------------------
 * Shape: `ROOM-ZONE-CODE-0001`.
 *
 *   - Broad to narrow, so a human reads it in the order they walk the building.
 *   - Hyphen separated.
 *   - The tail is zero-padded, so plain alphanumeric sorting puts 0002 before 0010. This is the
 *     single most common way a location scheme goes wrong and it cannot be fixed afterwards
 *     without reprinting every label.
 *   - Four segments, where a product code is two (`LAP-0001`). A picker under pressure must not
 *     confuse a slot ID with a SKU, and the segment count is the fastest visual tell.
 *
 * Token length and pad width live in `config.schema.ts` because they run on every compartment
 * created from now on. The backfill below repeats those defaults inline: a migration importing
 * the env schema builds the whole config at require time inside the migration provider, which
 * is a failure mode with nothing to do with shelves.
 *
 * ---------------------------------------------------------------------------------------------
 * **Immutable once assigned, enforced by trigger.** Renaming a room must not rewrite the IDs
 * underneath it: the ID is printed on a physical label and quoted in audit rows, and silently
 * re-deriving it would make the system disagree with the shelf and with its own history. The
 * room token is therefore a *snapshot* of the name at the moment the slot was created, not a
 * view of it. A decommissioned slot keeps its row and its ID — compartments are deactivated,
 * never deleted — so an ID is retired rather than reused, and the unique index guarantees it.
 *
 * ---------------------------------------------------------------------------------------------
 * Every existing compartment is given an ID (Ayman, 2026-09-21), rather than left null until
 * edited. His own source is the argument: a location that is not labelled effectively does not
 * exist in the system. Leaving them null would also mean a nullable column forever and every
 * read having to tolerate it.
 */

/** Backfill-only. Must match `STORAGE_ID_TOKEN_LENGTH` / `STORAGE_ID_SERIAL_PAD` defaults. */
const TOKEN_LENGTH = 3;
const SERIAL_PAD = 4;
const SEPARATOR = '-';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE SEQUENCE storage_id_seq START 1`.execute(db);

  await sql`ALTER TABLE storage_compartments ADD COLUMN storage_id text`.execute(db);

  /**
   * Deterministic order, so the serials follow the building rather than whatever order the
   * planner happened to produce. `row_number()` rather than `nextval()` inside the UPDATE for
   * the same reason: an UPDATE ... FROM has no ORDER BY, so the sequence would be consumed in
   * an arbitrary order and two runs of the same migration on the same data would disagree.
   *
   * A name made entirely of punctuation would yield an empty token — the not-blank CHECK on
   * the name does not stop that — so an empty token falls back to 'X' rather than producing
   * `--1A-0001`.
   */
  await sql`
    WITH ordered AS (
      SELECT
        c.id,
        coalesce(
          nullif(upper(substring(regexp_replace(r.name, '[^A-Za-z0-9]', '', 'g')
            from 1 for ${sql.lit(TOKEN_LENGTH)})), ''),
          'X'
        ) AS room_token,
        coalesce(
          nullif(upper(substring(regexp_replace(z.name, '[^A-Za-z0-9]', '', 'g')
            from 1 for ${sql.lit(TOKEN_LENGTH)})), ''),
          'X'
        ) AS zone_token,
        coalesce(
          nullif(upper(regexp_replace(c.code, '[^A-Za-z0-9]', '', 'g')), ''),
          'X'
        ) AS code_token,
        row_number() OVER (ORDER BY r.name, z.name, c.code, c.id) AS n
      FROM storage_compartments c
      JOIN storage_zones z ON z.id = c.zone_id
      JOIN storage_rooms r ON r.id = z.room_id
    )
    UPDATE storage_compartments c
    SET storage_id =
      o.room_token || ${sql.lit(SEPARATOR)} ||
      o.zone_token || ${sql.lit(SEPARATOR)} ||
      o.code_token || ${sql.lit(SEPARATOR)} ||
      lpad(o.n::text, ${sql.lit(SERIAL_PAD)}, '0')
    FROM ordered o
    WHERE o.id = c.id
  `.execute(db);

  // Move the sequence past everything the backfill consumed, so the first slot created through
  // the UI does not collide with a backfilled one.
  await sql`
    SELECT setval(
      'storage_id_seq',
      GREATEST((SELECT count(*) FROM storage_compartments), 1)
    )
  `.execute(db);

  await sql`ALTER TABLE storage_compartments ALTER COLUMN storage_id SET NOT NULL`.execute(db);

  await sql`
    ALTER TABLE storage_compartments
      ADD CONSTRAINT storage_compartments_storage_id_not_blank
      CHECK (length(btrim(storage_id)) > 0)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX storage_compartments_storage_id_key
    ON storage_compartments (lower(btrim(storage_id)))
  `.execute(db);

  // ------------------------------------------------------- immutability
  /**
   * A row-level trigger, not a CHECK: a CHECK cannot see the old value. This is the guarantee
   * that a room rename, a zone rename or a stray UPDATE cannot invalidate a label already stuck
   * on a shelf. Deliberately allows NULL → value, so the backfill and the insert path work, and
   * refuses every value → different value.
   */
  await sql`
    CREATE OR REPLACE FUNCTION storage_id_is_immutable() RETURNS trigger AS $$
    BEGIN
      IF OLD.storage_id IS NOT NULL AND NEW.storage_id IS DISTINCT FROM OLD.storage_id THEN
        RAISE EXCEPTION
          'storage_id is immutable once assigned (% -> %). The label is already on the shelf.',
          OLD.storage_id, NEW.storage_id
          USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER storage_compartments_storage_id_immutable
    BEFORE UPDATE ON storage_compartments
    FOR EACH ROW EXECUTE FUNCTION storage_id_is_immutable()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TRIGGER IF EXISTS storage_compartments_storage_id_immutable ON storage_compartments
  `.execute(db);
  await sql`DROP FUNCTION IF EXISTS storage_id_is_immutable()`.execute(db);
  await sql`DROP INDEX IF EXISTS storage_compartments_storage_id_key`.execute(db);
  await sql`
    ALTER TABLE storage_compartments
      DROP CONSTRAINT IF EXISTS storage_compartments_storage_id_not_blank
  `.execute(db);
  /** Every printed label becomes unrecoverable from the database. Inherent to reversing this. */
  await sql`ALTER TABLE storage_compartments DROP COLUMN IF EXISTS storage_id`.execute(db);
  await sql`DROP SEQUENCE IF EXISTS storage_id_seq`.execute(db);
}
