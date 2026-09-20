import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema';

/**
 * The Storage ID of a shelf slot: `ROOM-ZONE-CODE-0001`.
 *
 * Deliberately a pure function taking already-resolved names and an already-drawn serial. The
 * repository owns the sequence and the transaction; this owns the shape, so the shape can be
 * tested without a database and cannot quietly differ between the create path and anything
 * that later needs to explain an ID.
 *
 * The room and zone names are snapshotted at creation. Renaming either afterwards does **not**
 * change the ID — the database refuses it by trigger (migration 0034) because the label is
 * already stuck on the shelf and quoted in audit rows.
 */
export interface StorageIdFormat {
  tokenLength: number;
  serialPad: number;
  separator: string;
}

/**
 * Letters and digits only, uppercased, clipped to `tokenLength`.
 *
 * Falls back to `X` for a name made entirely of punctuation: the not-blank CHECK on a room or
 * zone name does not stop `"---"`, and an empty token would produce `--1A-0001`, which reads
 * as a malformed ID rather than an unusual one.
 */
export function storageIdToken(value: string, tokenLength: number): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.length > 0 ? cleaned.slice(0, tokenLength) : 'X';
}

export function buildStorageId(
  parts: { roomName: string; zoneName: string; compartmentCode: string; serial: number },
  format: StorageIdFormat,
): string {
  const { separator, tokenLength, serialPad } = format;
  return [
    storageIdToken(parts.roomName, tokenLength),
    storageIdToken(parts.zoneName, tokenLength),
    // The compartment code is already a code — kept whole rather than clipped, because "10B"
    // clipped to three characters is still "10B" but "SHELF12" clipped is a different shelf.
    storageIdToken(parts.compartmentCode, Number.MAX_SAFE_INTEGER),
    String(parts.serial).padStart(serialPad, '0'),
  ].join(separator);
}

/**
 * The shape used by the one-time backfill in migration 0034, by `pnpm db:seed`, and by the test
 * fixtures. Must stay in step with the `STORAGE_ID_*` defaults in `config.schema.ts` — the
 * running service reads config, these three read this, and a drift between them would mean
 * seeded shelves carrying a different shape from ones created through the UI.
 */
export const DEFAULT_STORAGE_ID_FORMAT: StorageIdFormat = {
  tokenLength: 3,
  serialPad: 4,
  separator: '-',
};

/**
 * Resolve the room and zone names, draw the next serial, and build the ID — the one path every
 * caller uses.
 *
 * The service, `pnpm db:seed` and the test fixtures all create compartments, and three private
 * copies of "look up the names, then `nextval`" is three chances for a seeded shelf to carry a
 * different shape from one made in the UI. `nextval` is what makes it safe under concurrent
 * creates: the database hands out the number, not a read-then-write.
 */
export async function generateStorageId(
  conn: Kysely<Database>,
  zoneId: string,
  code: string,
  format: StorageIdFormat = DEFAULT_STORAGE_ID_FORMAT,
): Promise<string> {
  const names = await conn
    .selectFrom('storage_zones')
    .innerJoin('storage_rooms', 'storage_rooms.id', 'storage_zones.room_id')
    .where('storage_zones.id', '=', zoneId)
    .select(['storage_zones.name as zone_name', 'storage_rooms.name as room_name'])
    .executeTakeFirstOrThrow();

  const serialRow = await sql<{ n: string }>`SELECT nextval('storage_id_seq') AS n`.execute(conn);

  return buildStorageId(
    {
      roomName: names.room_name,
      zoneName: names.zone_name,
      compartmentCode: code,
      serial: Number(serialRow.rows[0]?.n ?? 1),
    },
    format,
  );
}
