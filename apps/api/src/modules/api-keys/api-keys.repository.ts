import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { ApiKeyScope } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

/**
 * Rows as stored. Nothing here reaches a client untranslated — `token_hash` in particular must
 * never leave this file, which is why the service maps rather than spreading.
 */
export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  is_active: boolean;
  expires_at: Date | null;
  last_used_at: Date | null;
  created_by: string;
  created_by_name: string;
  created_at: Date;
  revoked_at: Date | null;
}

/** What the auth path needs, and nothing more. No name, no creator, no timestamps. */
export interface ApiKeyAuthRow {
  id: string;
  scopes: ApiKeyScope[];
  is_active: boolean;
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

/**
 * `scopes` cast to `text[]` on the way out, and this is not cosmetic.
 *
 * `node-postgres` ships array parsers for the built-in types but has no idea what an
 * `api_key_scope[]` is, so it hands back the raw literal `"{inventory:read}"` — a **string**
 * that TypeScript has been told is an array. Everything then compiles and mostly works:
 * `scopes.includes('inventory:read')` is true, because `String.prototype.includes` does a
 * substring match. It would be just as true for a key holding `inventory:read:nothing`, and
 * the JSON sent to the browser is a string where the contract promises a list.
 *
 * Casting to `text[]` puts it back on a type pg knows how to parse. Every read of this column
 * goes through here.
 */
const scopesAsArray = sql<ApiKeyScope[]>`api_keys.scopes::text[]`.as('scopes');

@Injectable()
export class ApiKeysRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The hot path: one indexed lookup by hash on every request that presents a key.
   *
   * Deliberately does **not** filter on `is_active` or `expires_at`. The caller needs to tell
   * "no such key" from "disabled" from "expired" to return the right error code, and a query
   * that filters them away collapses all three into a null.
   */
  async findByTokenHash(tokenHash: string): Promise<ApiKeyAuthRow | undefined> {
    return this.db
      .selectFrom('api_keys')
      .select(['id', scopesAsArray, 'is_active', 'expires_at', 'last_used_at', 'revoked_at'])
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst() as Promise<ApiKeyAuthRow | undefined>;
  }

  /**
   * Stamp `last_used_at`, but only if it is already older than the interval.
   *
   * The `WHERE` does the throttling, so a busy integration costs one cheap no-op UPDATE rather
   * than a row write per read. Fire-and-forget at the call site: a failure here must never turn
   * a successful read into an error.
   */
  async touch(id: string, intervalSeconds: number): Promise<void> {
    await this.db
      .updateTable('api_keys')
      .set({ last_used_at: sql<Date>`now()` })
      .where('id', '=', id)
      .where((eb) =>
        eb.or([
          eb('last_used_at', 'is', null),
          eb('last_used_at', '<', sql<Date>`now() - make_interval(secs => ${intervalSeconds})`),
        ]),
      )
      .execute();
  }

  async list(params: {
    limit: number;
    offset: number;
    includeRevoked: boolean;
  }): Promise<{ rows: ApiKeyRow[]; total: number }> {
    let query = this.db
      .selectFrom('api_keys')
      .innerJoin('users', 'users.id', 'api_keys.created_by')
      .select([
        'api_keys.id',
        'api_keys.name',
        'api_keys.key_prefix',
        scopesAsArray,
        'api_keys.is_active',
        'api_keys.expires_at',
        'api_keys.last_used_at',
        'api_keys.created_by',
        'users.full_name as created_by_name',
        'api_keys.created_at',
        'api_keys.revoked_at',
      ]);

    if (!params.includeRevoked) query = query.where('api_keys.revoked_at', 'is', null);

    const rows = (await query
      .orderBy('api_keys.created_at', 'desc')
      .limit(params.limit)
      .offset(params.offset)
      .execute()) as ApiKeyRow[];

    let countQuery = this.db
      .selectFrom('api_keys')
      .select((eb) => eb.fn.countAll<string>().as('count'));
    if (!params.includeRevoked) countQuery = countQuery.where('revoked_at', 'is', null);
    const counted = await countQuery.executeTakeFirst();

    return { rows, total: Number(counted?.count ?? 0) };
  }

  async findById(id: string): Promise<ApiKeyRow | undefined> {
    return this.db
      .selectFrom('api_keys')
      .innerJoin('users', 'users.id', 'api_keys.created_by')
      .select([
        'api_keys.id',
        'api_keys.name',
        'api_keys.key_prefix',
        scopesAsArray,
        'api_keys.is_active',
        'api_keys.expires_at',
        'api_keys.last_used_at',
        'api_keys.created_by',
        'users.full_name as created_by_name',
        'api_keys.created_at',
        'api_keys.revoked_at',
      ])
      .where('api_keys.id', '=', id)
      .executeTakeFirst() as Promise<ApiKeyRow | undefined>;
  }

  async insert(params: {
    name: string;
    keyPrefix: string;
    tokenHash: string;
    scopes: ApiKeyScope[];
    expiresAt: Date | null;
    createdBy: string;
  }): Promise<string> {
    const inserted = await this.db
      .insertInto('api_keys')
      .values({
        name: params.name,
        key_prefix: params.keyPrefix,
        token_hash: params.tokenHash,
        scopes: sql<ApiKeyScope[]>`${params.scopes}::api_key_scope[]`,
        expires_at: params.expiresAt,
        created_by: params.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  }

  /** Enable or disable. A revoked key is excluded, so revocation cannot be undone. */
  async setActive(id: string, isActive: boolean): Promise<boolean> {
    const result = await this.db
      .updateTable('api_keys')
      .set({ is_active: isActive })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  /**
   * Revoke. The row stays — deleting it would lose the audit trail's referent and let the same
   * prefix be issued again. `is_active` goes false in the same statement because the CHECK
   * constraint `api_keys_revoked_is_inactive` refuses the pair otherwise.
   */
  async revoke(id: string, revokedBy: string): Promise<boolean> {
    const result = await this.db
      .updateTable('api_keys')
      .set({ is_active: false, revoked_at: sql<Date>`now()`, revoked_by: revokedBy })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }
}
