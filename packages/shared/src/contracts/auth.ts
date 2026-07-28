import { z } from 'zod';
import { roleSchema } from '../enums/role.js';

/**
 * Password policy lives here so the login form, the admin "create user" form and the API all
 * enforce exactly one rule (rules/30-frontend.md — a client-only validation rule is a bug).
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Password must contain an upper case letter, a lower case letter and a digit',
  });

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
