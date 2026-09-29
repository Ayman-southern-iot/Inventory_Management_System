import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { TEST_PASSWORD } from './config/test-env';
import { createTestApp, nextClientIp, route, type TestApp } from './app';
import { uniqueEmail } from './factories';

/**
 * `TRUST_PROXY_HOPS` decides which X-Forwarded-For entry the API takes as the caller's address.
 * Every per-address limit and `audit_log.request_ip` read that one value (`req.ip`), so the
 * audit row of a failed login is where the setting becomes observable.
 *
 * The chain below is what two proxies in front of the API would forward: the caller, then the
 * outer proxy that received the request. With one hop trusted the API stops at the outer proxy;
 * with two it reaches the caller. RUNBOOK §0.7 is the reason this is config: the proxy chain in
 * front of production belongs to IT, and a change there must not need a change here.
 */
describe('client address behind a proxy chain (TRUST_PROXY_HOPS)', () => {
  async function recordedAddress(ctx: TestApp, forwardedFor: string): Promise<string | null> {
    const attempted = uniqueEmail('trust-proxy');
    const response = await request(ctx.app.getHttpServer())
      .post(route('/auth/login'))
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: attempted, password: TEST_PASSWORD });
    expect(response.status).toBe(401);

    const row = await ctx.db
      .selectFrom('audit_log')
      .select('request_ip')
      .where('action', '=', 'auth.login.failure')
      .where('entity_ref', '=', attempted)
      .executeTakeFirstOrThrow();
    return row.request_ip;
  }

  describe('with the default of one hop', () => {
    let ctx: TestApp;

    beforeAll(async () => {
      ctx = await createTestApp();
    });

    afterAll(async () => {
      await ctx.close();
    });

    it('takes the entry nearest the API, not the caller-supplied one before it', async () => {
      const caller = nextClientIp();
      const outerProxy = nextClientIp();

      expect(await recordedAddress(ctx, `${caller}, ${outerProxy}`)).toBe(outerProxy);
    });
  });

  describe('with TRUST_PROXY_HOPS = 2', () => {
    let ctx: TestApp;

    beforeAll(async () => {
      ctx = await createTestApp({ http: { trustProxyHops: 2 } });
    });

    afterAll(async () => {
      await ctx.close();
    });

    it('reaches past the outer proxy to the caller', async () => {
      const caller = nextClientIp();
      const outerProxy = nextClientIp();

      expect(await recordedAddress(ctx, `${caller}, ${outerProxy}`)).toBe(caller);
    });
  });
});
