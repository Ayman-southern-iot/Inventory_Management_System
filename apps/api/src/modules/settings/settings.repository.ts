import { Inject, Injectable } from '@nestjs/common';
import type { SettingKey } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

export interface SettingRow {
  key: SettingKey;
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
      key: r.key as SettingKey,
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

  async upsert(key: SettingKey, value: unknown, updatedBy: string | null): Promise<void> {
    await this.db
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
}
