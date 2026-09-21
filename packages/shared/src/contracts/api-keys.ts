import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common.js';

/**
 * API keys — a credential issued to a *system* rather than a person (Phase 10).
 *
 * The shape an integrator sees is deliberately small: they get a key, they get a list of
 * endpoints it opens, and nothing else. The admin sees a little more, but never the key itself
 * after the moment it is created.
 */

/**
 * What a key is allowed to reach. One member for now, by Ayman's decision (K2): products,
 * categories and locations. Not borrowing, which names employees, and not requisitions or
 * expenses, which are the money.
 *
 * Widening this is a migration, not a config change, because the Postgres enum has to learn the
 * member too. That is the correct cost for widening what a credential can read.
 */
export const ApiKeyScope = {
  INVENTORY_READ: 'inventory:read',
} as const;
export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export const apiKeyScopeSchema = z.nativeEnum(ApiKeyScope);

/**
 * Every issued key starts with this. It is load-bearing in three places, which is why it lives
 * here rather than being spelled out in each of them:
 *
 *  - the auth guard tells a key from a JWT by it, before doing any work;
 *  - the rate limiter picks the key ceiling by it, straight off the raw header, so the choice
 *    cannot depend on which global guard happens to run first;
 *  - secret scanners key off a recognisable prefix, which is how a leaked key in a public repo
 *    gets noticed by someone other than the person exploiting it.
 */
export const API_KEY_TOKEN_PREFIX = 'ims_';

/**
 * A key as the admin list shows it. There is no `token` field and there never will be — the
 * database holds only a hash, so this is everything the server itself can still say about it.
 */
export const apiKeySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** A fragment of the key, so two rows can be told apart. Not a secret and not usable. */
  keyPrefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  isActive: z.boolean(),
  /** Null means it never expires (K6). */
  expiresAt: z.string().nullable(),
  /** Null until the key is first used. Stamped at most once per touch interval, not per call. */
  lastUsedAt: z.string().nullable(),
  createdById: uuidSchema,
  createdByName: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  /** Derived, not stored: expired is a function of the clock, not a state somebody sets. */
  isExpired: z.boolean(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

/**
 * The one and only response that carries the raw key. Returned from `POST /admin/api-keys` and
 * never obtainable again — the admin UI shows it once and warns before it is dismissed.
 */
export const createdApiKeySchema = z.object({
  key: apiKeySchema,
  /** The full secret, e.g. `ims_xxxxxxxx…`. Shown once. Not recoverable. */
  token: z.string(),
});
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

/** Offered as buttons in the UI; `null` is "never". Free-form days are allowed too. */
export const API_KEY_EXPIRY_PRESET_DAYS = [30, 90, 365] as const;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(apiKeyScopeSchema).min(1),
  /**
   * How many days the key lives. `null` means forever, which Ayman asked for explicitly — some
   * integrations outlive the person who set them up. The UI defaults to 90 so that forever is a
   * choice somebody made rather than the value they got by not choosing.
   */
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/** Enable or disable. Revoking is a DELETE, because it cannot be undone. */
export const updateApiKeySchema = z.object({
  isActive: z.boolean(),
});
export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;

export const listApiKeysQuerySchema = paginationQuerySchema.extend({
  includeRevoked: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((value) => value === true || value === 'true')
    .default(false),
});
export type ListApiKeysQuery = z.infer<typeof listApiKeysQuerySchema>;

/* ------------------------------------------------------------------ generated usage docs */

/**
 * One endpoint a key can call, as discovered from the live route table.
 *
 * This exists so the admin page can tell an integrator how to use their key without anybody
 * reading the codebase — Ayman's actual ask (K7). It is *derived*, never written by hand: a
 * route gains `@ApiKeyScopes` and appears here, a route loses it and disappears. Hand-written
 * docs would be wrong the first time somebody renames a query parameter.
 */
export const apiEndpointDocSchema = z.object({
  method: z.string(),
  /** Path relative to the API root, e.g. `/products`. */
  path: z.string(),
  scope: apiKeyScopeSchema,
  summary: z.string(),
  /** Query parameters the route's zod schema accepts, if any. */
  queryParams: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
    }),
  ),
});
export type ApiEndpointDoc = z.infer<typeof apiEndpointDocSchema>;

export const apiKeyUsageDocSchema = z.object({
  /** The path the API is mounted at, e.g. `/api/v1`. The host comes from the browser. */
  basePath: z.string(),
  /** The header an integrator sets. Named here so the instructions cannot drift from the guard. */
  authHeader: z.string(),
  tokenPrefix: z.string(),
  /** Requests per minute a key is allowed, from config. */
  rateLimitPerMinute: z.number().int(),
  /** The `limit` ceiling on any paginated endpoint. */
  maxPageSize: z.number().int(),
  endpoints: z.array(apiEndpointDocSchema),
});
export type ApiKeyUsageDoc = z.infer<typeof apiKeyUsageDocSchema>;
