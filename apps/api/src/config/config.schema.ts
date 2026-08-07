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
  /**
   * Legacy key kept for back-compat. New code reads `loginThrottle.baseWindowSeconds`
   * and `loginThrottle.maxWindowSeconds` for the exponential backoff calculation. When both
   * `LOGIN_RATE_LIMIT_WINDOW_SECONDS` and `LOGIN_THROTTLE_BASE_WINDOW_SECONDS` are set, the new
   * value wins.
   */
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: durationSecondsSchema.default(300),

  // --- Login exponential backoff (Phase 06 hardening) -------------------------
  // Base of the exponential. After N failed attempts in the IP/email window, the lockout
  // duration is `min(2^N × baseWindow, maxWindow)`. Caps prevent a long-running attacker from
  // being locked out for hours.
  LOGIN_THROTTLE_BASE_WINDOW_SECONDS: durationSecondsSchema.default(30),
  LOGIN_THROTTLE_MAX_WINDOW_SECONDS: z.coerce.number().int().min(60).default(900),

  // --- Throttler tiers (Phase 06 hardening) ------------------------------------
  // Each tier is applied per-IP. `auth` is the strictest (login, refresh, password change,
  // signature download). `public` covers routes that are reachable without a session (BOM PDF
  // download, /health). `authenticated` is the budget for everything else. `loginBurst` is a
  // fourth, separate counter layered on top of `auth` specifically for the password-spray
  // shape — the burst limit and the credential backoff solve different problems.
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
  THROTTLE_AUTH_TTL_SECONDS: durationSecondsSchema.default(60),
  THROTTLE_PUBLIC_LIMIT: z.coerce.number().int().min(1).max(10_000).default(60),
  THROTTLE_PUBLIC_TTL_SECONDS: durationSecondsSchema.default(60),
  THROTTLE_AUTHENTICATED_LIMIT: z.coerce.number().int().min(1).max(100_000).default(300),
  THROTTLE_AUTHENTICATED_TTL_SECONDS: durationSecondsSchema.default(60),
  /** Replaces the previously hardcoded 10/60s login burst limit on `POST /auth/login`. */
  LOGIN_BURST_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
  LOGIN_BURST_TTL_SECONDS: durationSecondsSchema.default(60),

  // --- Body size limits (Phase 06 hardening) -----------------------------------
  // Explicit application-level caps. Multipart uploads are bounded separately at the
  // `FileInterceptor` and inside `FileStorageService`; these only govern JSON and url-encoded
  // bodies. Acceptable value syntax is whatever `bytes` accepts (e.g. `100kb`, `1mb`).
  JSON_BODY_LIMIT: z.string().min(1).default('100kb'),
  URLENCODED_BODY_LIMIT: z.string().min(1).default('100kb'),

  // First-boot seed values for `app_settings`. Read ONLY by the settings seeder — never at
  // the point of use, or the threshold becomes unchangeable without a redeploy.
  SETTING_EXPENSE_THRESHOLD_BDT: z.coerce.number().int().nonnegative().default(15_000),
  SETTING_APPROVER_SLOTS_BELOW_THRESHOLD: z.coerce.number().int().min(1).max(2).default(1),
  SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD: z.coerce.number().int().min(1).max(2).default(2),
  SETTING_BOM_OVER_BUDGET_TOLERANCE_PCT: z.coerce.number().int().min(0).max(100).default(10),
  /**
   * Phase 05 — single admin-designated approver for sub-threshold requisitions. Empty
   * string on first boot means "not configured"; submitting a sub-threshold requisition
   * then refuses with 409. The SettingsService coerces the empty string to null.
   */
  SETTING_SUBTHRESHOLD_APPROVER_USER_ID: z.string().default(''),

  /**
   * Phase 06 — audit recording and retention seeds. Both are first-boot values only; once the
   * `app_settings` rows exist the admin panel owns them.
   *
   * Empty `SETTING_AUDIT_ENABLED_ACTIONS` means "record everything", which is the right
   * default for a fresh install. `SETTING_AUDIT_RETENTION_DAYS=0` means keep forever — a purge
   * only ever runs because someone deliberately configured one.
   */
  SETTING_AUDIT_ENABLED_ACTIONS: z.string().default(''),
  SETTING_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),

  // --- Demo accounts -----------------------------------------------------------
  /**
   * Seeds a known set of accounts sharing one obvious password, and lists them on the login
   * page so anyone can sign in as any persona.
   *
   * This removes authentication in practice: whoever can reach the login page can act as the
   * administrator. It exists for demos and internal trials on a trusted network and must be
   * `false` on anything real. Defaults to `false` so it is never inherited by accident — a
   * deployment that wants it has to say so.
   */
  DEMO_ACCOUNTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Shared password for the demo accounts. Four characters is the policy minimum. */
  DEMO_ACCOUNT_PASSWORD: z.string().min(4).default('demo'),
  /**
   * Per-account exceptions, as `email=password` pairs separated by commas. For accounts that
   * predate demo mode and keep their own password rather than being reset to the shared one.
   * Credentials belong in configuration, never in source.
   */
  /**
   * Restricts the login page to these emails, comma separated. Without it the page lists every
   * active user, including ones whose password is not the demo one — a persona that fails on
   * click is worse than one that is absent. Empty means "list them all".
   */
  DEMO_ACCOUNT_EMAILS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    ),
  DEMO_ACCOUNT_PASSWORD_OVERRIDES: z
    .string()
    .default('')
    .transform((raw) =>
      Object.fromEntries(
        raw
          .split(',')
          .map((pair) => pair.trim())
          .filter((pair) => pair.includes('='))
          .map((pair) => {
            const separator = pair.indexOf('=');
            return [
              pair.slice(0, separator).trim().toLowerCase(),
              pair.slice(separator + 1).trim(),
            ] as const;
          }),
      ),
    ),

  // --- Uploads (Phase 05) ------------------------------------------------------
  // Signatures and invoices. Separate from PDF_STORAGE_DIR because rendered PDFs are derived
  // artefacts the system can regenerate, whereas an uploaded invoice exists nowhere else — the
  // two directories have completely different backup requirements.
  FILE_STORAGE_DIR: z.string().default('./storage/files'),
  /** Signature images. Small on purpose: a signature is a few hundred pixels of ink. */
  UPLOAD_MAX_IMAGE_BYTES: z.coerce.number().int().min(1024).max(50_000_000).default(2_000_000),
  /** Scanned invoices, which are legitimately larger. */
  UPLOAD_MAX_DOCUMENT_BYTES: z.coerce.number().int().min(1024).max(50_000_000).default(10_000_000),

  // --- Monitoring floor (Phase 06 task 6.4) ------------------------------------
  // Thresholds, not literals: what counts as "nearly full" depends on the volume, and how stale
  // a backup may be depends on how often cron runs it.
  MONITOR_DISK_WARN_PERCENT: z.coerce.number().int().min(50).max(99).default(80),
  /** Nightly at 02:00 plus slack. Anything older means the job stopped and nobody noticed. */
  MONITOR_BACKUP_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(720).default(26),
  /** Where infra/backup.sh writes. Blank disables the check — dev machines take no backups. */
  MONITOR_BACKUP_DIR: z.string().default(''),

  // --- Company identity (printed on every BOM) ---------------------------------
  // Configuration, not literals: another deployment is another company, and the address is the
  // sort of thing that changes with an office move rather than a release.
  /**
   * The business's own calendar. Report date ranges are resolved against this, not UTC — at
   * +06 a Dhaka morning is the previous UTC day, and a July range would silently drop it.
   */
  REPORTING_TIME_ZONE: z.string().min(1).default('Asia/Dhaka'),
  COMPANY_NAME: z.string().min(1).default('Southern IoT'),
  /** Pipe-separated so one env var carries a multi-line address block. */
  COMPANY_ADDRESS: z
    .string()
    .default('House 26, Road 13, Sector 14|Uttara, Dhaka - 1230|Bangladesh'),
  /** Repo-relative or absolute. Embedded as a data URI at render time, never linked. */
  COMPANY_LOGO_PATH: z.string().default('./assets/letterhead/siot-logo.jpg'),

  // --- PDF rendering (OQ-11) ---------------------------------------------------
  // Every measurement is configuration, because the real company pad has not been supplied
  // yet and its margins are unknown. Nothing here may become a literal in a template.
  PDF_STORAGE_DIR: z.string().default('./storage/pdf'),
  /** Where the letterhead image lives, if one has been supplied. Blank renders a placeholder. */
  PDF_LETTERHEAD_PATH: z.string().default(''),
  PDF_PAGE_FORMAT: z.enum(['A4', 'Letter']).default('A4'),
  PDF_MARGIN_TOP_MM: z.coerce.number().min(0).max(100).default(45),
  PDF_MARGIN_RIGHT_MM: z.coerce.number().min(0).max(100).default(15),
  PDF_MARGIN_BOTTOM_MM: z.coerce.number().min(0).max(100).default(30),
  PDF_MARGIN_LEFT_MM: z.coerce.number().min(0).max(100).default(15),
  /** Chromium is the memory hog in this stack; a runaway render must not hang the API. */
  PDF_RENDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  /** How long a download link stays valid. Short, because the link is the only auth. */
  PDF_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(86_400).default(300),
  /**
   * Signs short-lived download URLs. A leaked link must not impersonate a user, so this is
   * deliberately a separate secret from `JWT_ACCESS_SECRET`. Same length policy as the JWT
   * secrets; the cross-secret uniqueness check below catches the "copy-paste from .env"
   * mistake.
   */
  PDF_SIGNING_SECRET: secretSchema,
  /**
   * Absolute path to the Chrome/Chromium binary puppeteer should launch. Alpine's
   * puppeteer-core is linked against musl, and the system chromium works with it; puppeteer's
   * bundled chromium is linked against glibc and cannot run on Alpine, so a containerised
   * API must point this at the system binary. Empty (the default) keeps puppeteer's own
   * behaviour — fine on a dev host that already has Chrome installed.
   */
  PDF_BROWSER_EXECUTABLE_PATH: z.string().default(''),

  // Seeds the first ADMIN so a fresh install is reachable. Required in every environment,
  // because an install nobody can log into is not an install.
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_PASSWORD: z.string().min(12),
  SEED_ADMIN_NAME: z.string().min(2).default('System Administrator'),
  SEED_ADMIN_DESIGNATION: z.string().min(2).default('System Administrator'),
});

