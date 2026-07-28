import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role, type LoginResponse } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from './app';
import { LOGIN_MAX_ATTEMPTS, TEST_PASSWORD } from './config/test-env';
import { createUser, login, resetData, uniqueEmail } from './factories';

const WRONG_PASSWORD = `not-${TEST_PASSWORD}`;

describe('auth', () => {
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

  describe('login', () => {
    it('returns access and refresh tokens plus the identity, with the full role set', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db, {
        roles: [Role.APPROVER, Role.INVENTORY_MANAGER],
        designation: 'Head of Operations',
      });

      const response = await http.post('/auth/login').send({
        email: user.email,
        password: TEST_PASSWORD,
      });

      expect(response.status).toBe(200);
      const body = response.body as LoginResponse;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(body.refreshToken).not.toBe(body.accessToken);
      expect(body.expiresIn).toBeGreaterThan(0);
      expect(body.user.email).toBe(user.email);
      expect(body.user.designation).toBe('Head of Operations');
      expect([...body.user.roles].sort()).toEqual([
        Role.APPROVER,
        Role.GENERAL,
        Role.INVENTORY_MANAGER,
      ]);
      // The hash must never leave the backend, whatever else the serialiser picks up.
      expect(JSON.stringify(body)).not.toContain('$argon2');
    });

    it('accepts an email in a different case than it was stored in', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);

      const response = await http
        .post('/auth/login')
        .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD });

      expect(response.status).toBe(200);
    });

    it('answers a wrong password and an unknown email identically', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);

      const wrongPassword = await http
        .post('/auth/login')
        .send({ email: user.email, password: WRONG_PASSWORD });
      const unknownEmail = await http
        .post('/auth/login')
        .send({ email: uniqueEmail('nobody'), password: TEST_PASSWORD });

      // Any difference here — status, code, or message — enumerates which emails have accounts.
      expect(wrongPassword.status).toBe(unknownEmail.status);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body).toEqual({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: expect.any(String),
      });
    });

    it('refuses a deactivated account with ACCOUNT_DEACTIVATED', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db, { isActive: false });

      const response = await http
        .post('/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.ACCOUNT_DEACTIVATED);
    });

    it('rejects a malformed email before it reaches the password check', async () => {
      const http = httpClient(ctx.app);

      const response = await http.post('/auth/login').send({ email: 'not-an-email', password: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  describe('refresh rotation', () => {
    it('issues a different refresh token that works in place of the old one', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);
      const first = await login(http, user.email);

      const rotated = await http
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken });

      expect(rotated.status).toBe(200);
      const second = rotated.body as LoginResponse;
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.user.id).toBe(user.id);

      // The replacement is not merely different; it is usable.
      const again = await http.post('/auth/refresh').send({ refreshToken: second.refreshToken });
      expect(again.status).toBe(200);
      expect((again.body as LoginResponse).refreshToken).not.toBe(second.refreshToken);
    });

    it('gives the rotated access token access to /auth/me', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);
      const first = await login(http, user.email);

      const rotated = await http.post('/auth/refresh').send({ refreshToken: first.refreshToken });
      const me = await http.as((rotated.body as LoginResponse).accessToken).get('/auth/me');

      expect(me.status).toBe(200);
      expect(me.body.id).toBe(user.id);
    });

    it('kills the entire family when a rotated token is replayed', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);

      const first = await login(http, user.email);
      const rotated = await http.post('/auth/refresh').send({ refreshToken: first.refreshToken });
      expect(rotated.status).toBe(200);
      const second = rotated.body as LoginResponse;

      // The attacker replays the token that was already rotated away.
      const replay = await http.post('/auth/refresh').send({ refreshToken: first.refreshToken });

      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe(ErrorCode.TOKEN_REUSE_DETECTED);

      // The point of the family: the legitimate holder of the *newest* token is logged out too,
      // because there is no way to tell which of the two is the attacker.
      const newest = await http.post('/auth/refresh').send({ refreshToken: second.refreshToken });
      expect(newest.status).toBe(401);
      expect(newest.body.code).toBe(ErrorCode.TOKEN_REUSE_DETECTED);

      const live = await ctx.db
        .selectFrom('refresh_tokens')
        .where('user_id', '=', user.id)
        .where('revoked_at', 'is', null)
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirst();
      expect(live?.count).toBe(0);
    });

    it('leaves a second, independent login alive when one family is revoked', async () => {
      const deviceA = httpClient(ctx.app);
      const deviceB = httpClient(ctx.app);
      const user = await createUser(ctx.db);

      const sessionA = await login(deviceA, user.email);
      const sessionB = await login(deviceB, user.email);

      const rotatedA = await deviceA
        .post('/auth/refresh')
        .send({ refreshToken: sessionA.refreshToken });
      expect(rotatedA.status).toBe(200);
      await deviceA.post('/auth/refresh').send({ refreshToken: sessionA.refreshToken });

      // Revoking the compromised family must not sign the user out of their other device.
      const stillGood = await deviceB
        .post('/auth/refresh')
        .send({ refreshToken: sessionB.refreshToken });
      expect(stillGood.status).toBe(200);
    });

    it('rejects a refresh token that was never issued', async () => {
      const http = httpClient(ctx.app);

      const response = await http.post('/auth/refresh').send({ refreshToken: 'not-a-token' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.TOKEN_EXPIRED);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the caller`s identity for a valid bearer token', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db, { roles: [Role.ADMIN] });
      const session = await login(http, user.email);

      const response = await http.as(session.accessToken).get('/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(user.id);
      expect(response.body.roles).toContain(Role.ADMIN);
    });

    it('rejects a request with no bearer token', async () => {
      const response = await httpClient(ctx.app).get('/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it('rejects a garbage bearer token', async () => {
      const response = await httpClient(ctx.app).as('this.is.not.a.jwt').get('/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it('rejects an access token signed with the refresh secret', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);
      const session = await login(http, user.email);

      // Refresh tokens are not access tokens, whatever their shape suggests.
      const response = await http.as(session.refreshToken).get('/auth/me');

      expect(response.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('revokes the presented session so its refresh token stops working', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);
      const session = await login(http, user.email);

      const loggedOut = await http
        .as(session.accessToken)
        .post('/auth/logout')
        .send({ refreshToken: session.refreshToken });
      expect(loggedOut.status).toBe(204);

      const reuse = await http.post('/auth/refresh').send({ refreshToken: session.refreshToken });
      expect(reuse.status).toBe(401);
    });
  });

  describe('login rate limit', () => {
    it(`blocks the attempt after ${LOGIN_MAX_ATTEMPTS} failures, even with the right password`, async () => {
      // One client, one source IP: the limiter counts per email *and* per address.
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);

      for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS; attempt += 1) {
        const failed = await http
          .post('/auth/login')
          .send({ email: user.email, password: WRONG_PASSWORD });
        expect(failed.status).toBe(401);
        expect(failed.body.code).toBe(ErrorCode.INVALID_CREDENTIALS);
      }

      const blocked = await http
        .post('/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });

      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe(ErrorCode.RATE_LIMITED);
      expect(blocked.body.details).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    });

    it('clears the counter on a successful login', async () => {
      const http = httpClient(ctx.app);
      const user = await createUser(ctx.db);
      const nearMiss = LOGIN_MAX_ATTEMPTS - 1;

      for (let attempt = 0; attempt < nearMiss; attempt += 1) {
        await http.post('/auth/login').send({ email: user.email, password: WRONG_PASSWORD });
      }

      const recovered = await http
        .post('/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(recovered.status).toBe(200);

      // Without the reset these would accumulate onto the earlier failures and trip the limit.
      for (let attempt = 0; attempt < nearMiss; attempt += 1) {
        const failed = await http
          .post('/auth/login')
          .send({ email: user.email, password: WRONG_PASSWORD });
        expect(failed.status).toBe(401);
      }

      const stillAllowed = await http
        .post('/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(stillAllowed.status).toBe(200);
    });
  });
});
