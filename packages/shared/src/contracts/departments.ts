import { z } from 'zod';
import { paginationQuerySchema, queryBoolean } from './common.js';

export const departmentNameSchema = z.string().trim().min(1).max(120);

export const createDepartmentSchema = z.object({
  name: departmentNameSchema,
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: departmentNameSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const listDepartmentsQuerySchema = paginationQuerySchema.extend({
  includeInactive: queryBoolean(false),
});
export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuerySchema>;

export const departmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  userCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Department = z.infer<typeof departmentSchema>;
