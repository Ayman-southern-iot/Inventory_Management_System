import { z } from 'zod';
import { SETTING_KEYS, type SettingKey, getSettingDefinition } from '../settings/registry.js';

export const settingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

/**
 * The value is validated against the *specific* setting's schema, not a generic `unknown`,
 * so the API can never store a string where an integer belongs.
 */
export const updateSettingSchema = z
  .object({
    key: settingKeySchema,
    value: z.unknown(),
  })
  .superRefine((input, ctx) => {
    const result = getSettingDefinition(input.key).schema.safeParse(input.value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ['value', ...issue.path] });
      }
    }
  });
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;

export const settingSchema = z.object({
  key: settingKeySchema,
  value: z.unknown(),
  // Drives the control the admin panel renders. `audit_actions` is a multi-select over
  // AUDIT_ACTIONS; `days` is an integer with a "0 = keep forever" affordance.
  kind: z.enum(['currency_bdt', 'integer', 'uuid', 'audit_actions', 'days']),
  labelKey: z.string(),
  updatedAt: z.string(),
  updatedByName: z.string().nullable(),
});
export type Setting = z.infer<typeof settingSchema>;

export const APPROVER_SLOT_NUMBERS = [1, 2] as const;
export const approverSlotNumberSchema = z.union([z.literal(1), z.literal(2)]);

/**
 * OPEN QUESTION: OQ-02 — approver slots default globally and may be overridden per department.
 * A row with `departmentId: null` is the company-wide default.
 */
export const setApproverSlotSchema = z.object({
  departmentId: z.string().uuid().nullable(),
  slotNo: approverSlotNumberSchema,
  userId: z.string().uuid().nullable(),
});
export type SetApproverSlotInput = z.infer<typeof setApproverSlotSchema>;

export const approverSlotSchema = z.object({
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  slotNo: approverSlotNumberSchema,
  userId: z.string().uuid().nullable(),
  userName: z.string().nullable(),
  /**
   * Whether the user holding this slot is currently active. A `false` here means the slot
   * exists with a `userId` but the user is deactivated, so submitting a requisition will
   * be refused until the admin re-assigns the slot or re-activates the user. Surfaced to
   * the admin panel so the stale-slot bug is visible without trying to submit.
   */
  isActive: z.boolean().nullable(),
});
export type ApproverSlot = z.infer<typeof approverSlotSchema>;
