import { z } from 'zod';

export const uuidSchema = z.string().uuid();

/** Every list endpoint is paginated (rules/40-database.md). */
export const PAGINATION_DEFAULT_LIMIT = 25;
export const PAGINATION_MAX_LIMIT = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}
