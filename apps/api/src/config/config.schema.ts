import { z } from 'zod';

/**
 * THE ONLY FILE IN THE BACKEND THAT MAY TOUCH `process.env` (rules/10-no-hardcoding.md).
 * A `process.env` anywhere else is a bug — eslint and the guard hook both fail the build on it.
 *
 * Every variable is validated at boot. A missing or malformed one crashes the process naming
 * the offending variable, rather than falling back to a default that works in dev and silently
 * breaks in production. Defaults exist only for genuinely optional, non-secret values.
 */

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

/** Rejects a secret that was copied straight out of `.env.example` and never changed. */
const PLACEHOLDER_SECRETS = new Set(['change-me', 'changeme', 'secret', 'replace-me']);

const secretSchema = z
  .string()
  .min(32, 'must be at least 32 characters')
  .refine((v) => !PLACEHOLDER_SECRETS.has(v.toLowerCase()), {
    message: 'looks like the placeholder from .env.example — generate a real secret',
  });

const durationSecondsSchema = z.coerce.number().int().positive();

const rawSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_GLOBAL_PREFIX: z.string().default('api/v1'),

  // Comma-separated. In production the SPA is same-origin behind Caddy, so this is
  // normally empty there and only populated for the Vite dev server.
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  POSTGRES_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  JWT_ACCESS_SECRET: secretSchema,
  JWT_REFRESH_SECRET: secretSchema,
  JWT_ACCESS_TTL_SECONDS: durationSecondsSchema.default(900),
  JWT_REFRESH_TTL_SECONDS: durationSecondsSchema.default(60 * 60 * 24 * 14),

  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: durationSecondsSchema.default(300),

  // First-boot seed values for `app_settings`. Read ONLY by the settings seeder — never at
  // the point of use, or the threshold becomes unchangeable without a redeploy.
  SETTING_EXPENSE_THRESHOLD_BDT: z.coerce.number().int().nonnegative().default(15_000),
  SETTING_APPROVER_SLOTS_BELOW_THRESHOLD: z.coerce.number().int().min(1).max(2).default(1),
  SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD: z.coerce.number().int().min(1).max(2).default(2),

  // Seeds the first ADMIN so a fresh install is reachable. Required in every environment,
  // because an install nobody can log into is not an install.
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_PASSWORD: z.string().min(12),
  SEED_ADMIN_NAME: z.string().min(2).default('System Administrator'),
  SEED_ADMIN_DESIGNATION: z.string().min(2).default('System Administrator'),
});

export type RawConfig = z.infer<typeof rawSchema>;

export interface AppConfig {
  readonly nodeEnv: RawConfig['NODE_ENV'];
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly http: {
    readonly port: number;
    readonly globalPrefix: string;
    readonly corsOrigins: readonly string[];
  };
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly password: string;
    readonly ssl: boolean;
    readonly poolMax: number;
  };
  readonly auth: {
    readonly accessSecret: string;
    readonly refreshSecret: string;
    readonly accessTtlSeconds: number;
    readonly refreshTtlSeconds: number;
    readonly loginRateLimit: { readonly maxAttempts: number; readonly windowSeconds: number };
  };
  /** Keyed by `SettingDefinition.seedEnvVar`; consumed once, on first boot. */
  readonly settingSeeds: Readonly<Record<string, unknown>>;
  readonly seedAdmin: {
    readonly email: string;
    readonly password: string;
    readonly fullName: string;
    readonly designation: string;
  };
}

export class ConfigValidationError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const lines = issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    super(`Invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

/** Exported for tests so config validation can be exercised without mutating the real env. */
export function buildConfig(source: Record<string, string | undefined>): AppConfig {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) throw new ConfigValidationError(parsed.error.issues);

  const env = parsed.data;

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    http: Object.freeze({
      port: env.API_PORT,
      globalPrefix: env.API_GLOBAL_PREFIX,
      corsOrigins: Object.freeze(
        env.CORS_ALLOWED_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    }),
    db: Object.freeze({
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      ssl: env.POSTGRES_SSL,
      poolMax: env.POSTGRES_POOL_MAX,
    }),
    auth: Object.freeze({
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
      loginRateLimit: Object.freeze({
        maxAttempts: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
        windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      }),
    }),
    settingSeeds: Object.freeze<Record<string, unknown>>({
      SETTING_EXPENSE_THRESHOLD_BDT: env.SETTING_EXPENSE_THRESHOLD_BDT,
      SETTING_APPROVER_SLOTS_BELOW_THRESHOLD: env.SETTING_APPROVER_SLOTS_BELOW_THRESHOLD,
      SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD:
        env.SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD,
    }),
    seedAdmin: Object.freeze({
      email: env.SEED_ADMIN_EMAIL.toLowerCase(),
      password: env.SEED_ADMIN_PASSWORD,
      fullName: env.SEED_ADMIN_NAME,
      designation: env.SEED_ADMIN_DESIGNATION,
    }),
  });
}
