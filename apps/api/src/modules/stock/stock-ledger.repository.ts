import { Inject, Injectable } from '@nestjs/common';
import type { LedgerEntry, ListLedgerQuery, Paginated } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

/**
 * Read-only view of the ledger. Deliberately separate from `StockService`: that class is the
 * write path and keeping reads out of it makes "who writes stock?" answerable by looking at
 * one file (ADR-0001).
 */
/** Null on the side a movement did not touch — a RECEIPT has no origin, an ISSUE no destination. */
function locationLabel(zoneName: string | null, code: string | null): string | null {
  return zoneName && code ? `${zoneName} / ${code}` : null;
}

@Injectable()
export class StockLedgerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(query: ListLedgerQuery): Promise<Paginated<LedgerEntry>> {
    const offset = (query.page - 1) * query.limit;

    // Compartment labels are resolved by join, not by a lookup per row — the ledger is the
    // one table that grows without bound, so an N+1 here would degrade forever.
    const base = this.db
      .selectFrom('stock_ledger')
      .innerJoin('products', 'products.id', 'stock_ledger.product_id')
      .leftJoin(
        'storage_compartments as from_comp',
        'from_comp.id',
        'stock_ledger.from_compartment_id',
      )
      .leftJoin('storage_zones as from_zone', 'from_zone.id', 'from_comp.zone_id')
      .leftJoin('storage_compartments as to_comp', 'to_comp.id', 'stock_ledger.to_compartment_id')
      .leftJoin('storage_zones as to_zone', 'to_zone.id', 'to_comp.zone_id')
      .leftJoin('users', 'users.id', 'stock_ledger.performed_by')
      .$if(query.productId !== undefined, (qb) =>
        qb.where('stock_ledger.product_id', '=', query.productId!),
      )
      .$if(query.movementType !== undefined, (qb) =>
        qb.where('stock_ledger.movement_type', '=', query.movementType!),
      );

    const [rows, counted] = await Promise.all([
      base
        // The "Zone / Compartment" label is assembled in TypeScript below. Doing it in SQL
        // needs a CASE inside a COALESCE per side and buys nothing — the join already fetched
        // both parts.
        .select([
          'stock_ledger.id',
          'stock_ledger.product_id',
          'products.name as product_name',
          'stock_ledger.quantity',
          'stock_ledger.movement_type',
          'stock_ledger.ref_type',
          'stock_ledger.ref_id',
          'stock_ledger.note',
          'stock_ledger.created_at',
          'users.full_name as performed_by_name',
          'from_comp.code as from_code',
          'from_zone.name as from_zone_name',
          'to_comp.code as to_code',
          'to_zone.name as to_zone_name',
        ])
        // Newest first, and by id as the tiebreak: several movements can share a timestamp,
        // and an unstable sort would make pagination silently skip or repeat rows.
        .orderBy('stock_ledger.created_at', 'desc')
        .orderBy('stock_ledger.id', 'desc')
        .limit(query.limit)
        .offset(offset)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirst(),
    ]);

    return {
      items: rows.map((row) => ({
        id: String(row.id),
        productId: row.product_id,
        productName: row.product_name,
        fromCompartment: locationLabel(row.from_zone_name, row.from_code),
        toCompartment: locationLabel(row.to_zone_name, row.to_code),
        quantity: row.quantity,
        movementType: row.movement_type,
        refType: row.ref_type,
        refId: row.ref_id,
        performedByName: row.performed_by_name,
        note: row.note,
        createdAt: row.created_at.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total: Number(counted?.count ?? 0),
    };
  }
}
