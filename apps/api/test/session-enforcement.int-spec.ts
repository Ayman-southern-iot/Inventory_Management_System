import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from './app';
import { createUser, createUserAndLogin, login, resetData } from './factories';

/**
 * An access token is a 15-minute bearer credential. Everything here checks that it is not
 * *only* a bearer credential — that the session behind it is still re-validated on every
 * request, so an admin action takes effect now rather than up to fifteen minutes from now.
 */
describe('session enforcement on the access token', () => {
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

  it('stops a deactivated user immediately, not when their access token expires', async () => {
    const admin = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.GENERAL, Role.ADMIN],
    });
    const victimHttp = httpClient(ctx.app);
    const victim = await createUser(ctx.db);
    const session = await login(victimHttp, victim.email);
    const authed = victimHttp.as(session.accessToken);

    expect((await authed.get('/departments')).status).toBe(200);

    await admin.client.patch(`/admin/users/${victim.id}/active`).send({ isActive: false });

    // Same, still-unexpired token. Before session re-validation this returned 200.
    const after = await authed.get('/departments');
    expect(after.status).toBe(403);
    expect(after.body.code).toBe(ErrorCode.ACCOUNT_DEACTIVATED);
  });

  it('stops a logged-out access token being reused', async () => {
    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app));
    expect((await session.client.get('/departments')).status).toBe(200);

    await session.client.post('/auth/logout').send({ refreshToken: session.session.refreshToken });

    const after = await session.client.get('/departments');
    expect(after.status).toBe(401);
  });

  it('reflects a role change without waiting for the token to be reissued', async () => {
    const admin = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.GENERAL, Role.ADMIN],
    });
    const targetHttp = httpClient(ctx.app);
    const target = await createUser(ctx.db, { roles: [Role.GENERAL] });
    const session = await login(targetHttp, target.email);
    const authed = targetHttp.as(session.accessToken);

    expect((await authed.get('/admin/users')).status).toBe(403);

    await admin.client
      .patch(`/admin/users/${target.id}`)
      .send({ roles: [Role.GENERAL, Role.ADMIN] });

    // Roles come from the database on each request, not from what the token was minted with.
    expect((await authed.get('/admin/users')).status).toBe(200);
  });
});

describe('forced password change', () => {
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

  async function userOwingAPasswordChange() {
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db, { mustChangePassword: true });
    const session = await login(http, user.email);
    return { user, session, client: http.as(session.accessToken) };
  }

  it('blocks ordinary endpoints until the password is actually changed', async () => {
    const pending = await userOwingAPasswordChange();

    // The SPA redirects, but the API is what has to enforce it — otherwise the temporary
    // password an admin sends over chat stays usable forever for anyone skipping the UI.
    const blocked = await pending.client.get('/departments');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('blocks admin endpoints too, even for an admin', async () => {
    const http = httpClient(ctx.app);
    const admin = await createUser(ctx.db, {
      roles: [Role.GENERAL, Role.ADMIN],
      mustChangePassword: true,
    });
    const session = await login(http, admin.email);

    const blocked = await http.as(session.accessToken).get('/admin/users');
    expect(blocked.status).toBe(403);
  });

  it('still allows exactly the routes needed to complete the change', async () => {
    const pending = await userOwingAPasswordChange();

    expect((await pending.client.get('/auth/me')).status).toBe(200);

    const changed = await pending.client
      .post('/auth/change-password')
      .send({ currentPassword: pending.user.password, newPassword: 'FreshPassw0rdHere' });
    expect(changed.status).toBe(200);
    // The response carries a fresh session so the caller is not signed out by their own change.
    expect(changed.body.accessToken).toBeTruthy();
    expect(changed.body.user.mustChangePassword).toBe(false);
  });

  it('lets the user through everything once the change is done', async () => {
    const pending = await userOwingAPasswordChange();

    const changed = await pending.client
      .post('/auth/change-password')
      .send({ currentPassword: pending.user.password, newPassword: 'FreshPassw0rdHere' });

    // The session returned by the change is immediately usable — no re-login required.
    const authed = pending.client.as(changed.body.accessToken as string);
    expect((await authed.get('/departments')).status).toBe(200);
  });
});

describe('refresh token family lifetime', () => {
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

  it('does not extend the family expiry on rotation', async () => {
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db);
    const session = await login(http, user.email);

    const [original] = await ctx.db
      .selectFrom('refresh_tokens')
      .select('expires_at')
      .where('user_id', '=', user.id)
      .execute();

    await http.post('/auth/refresh').send({ refreshToken: session.refreshToken });

    const rows = await ctx.db
      .selectFrom('refresh_tokens')
      .select('expires_at')
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .execute();

    expect(rows).toHaveLength(1);
    // A sliding expiry would let a stolen family be rotated forever and never age out.
    expect(rows[0]!.expires_at.getTime()).toBe(original!.expires_at.getTime());
  });
});
