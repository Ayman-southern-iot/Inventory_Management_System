/**
 * The environment the integration suite runs against.
 *
 * This is the one place in `test/` that names concrete values, for the same reason
 * `src/config/` is the one place in the backend that names `process.env`
 * (rules/10-no-hardcoding.md). Specs import the constants from here; they never inline them.
 *
 * The values are forced onto `process.env` rather than merged, so a developer whose shell
 * happens to export POSTGRES_PORT=5433 cannot point the integration suite at the dev database
 * and truncate it.
 */

/** The throwaway database from infra/docker-compose.dev.yml, service `db-test`. */
export const TEST_DB_NAME = 'ims_test';

/** migrations.int-spec builds and destroys this one so it never fights the other specs. */
export const MIGRATION_SCRATCH_DB_NAME = 'ims_test_migrations';

/**
 * Deliberately lower than the production default: the rate-limit spec has to actually reach the
 * ceiling, and every attempt costs an argon2 verify.
 */
export const LOGIN_MAX_ATTEMPTS = 3;

/** Satisfies `passwordSchema`: >= 12 chars, upper + lower + digit. */
export const TEST_PASSWORD = 'IntegrationPass1';
export const ROTATED_PASSWORD = 'RotatedPass9xyz';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  API_PORT: '3100',
  API_GLOBAL_PREFIX: 'api/v1',
  CORS_ALLOWED_ORIGINS: '',

  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5434',
  POSTGRES_DB: TEST_DB_NAME,
  POSTGRES_USER: 'ims',
  POSTGRES_PASSWORD: 'ims_test_password',
  POSTGRES_SSL: 'false',
  POSTGRES_POOL_MAX: '10',

  JWT_ACCESS_SECRET: 'integration-access-secret-not-a-placeholder-0123456789',
  JWT_REFRESH_SECRET: 'integration-refresh-secret-not-a-placeholder-0123456789',
  PDF_SIGNING_SECRET: 'integration-pdf-signing-secret-not-a-placeholder-01234',
  JWT_ACCESS_TTL_SECONDS: '900',
  JWT_REFRESH_TTL_SECONDS: '1209600',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: String(LOGIN_MAX_ATTEMPTS),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: '300',

  SETTING_EXPENSE_THRESHOLD_BDT: '15000',
  SETTING_APPROVER_SLOTS_BELOW_THRESHOLD: '1',
  SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD: '2',

  SEED_ADMIN_EMAIL: 'seed-admin@ims.test',
  SEED_ADMIN_PASSWORD: 'SeedAdminPass1',
  SEED_ADMIN_NAME: 'Integration Seed Admin',
  SEED_ADMIN_DESIGNATION: 'Integration Seed Admin',
};

/**
 * Applied by `global-setup.ts`, which runs in the vitest main process before any worker forks.
 * The workers additionally receive these through `test.env` in the integration vitest config,
 * because `src/config` reads `process.env` at import time and a worker must never see the
 * developer's `.env` values first.
 */
export function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }
}
