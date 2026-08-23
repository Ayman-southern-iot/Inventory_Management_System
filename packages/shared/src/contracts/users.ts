import { z } from 'zod';
import { roleSchema, type Role, BASE_ROLE } from '../enums/role.js';
import { emailSchema, passwordSchema } from './auth.js';
import { paginationQuerySchema, queryBoolean } from './common.js';

/** Prints on the BOM footprint block, so it is required and must be meaningful. */
export const designationSchema = z.string().trim().min(2).max(120);
export const fullNameSchema = z.string().trim().min(2).max(160);

/**
 * Roles are additive and GENERAL is implicit for everyone, so the set is normalised rather than
 * rejected — the admin UI never offers GENERAL as a removable checkbox.
 */
export const roleSetSchema = z
  .array(roleSchema)
  .max(4)
  .transform((roles) => Array.from(new Set([BASE_ROLE, ...roles])).sort())
  .pipe(z.array(roleSchema).min(1));

export const createUserSchema = z.object({
  email: emailSchema,
  fullName: fullNameSchema,
  designation: designationSchema,
  departmentId: z.string().uuid().nullable().default(null),
  roles: roleSetSchema,
  password: passwordSchema,
  /** Forces a password change on first login; the admin never keeps knowing the password. */
  mustChangePassword: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: fullNameSchema.optional(),
  designation: designationSchema.optional(),
  departmentId: z.string().uuid().nullable().optional(),
  roles: roleSetSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserActiveSchema = z.object({
  isActive: z.boolean(),
});
export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>;

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
  mustChangePassword: z.boolean().default(true),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(160).optional(),
  role: roleSchema.optional(),
  departmentId: z.string().uuid().optional(),
  includeInactive: queryBoolean(false),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/**
 * The picker feed (D-023 / OQ-29). Deliberately a *different* contract from `listUsersQuery`
 * rather than a relaxation of it: this one is readable by approvers and the IM, so its
 * projection is the constraint that matters and must not drift into the admin one.
 *
 * `includeInactive` is absent on purpose — a picker offering someone who cannot act is a
 * dead end — and so is `departmentId`, which neither the delegate nor the borrow-to-user
 * picker filters by.
 */
export const selectableUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(160).optional(),
  role: roleSchema.optional(),
});
export type SelectableUsersQuery = z.infer<typeof selectableUsersQuerySchema>;

/**
 * Exactly the two fields `ApprovalTracker` already renders to any approver, and nothing else.
 * No email, no roles, no department, no `lastLoginAt` — the endpoint is a name picker, and a
 * field nobody asked for is a field nobody notices leaking.
 */
export const selectableUserSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  designation: z.string(),
});
export type SelectableUser = z.infer<typeof selectableUserSchema>;

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  designation: z.string(),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  roles: z.array(roleSchema),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

export function hasRole(roles: readonly Role[], role: Role): boolean {
  return roles.includes(role);
}
