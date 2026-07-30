import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Department, ListDepartmentsQuery } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';

export type Tx = Transaction<Database>;

@Injectable()
export class DepartmentsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The user count is a correlated subquery, not a second request per row. */
  private withUserCount() {
    return this.db.selectFrom('departments').select((eb) => [
      'departments.id',
      'departments.name',
      'departments.is_active',
      'departments.created_at',
      eb
        .selectFrom('users')
        .whereRef('users.department_id', '=', 'departments.id')
        .where('users.is_active', '=', true)
        .select((inner) => inner.fn.countAll<number>().as('c'))
        .as('user_count'),
    ]);
  }

  async list(query: ListDepartmentsQuery): Promise<{ items: Department[]; total: number }> {
    const offset = (query.page - 1) * query.limit;

    const rows = await this.withUserCount()
      .$if(!query.includeInactive, (qb) => qb.where('departments.is_active', '=', true))
      .orderBy('departments.name')
      .limit(query.limit)
      .offset(offset)
      .execute();

    const counted = await this.db
      .selectFrom('departments')
      .$if(!query.includeInactive, (qb) => qb.where('is_active', '=', true))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.is_active,
        userCount: Number(r.user_count ?? 0),
        createdAt: r.created_at.toISOString(),
      })),
      total: counted?.count ?? 0,
    };
  }

  async findById(id: string): Promise<Department | undefined> {
    const row = await this.withUserCount().where('departments.id', '=', id).executeTakeFirst();
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      userCount: Number(row.user_count ?? 0),
      createdAt: row.created_at.toISOString(),
    };
  }

  async insert(name: string, tx: Tx): Promise<string> {
    const row = await tx
      .insertInto('departments')
      .values({ name })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async update(
    id: string,
    values: { name?: string; isActive?: boolean },
    tx: Tx,
  ): Promise<number> {
    const patch = {
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
    };
    if (Object.keys(patch).length === 0) return 1;

    const result = await tx
      .updateTable('departments')
      .set(patch)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async countActiveUsers(departmentId: string): Promise<number> {
    const row = await this.db
      .selectFrom('users')
      .where('department_id', '=', departmentId)
      .where('is_active', '=', true)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return row?.count ?? 0;
  }
}
