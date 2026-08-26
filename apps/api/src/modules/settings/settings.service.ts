import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  AUDIT_ALWAYS_ON_ACTIONS,
  InternalSettingKey,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SettingKey,
  getSettingDefinition,
  isSettingKey,
  storedAuditActionsSchema,
  type AuditAction,
  type Setting,
  type SettingValue,
  type StoredAuditActions,
} from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { UnknownSettingError, ConflictError, ValidationFailedError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
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
    private readonly audit: AuditService,
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

    await this.unionNewAuditActions();
  }

  /**
   * The one setting that is reconciled on every boot rather than seeded once.
   *
   * Every other key is seed-once-never-overwrite: the row owns the value and an admin's choice
   * survives restarts (rules/10-no-hardcoding.md). `AUDIT_ENABLED_ACTIONS` cannot follow that
   * rule, because its stored value is a *materialised snapshot of a code-level list* — the empty
   * env seed expands to `[...AUDIT_ACTIONS]` as it stood on the day the row was first written.
   * `AuditService` then reads that array as an explicit allow-list, so an action introduced by a
   * later release is absent from the snapshot and is silently never recorded. The "record
   * everything" fallback only fires when the row is missing entirely, which is true only on an
   * install that has never booted.
   *
   * Appending the missing members is therefore the difference between a new audited action
   * working everywhere and working nowhere except a fresh database.
   *
   * What makes the append safe is `AUDIT_KNOWN_ACTIONS`. The enabled list on its own cannot say
   * *why* an action is missing from it, so a second row records the action set the code knew
   * about when the two were last reconciled. Missing **and** unknown means this release
   * introduced it: enable it. Missing but known means an admin switched it off: leave it off,
   * on this restart and every restart after it — a restart never resets a value an admin has
   * since changed (rules/10-no-hardcoding.md).
   *
   * The upgrade case is the subtle one. A database written before `AUDIT_KNOWN_ACTIONS` existed
   * has no such row, and seeding it from `AUDIT_ACTIONS` would declare every action already
   * known and leave the actions this mechanism exists to enable switched off forever. It is
   * seeded from the stored *enabled* list instead, because that array is precisely what the code
   * knew when it was written. The cost is one-off and unavoidable: on that single boot an action
   * an admin disabled before the upgrade still cannot be told apart from one that did not exist
   * yet, so it comes back. From the next boot onwards the distinction is on record.
   */
  private async unionNewAuditActions(): Promise<void> {
    const enabledKey = SettingKey.AUDIT_ENABLED_ACTIONS;
    const rows = await this.repo.findAll();
    const enabled = storedAuditActionsSchema.safeParse(
      rows.find((row) => row.key === enabledKey)?.value,
    );
    const known = storedAuditActionsSchema.safeParse(
      rows.find((row) => row.key === InternalSettingKey.AUDIT_KNOWN_ACTIONS)?.value,
    );

    // An absent or malformed enabled list is read as null by `AuditRepository.readEnabledActions`,
    // which already means "record everything"; writing a list here would narrow that, not widen
    // it. The known set is still recorded below, so the first explicit list an admin saves after
    // this is not mistaken for a pre-upgrade snapshot on the next boot.
    if (enabled.success) {
      const knownActions = new Set(known.success ? known.data : enabled.data);
      const enabledActions = new Set(enabled.data);
      const added = AUDIT_ACTIONS.filter(
        (action) => !knownActions.has(action) && !enabledActions.has(action),
      );

      if (added.length > 0) {
        // `updated_by` stays null: the system is reconciling its own list, and naming a person in
        // the settings audit trail for a change they did not make would be a lie.
        await this.repo.upsert(enabledKey, [...enabled.data, ...added], null);
        this.cache.delete(enabledKey);
        this.audit.clearEnabledActionsCache();
        this.logger.log(
          `Enabled ${added.length} newly introduced audit action(s): ${added.join(', ')}`,
        );
      }
    }

    await this.rememberKnownAuditActions(known.success ? known.data : null);
  }

  /**
   * Records the action set this build ships with, so the next boot can tell a new action from a
   * deliberately disabled one. Written unconditionally after reconciliation — including when
   * nothing was added — because "known" is a property of the code, not of what changed.
   */
  private async rememberKnownAuditActions(stored: StoredAuditActions | null): Promise<void> {
    const storedActions = new Set(stored ?? []);
    const unchanged =
      stored !== null &&
      stored.length === AUDIT_ACTIONS.length &&
      AUDIT_ACTIONS.every((action) => storedActions.has(action));
    // A boot that changes nothing must not touch `updated_at`, or the settings history starts
    // reporting a restart as an event.
    if (unchanged) return;

    await this.repo.upsert(InternalSettingKey.AUDIT_KNOWN_ACTIONS, [...AUDIT_ACTIONS], null);
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

  async set(key: string, value: unknown, context: AuditContext): Promise<Setting> {
    if (!isSettingKey(key)) throw new UnknownSettingError(key);

    const definition = getSettingDefinition(key);
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationFailedError(
        parsed.error.issues.map((i) => ({ path: `value.${i.path.join('.')}`, message: i.message })),
      );
    }

    // An audit log whose subject can stop it recording them is not an audit log. The set of
    // actions is configurable to cut noise, not to let an admin quietly stop recording logins
    // or their own settings changes before doing something they would rather nobody saw.
    if (key === SettingKey.AUDIT_ENABLED_ACTIONS) {
      const enabled = new Set(parsed.data as AuditAction[]);
      const missing = AUDIT_ALWAYS_ON_ACTIONS.filter((action) => !enabled.has(action));
      if (missing.length > 0) {
        throw new ValidationFailedError([
          {
            path: 'value',
            message: `These actions are always recorded and cannot be disabled: ${missing.join(', ')}`,
          },
        ]);
      }
    }

    // Capture the previous value *before* the upsert so the audit row carries a real diff
    // rather than just "someone set X". Without this the admin's only signal is the timestamp.
    let previousValue: unknown = null;
    try {
      previousValue = await this.get(key);
    } catch {
      previousValue = null;
    }

    // One transaction so a setting can never change without the audit row that says who changed
    // it and from what — this is the table that moves the expense threshold.
    await this.repo.connection.transaction().execute(async (tx) => {
      await this.repo.upsert(key, parsed.data, context.actorId ?? null, tx);
      await this.audit.record({
        action: 'settings.update',
        entityType: 'settings',
        entityId: key,
        entityRef: key,
        /**
         * D-031. The before/after pair has always been in `metadata` (and the detail drawer
         * renders it), but the summary said only "Updated setting EXPENSE_THRESHOLD_BDT" — and
         * the summary is the line an auditor scans down. Reconstructing what a financial control
         * was set to on a given date meant opening every row one at a time.
         *
         * The values go in the sentence. `metadata` keeps the structured pair, because the
         * summary is prose and prose is not something to parse.
         */
        summary: `Changed setting ${key} from ${describeSettingValue(previousValue)} to ${describeSettingValue(parsed.data)}`,
        metadata: { before: previousValue, after: parsed.data },
      }, context, tx);
    });

    // Invalidate after the commit, not before: dropping the cache entry while the transaction
    // was still open would let a concurrent reader repopulate it from the pre-update row.
    this.cache.delete(key);
    // AuditService keeps its own copy of this one (it reads app_settings directly to avoid a
    // circular module dependency), so it has to be told.
    if (key === SettingKey.AUDIT_ENABLED_ACTIONS) this.audit.clearEnabledActionsCache();

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

/**
 * A setting value as it should read inside an audit sentence.
 *
 * Kept short deliberately: `AUDIT_ENABLED_ACTIONS` holds every audit action, and spelling all of
 * them into a summary line would bury the one-word settings changes it sits beside. The full
 * value is in `metadata` either way, which is where anything machine-read should look.
 */
function describeSettingValue(value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
