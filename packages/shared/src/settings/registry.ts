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
  BOM_OVER_BUDGET_TOLERANCE_PCT: 'BOM_OVER_BUDGET_TOLERANCE_PCT',
  /**
   * Phase 05: a single admin-designated approver handles all sub-threshold requisitions
   * (`requestedAmount < EXPENSE_THRESHOLD_BDT`). `null` means "not configured yet" —
   * submitting a sub-threshold requisition then refuses with 409 until the admin picks
   * someone.
   */
  SUBTHRESHOLD_APPROVER_USER_ID: 'SUBTHRESHOLD_APPROVER_USER_ID',
  /**
   * Phase 06: which actions the audit log actually records. Everything in
   * `AUDIT_ALWAYS_ON_ACTIONS` is recorded regardless of what this contains.
   */
  AUDIT_ENABLED_ACTIONS: 'AUDIT_ENABLED_ACTIONS',
  /**
   * Phase 06: how many days of audit history to keep. `0` means keep forever, and is the
   * default — deleting history is opt-in, never something an upgrade does on its own.
   */
  AUDIT_RETENTION_DAYS: 'AUDIT_RETENTION_DAYS',
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export type SettingKind = 'currency_bdt' | 'integer' | 'uuid' | 'audit_actions' | 'days';

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
   * OPEN QUESTION: OQ-05 — a BOM whose total exceeds the approved amount by more than this
   * percentage goes back for re-approval instead of on to Accounts. The working assumption is
   * yes with a configurable tolerance, which is why this is a setting and not a literal.
   */
  [SettingKey.BOM_OVER_BUDGET_TOLERANCE_PCT]: {
    key: SettingKey.BOM_OVER_BUDGET_TOLERANCE_PCT,
    schema: z.number().int().min(0).max(100),
    seedEnvVar: 'SETTING_BOM_OVER_BUDGET_TOLERANCE_PCT',
    kind: 'integer',
    labelKey: 'bomOverBudgetTolerance',
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
   * Days of audit history to keep. `0` disables the purge entirely and is the default: this
   * system's standing requirement is that no data is lost, so history is only ever deleted
   * because an admin deliberately asked for it. The floor of 30 on any non-zero value stops a
   * typo like `1` from erasing the trail an incident is being investigated from.
   */
  [SettingKey.AUDIT_RETENTION_DAYS]: {
    key: SettingKey.AUDIT_RETENTION_DAYS,
    schema: z
      .number()
      .int()
      .min(0)
      .refine((days) => days === 0 || days >= 30, {
        message: 'Retention must be 0 (keep forever) or at least 30 days',
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
