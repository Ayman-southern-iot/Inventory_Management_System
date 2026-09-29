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
 * What a key is allowed to reach.
 *
 * `inventory:read` is Phase 10's (K2): products, categories and locations. The four write scopes
 * are ADR-0002's (migration 0039), and every one of them needs the key to be bound to a service
 * account, because a write has to be attributed to somebody and must never be attributed to a
 * person. Still **not** borrowing, which names employees, nor requisitions or expenses, which are
 * the money — K2 stands (OQ-KT6).
 *
 * Widening this is a migration, not a config change, because the Postgres enum has to learn the
 * member too. That is the correct cost for widening what a credential can reach.
 */
export const ApiKeyScope = {
  INVENTORY_READ: 'inventory:read',
  /** Create and edit categories and products. */
  CATALOG_WRITE: 'catalog:write',
  /** Create zones and compartments. */
  LOCATIONS_WRITE: 'locations:write',
  /** Record goods arriving onto a shelf. */
  STOCK_RECEIVE: 'stock:receive',
  /** Take stock off a shelf in one call (`POST /stock/take`). */
  STOCK_TAKE: 'stock:take',
} as const;
export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export const apiKeyScopeSchema = z.nativeEnum(ApiKeyScope);

/**
 * The scopes that cannot change anything. A key holding only these needs no service account and
 * may live forever (K6); a key holding anything else needs both a service account and an expiry.
 * Mirrored by the two CHECKs in migration 0039, which is the guarantee — this is the explanation.
 */
export const READ_ONLY_API_KEY_SCOPES: readonly ApiKeyScope[] = [ApiKeyScope.INVENTORY_READ];

export const isReadOnlyApiKeyScope = (scope: ApiKeyScope): boolean =>
  READ_ONLY_API_KEY_SCOPES.includes(scope);

export const hasWriteScope = (scopes: readonly ApiKeyScope[]): boolean =>
  scopes.some((scope) => !isReadOnlyApiKeyScope(scope));

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
 * How many characters of the secret follow `ims_` in the stored, displayed `key_prefix`. Enough to
 * tell two keys apart at a glance, far too little to narrow a search. Also the per-key throttle
 * bucket (ADR-0002), so the admin list and the rate limiter name a key the same way.
 */
export const API_KEY_DISPLAY_PREFIX_CHARS = 8;

/**
 * A key may also be presented as `?api_key=...` instead of a header, so a URL can be pasted
 * into a browser and read (Ayman, 2026-09-21, chosen over a header extension and over an
 * expiring preview link after the trade-off was put to him).
 *
 * **This is the less safe of the two ways in, and knowingly so.** A key in a URL is written
 * down by things nobody thinks about: web-server access logs, browser history, and the
 * `Referer` header sent to any third-party resource. A key that escapes that way escapes
 * silently and keeps working until somebody revokes it. The header is still the right choice
 * for anything automated; this exists for a human looking at data in a browser.
 *
 * What we do about it on our side: the name is defined once, here, so the guard, the rate
 * limiter and the log redaction cannot disagree about what to look for or what to hide.
 */
export const API_KEY_QUERY_PARAM = 'api_key';

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
  /** The service account this key acts as. Null for an unbound, read-only key (K4). */
  serviceAccountId: uuidSchema.nullable(),
  serviceAccountName: z.string().nullable(),
  /**
   * Whether that account is active. A key whose own `isActive` is true is still refused while
   * its account is switched off, so the list has to be able to say so. Null when unbound.
   */
  serviceAccountIsActive: z.boolean().nullable(),
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

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(apiKeyScopeSchema).min(1),
    /**
     * How many days the key lives. `null` means forever, which Ayman asked for explicitly — some
     * integrations outlive the person who set them up. The UI defaults to 90 so that forever is a
     * choice somebody made rather than the value they got by not choosing.
     *
     * Forever is for read-only keys only (OQ-KT3). A key that can write must expire, and no later
     * than `API_KEY_WRITE_MAX_LIFETIME_DAYS` — a ceiling the server enforces, because it is
     * config and this schema cannot see it. The usage document tells the UI what it is.
     */
    expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
    /**
     * The service account the key acts as. Required for any write scope, optional for a read-only
     * key, which otherwise has no principal at all. Must name a service account, never a person —
     * the server refuses it and so does the database (migration 0039).
     */
    serviceAccountId: uuidSchema.nullable().default(null),
  })
  .superRefine((input, ctx) => {
    if (!hasWriteScope(input.scopes)) return;
    if (input.serviceAccountId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceAccountId'],
        message: 'A key that can make changes must act as a service account',
      });
    }
    if (input.expiresInDays === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresInDays'],
        message: 'A key that can make changes must have an expiry date',
      });
    }
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

