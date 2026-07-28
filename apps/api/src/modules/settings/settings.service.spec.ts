import { beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  SETTING_KEYS,
  SettingKey,
  getSettingDefinition,
  type SettingKey as SettingKeyType,
} from '@ims/shared';
import type { AppConfig } from '../../config';
import { SettingsService } from './settings.service';
import type { SettingRow, SettingsRepository } from './settings.repository';

/**
 * Plan 0.4's acceptance criterion is "changing the expense threshold takes effect without a
 * restart". The cache is what could break that, so this spec drives the cache directly with an
 * in-memory repository: no database, no fake timers, and no waiting out the 30s TTL.
 */
const SEED_VALUES: Record<SettingKeyType, number> = {
  [SettingKey.EXPENSE_THRESHOLD_BDT]: 20_000,
  [SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD]: 1,
  [SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD]: 2,
};

const ACTOR_ID = 'actor-id';

/** Records reads so a test can prove a value came from the cache rather than the store. */
class FakeSettingsRepository {
  readonly rows = new Map<string, { value: unknown; updatedBy: string | null }>();
  findAllCalls = 0;

  async findAll(): Promise<SettingRow[]> {
    this.findAllCalls += 1;
    return [...this.rows.entries()].map(([key, row]) => ({
      key: key as SettingKeyType,
      value: row.value,
      updatedAt: new Date(),
      updatedByName: row.updatedBy,
    }));
  }

  async insertIfAbsent(key: SettingKeyType, value: unknown): Promise<boolean> {
    if (this.rows.has(key)) return false;
    this.rows.set(key, { value, updatedBy: null });
    return true;
  }

  async upsert(key: SettingKeyType, value: unknown, updatedBy: string | null): Promise<void> {
    this.rows.set(key, { value, updatedBy });
  }

  /** Writes behind the service's back, the way another process would. */
  writeDirectly(key: SettingKeyType, value: unknown): void {
    this.rows.set(key, { value, updatedBy: null });
  }
}

function configWithSeeds(): AppConfig {
  const settingSeeds: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    settingSeeds[getSettingDefinition(key).seedEnvVar] = SEED_VALUES[key];
  }
  return { settingSeeds } as unknown as AppConfig;
}

describe('SettingsService', () => {
  let repo: FakeSettingsRepository;
  let service: SettingsService;

  // The seeder logs a line per setting per test; that is 21 lines of noise around 7 assertions.
  Logger.overrideLogger(false);

  beforeEach(async () => {
    repo = new FakeSettingsRepository();
    service = new SettingsService(repo as unknown as SettingsRepository, configWithSeeds());
    await service.onModuleInit();
  });

  it('seeds every registered key from the config seeds on first boot', async () => {
    for (const key of SETTING_KEYS) {
      expect(await service.get(key)).toBe(SEED_VALUES[key]);
    }
  });

  it('never overwrites a value that already exists in the store', async () => {
    repo.writeDirectly(SettingKey.EXPENSE_THRESHOLD_BDT, 42_000);

    await service.seedMissing();
    service.clearCache();

    expect(await service.get(SettingKey.EXPENSE_THRESHOLD_BDT)).toBe(42_000);
  });

  it('really does cache — a write behind its back is not observed', async () => {
    expect(await service.get(SettingKey.EXPENSE_THRESHOLD_BDT)).toBe(
      SEED_VALUES[SettingKey.EXPENSE_THRESHOLD_BDT],
    );

    repo.writeDirectly(SettingKey.EXPENSE_THRESHOLD_BDT, 99_000);

    // Still the cached value: this is what makes the invalidation test below meaningful.
    expect(await service.get(SettingKey.EXPENSE_THRESHOLD_BDT)).toBe(
      SEED_VALUES[SettingKey.EXPENSE_THRESHOLD_BDT],
    );
  });

  it('makes a set() visible to the next get() without waiting out the TTL (plan 0.4)', async () => {
    const before = await service.get(SettingKey.EXPENSE_THRESHOLD_BDT);
    const next = before + 5_000;

    await service.set(SettingKey.EXPENSE_THRESHOLD_BDT, next, ACTOR_ID);

    expect(await service.get(SettingKey.EXPENSE_THRESHOLD_BDT)).toBe(next);
  });

  it('invalidates only the key that changed, leaving the rest cached', async () => {
    await service.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD);
    await service.set(SettingKey.EXPENSE_THRESHOLD_BDT, 31_000, ACTOR_ID);

    expect(await service.get(SettingKey.EXPENSE_THRESHOLD_BDT)).toBe(31_000);
    expect(await service.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD)).toBe(
      SEED_VALUES[SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD],
    );
  });

  it('rejects an unknown key rather than creating a setting nobody declared', async () => {
    await expect(service.set('EXPENSE_THRESHOLD_USD', 1, ACTOR_ID)).rejects.toMatchObject({
      code: 'UNKNOWN_SETTING',
    });
  });

  it('rejects a value that violates the setting`s own schema', async () => {
    await expect(
      service.set(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD, 9, ACTOR_ID),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // And the stored value is untouched.
    expect(await service.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD)).toBe(
      SEED_VALUES[SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD],
    );
  });
});
