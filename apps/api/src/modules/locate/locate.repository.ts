import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

/**
 * Reads only. Locating a product changes nothing, so nothing here writes — least of all to the
 * stock tables, which only `StockService` may (rule 2).
 *
 * Archived products light nothing: a search hands over active products, and a stale id must not
 * make the cabinet point at a shelf the product left long ago.
 */
@Injectable()
export class LocateRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Every shelf holding any of the products now — one query for all of them, never one per
   * product (`rules/40-database.md`).
   *
   * Projects the columns of `StockService.placementsForProduct`, so each row goes through the
   * same `toPlacement` mapper and `available` is computed in exactly one place. A column added to
   * that projection without being added here is a type error at the call site, not drift.
   */
  async placementsOf(productIds: readonly string[]) {
    return this.db
      .selectFrom('stock_placements')
      .innerJoin('products', 'products.id', 'stock_placements.product_id')
      .innerJoin('storage_compartments', 'storage_compartments.id', 'stock_placements.compartment_id')
      .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
      .innerJoin('storage_rooms', 'storage_rooms.id', 'storage_zones.room_id')
      .where('stock_placements.product_id', 'in', productIds)
      .where('products.is_active', '=', true)
      .select([
        'stock_placements.product_id',
        'stock_placements.id',
        'stock_placements.compartment_id',
        'stock_placements.quantity',
        'stock_placements.reserved_qty',
        'stock_placements.quarantined_qty',
        'stock_placements.version',
        'storage_compartments.code as compartment_code',
        'storage_zones.id as zone_id',
        'storage_zones.name as zone_name',
        'storage_rooms.id as room_id',
        'storage_rooms.name as room_name',
      ])
      .execute();
  }

  /**
   * For each product, the shelf its stock most recently left.
   *
   * Used for a product with no placement, which is exactly a product that has run out:
   * `StockService` deletes a placement at zero, so the ledger is the only record of where it
   * lived. Its newest outbound row is the one that took the last units out — an issue, an
   * adjustment, a disposal, or a move whose destination has since emptied too. A product never
   * stocked has no outbound row and is absent from the result.
   *
   * The newest row is taken first and its shelf's state reported, rather than the newest row on
   * a still-active shelf: falling back to an older shelf would point at where the product lived
   * before, which is worse than pointing nowhere. One query for all of them.
   *
   * Newest by `id`, not `created_at`: `created_at` is `now()`, the time the transaction *started*,
   * so an issue that queued behind a move on the same placement lock carries the older timestamp
   * though it happened second. The id is drawn at insert, under that lock, so it is in the order
   * the movements really happened.
   */
  async lastCellsOf(productIds: readonly string[]) {
    return this.db
      .selectFrom('stock_ledger')
      .innerJoin('products', 'products.id', 'stock_ledger.product_id')
      .innerJoin('storage_compartments', 'storage_compartments.id', 'stock_ledger.from_compartment_id')
      .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
      .innerJoin('storage_rooms', 'storage_rooms.id', 'storage_zones.room_id')
      .where('stock_ledger.product_id', 'in', productIds)
      .where('products.is_active', '=', true)
      .distinctOn('stock_ledger.product_id')
      .select([
        'stock_ledger.product_id',
        'storage_compartments.code as compartment_code',
        'storage_zones.name as zone_name',
        'storage_rooms.name as room_name',
        'storage_compartments.is_active as is_compartment_active',
        'storage_zones.is_active as is_zone_active',
        'storage_rooms.is_active as is_room_active',
      ])
      .orderBy('stock_ledger.product_id')
      .orderBy('stock_ledger.id', 'desc')
      .execute();
  }
}
