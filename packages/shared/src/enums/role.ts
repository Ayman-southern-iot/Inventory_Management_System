import { z } from 'zod';

/**
 * Roles are additive: a user holds a *set*, not one. Everyone can borrow and raise
 * requisitions; an approver is a general user with approval rights on top.
 * Mirrors the Postgres enum `user_role` — changing either requires a migration.
 */
export const Role = {
  GENERAL: 'GENERAL',
  APPROVER: 'APPROVER',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  ADMIN: 'ADMIN',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ROLE_VALUES = Object.values(Role) as [Role, ...Role[]];

export const roleSchema = z.enum(ROLE_VALUES);

/** Every user implicitly holds GENERAL; the admin UI never lets it be removed. */
export const BASE_ROLE: Role = Role.GENERAL;
