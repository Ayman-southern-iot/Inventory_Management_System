import { z } from 'zod';

export const uuidSchema = z.string().uuid();

/** Every list endpoint is paginated (rules/40-database.md). */
export const PAGINATION_DEFAULT_LIMIT = 25;
export const PAGINATION_MAX_LIMIT = 100;
/**
 * `limit` was clamped but `page` was not, so `?page=100000000` still asked Postgres for
 * `OFFSET 2500000000` plus a full count. Far beyond any real page of a twelve-person tool.
 */
export const PAGINATION_MAX_PAGE = 10_000;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(PAGINATION_MAX_PAGE).default(1),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});

/**
 * Query-string booleans. `z.coerce.boolean()` is unsafe here: any non-empty string
 * (including `"false"`) coerces to `true`, so a SPA that drops a `mine=false`
 * query param into a list request would filter as if the user asked for `mine=true`.
 * Use this instead.
 */
export const queryBoolean = (defaultValue = false) =>
  z
    .union([z.boolean(), z.string()])
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      const normalised = value.trim().toLowerCase();
      if (normalised === 'true' || normalised === '1') return true;
      if (normalised === 'false' || normalised === '0' || normalised === '') return false;
      return defaultValue;
    })
    .default(defaultValue);

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