/**
 * Identical access and refresh secrets would make a refresh token verify as an access token.
 * `.env.example` says they must differ; a comment is not enforcement.
 */
const validatedSchema = rawSchema.superRefine((env, ctx) => {
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_REFRESH_SECRET'],
      message: 'must differ from JWT_ACCESS_SECRET',
    });
  }
  // A leaked download URL must not verify as a session token. The PDF signing secret is the
  // third key in this trio; force it to differ from both.
  if (env.PDF_SIGNING_SECRET === env.JWT_ACCESS_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PDF_SIGNING_SECRET'],
      message: 'must differ from JWT_ACCESS_SECRET',
    });
  }
  if (env.PDF_SIGNING_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PDF_SIGNING_SECRET'],
      message: 'must differ from JWT_REFRESH_SECRET',
    });
  }
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
    /** Capped exponential backoff applied to repeated failed logins. */
    readonly loginThrottle: {
      readonly baseWindowSeconds: number;
      readonly maxWindowSeconds: number;
    };
  };
  readonly throttling: {
    readonly auth: { readonly limit: number; readonly ttlSeconds: number };
    readonly public: { readonly limit: number; readonly ttlSeconds: number };
    readonly authenticated: { readonly limit: number; readonly ttlSeconds: number };
    readonly loginBurst: { readonly limit: number; readonly ttlSeconds: number };
  };
  readonly body: {
    readonly jsonLimit: string;
    readonly urlencodedLimit: string;
  };
  /** Keyed by `SettingDefinition.seedEnvVar`; consumed once, on first boot. */
  readonly settingSeeds: Readonly<Record<string, unknown>>;
  readonly monitoring: {
    readonly diskWarnPercent: number;
    readonly backupMaxAgeHours: number;
    readonly backupDir: string;
  };
  readonly reportingTimeZone: string;
  readonly company: {
    readonly name: string;
    readonly addressLines: readonly string[];
    readonly logoPath: string;
  };
  /** Demo accounts: a known persona set sharing one obvious password. Off unless asked for. */
  readonly demo: {
    readonly accountsEnabled: boolean;
    readonly password: string;
    /** Lower-cased emails to list. Empty lists every active user. */
    readonly accountEmails: readonly string[];
    /** Per-account exceptions, keyed by lower-cased email. */
    readonly passwordOverrides: Readonly<Record<string, string>>;
  };
  readonly uploads: {
    readonly storageDir: string;
    readonly maxImageBytes: number;
    readonly maxDocumentBytes: number;
  };
  readonly pdf: {
    readonly storageDir: string;
    readonly letterheadPath: string;
    readonly pageFormat: 'A4' | 'Letter';
    readonly margins: {
      readonly top: string;
      readonly right: string;
      readonly bottom: string;
      readonly left: string;
    };
    readonly renderTimeoutMs: number;
    readonly signedUrlTtlSeconds: number;
    /** Empty in dev, set to `/usr/bin/chromium-browser` in the container. */
    readonly browserExecutablePath: string;
    /** HMAC key for download URLs — kept off `JWT_ACCESS_SECRET` so a leak stays bounded. */
    readonly signedUrlKey: string;
  };
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
  const parsed = validatedSchema.safeParse(source);
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
      loginThrottle: Object.freeze({
        baseWindowSeconds: env.LOGIN_THROTTLE_BASE_WINDOW_SECONDS,
        maxWindowSeconds: env.LOGIN_THROTTLE_MAX_WINDOW_SECONDS,
      }),
    }),
    throttling: Object.freeze({
      auth: Object.freeze({
        limit: env.THROTTLE_AUTH_LIMIT,
        ttlSeconds: env.THROTTLE_AUTH_TTL_SECONDS,
      }),
      public: Object.freeze({
        limit: env.THROTTLE_PUBLIC_LIMIT,
        ttlSeconds: env.THROTTLE_PUBLIC_TTL_SECONDS,
      }),
      authenticated: Object.freeze({
        limit: env.THROTTLE_AUTHENTICATED_LIMIT,
        ttlSeconds: env.THROTTLE_AUTHENTICATED_TTL_SECONDS,
      }),
      loginBurst: Object.freeze({
        limit: env.LOGIN_BURST_LIMIT,
        ttlSeconds: env.LOGIN_BURST_TTL_SECONDS,
      }),
    }),
    body: Object.freeze({
      jsonLimit: env.JSON_BODY_LIMIT,
      urlencodedLimit: env.URLENCODED_BODY_LIMIT,
    }),
    settingSeeds: Object.freeze<Record<string, unknown>>({
      SETTING_EXPENSE_THRESHOLD_BDT: env.SETTING_EXPENSE_THRESHOLD_BDT,
      SETTING_APPROVER_SLOTS_BELOW_THRESHOLD: env.SETTING_APPROVER_SLOTS_BELOW_THRESHOLD,
      SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD:
        env.SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD,
      SETTING_BOM_OVER_BUDGET_TOLERANCE_PCT: env.SETTING_BOM_OVER_BUDGET_TOLERANCE_PCT,
      SETTING_SUBTHRESHOLD_APPROVER_USER_ID: env.SETTING_SUBTHRESHOLD_APPROVER_USER_ID,
      // Comma-separated on the wire, an array in the setting. Empty stays empty so the
      // registry's transform turns it into "every action".
      SETTING_AUDIT_ENABLED_ACTIONS: env.SETTING_AUDIT_ENABLED_ACTIONS.trim()
        ? env.SETTING_AUDIT_ENABLED_ACTIONS.split(',')
            .map((action) => action.trim())
            .filter(Boolean)
        : '',
      SETTING_AUDIT_RETENTION_DAYS: env.SETTING_AUDIT_RETENTION_DAYS,
    }),
    monitoring: Object.freeze({
      diskWarnPercent: env.MONITOR_DISK_WARN_PERCENT,
      backupMaxAgeHours: env.MONITOR_BACKUP_MAX_AGE_HOURS,
      backupDir: env.MONITOR_BACKUP_DIR,
    }),
    reportingTimeZone: env.REPORTING_TIME_ZONE,
    company: Object.freeze({
      name: env.COMPANY_NAME,
      addressLines: Object.freeze(
        env.COMPANY_ADDRESS.split('|')
          .map((line) => line.trim())
          .filter(Boolean),
      ),
      logoPath: env.COMPANY_LOGO_PATH,
    }),
    demo: Object.freeze({
      accountsEnabled: env.DEMO_ACCOUNTS_ENABLED,
      password: env.DEMO_ACCOUNT_PASSWORD,
      accountEmails: env.DEMO_ACCOUNT_EMAILS,
      passwordOverrides: env.DEMO_ACCOUNT_PASSWORD_OVERRIDES,
    }),
    uploads: Object.freeze({
      storageDir: env.FILE_STORAGE_DIR,
      maxImageBytes: env.UPLOAD_MAX_IMAGE_BYTES,
      maxDocumentBytes: env.UPLOAD_MAX_DOCUMENT_BYTES,
    }),
    pdf: Object.freeze({
      storageDir: env.PDF_STORAGE_DIR,
      letterheadPath: env.PDF_LETTERHEAD_PATH,
      pageFormat: env.PDF_PAGE_FORMAT,
      // Millimetres in env, CSS units out — Puppeteer wants the unit attached.
      margins: Object.freeze({
        top: `${env.PDF_MARGIN_TOP_MM}mm`,
        right: `${env.PDF_MARGIN_RIGHT_MM}mm`,
        bottom: `${env.PDF_MARGIN_BOTTOM_MM}mm`,
        left: `${env.PDF_MARGIN_LEFT_MM}mm`,
      }),
      renderTimeoutMs: env.PDF_RENDER_TIMEOUT_MS,
      signedUrlTtlSeconds: env.PDF_SIGNED_URL_TTL_SECONDS,
      signedUrlKey: env.PDF_SIGNING_SECRET,
      browserExecutablePath: env.PDF_BROWSER_EXECUTABLE_PATH,
    }),
    seedAdmin: Object.freeze({
      email: env.SEED_ADMIN_EMAIL.toLowerCase(),
      password: env.SEED_ADMIN_PASSWORD,
      fullName: env.SEED_ADMIN_NAME,
      designation: env.SEED_ADMIN_DESIGNATION,
    }),
  });
}
