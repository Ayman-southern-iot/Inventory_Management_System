import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type TestApp } from './app';
import { createUser, createUserAndLogin, login, resetData } from './factories';

/**
 * A refresh token can die for several reasons, and the user is told a different thing for
 * each. Getting this wrong is not a security hole — the session is dead either way — but it
 * tells a user whose password an administrator just reset that they may have been hacked.
 *
 * The reason is recorded on the row (migration 0005) rather than inferred, because the two
 * cases that matter are indistinguishable from the other columns: a token killed by the
 * theft response and a token killed by an administrator both have a null `replaced_by_id`.
 */
describe('refresh token revocation reasons', () => {
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

  it('reports SESSION_REVOKED, not theft, when an administrator deactivates the account', async () => {
    const admin = await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.GENERAL, Role.ADMIN] });
    const victimHttp = httpClient(ctx.app);
    const victim = await createUser(ctx.db);
    const session = await login(victimHttp, victim.email);

    await admin.client.patch(`/admin/users/${victim.id}/active`).send({ isActive: false });

    const refreshed = await victimHttp
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken });

    expect(refreshed.status).toBe(401);
    expect(refreshed.body.code).toBe(ErrorCode.SESSION_REVOKED);
    expect(refreshed.body.message).not.toMatch(/security/i);
  });

  it('reports SESSION_REVOKED when an administrator resets the password', async () => {
    const admin = await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.GENERAL, Role.ADMIN] });
    const victimHttp = httpClient(ctx.app);
    const victim = await createUser(ctx.db);
    const session = await login(victimHttp, victim.email);

    await admin.client
      .post(`/admin/users/${victim.id}/password`)
      .send({ newPassword: 'BrandNewPassw0rd', mustChangePassword: true });

    const refreshed = await victimHttp
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken });

    expect(refreshed.status).toBe(401);
    expect(refreshed.body.code).toBe(ErrorCode.SESSION_REVOKED);
  });

  it('still reports TOKEN_REUSE_DETECTED when a rotated token is genuinely replayed', async () => {
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db);
    const first = await login(http, user.email);

    const rotated = await http.post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);

    // Replaying the token that was rotated away is the theft signal, and must stay loud.
    const replay = await http.post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe(ErrorCode.TOKEN_REUSE_DETECTED);
  });

  it('does not soften a token killed by the theft response into SESSION_REVOKED', async () => {
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db);
    const first = await login(http, user.email);

    const rotated = await http.post('/auth/refresh').send({ refreshToken: first.refreshToken });
    const newest = rotated.body.refreshToken as string;

    await http.post('/auth/refresh').send({ refreshToken: first.refreshToken });

    // `newest` was revoked by the family kill, not by an administrator. Inferring the reason
    // from `replaced_by_id` used to get this exact case wrong.
    const afterFamilyKill = await http.post('/auth/refresh').send({ refreshToken: newest });
    expect(afterFamilyKill.status).toBe(401);
    expect(afterFamilyKill.body.code).toBe(ErrorCode.TOKEN_REUSE_DETECTED);
  });

  it('records a reason on every revoked row, so the CHECK constraint cannot be dodged', async () => {
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db);
    const session = await login(http, user.email);
    await http.post('/auth/refresh').send({ refreshToken: session.refreshToken });

    const orphaned = await ctx.db
      .selectFrom('refresh_tokens')
      .select('id')
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is not', null)
      .where('revoked_reason', 'is', null)
      .execute();

    expect(orphaned).toHaveLength(0);
  });

  it('marks a logout as LOGOUT rather than leaving it indistinguishable from theft', async () => {
    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app));
    await session.client.post('/auth/logout').send({ refreshToken: session.session.refreshToken });

    const rows = await ctx.db
      .selectFrom('refresh_tokens')
      .select('revoked_reason')
      .where('user_id', '=', session.user.id)
      .where('revoked_at', 'is not', null)
      .execute();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.revoked_reason).toBe('LOGOUT');
  });

  it('leaves a live session with no revocation reason at all', async () => {
    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app));
    const live = await ctx.db
      .selectFrom('refresh_tokens')
      .select(['revoked_at', 'revoked_reason'])
      .where('user_id', '=', session.user.id)
      .execute();

    expect(live).toHaveLength(1);
    expect(live[0]?.revoked_at).toBeNull();
    expect(live[0]?.revoked_reason).toBeNull();
  });
});
