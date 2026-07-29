import { z } from 'zod';

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
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export type SettingKind = 'currency_bdt' | 'integer';

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
