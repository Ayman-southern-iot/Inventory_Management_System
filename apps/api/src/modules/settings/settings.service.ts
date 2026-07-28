import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SettingKey,
  getSettingDefinition,
  isSettingKey,
  type Setting,
  type SettingValue,
} from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { UnknownSettingError, ConflictError, ValidationFailedError } from '../../common/errors';
import { SettingsRepository } from './settings.repository';

/**
 * Cache TTL. Short enough that an admin's change is visible almost immediately across all
 * instances; long enough that a hot path does not query on every read. The write path clears
 * the cache directly, so this only bounds staleness for *other* processes (the worker).
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<SettingKey, CacheEntry>();

  constructor(
    private readonly repo: SettingsRepository,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Seeds any missing setting from env so a fresh install boots with sane values, then never
   * looks at env again — the row owns the value from here on (rules/10-no-hardcoding.md).
   */
  async onModuleInit(): Promise<void> {
    await this.seedMissing();
  }

  async seedMissing(): Promise<void> {
    for (const key of SETTING_KEYS) {
      const definition = getSettingDefinition(key);
      const raw = this.config.settingSeeds[definition.seedEnvVar];
      const parsed = definition.schema.safeParse(raw);

      if (!parsed.success) {
        // The config schema already validated these, so this is a programming error:
        // the registry entry and the config schema have drifted apart.
        throw new Error(
          `Setting ${key} cannot be seeded from ${definition.seedEnvVar}: ` +
            parsed.error.issues.map((i) => i.message).join('; '),
        );
      }

      const inserted = await this.repo.insertIfAbsent(key, parsed.data);
      if (inserted) this.logger.log(`Seeded setting ${key} = ${JSON.stringify(parsed.data)}`);
    }
  }

  /** Typed read. Returns the setting's own value type, not `unknown`. */
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as SettingValue<K>;

    const rows = await this.repo.findAll();
    const now = Date.now();
    for (const row of rows) {
      if (isSettingKey(row.key)) {
        this.cache.set(row.key, { value: row.value, expiresAt: now + CACHE_TTL_MS });
      }
    }

    const entry = this.cache.get(key);
    if (!entry) {
      // The row is missing despite seeding — the database was modified out from under us.
      throw new ConflictError(`Setting ${key} is missing from app_settings. Run pnpm db:seed.`);
    }

    const parsed = getSettingDefinition(key).schema.safeParse(entry.value);
    if (!parsed.success) {
      throw new ConflictError(`Setting ${key} holds a value that is no longer valid`);
    }
    return parsed.data as SettingValue<K>;
  }

  async list(): Promise<Setting[]> {
    const rows = await this.repo.findAll();
    const byKey = new Map(rows.filter((row) => isSettingKey(row.key)).map((row) => [row.key, row]));

    // Registry order, not alphabetical — the threshold is the setting an admin comes here for,
    // and the two slot counts only make sense read after it.
    return SETTING_KEYS.flatMap((key) => {
      const row = byKey.get(key);
      if (!row) return [];
      const definition = getSettingDefinition(key);
      return [
        {
          key,
          value: row.value,
          kind: definition.kind,
          labelKey: definition.labelKey,
          updatedAt: row.updatedAt.toISOString(),
          updatedByName: row.updatedByName,
        },
      ];
    });
  }

  async set(key: string, value: unknown, actorId: string): Promise<Setting> {
    if (!isSettingKey(key)) throw new UnknownSettingError(key);

    const definition = getSettingDefinition(key);
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationFailedError(
        parsed.error.issues.map((i) => ({ path: `value.${i.path.join('.')}`, message: i.message })),
      );
    }

    await this.repo.upsert(key, parsed.data, actorId);
    // Invalidate rather than write through: the row's updated_at comes from the database.
    this.cache.delete(key);

    const updated = (await this.list()).find((s) => s.key === key);
    if (!updated) throw new ConflictError(`Setting ${key} disappeared during update`);
    return updated;
  }

  /** Test seam — lets a spec assert that a write is visible without waiting out the TTL. */
  clearCache(): void {
    this.cache.clear();
  }

  static get definitions(): typeof SETTING_DEFINITIONS {
    return SETTING_DEFINITIONS;
  }
}
