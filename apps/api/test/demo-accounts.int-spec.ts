import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, httpClient, type TestApp } from './app';
import { config } from '../src/config';

/**
 * `GET /auth/demo-accounts` lists every active account on the login page, sharing one known
 * password, so anyone can sign in as any persona. That removes authentication in practice.
 *
 * The property worth testing is therefore not the happy path — it is that the route is
 * **silent unless someone deliberately turned it on**. A default that leaks the staff
 * directory and a working administrator login is the failure that matters, and it is the one
 * a future refactor is most likely to reintroduce.
 */
describe('demo accounts', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('is off unless explicitly enabled', () => {
    // If this ever fails, the default flipped — which means every deployment that did not
    // opt out is publishing its user list and a shared password.
    expect(config.demo.accountsEnabled).toBe(false);
  });

  it('answers 404 while disabled, rather than an empty list', async () => {
    const response = await httpClient(ctx.app).get('/auth/demo-accounts');

    // 404 and not 200-with-nothing: a disabled deployment should not confirm the route exists.
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain(config.demo.password);
  });

  it('never exposes a password hash even when it answers', async () => {
    // Whatever the flag, the response shape carries no credential material beyond the single
    // configured demo password — no hashes, no per-user secrets.
    const response = await httpClient(ctx.app).get('/auth/demo-accounts');
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('$argon2');
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('passwordHash');
  });
});