/* ------------------------------------------------------------------ service accounts */

/**
 * The principal a write-capable key acts as (ADR-0002). A `users` row flagged
 * `is_service_account`: it cannot sign in, it never appears as a person anywhere — not as a
 * recipient, an approver, a borrower or an option in a picker — and it always holds exactly
 * GENERAL and INVENTORY_MANAGER, because every write a key can reach is an IM action. What a
 * given key may actually do is limited by that key's scopes, not by the account's roles.
 *
 * Managed from the API keys screen, not the Users screen: an admin editing roles or resetting a
 * password there would be changing a machine's credentials through a form built for people.
 */
export const serviceAccountSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isActive: z.boolean(),
  /**
   * Keys that would work if the account is active: not revoked, not disabled, not expired.
   * Deactivating the account stops all of them.
   */
  activeKeyCount: z.number().int(),
  createdAt: z.string(),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

export const createServiceAccountSchema = z.object({
  /** What the key-holder is, e.g. "Lab drawer panel C576". Appears wherever it acted. */
  name: z.string().trim().min(1).max(120),
});
export type CreateServiceAccountInput = z.infer<typeof createServiceAccountSchema>;

/** Deactivating is the kill switch for every key bound to the account at once. */
export const updateServiceAccountSchema = z.object({
  isActive: z.boolean(),
});
export type UpdateServiceAccountInput = z.infer<typeof updateServiceAccountSchema>;

/* ------------------------------------------------------------------ generated usage docs */

/** One query or body field, as read off the route's own zod schema. */
export const apiParamDocSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
});
export type ApiParamDoc = z.infer<typeof apiParamDocSchema>;

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
  queryParams: z.array(apiParamDocSchema),
  /** JSON body fields the route's zod schema accepts, if any. Empty for a GET. */
  bodyParams: z.array(apiParamDocSchema),
  /** True when the route must carry an `Idempotency-Key` header. */
  requiresIdempotencyKey: z.boolean(),
});
export type ApiEndpointDoc = z.infer<typeof apiEndpointDocSchema>;

export const apiKeyUsageDocSchema = z.object({
  /** The path the API is mounted at, e.g. `/api/v1`. The host comes from the browser. */
  basePath: z.string(),
  /** The header an integrator sets. Named here so the instructions cannot drift from the guard. */
  authHeader: z.string(),
  /** The query parameter that carries a key instead of the header, for pasting into a browser. */
  queryParam: z.string(),
  tokenPrefix: z.string(),
  /** Requests per minute a key is allowed, from config. */
  rateLimitPerMinute: z.number().int(),
  /** The `limit` ceiling on any paginated endpoint. */
  maxPageSize: z.number().int(),
  /**
   * The longest a write-capable key may live, from config (OQ-KT3). The create dialog offers
   * no expiry beyond it, and no "never", once a write scope is ticked.
   */
  writeKeyMaxLifetimeDays: z.number().int(),
  /**
   * True on a production deployment running demo accounts: every key is refused and none may be
   * issued (ADR-0002). The page says so instead of offering a Create button that would fail.
   */
  keysDisabledInDemo: z.boolean(),
  endpoints: z.array(apiEndpointDocSchema),
});
export type ApiKeyUsageDoc = z.infer<typeof apiKeyUsageDocSchema>;
