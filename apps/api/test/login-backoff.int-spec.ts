import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, httpClient, type TestApp } from './app';
import { LOGIN_MAX_ATTEMPTS, TEST_PASSWORD } from './config/test-env';
import { createUser, login, resetData, uniqueEmail } from './factories';

const WRONG_PASSWORD = `not-${TEST_PASSWORD}`;

/**
 * The exponential-backoff behaviour in `LoginThrottleService`. Values come from
 * `LOGIN_THROTTLE_BASE_WINDOW_SECONDS=5` and `LOGIN_THROTTLE_MAX_WINDOW_SECONDS=300` in
 * `test/config/test-env.ts`; the per-email and per-IP ceiling is `LOGIN_MAX_ATTEMPTS=3`.
 *
 * Because the IP ceiling is checked BEFORE the password on every call, and the count of
 * recent failures for an IP is the same as the count for the email on that IP, the two
 * ceilings trip on the same attempt — and the IP path's assertion wins by virtue of running
 * first. The Retry-After value used is therefore `computeBackoffSeconds(byIp)`.
 */
describe('login exponential backoff', () => {
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

  it('reports 2^N × baseWindow at the first trip, with an integer Retry-After header', async () => {
    // Three prior failures from this IP exist (the (LOGIN_MAX_ATTEMPTS - 1) wrong attempts
    // that just happened). The next attempt's assertIpNotThrottled sees byIp=3 → 2^3 × 5 = 40s.
    const http = httpClient(ctx.app);
    const email = uniqueEmail('nobody');

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i += 1) {
      const attempt = await http.post('/auth/login').send({ email, password: WRONG_PASSWORD });
      expect(attempt.status).toBe(401);
    }

    const tripped = await http.post('/auth/login').send({ email, password: WRONG_PASSWORD });
    expect(tripped.status).toBe(429);
    expect(tripped.body.code).toBe('RATE_LIMITED');
    expect(tripped.body.details.retryAfterSeconds).toBe(40);

    // RFC 7231 §7.1.3 — Retry-After is integer seconds. The filter uses Math.ceil on a value
    // that's already an integer here, but the contract is "integer string regardless of input".
    expect(tripped.headers['retry-after']).toBe('40');
  });

  it('resets the per-IP/per-email counter on a successful login', async () => {
    // After two wrong attempts the counter holds 2 failed rows for (email, ip). A successful
    // login deletes every failed row for that (email, ip), so the NEXT wrong attempt must be a
    // clean 401 — not a 429. Without clearFailures() the second wrong attempt would already be
    // inside the throttle window and the next call would trip the IP ceiling.
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db);

    const fail1 = await http.post('/auth/login').send({ email: user.email, password: WRONG_PASSWORD });
    const fail2 = await http.post('/auth/login').send({ email: user.email, password: WRONG_PASSWORD });
    expect([fail1.status, fail2.status]).toEqual([401, 401]);

    // Successful login on the same IP/email clears the failed-attempt rows.
    const ok = await login(http, user.email);
    expect(ok.accessToken).toEqual(expect.any(String));

    // The next wrong attempt must be a clean 401, not a 429.
    const failAfterReset = await http
      .post('/auth/login')
      .send({ email: user.email, password: WRONG_PASSWORD });
    expect(failAfterReset.status).toBe(401);
  });

  it('keeps separate counters for separate source IPs', async () => {
    // Per-IP tracking is the whole point of having two dimensions. httpA burns out its IP ceiling
    // on email X; httpB has zero failures on its IP — and crucially queries a DIFFERENT email,
    // so the per-email counter also reads zero for httpB. The two ceilings are tracked by their
    // own dimension: same IP, all emails OR same email, all IPs. Without per-IP isolation a
    // botnet spraying from many addresses could lock out one user; without per-email isolation a
    // single attacker from one IP could lock many users.
    const httpA = httpClient(ctx.app);
    const httpB = httpClient(ctx.app, { ip: '10.99.99.1' });
    const emailA = uniqueEmail('a');
    const emailB = uniqueEmail('b');

    // Burn out the IP-ceiling for httpA on emailA.
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      const attempt = await httpA.post('/auth/login').send({ email: emailA, password: WRONG_PASSWORD });
      expect([401, 429]).toContain(attempt.status);
    }
    const burned = await httpA.post('/auth/login').send({ email: emailA, password: WRONG_PASSWORD });
    expect(burned.status).toBe(429);

    // httpB has done zero failures on its own IP AND is using a different email, so both
    // counters read zero for it. The request goes through the password check and fails cleanly.
    const fromOtherIp = await httpB
      .post('/auth/login')
      .send({ email: emailB, password: WRONG_PASSWORD });
    expect(fromOtherIp.status).toBe(401);
  });
});
