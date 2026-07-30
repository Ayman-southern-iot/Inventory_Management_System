import { z } from 'zod';
import { roleSchema } from '../enums/role.js';

/**
 * Password policy lives here so the login form, the admin "create user" form and the API all
 * enforce exactly one rule (rules/30-frontend.md — a client-only validation rule is a bug).
 *
 * Length only, minimum 4, no composition requirement — set by the operator on 2026-07-30
 * (OQ-17). That is roughly 1.7 million combinations: crackable instantly offline if the database
 * is ever taken, and guessable online in minutes against an unprotected endpoint.
 *
 * What makes it survivable is entirely outside this file: `/auth/login` is capped per IP by the
 * global throttler, `LoginThrottleService` caps attempts per email, and passwords are hashed with
 * a deliberate work factor. **Those three are now the whole defence.** Weakening any of them
 * turns an accepted trade-off into a real hole.
 */
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const emailSchema = z.string().trim().toLowerCase().email().max(255);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** The authenticated identity the SPA renders its navigation from. */
export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  designation: z.string(),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  roles: z.array(roleSchema),
  mustChangePassword: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Seconds until the access token expires; the client refreshes ahead of this. */
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const loginResponseSchema = authTokensSchema.extend({ user: authUserSchema });
export type LoginResponse = z.infer<typeof loginResponseSchema>;
