import { Inject, Injectable } from '@nestjs/common';
import type { Category } from '@ims/shared';
import { sql, type Transaction } from 'kysely';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';

/** Kysely transaction handle. Pass to repository writes so audit rows commit together. */
export type Tx = Transaction<Database>;

@Injectable()
export class CategoriesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * `product_count` is a correlated subquery rather than a second request per node: the tree is
   * fetched whole, so a per-node count would be one query per category (rules/40-database.md).
   */
  private baseSelect() {
    return this.db.selectFrom('categories').select((eb) => [
      'categories.id',
      'categories.name',
      'categories.parent_id',
      'categories.is_trackable',
      'categories.is_active',
      'categories.created_at',
      'categories.updated_at',
      eb
        .selectFrom('products')
        .whereRef('products.category_id', '=', 'categories.id')
        .where('products.is_active', '=', true)
        .select((inner) => inner.fn.countAll<number>().as('c'))
        .as('product_count'),
    ]);
  }

  /** The whole table in one query. It is a dozen rows; the tree is assembled in memory. */
  async listAll(): Promise<Category[]> {
    const rows = await this.baseSelect().orderBy('categories.name').execute();
    return rows.map(toCategory);
  }

  async findById(id: string): Promise<Category | undefined> {
    const row = await this.baseSelect().where('categories.id', '=', id).executeTakeFirst();
    return row ? toCategory(row) : undefined;
  }

  async insert(
    values: {
      name: string;
      parentId: string | null;
      isTrackable: boolean;
    },
    tx?: Tx,
  ): Promise<string> {
    const conn = tx ?? this.db;
    const row = await conn
      .insertInto('categories')
      .values({
        name: values.name,
        parent_id: values.parentId,
        is_trackable: values.isTrackable,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async update(
    id: string,
    values: { name?: string; isTrackable?: boolean; isActive?: boolean; parentId?: string | null },
    tx?: Tx,
  ): Promise<void> {
    const patch = {
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.isTrackable === undefined ? {} : { is_trackable: values.isTrackable }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
      // undefined leaves the parent alone; null makes it a top-level category.
      ...(values.parentId === undefined ? {} : { parent_id: values.parentId }),
    };
    if (Object.keys(patch).length === 0) return;

    const conn = tx ?? this.db;
    await conn.updateTable('categories').set(patch).where('id', '=', id).execute();
  }

  async countActiveProducts(categoryId: string): Promise<number> {
    const row = await this.db
      .selectFrom('products')
      .where('category_id', '=', categoryId)
      .where('is_active', '=', true)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async countActiveChildren(categoryId: string): Promise<number> {
    const row = await this.db
      .selectFrom('categories')
      .where('parent_id', '=', categoryId)
      .where('is_active', '=', true)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * Existing categories whose names are close to any of `candidates`, for the import's
   * near-duplicate warning (`importing_data.md` §5.3 stage 7).
   *
   * **This one is a sequential scan on purpose, and that decision has an expiry.** There is no
   * trigram index on `categories.name` because the table is a dozen rows against several
   * thousand products — the index would cost more to maintain than the scan costs to run. The
   * products query next door does the opposite for the same reason pointed the other way.
   *
   * The condition, so it can be rechecked rather than assumed: this holds while `categories`
   * stays in the low thousands. Past that, add `gin (name gin_trgm_ops)` and switch the join to
   * `%` as `ProductsRepository.findSimilarNames` does. Nothing here will notice on its own — an
   * import would just get quietly slower, which is the least visible kind of regression.
   */
  async findSimilarNames(
    candidates: string[],
    threshold: number,
  ): Promise<{ candidate: string; id: string; name: string; score: number }[]> {
    if (candidates.length === 0) return [];

    const rows = await sql<{ candidate: string; id: string; name: string; score: number }>`
      SELECT c.candidate, cat.id, cat.name, similarity(cat.name, c.candidate)::float8 AS score
      FROM unnest(${sql.val(candidates)}::text[]) AS c(candidate)
      JOIN categories cat ON similarity(cat.name, c.candidate) >= ${sql.val(threshold)}
      WHERE lower(btrim(cat.name)) <> lower(btrim(c.candidate))
      ORDER BY score DESC, cat.name
    `.execute(this.db);

    return rows.rows;
  }
}

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  is_trackable: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  product_count: number | null;
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    isTrackable: row.is_trackable,
    isActive: row.is_active,
    productCount: Number(row.product_count ?? 0),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
