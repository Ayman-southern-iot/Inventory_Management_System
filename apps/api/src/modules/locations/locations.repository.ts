import { Inject, Injectable } from '@nestjs/common';
import type { Compartment, Room, Zone } from '@ims/shared';
import type { Transaction } from 'kysely';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';
import { generateStorageId, type StorageIdFormat } from './storage-id';

/** Kysely transaction handle. Pass to repository writes so audit rows commit together. */
export type Tx = Transaction<Database>;

@Injectable()
export class LocationsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Rooms with their zones with their compartments, in three queries, not one per level. The
   * location tree is small enough to assemble in memory and a join would duplicate every room
   * row once per compartment underneath it.
   */
  async listRooms(includeInactive: boolean): Promise<Room[]> {
    const rooms = await this.db
      .selectFrom('storage_rooms')
      .select(['id', 'name', 'is_active'])
      .$if(!includeInactive, (qb) => qb.where('is_active', '=', true))
      .orderBy('name')
      .execute();

    if (rooms.length === 0) return [];

    const zones = await this.listZonesIn(
      rooms.map((room) => room.id),
      includeInactive,
    );

    const byRoom = new Map<string, Zone[]>();
    for (const zone of zones) {
      const list = byRoom.get(zone.roomId) ?? [];
      list.push(zone);
      byRoom.set(zone.roomId, list);
    }

    return rooms.map((room) => ({
      id: room.id,
      name: room.name,
      isActive: room.is_active,
      zones: byRoom.get(room.id) ?? [],
    }));
  }

  /**
   * Every zone, flat, each carrying its room. Kept as its own method because the pickers want a
   * flat list and the Locations page wants the tree, and deriving one from the other in the
   * caller is how the two drift.
   */
  async listZones(includeInactive: boolean): Promise<Zone[]> {
    return this.listZonesIn(undefined, includeInactive);
  }

  private async listZonesIn(roomIds: string[] | undefined, includeInactive: boolean): Promise<Zone[]> {
    if (roomIds !== undefined && roomIds.length === 0) return [];

    const zones = await this.db
      .selectFrom('storage_zones')
      .innerJoin('storage_rooms', 'storage_rooms.id', 'storage_zones.room_id')
      .select([
        'storage_zones.id',
        'storage_zones.name',
        'storage_zones.is_active',
        'storage_zones.room_id',
        'storage_rooms.name as room_name',
      ])
      .$if(roomIds !== undefined, (qb) => qb.where('storage_zones.room_id', 'in', roomIds!))
      .$if(!includeInactive, (qb) => qb.where('storage_zones.is_active', '=', true))
      // Room first, so a flat zone list still reads in building order.
      .orderBy('storage_rooms.name')
      .orderBy('storage_zones.name')
      .execute();

    if (zones.length === 0) return [];

    const compartments = await this.db
      .selectFrom('storage_compartments')
      .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
      .innerJoin('storage_rooms', 'storage_rooms.id', 'storage_zones.room_id')
      .select((eb) => [
        'storage_compartments.id',
        'storage_compartments.zone_id',
        'storage_compartments.code',
        'storage_compartments.storage_id',
        'storage_compartments.is_active',
        'storage_zones.name as zone_name',
        'storage_zones.room_id as room_id',
        'storage_rooms.name as room_name',
        // Correlated subquery rather than a second round trip per compartment.
        eb
          .selectFrom('stock_placements')
          .whereRef('stock_placements.compartment_id', '=', 'storage_compartments.id')
          .where('stock_placements.quantity', '>', 0)
          .select((inner) => inner.fn.countAll<number>().as('c'))
          .as('placement_count'),
      ])
      .where(
        'storage_compartments.zone_id',
        'in',
        zones.map((z) => z.id),
      )
      .$if(!includeInactive, (qb) => qb.where('storage_compartments.is_active', '=', true))
      .orderBy('storage_compartments.code')
      .execute();

    const byZone = new Map<string, Compartment[]>();
    for (const row of compartments) {
      const list = byZone.get(row.zone_id) ?? [];
      list.push({
        id: row.id,
        zoneId: row.zone_id,
        zoneName: row.zone_name,
        roomId: row.room_id,
        roomName: row.room_name,
        code: row.code,
        storageId: row.storage_id,
        isActive: row.is_active,
        placementCount: Number(row.placement_count ?? 0),
      });
      byZone.set(row.zone_id, list);
    }

    return zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      roomId: zone.room_id,
      roomName: zone.room_name,
      isActive: zone.is_active,
      compartments: byZone.get(zone.id) ?? [],
    }));
  }

  async insertRoom(name: string, tx?: Tx): Promise<string> {
    const conn = tx ?? this.db;
    const row = await conn
      .insertInto('storage_rooms')
      .values({ name })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateRoom(
    id: string,
    values: { name?: string; isActive?: boolean },
    tx?: Tx,
  ): Promise<number> {
    const patch = {
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
    };
    if (Object.keys(patch).length === 0) return 1;

    const conn = tx ?? this.db;
    const result = await conn
      .updateTable('storage_rooms')
      .set(patch)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async findRoom(id: string): Promise<{ id: string; name: string; is_active: boolean } | undefined> {
    return this.db
      .selectFrom('storage_rooms')
      .select(['id', 'name', 'is_active'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Stock anywhere under a room blocks its deactivation, same rule as a zone. */
  async countStockInRoom(roomId: string): Promise<number> {
    const row = await this.db
      .selectFrom('stock_placements')
      .innerJoin(
        'storage_compartments',
        'storage_compartments.id',
        'stock_placements.compartment_id',
      )
      .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
      .where('storage_zones.room_id', '=', roomId)
      .where('stock_placements.quantity', '>', 0)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async insertZone(name: string, roomId: string, tx?: Tx): Promise<string> {
    const conn = tx ?? this.db;
    const row = await conn
      .insertInto('storage_zones')
      .values({ name, room_id: roomId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateZone(
    id: string,
    values: { name?: string; isActive?: boolean },
    tx?: Tx,
  ): Promise<number> {
    const patch = {
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
    };
    if (Object.keys(patch).length === 0) return 1;

    const conn = tx ?? this.db;
    const result = await conn
      .updateTable('storage_zones')
      .set(patch)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async findZone(
    id: string,
  ): Promise<{ id: string; name: string; room_id: string; is_active: boolean } | undefined> {
    return this.db
      .selectFrom('storage_zones')
      .select(['id', 'name', 'room_id', 'is_active'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Draws the next serial and stamps the Storage ID in the same statement path as the insert.
   *
   * `nextval` is what makes this safe under concurrent creates — two IMs adding a shelf at the
   * same moment get different serials from the database rather than from a read-then-write that
   * would hand them both the same number. Gaps are fine and expected: a rolled-back create
   * burns a serial, which is the correct trade against ever reusing one.
   */
  async insertCompartment(
    zoneId: string,
    code: string,
    format: StorageIdFormat,
    tx?: Tx,
  ): Promise<{ id: string; storageId: string }> {
    const conn = tx ?? this.db;
    const storageId = await generateStorageId(conn, zoneId, code, format);

    const row = await conn
      .insertInto('storage_compartments')
      .values({ zone_id: zoneId, code, storage_id: storageId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id, storageId };
  }

  async updateCompartment(
    id: string,
    values: { code?: string; isActive?: boolean },
    tx?: Tx,
  ): Promise<number> {
    const patch = {
      ...(values.code === undefined ? {} : { code: values.code }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
    };
    if (Object.keys(patch).length === 0) return 1;

    const conn = tx ?? this.db;
    const result = await conn
      .updateTable('storage_compartments')
      .set(patch)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async findCompartment(
    id: string,
  ): Promise<
    | { id: string; zone_id: string; code: string; storage_id: string; is_active: boolean }
    | undefined
  > {
    return this.db
      .selectFrom('storage_compartments')
      .select(['id', 'zone_id', 'code', 'storage_id', 'is_active'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Stock still sitting in a compartment blocks its deactivation. */
  async countStockIn(compartmentId: string): Promise<number> {
    const row = await this.db
      .selectFrom('stock_placements')
      .where('compartment_id', '=', compartmentId)
      .where('quantity', '>', 0)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async countStockInZone(zoneId: string): Promise<number> {
    const row = await this.db
      .selectFrom('stock_placements')
      .innerJoin(
        'storage_compartments',
        'storage_compartments.id',
        'stock_placements.compartment_id',
      )
      .where('storage_compartments.zone_id', '=', zoneId)
      .where('stock_placements.quantity', '>', 0)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}
