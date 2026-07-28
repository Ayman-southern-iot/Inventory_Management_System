import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { Role, type ListUsersQuery, type User } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database, UserRow } from '../../database/schema';

export type Tx = Transaction<Database>;

export interface UserWithRoles extends UserRow {
  department_name: string | null;
  roles: Role[];
}

/**
 * Roles come back as an aggregated array in the same query rather than a second round trip —
 * a list of 12 users must not be 13 queries (rules/40-database.md, N+1 is a review blocker).
 */
const ROLES_AGG = sql<Role[]>`
  coalesce(
    (select array_agg(ur.role::text order by ur.role) from user_roles ur where ur.user_id = users.id),
    ARRAY[]::text[]
  )
`;

@Injectable()
export class UsersRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private baseSelect(db: Db | Tx = this.db) {
    return db
      .selectFrom('users')
      .leftJoin('departments', 'departments.id', 'users.department_id')
      .select([
        'users.id',
        'users.email',
        'users.password_hash',
        'users.full_name',
        'users.designation',
        'users.department_id',
        'users.is_active',
        'users.must_change_password',
        'users.last_login_at',
        'users.created_at',
        'users.updated_at',
        'departments.name as department_name',
        ROLES_AGG.as('roles'),
      ]);
  }

  async findById(id: string, db: Db | Tx = this.db): Promise<UserWithRoles | undefined> {
    return this.baseSelect(db).where('users.id', '=', id).executeTakeFirst();
  }

  async findByEmail(email: string): Promise<UserWithRoles | undefined> {
    return this.baseSelect().where('users.email', '=', email.toLowerCase()).executeTakeFirst();
  }

  async list(query: ListUsersQuery): Promise<{ items: UserWithRoles[]; total: number }> {
    const offset = (query.page - 1) * query.limit;

    let base = this.db
      .selectFrom('users')
      .leftJoin('departments', 'departments.id', 'users.department_id')
      .$if(!query.includeInactive, (qb) => qb.where('users.is_active', '=', true))
      .$if(query.departmentId !== undefined, (qb) =>
        qb.where('users.department_id', '=', query.departmentId!),
      )
      .$if(query.role !== undefined, (qb) =>
        qb.where((eb) =>
          eb.exists(
            eb
              .selectFrom('user_roles')
              .select('user_roles.user_id')
              .whereRef('user_roles.user_id', '=', 'users.id')
              .where('user_roles.role', '=', query.role!),
          ),
        ),
      );

    if (query.search) {
      const term = `%${query.search.toLowerCase()}%`;
      base = base.where((eb) =>
        eb.or([
          eb(sql`lower(users.full_name)`, 'like', term),
          eb(sql`lower(users.email)`, 'like', term),
          eb(sql`lower(users.designation)`, 'like', term),
        ]),
      );
    }

    const [rows, counted] = await Promise.all([
      base
        .select([
          'users.id',
          'users.email',
          'users.password_hash',
          'users.full_name',
          'users.designation',
          'users.department_id',
          'users.is_active',
          'users.must_change_password',
          'users.last_login_at',
          'users.created_at',
          'users.updated_at',
          'departments.name as department_name',
          ROLES_AGG.as('roles'),
        ])
        .orderBy('users.full_name')
        .limit(query.limit)
        .offset(offset)
        .execute(),
      base.select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirst(),
    ]);

    return { items: rows, total: counted?.count ?? 0 };
  }

  async insert(
    tx: Tx,
    values: {
      email: string;
      passwordHash: string;
      fullName: string;
      designation: string;
      departmentId: string | null;
      mustChangePassword: boolean;
    },
  ): Promise<string> {
    const row = await tx
      .insertInto('users')
      .values({
        email: values.email,
        password_hash: values.passwordHash,
        full_name: values.fullName,
        designation: values.designation,
        department_id: values.departmentId,
        must_change_password: values.mustChangePassword,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async update(
    tx: Tx,
    id: string,
    values: {
      fullName?: string;
      designation?: string;
      departmentId?: string | null;
      isActive?: boolean;
      mustChangePassword?: boolean;
      passwordHash?: string;
    },
  ): Promise<void> {
    const patch = {
      ...(values.fullName === undefined ? {} : { full_name: values.fullName }),
      ...(values.designation === undefined ? {} : { designation: values.designation }),
      ...(values.departmentId === undefined ? {} : { department_id: values.departmentId }),
      ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
      ...(values.mustChangePassword === undefined
        ? {}
        : { must_change_password: values.mustChangePassword }),
      ...(values.passwordHash === undefined ? {} : { password_hash: values.passwordHash }),
    };
    if (Object.keys(patch).length === 0) return;

    await tx.updateTable('users').set(patch).where('id', '=', id).execute();
  }

  /** Replaces the whole role set in one statement pair, inside the caller's transaction. */
  async replaceRoles(tx: Tx, userId: string, roles: readonly Role[]): Promise<void> {
    await tx.deleteFrom('user_roles').where('user_id', '=', userId).execute();
    if (roles.length === 0) return;
    await tx
      .insertInto('user_roles')
      .values(roles.map((role) => ({ user_id: userId, role })))
      .execute();
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.db
      .updateTable('users')
      .set({ last_login_at: sql<Date>`now()` })
      .where('id', '=', userId)
      .execute();
  }

  async countByRole(role: Role): Promise<number> {
    const row = await this.db
      .selectFrom('user_roles')
      .innerJoin('users', 'users.id', 'user_roles.user_id')
      .where('user_roles.role', '=', role)
      .where('users.is_active', '=', true)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  get connection(): Db {
    return this.db;
  }
}

export function toUser(row: UserWithRoles): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    designation: row.designation,
    departmentId: row.department_id,
    departmentName: row.department_name,
    roles: row.roles,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
