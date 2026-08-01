import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { ListProductsQuery, Product } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';
import type { Transaction } from 'kysely';
import { BorrowStatus } from '@ims/shared';

/** Kysely transaction handle. Pass to repository writes so audit rows commit together. */
export type Tx = Transaction<Database>;

@Injectable()
export class ProductsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Stock totals come from one LATERAL aggregate evaluated per product row, not a second query
   * per product (rules/40-database.md — N+1 is a review blocker). It is a join rather than two
   * scalar subselects so `stock_placements` is scanned once per product instead of twice, and so
   * `inStockOnly` can filter on the same aggregate it reports.
   *
   * Three aggregates survive on the row:
   *   `total_quantity`, `total_reserved`, `total_quarantined` from `stock_placements`
   *   `total_in_use`     from `borrow_requests`  (active statuses; see OUTSTANDING_STATUSES in
   *                      `@ims/shared` for the canonical list — duplicated here as a literal so
   *                      this query is independently readable)
   *
   * `total_in_use` measures outstanding quantity (issued but not yet returned); products in
   * PENDING are *reserved*, not *out*, so they live in `total_reserved`. That split lets
   * `total_owned = total_quantity + total_in_use` answer "how many are we currently responsible
   * for, in any state" without double-counting the reservations.
   */
  private baseSelect() {
    return this.db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('stock_placements')
            .whereRef('stock_placements.product_id', '=', 'products.id')
            .select([
              sql<number>`coalesce(sum(stock_placements.quantity), 0)::int`.as('total_quantity'),
              sql<number>`coalesce(sum(stock_placements.reserved_qty), 0)::int`.as(
                'total_reserved',
              ),
              sql<number>`coalesce(sum(stock_placements.quarantined_qty), 0)::int`.as(
                'total_quarantined',
              ),
            ])
            .as('totals'),
        (join) => join.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('borrow_requests')
            .whereRef('borrow_requests.product_id', '=', 'products.id')
            .where('borrow_requests.status', 'in', [
              BorrowStatus.ISSUED,
              BorrowStatus.PARTIALLY_RETURNED,
            ])
            .select([
              sql<number>`coalesce(sum(borrow_requests.quantity - borrow_requests.returned_qty), 0)::int`.as(
                'total_in_use',
              ),
            ])
            .as('in_use'),
        (join) => join.onTrue(),
      )
      .select([
        'products.id',
        'products.product_code',
        'products.name',
        'products.category_id',
        'products.unit',
        'products.default_returnable',
        'products.description',
        'products.is_active',
        'products.created_at',
        'categories.name as category_name',
        'categories.is_trackable',
        'totals.total_quantity',
        'totals.total_reserved',
        'totals.total_quarantined',
        'in_use.total_in_use',
      ]);
  }

  async list(query: ListProductsQuery): Promise<{ items: Product[]; total: number }> {
    const offset = (query.page - 1) * query.limit;

    const base = this.baseSelect()
      .$if(!query.includeInactive, (qb) => qb.where('products.is_active', '=', true))
      .$if(query.categoryId !== undefined, (qb) =>
        qb.where('products.category_id', '=', query.categoryId!),
      )
      .$if(query.inStockOnly, (qb) => qb.where('totals.total_quantity', '>', 0))
      .$if(query.search !== undefined, (qb) => {
        /**
         * `ILIKE '%term%'` rather than the `%` similarity operator, and both are served by the
         * GIN trigram indexes from migration 0006 (`products_name_trgm_idx`,
         * `products_code_trgm_idx` — `gin_trgm_ops` supports LIKE/ILIKE as well as similarity).
         *
         * ILIKE wins here because similarity ranking is governed by `pg_trgm.similarity_threshold`,
         * a database GUC — an invisible knob nobody can tune from the admin UI — and because
         * short Storage IDs like "1A" score badly under similarity while still needing to match
         * as a substring. A term under three characters cannot use the index and falls back to a
         * scan; at this catalogue size that is cheaper than the alternatives.
         */
        const term = `%${query.search!}%`;
        return qb.where((eb) =>
          eb.or([
            eb(sql.ref('products.name'), 'ilike', term),
            eb(sql.ref('products.product_code'), 'ilike', term),
          ]),
        );
      });

    const [rows, counted] = await Promise.all([
      base.orderBy('products.name').limit(query.limit).offset(offset).execute(),
      base
        .clearSelect()
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirst(),
    ]);

    return { items: rows.map(toProduct), total: Number(counted?.count ?? 0) };
  }

  /** No `is_active` filter: history must keep resolving to a deactivated product (plan 1.2). */
  async findById(id: string): Promise<Product | undefined> {
    const row = await this.baseSelect().where('products.id', '=', id).executeTakeFirst();
    return row ? toProduct(row) : undefined;
  }

  async insert(
    values: {
      productCode: string;
      name: string;
      categoryId: string;
      unit: string;
      defaultReturnable: boolean;
      description: string | null;
    },
    tx?: Tx,
  ): Promise<string> {
    const conn = tx ?? this.db;
    const row = await conn
      .insertInto('products')
      .values({
        product_code: values.productCode,
        name: values.name,
        category_id: values.categoryId,
        unit: values.unit,
        default_returnable: values.defaultReturnable,
        description: values.description,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async update(
    id: string,
    values: {
      productCode?: string;
      name?: string;
      categoryId?: string;
      unit?: string;
      defaultReturnable?: boolean;
      description?: string | null;
      isActive?: boolean;
    },
    tx?: Tx,
  ): Promise<void> {
    const patch = {
      ...(values.productCode === undefined ? {} : { product_code: values.productCode }),
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.categoryId === undefined ? {} : { category_id: values.categoryId }),
      ...(values.unit === undefined ? {} : { unit: values.unit }),
      ...(values.defaultReturnable === undefined
        ? {}
        : { default_returnable: values.defaultReturnable }),
      ...(values.description === undefined ? {} : { description: values.description }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
    };
    if (Object.keys(patch).length === 0) return;

    const conn = tx ?? this.db;
    await conn.updateTable('products').set(patch).where('id', '=', id).execute();
  }
}

interface ProductRow {
  id: string;
  product_code: string;
  name: string;
  category_id: string;
  unit: string;
  default_returnable: boolean;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  category_name: string;
  is_trackable: boolean;
  total_quantity: number | null;
  total_reserved: number | null;
  total_quarantined: number | null;
  total_in_use: number | null;
}

function toProduct(row: ProductRow): Product {
  const totalOnHand = Number(row.total_quantity ?? 0);
  const totalReserved = Number(row.total_reserved ?? 0);
  const totalQuarantined = Number(row.total_quarantined ?? 0);
  const totalInUse = Number(row.total_in_use ?? 0);
  return {
    id: row.id,
    productCode: row.product_code,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    isTrackable: row.is_trackable,
    unit: row.unit,
    defaultReturnable: row.default_returnable,
    description: row.description,
    isActive: row.is_active,
    // `totalQuantity` is the historical synonym for "physical on-hand". Kept so the API
    // contract never breaks for older clients; the new names are the human-readable ones.
    totalQuantity: totalOnHand,
    totalReserved,
    totalAvailable: totalOnHand - totalReserved - totalQuarantined,
    totalOnHand,
    totalQuarantined,
    totalInUse,
    totalOwned: totalOnHand + totalInUse,
    createdAt: row.created_at.toISOString(),
  };
}
