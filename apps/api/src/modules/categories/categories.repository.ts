import { Inject, Injectable } from '@nestjs/common';
import type { Category } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

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

  async insert(values: {
    name: string;
    parentId: string | null;
    isTrackable: boolean;
  }): Promise<string> {
    const row = await this.db
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
    values: { name?: string; isTrackable?: boolean; isActive?: boolean },
  ): Promise<void> {
    const patch = {
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.isTrackable === undefined ? {} : { is_trackable: values.isTrackable }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
    };
    if (Object.keys(patch).length === 0) return;

    await this.db.updateTable('categories').set(patch).where('id', '=', id).execute();
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
}

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  is_trackable: boolean;
  is_active: boolean;
  created_at: Date;
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
  };
}
