import { Inject, Injectable } from '@nestjs/common';
import type { Compartment, Zone } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

@Injectable()
export class LocationsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Zones with their compartments in two queries, not one per zone. The location tree is small
   * enough to assemble in memory and a join would duplicate every zone row.
   */
  async listZones(includeInactive: boolean): Promise<Zone[]> {
    const zones = await this.db
      .selectFrom('storage_zones')
      .select(['id', 'name', 'is_active'])
      .$if(!includeInactive, (qb) => qb.where('is_active', '=', true))
      .orderBy('name')
      .execute();

    if (zones.length === 0) return [];

    const compartments = await this.db
      .selectFrom('storage_compartments')
      .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
      .select((eb) => [
        'storage_compartments.id',
        'storage_compartments.zone_id',
        'storage_compartments.code',
        'storage_compartments.is_active',
        'storage_zones.name as zone_name',
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
        code: row.code,
        isActive: row.is_active,
        placementCount: Number(row.placement_count ?? 0),
      });
      byZone.set(row.zone_id, list);
    }

    return zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      isActive: zone.is_active,
      compartments: byZone.get(zone.id) ?? [],
    }));
  }

  async insertZone(name: string): Promise<string> {
    const row = await this.db
      .insertInto('storage_zones')
      .values({ name })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateZone(id: string, values: { name?: string; isActive?: boolean }): Promise<number> {
    const patch = {
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
    };
    if (Object.keys(patch).length === 0) return 1;

    const result = await this.db
      .updateTable('storage_zones')
      .set(patch)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async findZone(id: string): Promise<{ id: string; name: string; is_active: boolean } | undefined> {
    return this.db
      .selectFrom('storage_zones')
      .select(['id', 'name', 'is_active'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async insertCompartment(zoneId: string, code: string): Promise<string> {
    const row = await this.db
      .insertInto('storage_compartments')
      .values({ zone_id: zoneId, code })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateCompartment(
    id: string,
    values: { code?: string; isActive?: boolean },
  ): Promise<number> {
    const patch = {
      ...(values.code === undefined ? {} : { code: values.code }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
    };
    if (Object.keys(patch).length === 0) return 1;

    const result = await this.db
      .updateTable('storage_compartments')
      .set(patch)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async findCompartment(id: string): Promise<{ id: string; zone_id: string } | undefined> {
    return this.db
      .selectFrom('storage_compartments')
      .select(['id', 'zone_id'])
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
