import { z } from 'zod';
import { AUDIT_ACTIONS, auditActionSchema } from '../contracts/audit.js';

/**
 * The registry of every business value that an admin may change at runtime.
 *
 * A value belongs here — not in code, not in env at the point of use — whenever someone could
 * reasonably want it different next quarter (rules/10-no-hardcoding.md). Env only supplies the
 * *first boot* seed; after that the `app_settings` row owns the value, which is what makes
 * requirements §11 ("threshold changeable without a redeploy") possible.
 *
 * Adding a setting: add an entry here, add its env var to the config schema under the same
 * `seedEnvVar` name. Nothing else needs to change — the seeder and admin UI are data-driven.
 */

export const SettingKey = {
  EXPENSE_THRESHOLD_BDT: 'EXPENSE_THRESHOLD_BDT',
  APPROVER_SLOTS_BELOW_THRESHOLD: 'APPROVER_SLOTS_BELOW_THRESHOLD',
  APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD: 'APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD',
  /**
   * Phase 05: a single admin-designated approver handles all sub-threshold requisitions
   * (`requestedAmount < EXPENSE_THRESHOLD_BDT`). `null` means "not configured yet" —
   * submitting a sub-threshold requisition then refuses with 409 until the admin picks
   * someone.
   */
  SUBTHRESHOLD_APPROVER_USER_ID: 'SUBTHRESHOLD_APPROVER_USER_ID',
  /**
   * Phase 06: which actions the audit log actually records. Everything in
   * `AUDIT_ALWAYS_ON_ACTIONS` is recorded regardless of what this contains. Reconciled at boot
   * against `InternalSettingKey.AUDIT_KNOWN_ACTIONS`, which is what lets a newly shipped action
   * turn itself on without also resurrecting one an admin turned off.
   */
  AUDIT_ENABLED_ACTIONS: 'AUDIT_ENABLED_ACTIONS',
  /**
   * Phase 06: how many days of audit history to keep. `0` means keep forever, and is the
   * default — deleting history is opt-in, never something an upgrade does on its own.
   */
  AUDIT_RETENTION_DAYS: 'AUDIT_RETENTION_DAYS',
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

/**
 * Rows the system writes to `app_settings` for its own bookkeeping.
 *
 * Deliberately **not** members of `SettingKey`: nobody administers these. Keeping them out of
 * the registry is what makes them invisible without a special case anywhere — `isSettingKey`
 * is false, so `SettingsService.list()` skips the row, `PUT /admin/settings` rejects one with a
 * 400 from `updateSettingSchema`'s `z.enum(SETTING_KEYS)` before the request body is even
 * accepted (never reaching `set()`, so `UNKNOWN_SETTING` is not involved), and the admin panel
 * (which renders whatever `list()` returns) cannot offer one as a toggle. They also have no
 * `seedEnvVar`, because they describe what the *code* knew, which env has nothing to say about.
 */
export const InternalSettingKey = {
  /**
   * The `AUDIT_ACTIONS` members the system knew about the last time `AUDIT_ENABLED_ACTIONS`
   * was reconciled. Without it, "absent from the enabled list because this release introduced
   * it" and "absent because an admin switched it off" are the same stored state, and boot
   * would have to guess — which meant undoing the admin's choice on every restart.
   */
  AUDIT_KNOWN_ACTIONS: 'AUDIT_KNOWN_ACTIONS',
} as const;

export type InternalSettingKey = (typeof InternalSettingKey)[keyof typeof InternalSettingKey];

/** Anything that may legitimately appear in `app_settings.key`. */
export type AppSettingKey = SettingKey | InternalSettingKey;

/**
 * How the two audit action lists are read back out of `app_settings.value`.
 *
 * `z.string()` rather than `auditActionSchema` on purpose: a release that *retires* an action
 * leaves the retired member sitting in the stored row, and rejecting the whole array over it
 * would turn boot reconciliation into a boot crash. An unrecognised member is harmless — it
 * can only ever fail to match a current action.
 */
export const storedAuditActionsSchema = z.array(z.string());
export type StoredAuditActions = z.infer<typeof storedAuditActionsSchema>;

export type SettingKind = 'currency_bdt' | 'integer' | 'uuid' | 'audit_actions' | 'days';

/**
 * Retention policies the admin UI presents for `AUDIT_RETENTION_DAYS`. `0` keeps the historical
 * "do not purge" contract, which the nightly retention job (`pruneAuditLog`) reads as a
 * short-circuit. The other values are an explicit preset list so an admin cannot type a value
 * (e.g. `7`) the retention job would honour but that has no UI label.
 */
export interface RetentionPreset {
  /** Wire value persisted in `app_settings.value` and consumed by `pruneAuditLog`. */
  readonly days: number;
  /** Display label for the admin dropdown. */
  readonly label: string;
}

export const AUDIT_RETENTION_PRESETS: readonly RetentionPreset[] = [
  { days: 5, label: '5 days' },
  { days: 10, label: '10 days' },
  { days: 15, label: '15 days' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
  { days: 1095, label: '3 years' },
  { days: 1825, label: '5 years' },
  { days: 3650, label: '10 years' },
  { days: 0, label: 'Forever' },
] as const;

/** Type guard for the preset values — useful when the wire type is `number`. */
export function isRetentionPresetValue(value: number): value is (typeof AUDIT_RETENTION_PRESETS)[number]['days'] {
  return AUDIT_RETENTION_PRESETS.some((preset) => preset.days === value);
}

export interface SettingDefinition<T> {
  readonly key: SettingKey;
  /** Parses both the env seed (after JSON coercion) and any admin-supplied update. */
  readonly schema: z.ZodType<T>;
  /** Which env var seeds this on a fresh install. */
  readonly seedEnvVar: string;
  /** Drives the input control the admin panel renders. */
  readonly kind: SettingKind;
  /** i18n key for the label shown in the admin panel. */
  readonly labelKey: string;
}

const definitions = {
  [SettingKey.EXPENSE_THRESHOLD_BDT]: {
    key: SettingKey.EXPENSE_THRESHOLD_BDT,
    schema: z.number().int().nonnegative(),
    seedEnvVar: 'SETTING_EXPENSE_THRESHOLD_BDT',
    kind: 'currency_bdt',
    labelKey: 'expenseThreshold',
  },
  // OPEN QUESTION: OQ-01 — below the threshold we assume a single approver.
  //
  // Phase 05: deprecated for new installs. The sub-threshold approver is now an explicit
  // single user (`SUBTHRESHOLD_APPROVER_USER_ID`); the count here is only consulted as a
  // safety net if that user is null. Kept in the registry so existing admin panel builds
  // and prior settings rows keep working until the row is migrated out.
  [SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD]: {
    key: SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD,
    schema: z.number().int().min(1).max(2),
    seedEnvVar: 'SETTING_APPROVER_SLOTS_BELOW_THRESHOLD',
    kind: 'integer',
    labelKey: 'approverSlotsBelow',
  },
  [SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD]: {
    key: SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD,
    schema: z.number().int().min(1).max(2),
    seedEnvVar: 'SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD',
    kind: 'integer',
    labelKey: 'approverSlotsAtOrAbove',
  },
  /**
   * The single approver assigned to all sub-threshold requisitions. Previously the system
   * used `APPROVER_SLOTS_BELOW_THRESHOLD` (a count) + `approver_slots` slot 1, which made
   * "below the threshold" share slot 1 with "above the threshold" — confusing and brittle
   * once an admin reassigns slot 1.
   */
  [SettingKey.SUBTHRESHOLD_APPROVER_USER_ID]: {
    key: SettingKey.SUBTHRESHOLD_APPROVER_USER_ID,
    // Treat both `null` and the empty string as "not configured" so the first-boot seed
    // (SETTING_SUBTHRESHOLD_APPROVER_USER_ID="") works without a migration to insert null.
    schema: z
      .union([z.literal(''), z.string().uuid(), z.null()])
      .transform((value) => (value === '' || value === null ? null : value))
      .nullable(),
    seedEnvVar: 'SETTING_SUBTHRESHOLD_APPROVER_USER_ID',
    kind: 'uuid',
    labelKey: 'subthresholdApprover',
  },
  /**
   * The set of actions the audit log records. Seeded from env as a comma-separated list; the
   * empty string seeds "everything", which is what a fresh install wants.
   *
   * Note this is a *recording* control, not a filter — a disabled action leaves no row at all,
   * so turning one back on does not recover the entries missed while it was off. The always-on
   * set (`AUDIT_ALWAYS_ON_ACTIONS`) is enforced in `SettingsService`, not here, because the
   * schema's job is shape and the invariant is policy.
   */
  [SettingKey.AUDIT_ENABLED_ACTIONS]: {
    key: SettingKey.AUDIT_ENABLED_ACTIONS,
    schema: z
      .union([z.literal(''), z.null(), z.array(auditActionSchema)])
      .transform((value) =>
        value === '' || value === null ? [...AUDIT_ACTIONS] : value,
      ),
    seedEnvVar: 'SETTING_AUDIT_ENABLED_ACTIONS',
    kind: 'audit_actions',
    labelKey: 'auditEnabledActions',
  },
  /**
   * Days of audit history to keep. `0` disables the purge entirely and is the default — this
   * system's standing requirement is that no data is lost, so history is only ever deleted
   * because an admin deliberately asked for it. Non-zero values are restricted to the explicit
   * preset list above so the UI label always matches the persisted value, and so a stray
   * integer from a future hand-edited DB row cannot silently change retention behaviour.
   */
  [SettingKey.AUDIT_RETENTION_DAYS]: {
    key: SettingKey.AUDIT_RETENTION_DAYS,
    schema: z
      .number()
      .int()
      .min(0)
      .refine(isRetentionPresetValue, {
        message: 'Retention must be one of the presets (5/10/15 days, 1/3/6 months, 1/3/5/10 years, or Forever)',
      }),
    seedEnvVar: 'SETTING_AUDIT_RETENTION_DAYS',
    kind: 'days',
    labelKey: 'auditRetentionDays',
  },
} as const satisfies Record<SettingKey, SettingDefinition<unknown>>;

export const SETTING_DEFINITIONS = definitions;

/** The value type of a given setting, inferred from its schema. */
export type SettingValue<K extends SettingKey> = z.infer<(typeof definitions)[K]['schema']>;

export const SETTING_KEYS = Object.keys(definitions) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return Object.prototype.hasOwnProperty.call(definitions, value);
}

export function getSettingDefinition<K extends SettingKey>(key: K): (typeof definitions)[K] {
  return definitions[key];
}
