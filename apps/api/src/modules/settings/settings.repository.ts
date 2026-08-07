import { Inject, Injectable } from '@nestjs/common';
import type { AppSettingKey, SettingKey } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Tx } from '../audit/audit.repository';

export interface SettingRow {
  /**
   * Widened beyond `SettingKey` because `app_settings` also holds the system's own bookkeeping
   * rows (`InternalSettingKey`). Callers that mean "an administered setting" narrow with
   * `isSettingKey` — the compiler makes them.
   */
  key: AppSettingKey;
  value: unknown;
  updatedAt: Date;
  updatedByName: string | null;
}

@Injectable()
export class SettingsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(): Promise<SettingRow[]> {
    const rows = await this.db
      .selectFrom('app_settings')
      .leftJoin('users', 'users.id', 'app_settings.updated_by')
      .select([
        'app_settings.key',
        'app_settings.value',
        'app_settings.updated_at',
        'users.full_name as updated_by_name',
      ])
      .orderBy('app_settings.key')
      .execute();

    return rows.map((r) => ({
      key: r.key as AppSettingKey,
      value: r.value,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
    }));
  }

  /**
   * Seeds a key only if it is absent. `ON CONFLICT DO NOTHING` is what makes boot idempotent:
   * once an admin has changed a value, restarting the API must never reset it from env.
   */
  async insertIfAbsent(key: SettingKey, value: unknown): Promise<boolean> {
    const result = await this.db
      .insertInto('app_settings')
      .values({ key, value: JSON.stringify(value) })
      .onConflict((oc) => oc.column('key').doNothing())
      .executeTakeFirst();

    return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
  }

  /**
   * `executor` lets the caller hand in an open transaction so the write and its audit row
   * commit together. Defaults to the pool when there is nothing to join.
   */
  async upsert(
    key: AppSettingKey,
    value: unknown,
    updatedBy: string | null,
    executor: Db | Tx = this.db,
  ): Promise<void> {
    await executor
      .insertInto('app_settings')
      .values({ key, value: JSON.stringify(value), updated_by: updatedBy })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value: JSON.stringify(value),
          updated_by: updatedBy,
        }),
      )
      .execute();
  }

  get connection(): Db {
    return this.db;
  }
}
