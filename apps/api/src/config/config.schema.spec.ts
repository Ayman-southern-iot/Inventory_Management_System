import { describe, expect, it } from 'vitest';
import { buildConfig, ConfigValidationError } from './config.schema';

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  POSTGRES_HOST: 'localhost',
  POSTGRES_DB: 'ims_test',
  POSTGRES_USER: 'ims',
  POSTGRES_PASSWORD: 'ims',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  SEED_ADMIN_EMAIL: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'AdminPassw0rd!',
};

describe('buildConfig', () => {
  it('builds a frozen config from a complete environment', () => {
    const cfg = buildConfig(VALID_ENV);

    expect(cfg.db.database).toBe('ims_test');
    expect(cfg.http.port).toBe(3000);
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.db)).toBe(true);
  });

  it.each([
    'POSTGRES_HOST',
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'SEED_ADMIN_EMAIL',
    'SEED_ADMIN_PASSWORD',
  ])('fails naming %s when it is missing', (variable) => {
    const env = { ...VALID_ENV };
    delete env[variable];

    expect(() => buildConfig(env)).toThrow(ConfigValidationError);
    expect(() => buildConfig(env)).toThrow(new RegExp(variable));
  });

  it('rejects a JWT secret shorter than 32 characters instead of silently accepting it', () => {
    expect(() => buildConfig({ ...VALID_ENV, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects the .env.example placeholder secret', () => {
    expect(() => buildConfig({ ...VALID_ENV, JWT_REFRESH_SECRET: 'change-me' })).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('rejects a malformed port rather than coercing it to NaN', () => {
    expect(() => buildConfig({ ...VALID_ENV, API_PORT: 'not-a-port' })).toThrow(/API_PORT/);
  });

  it('parses the CORS origin list and drops blanks', () => {
    const cfg = buildConfig({ ...VALID_ENV, CORS_ALLOWED_ORIGINS: 'http://a.test, ,http://b.test' });
    expect(cfg.http.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('defaults the setting seeds so a fresh install boots without them', () => {
    const cfg = buildConfig(VALID_ENV);
    expect(cfg.settingSeeds.SETTING_EXPENSE_THRESHOLD_BDT).toBe(15_000);
    expect(cfg.settingSeeds.SETTING_APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD).toBe(2);
  });

  it('reports every missing variable at once, not just the first', () => {
    const env = { ...VALID_ENV };
    delete env.POSTGRES_HOST;
    delete env.JWT_ACCESS_SECRET;

    try {
      buildConfig(env);
      expect.unreachable('expected buildConfig to throw');
    } catch (error) {
      expect((error as Error).message).toMatch(/POSTGRES_HOST/);
      expect((error as Error).message).toMatch(/JWT_ACCESS_SECRET/);
    }
  });
});
