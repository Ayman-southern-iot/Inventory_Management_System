import { sql, type Kysely } from 'kysely';

/**
 * Room, above Zone. Location becomes Room → Zone → Compartment.
 *
 * Ayman, ask #3: "Location should have Room name, then zone, then compartment." The model was
 * flat — a globally-unique zone name with compartments under it — which works until the company
 * has a shelf A in the lab and a shelf A in the store room, and the second one cannot be
 * created because the name is taken by a different building.
 *
 * It is also the prerequisite for the auto-generated Storage ID (ask #1, migration 0034): the
 * ID is composed room → zone → compartment → serial, so the room has to exist as a real level
 * before an ID can name one.
 *
 * ---------------------------------------------------------------------------------------------
 * **The property that keeps this safe: the compartment stays the physical leaf.**
 * `stock_placements.compartment_id` and the append-only
 * `stock_ledger.from_compartment_id` / `to_compartment_id` keep pointing exactly where they
 * pointed before. Not one placement row and not one ledger row is touched or rewritten. A room
 * is an attribute of the zone above the leaf, so every quantity in the system is untouched by
 * this migration — which is the only reason a structural change this wide is a single release
 * rather than a multi-release column move.
 *
 * ---------------------------------------------------------------------------------------------
 * The zone name unique index moves from global to per-room. That is the behaviour change people
 * will actually notice: "Shelf A" becomes creatable twice as long as the rooms differ.
 *
 * ---------------------------------------------------------------------------------------------
 * On the backfill room name being a literal: `rules/40-database.md` says migrations never carry
 * business data, and the phase plan (A.2) asked for this to come from config. Neither is quite
 * right for a one-time backfill. Importing the config singleton into a migration builds the
 * whole environment schema at require time, inside the migration provider, in whichever worker
 * happens to load it — a failure mode with nothing to do with rooms. And this name is written
 * exactly once, on the only two databases that will ever run this migration, after which every
 * room is created through the UI and this one is renamed. It is the same class of decision as
 * 0031 writing 'ACTIVE' onto the projects that already existed: a historical fact, not a policy
 * knob. So: a named constant, with this paragraph, and the admin renames it on day one.
 */

/**
 * Holds every zone that existed before rooms did. Deliberately bland and obviously provisional,
 * so that an admin opening Locations sees something that asks to be renamed rather than
 * something that looks deliberate.
 */
const BACKFILL_ROOM_NAME = 'Unassigned Room';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ------------------------------------------------------------------ rooms
  // Mirrors `storage_zones` field for field, including the blank-name CHECK, so the two levels
  // behave identically and nobody has to remember which one validates what.
  await db.schema
    .createTable('storage_rooms')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('storage_rooms_name_not_blank', sql`length(btrim(name)) > 0`)
    .execute();

  await sql`
    CREATE UNIQUE INDEX storage_rooms_name_key ON storage_rooms (lower(btrim(name)))
  `.execute(db);

  await sql`
    CREATE TRIGGER storage_rooms_set_updated_at
    BEFORE UPDATE ON storage_rooms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);

  // ------------------------------------------------- zones belong to a room
  // Nullable → backfill → NOT NULL. ON DELETE RESTRICT: a room with zones in it is not
  // deletable, the same way a zone with compartments is not.
  await sql`
    ALTER TABLE storage_zones
      ADD COLUMN room_id uuid REFERENCES storage_rooms (id) ON DELETE RESTRICT
  `.execute(db);

  /**
   * Only create the holding room if there is something to hold. A fresh database — every test
   * run, and any new deployment — gets no room at all rather than a permanent "Unassigned Room"
   * nobody asked for, which would then need deleting on day one of every install.
   */
  await sql`
    INSERT INTO storage_rooms (name)
    SELECT ${BACKFILL_ROOM_NAME}
    WHERE EXISTS (SELECT 1 FROM storage_zones)
  `.execute(db);

  await sql`
    UPDATE storage_zones
    SET room_id = (SELECT id FROM storage_rooms WHERE name = ${BACKFILL_ROOM_NAME})
    WHERE room_id IS NULL
  `.execute(db);

  await sql`ALTER TABLE storage_zones ALTER COLUMN room_id SET NOT NULL`.execute(db);

  // ------------------------------------------- zone names are unique per room
  // Was global. Two rooms may each have a "Shelf A" — that is the point of the level, and the
  // old index is what made it impossible.
  await sql`DROP INDEX IF EXISTS storage_zones_name_key`.execute(db);

  await sql`
    CREATE UNIQUE INDEX storage_zones_room_name_key
    ON storage_zones (room_id, lower(btrim(name)))
  `.execute(db);

  // Every zone list is "the zones in this room", so the FK gets the index its lookups need.
  await sql`CREATE INDEX storage_zones_room_idx ON storage_zones (room_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  /**
   * Reversing this re-imposes a global unique on zone name. If two rooms have each been given a
   * zone of the same name — the exact capability this migration adds — that index cannot be
   * built, and the rollback would otherwise die inside `CREATE UNIQUE INDEX` with a duplicate
   * key error naming a row rather than the reason. Fail first, with the sentence that explains
   * what has to happen before a rollback is possible.
   */
  const clash = await sql<{ name: string }>`
    SELECT lower(btrim(name)) AS name
    FROM storage_zones
    GROUP BY lower(btrim(name))
    HAVING count(*) > 1
    LIMIT 1
  `.execute(db);

  if (clash.rows.length > 0) {
    throw new Error(
      `Cannot roll back 0033: the zone name "${clash.rows[0]!.name}" now exists in more than ` +
        'one room, and zone names were globally unique before this migration. Rename or remove ' +
        'the duplicate zones first.',
    );
  }

  await sql`DROP INDEX IF EXISTS storage_zones_room_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS storage_zones_room_name_key`.execute(db);

  await sql`
    CREATE UNIQUE INDEX storage_zones_name_key ON storage_zones (lower(btrim(name)))
  `.execute(db);

  await sql`ALTER TABLE storage_zones DROP COLUMN IF EXISTS room_id`.execute(db);

  await sql`DROP TRIGGER IF EXISTS storage_rooms_set_updated_at ON storage_rooms`.execute(db);
  await db.schema.dropTable('storage_rooms').ifExists().execute();
}
