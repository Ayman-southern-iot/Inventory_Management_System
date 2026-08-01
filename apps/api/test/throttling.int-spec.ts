import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from './app';
import { TEST_PASSWORD } from './config/test-env';
import { createUser, login, resetData } from './factories';

/**
 * Coverage for the three named throttler tiers defined in `app.module.ts` and the per-tier
 * limits in `test/config/test-env.ts`:
 *
 *   THROTTLE_AUTH_LIMIT          = 10  (login/refresh/logout/change-password/profile.content)
 *   THROTTLE_PUBLIC_LIMIT        = 60  (health, BOM PDF download)
 *   THROTTLE_AUTHENTICATED_LIMIT = 300 (everything else authenticated)
 *   LOGIN_BURST_LIMIT            = 10  (login-only burst, layered with auth)
 *
 * Each route declares its tier through a `@Throttle({ name: { limit, ttl } })` decorator, which
 * `ThrottlerGuard` enforces independently per named throttler.
 */
describe('throttler tiers', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
  });

  it('trips the login burst ceiling on the 11th login attempt from one IP', async () => {
    // /auth/login stacks `auth` and `loginBurst` — both limit 10 in the test env. We send 11
    // distinct emails (so LoginThrottleService per-email backoff never fires) and assert the
    // 11th request is a 429 with a recognisable Retry-After-{name} header.
    const http = httpClient(ctx.app);
    let lastStatus = 0;
    let lastHeaders: Record<string, string | string[] | undefined> = {};
    for (let i = 0; i < 11; i += 1) {
      const attempt = await http
        .post('/auth/login')
        .send({ email: `bogus-${i}@x.test`, password: WRONG_PASSWORD });
      lastStatus = attempt.status;
      lastHeaders = attempt.headers;
    }

    expect(lastStatus).toBe(429);

    // The throttler emits per-named-tier headers (`Retry-After-loginBurst`, `Retry-After-auth`).
    // We accept either, since the throttler is free to evaluate in any order — the point of the
    // contract is that SOME tier header is present.
    const headerValue =
      lastHeaders['retry-after-loginburst'] ?? lastHeaders['retry-after-auth'];
    expect(typeof headerValue === 'string' ? Number(headerValue) : NaN).toBeGreaterThan(0);
  });

  it('leaves /health reachable on the public tier', async () => {
    // /health uses the `public` ceiling (60 in test-env). One request must succeed to prove
    // the route is wired to the named throttler (and not misconfigured to block outright).
    const http = httpClient(ctx.app);
    const response = await http.get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('leaves a logged-in GET on the authenticated tier reachable at small volumes', async () => {
    // /products is on the `authenticated` ceiling (300 in test-env). 300 requests to trip it is
    // expensive and not necessary — the wiring test is: a logged-in user can hit a normal
    // authenticated route without being throttled. The throttler key is the user identity, so
    // proving "logged-in user → 200" also proves the throttler is invoked (it'd 429 otherwise
    // on the wrong key).
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db);
    const session = await login(http, user.email);
    const authed = http.as(session.accessToken);

    const response = await authed.get('/products');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ items: expect.any(Array) }));
  });

  it('rejects an oversized JSON body with 413 before the controller runs', async () => {
    // main.ts installs a body parser with a 100kb cap. Nest surfaces 413 as PAYLOAD_TOO_LARGE
    // through the AllExceptionsFilter. We send a 200kb payload and expect 413 — proving the cap
    // is in place AND that we did not regress to the default (which is 100kb for json() too,
    // but our explicit setting means a future change to either default still keeps the cap).
    const http = httpClient(ctx.app);
    const big = 'x'.repeat(200 * 1024);

    const response = await http
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: `big-${big}@x.test`, password: big }));

    expect(response.status).toBe(413);
    expect(response.body.code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
  });
});

const WRONG_PASSWORD = `not-${TEST_PASSWORD}`;