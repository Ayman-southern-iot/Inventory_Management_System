import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { config } from '../src/config';
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
 * The real application: real AppModule, real guards, real filter, real Postgres. The only
 * differences from `main.ts` are the silenced logger and the absence of `helmet`/CORS, neither
 * of which any assertion here depends on.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

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
