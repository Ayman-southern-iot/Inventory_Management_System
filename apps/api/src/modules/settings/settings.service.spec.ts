import { beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  SETTING_KEYS,
  SettingKey,
  getSettingDefinition,
  type AppSettingKey,
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
const SEED_VALUES: Record<SettingKeyType, number | string | string[] | null> = {
  [SettingKey.EXPENSE_THRESHOLD_BDT]: 20_000,
  [SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD]: 1,
  [SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD]: 2,
  [SettingKey.BOM_OVER_BUDGET_TOLERANCE_PCT]: 10,
  // Phase 05: the sub-threshold approver is `null` until the admin designates one. The
  // service tests only check that the seed round-trips, so an explicit null here keeps the
  // cache-coverage assertions honest.
  [SettingKey.SUBTHRESHOLD_APPROVER_USER_ID]: null,
  // Phase 06. Seeded as "everything recorded" and "keep forever", matching a fresh install.
  [SettingKey.AUDIT_ENABLED_ACTIONS]: [...AUDIT_ACTIONS],
  [SettingKey.AUDIT_RETENTION_DAYS]: 0,
};

const ACTOR_ID = 'actor-id';

const ACTOR_CONTEXT = {
  actorId: ACTOR_ID,
  actorName: null,
  actorEmail: null,
  actorRoles: [],
  requestMethod: null,
  requestPath: null,
  requestIp: null,
  userAgent: null,
};

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

  // Widened to `AppSettingKey`, matching `SettingsRepository.upsert` post-KNOWN-set: the
  // service also writes `InternalSettingKey.AUDIT_KNOWN_ACTIONS` through this method, which is
  // not a `SettingKey`. Narrower here would be a fake lying about the interface it stands in for.
  async upsert(key: AppSettingKey, value: unknown, updatedBy: string | null): Promise<void> {
    this.rows.set(key, { value, updatedBy });
  }

  /**
   * `set()` now writes the row and its audit entry in one transaction, so the fake has to
   * offer the same shape. The callback runs immediately against this same in-memory store —
   * there is nothing to isolate, and the transaction semantics themselves are covered by the
   * integration suite against a real Postgres.
   */
  get connection() {
    return {
      transaction: () => ({
        execute: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(undefined),
      }),
    };
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
    // `clearEnabledActionsCache` is not optional: both `set()` and the boot reconciliation call
    // it, and a fake missing it fails with a TypeError rather than a useful assertion the first
    // time a test drives AUDIT_ENABLED_ACTIONS through either path.
    const fakeAudit = {
      record: async () => undefined,
      recordFailure: async () => undefined,
      clearEnabledActionsCache: () => undefined,
    } as never;
    service = new SettingsService(
      repo as unknown as SettingsRepository,
      configWithSeeds(),
      fakeAudit as never,
    );
    await service.onModuleInit();
  });

  it('seeds every registered key from the config seeds on first boot', async () => {
    for (const key of SETTING_KEYS) {
      // Deep equality, not identity: AUDIT_ENABLED_ACTIONS seeds an array.
      expect(await service.get(key)).toStrictEqual(SEED_VALUES[key]);
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

    await service.set(SettingKey.EXPENSE_THRESHOLD_BDT, next, ACTOR_CONTEXT);

    expect(await service.get(SettingKey.EXPENSE_THRESHOLD_BDT)).toBe(next);
  });

  it('invalidates only the key that changed, leaving the rest cached', async () => {
    await service.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD);
    await service.set(SettingKey.EXPENSE_THRESHOLD_BDT, 31_000, ACTOR_CONTEXT);

    expect(await service.get(SettingKey.EXPENSE_THRESHOLD_BDT)).toBe(31_000);
    expect(await service.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD)).toBe(
      SEED_VALUES[SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD],
    );
  });

  it('rejects an unknown key rather than creating a setting nobody declared', async () => {
    await expect(service.set('EXPENSE_THRESHOLD_USD', 1, ACTOR_CONTEXT)).rejects.toMatchObject({
      code: 'UNKNOWN_SETTING',
    });
  });

  it('rejects a value that violates the setting`s own schema', async () => {
    await expect(
      service.set(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD, 9, ACTOR_CONTEXT),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // And the stored value is untouched.
    expect(await service.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD)).toBe(
      SEED_VALUES[SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD],
    );
  });

  it('accepts every AUDIT_RETENTION_DAYS preset and round-trips it', async () => {
    for (const days of [5, 10, 15, 30, 90, 180, 365, 1095, 1825, 3650, 0]) {
      await service.set(SettingKey.AUDIT_RETENTION_DAYS, days, ACTOR_CONTEXT);
      expect(await service.get(SettingKey.AUDIT_RETENTION_DAYS)).toBe(days);
    }
  });

  it('rejects an AUDIT_RETENTION_DAYS value outside the preset list', async () => {
    // 0 (forever) and the preset values pass; everything else is refused.
    for (const days of [1, 7, 14, 29, 45, 100, -1, 1.5, NaN]) {
      await expect(
        service.set(SettingKey.AUDIT_RETENTION_DAYS, days, ACTOR_CONTEXT),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    // Stored value stays at the seed (0 = forever).
    expect(await service.get(SettingKey.AUDIT_RETENTION_DAYS)).toBe(0);
  });
});
