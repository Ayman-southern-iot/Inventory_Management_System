import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONFIG, config, type AppConfig } from '../src/config';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { DB } from '../src/database/database.module';
import type { Db } from '../src/database/create-db';

export interface TestApp {
  app: INestApplication;
  moduleRef: TestingModule;
  db: Db;
  close(): Promise<void>;
}

/**
 * A partial config override, for a spec that needs the application built under a different
 * policy from the one production ships with.
 *
 * Deep-merged one level, because the interesting settings are grouped (`money`, `pdf`, `auth`)
 * and a caller wanting one of them should not have to restate the rest of its group.
 */
export type ConfigOverrides = {
  [K in keyof AppConfig]?: AppConfig[K] extends object ? Partial<AppConfig[K]> : AppConfig[K];
};

function withOverrides(overrides: ConfigOverrides): AppConfig {
  const merged: Record<string, unknown> = { ...config };
  for (const [group, value] of Object.entries(overrides)) {
    const current = (config as unknown as Record<string, unknown>)[group];
    merged[group] =
      current && typeof current === "object" && value && typeof value === "object"
        ? Object.freeze({ ...(current as object), ...(value as object) })
        : value;
  }
  return Object.freeze(merged) as unknown as AppConfig;
}

/**
 * The real application: real AppModule, real guards, real filter, real Postgres. The only
 * differences from `main.ts` are the silenced logger and the absence of `helmet`/CORS, neither
 * of which any assertion here depends on.
 *
 * `overrides` builds the app under a different config — the way to test a flag-gated feature
 * from both sides. Without it the behaviour is byte-identical to before: the provider is only
 * replaced when a caller actually asks, so the other specs are untouched.
 *
 * The alternative was setting an env var for the whole run, which would flip the flag for every
 * spec in the process and make "what was this suite testing" depend on the runner.
 */
export async function createTestApp(overrides?: ConfigOverrides): Promise<TestApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (overrides) {
    builder.overrideProvider(CONFIG).useValue(withOverrides(overrides));
  }
  const moduleRef = await builder.compile();

  // Silenced: a passing suite must not flood the runner with Nest's stdout.
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.setGlobalPrefix(config.http.globalPrefix, { exclude: ['health'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  // Same as production: the rate limiters read the forwarded client address, which is what
  // lets each test present its own source IP instead of sharing one bucket.
  app.set('trust proxy', 1);

  await app.init();

  return {
    app,
    moduleRef,
    db: app.get<Db>(DB),
    close: async () => {
      await app.close();
    },
  };
}

/** Prefixes a route the way `setGlobalPrefix` does, without restating the prefix in specs. */
export function route(path: string): string {
  return `/${config.http.globalPrefix}${path}`;
}

let ipCounter = 0;

/**
 * A distinct source address per test. Both rate limiters (the global ThrottlerGuard and
 * LoginThrottleService) count per IP, so tests that share one address leak failures into each
 * other and go order-dependent.
 */
export function nextClientIp(): string {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 65_536) % 256}.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
}

export interface HttpClientOptions {
  ip?: string;
  token?: string;
}

export interface HttpClient {
  get(path: string): request.Test;
  post(path: string): request.Test;
  patch(path: string): request.Test;
  put(path: string): request.Test;
  delete(path: string): request.Test;
  /** Same source IP, different bearer token. */
  as(token: string | undefined): HttpClient;
}

export function httpClient(app: INestApplication, options: HttpClientOptions = {}): HttpClient {
  const ip = options.ip ?? nextClientIp();
  const server = app.getHttpServer();

  const prepare = (t: request.Test): request.Test => {
    const withIp = t.set('X-Forwarded-For', ip);
    return options.token ? withIp.set('Authorization', `Bearer ${options.token}`) : withIp;
  };

  return {
    get: (path) => prepare(request(server).get(route(path))),
    post: (path) => prepare(request(server).post(route(path))),
    patch: (path) => prepare(request(server).patch(route(path))),
    put: (path) => prepare(request(server).put(route(path))),
    delete: (path) => prepare(request(server).delete(route(path))),
    as: (token) => httpClient(app, { ip, ...(token ? { token } : {}) }),
  };
}
