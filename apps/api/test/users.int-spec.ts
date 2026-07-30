import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, ROLE_VALUES, Role, type User } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { ROTATED_PASSWORD, TEST_PASSWORD } from './config/test-env';
import {
  countRefreshTokens,
  createDepartment,
  createUser,
  login,
  resetData,
  uniqueEmail,
} from './factories';

interface Admin {
  id: string;
  email: string;
  client: HttpClient;
}

describe('admin user management', () => {
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

  /** The acting administrator. Every test builds its own, so none share mutable state. */
  async function actingAdmin(): Promise<Admin> {
    const http = httpClient(ctx.app);
    const user = await createUser(ctx.db, { roles: [Role.ADMIN], designation: 'Administrator' });
    const session = await login(http, user.email);
    return { id: user.id, email: user.email, client: http.as(session.accessToken) };
  }

  function newUserBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      email: uniqueEmail('created'),
      fullName: 'Created Person',
      designation: 'Engineer',
      roles: [Role.GENERAL],
      password: TEST_PASSWORD,
      ...overrides,
    };
  }

  describe('creation', () => {
    it('creates one user of each role, and each of them can log in (Phase 00 exit criterion)', async () => {
      const admin = await actingAdmin();

      for (const role of ROLE_VALUES) {
        const body = newUserBody({ roles: [role], designation: `${role} designation` });

        const created = await admin.client.post('/admin/users').send(body);
        expect({ role, status: created.status }).toEqual({ role, status: 201 });
        expect((created.body as User).roles).toContain(role);

        const session = await login(httpClient(ctx.app), body.email as string, TEST_PASSWORD);
        expect(session.user.roles).toContain(role);
        expect(session.user.roles).toContain(Role.GENERAL);
      }
    });

    it('gives a user two roles at once — roles are additive (plan 0.5)', async () => {
      const admin = await actingAdmin();

      const created = await admin.client
        .post('/admin/users')
        .send(newUserBody({ roles: [Role.APPROVER, Role.INVENTORY_MANAGER] }));

      expect(created.status).toBe(201);
      expect([...(created.body as User).roles].sort()).toEqual([
        Role.APPROVER,
        Role.GENERAL,
        Role.INVENTORY_MANAGER,
      ]);

      const stored = await ctx.db
        .selectFrom('user_roles')
        .where('user_id', '=', (created.body as User).id)
        .select('role')
        .execute();
      expect(stored.map((r) => r.role).sort()).toEqual([
        Role.APPROVER,
        Role.GENERAL,
        Role.INVENTORY_MANAGER,
      ]);
    });

    it('adds GENERAL even when the caller omits it', async () => {
      const admin = await actingAdmin();

      const created = await admin.client
        .post('/admin/users')
        .send(newUserBody({ roles: [Role.APPROVER] }));

      expect((created.body as User).roles).toContain(Role.GENERAL);
    });

    it('attaches the user to a department', async () => {
      const admin = await actingAdmin();
      const department = await createDepartment(ctx.db);

      const created = await admin.client
        .post('/admin/users')
        .send(newUserBody({ departmentId: department.id }));

      expect(created.status).toBe(201);
      expect((created.body as User).departmentId).toBe(department.id);
      expect((created.body as User).departmentName).toBe(department.name);
    });

    it.each([
      ['missing', undefined],
      ['blank', ''],
      ['whitespace only', '   '],
      ['a single character', 'x'],
    ])('rejects a designation that is %s (plan 0.5 — it prints on the BOM)', async (_label, value) => {
      const admin = await actingAdmin();
      const body = newUserBody();
      if (value === undefined) delete body.designation;
      else body.designation = value;

      const response = await admin.client.post('/admin/users').send(body);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('rejects a duplicate email with CONFLICT', async () => {
      const admin = await actingAdmin();
      const email = uniqueEmail('duplicate');
      const first = await admin.client.post('/admin/users').send(newUserBody({ email }));
      expect(first.status).toBe(201);

      const second = await admin.client.post('/admin/users').send(newUserBody({ email }));

      expect(second.status).toBe(409);
      expect(second.body.code).toBe(ErrorCode.CONFLICT);
    });

    it('treats a differently-cased duplicate email as the same account', async () => {
      const admin = await actingAdmin();
      const email = uniqueEmail('case');
      await admin.client.post('/admin/users').send(newUserBody({ email }));

      const second = await admin.client
        .post('/admin/users')
        .send(newUserBody({ email: email.toUpperCase() }));

      expect(second.status).toBe(409);
    });

    it('rejects a password shorter than the shared minimum', async () => {
      const admin = await actingAdmin();

      // Three characters — one below PASSWORD_MIN_LENGTH.
      const response = await admin.client.post('/admin/users').send(newUserBody({ password: 'abc' }));

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    /**
     * OQ-17: the operator set the policy to length-only, minimum 4. A four-character all-lowercase
     * password with no digit is deliberately valid now, and this test is what stops someone
     * "helpfully" reinstating a complexity rule later.
     */
    it('accepts a four-character password with no digit and no capital', async () => {
      const admin = await actingAdmin();

      const response = await admin.client.post('/admin/users').send(newUserBody({ password: 'abcd' }));

      expect(response.status).toBe(201);
    });
  });

  describe('the last administrator', () => {
    it('refuses to remove ADMIN from the only active administrator', async () => {
      const admin = await actingAdmin();

      const response = await admin.client
        .patch(`/admin/users/${admin.id}`)
        .send({ roles: [Role.GENERAL] });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCode.CONFLICT);

      // And the role really is still there — a refused request must not half-apply.
      const roles = await ctx.db
        .selectFrom('user_roles')
        .where('user_id', '=', admin.id)
        .select('role')
        .execute();
      expect(roles.map((r) => r.role)).toContain(Role.ADMIN);
    });

    it('refuses to let an administrator drop their own ADMIN role even when another exists', async () => {
      const admin = await actingAdmin();
      await createUser(ctx.db, { roles: [Role.ADMIN] });

      const response = await admin.client
        .patch(`/admin/users/${admin.id}`)
        .send({ roles: [Role.GENERAL] });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.FORBIDDEN);
    });

    it('allows removing ADMIN from someone else once a second administrator exists', async () => {
      const admin = await actingAdmin();
      const other = await createUser(ctx.db, { roles: [Role.ADMIN] });

      const response = await admin.client
        .patch(`/admin/users/${other.id}`)
        .send({ roles: [Role.GENERAL] });

      expect(response.status).toBe(200);
      expect((response.body as User).roles).toEqual([Role.GENERAL]);
    });

    it('refuses to deactivate your own account', async () => {
      const admin = await actingAdmin();

      const response = await admin.client
        .patch(`/admin/users/${admin.id}/active`)
        .send({ isActive: false });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.FORBIDDEN);

      const row = await ctx.db
        .selectFrom('users')
        .where('id', '=', admin.id)
        .select('is_active')
        .executeTakeFirstOrThrow();
      expect(row.is_active).toBe(true);
    });

    it('counts *active* administrators, so deactivating the spare re-locks the role', async () => {
      const admin = await actingAdmin();
      const spare = await createUser(ctx.db, { roles: [Role.ADMIN] });

      // Two active admins: dropping your own role is refused as "not on yourself", not as
      // "last admin" — a different rule, and the status distinguishes them.
      const whileSpareIsActive = await admin.client
        .patch(`/admin/users/${admin.id}`)
        .send({ roles: [Role.GENERAL] });
      expect(whileSpareIsActive.status).toBe(403);

      const deactivated = await admin.client
        .patch(`/admin/users/${spare.id}/active`)
        .send({ isActive: false });
      expect(deactivated.status).toBe(200);

      // The spare still holds the ADMIN row but is inactive, so it no longer counts.
      const whileSpareIsInactive = await admin.client
        .patch(`/admin/users/${admin.id}`)
        .send({ roles: [Role.GENERAL] });
      expect(whileSpareIsInactive.status).toBe(409);
      expect(whileSpareIsInactive.body.code).toBe(ErrorCode.CONFLICT);
    });

    it('lets an administrator deactivate another administrator', async () => {
      const admin = await actingAdmin();
      const other = await createUser(ctx.db, { roles: [Role.ADMIN] });

      const response = await admin.client
        .patch(`/admin/users/${other.id}/active`)
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect((response.body as User).isActive).toBe(false);

      const blocked = await httpClient(ctx.app)
        .post('/auth/login')
        .send({ email: other.email, password: TEST_PASSWORD });
      expect(blocked.body.code).toBe(ErrorCode.ACCOUNT_DEACTIVATED);
    });
  });

  describe('session invalidation', () => {
    it('kills a deactivated user`s refresh tokens immediately, not at token expiry', async () => {
      const admin = await actingAdmin();
      const victimHttp = httpClient(ctx.app);
      const victim = await createUser(ctx.db);
      const session = await login(victimHttp, victim.email);
      expect(await countRefreshTokens(ctx.db, victim.id, true)).toBe(1);

      const deactivated = await admin.client
        .patch(`/admin/users/${victim.id}/active`)
        .send({ isActive: false });
      expect(deactivated.status).toBe(200);

      expect(await countRefreshTokens(ctx.db, victim.id, true)).toBe(0);

      const refreshed = await victimHttp
        .post('/auth/refresh')
        .send({ refreshToken: session.refreshToken });
      expect(refreshed.status).toBe(401);

      // The still-unexpired access token is refused too, because /auth/me re-reads the account.
      const me = await victimHttp.as(session.accessToken).get('/auth/me');
      expect(me.status).toBe(403);
      expect(me.body.code).toBe(ErrorCode.ACCOUNT_DEACTIVATED);

      const loginAgain = await victimHttp
        .post('/auth/login')
        .send({ email: victim.email, password: TEST_PASSWORD });
      expect(loginAgain.body.code).toBe(ErrorCode.ACCOUNT_DEACTIVATED);
    });

    it('kills existing sessions when an admin resets a password', async () => {
      const admin = await actingAdmin();
      const targetHttp = httpClient(ctx.app);
      const target = await createUser(ctx.db);
      const session = await login(targetHttp, target.email);

      const reset = await admin.client
        .post(`/admin/users/${target.id}/password`)
        .send({ newPassword: ROTATED_PASSWORD });
      expect(reset.status).toBe(204);

      expect(await countRefreshTokens(ctx.db, target.id, true)).toBe(0);

      const refreshed = await targetHttp
        .post('/auth/refresh')
        .send({ refreshToken: session.refreshToken });
      expect(refreshed.status).toBe(401);

      const oldPassword = await targetHttp
        .post('/auth/login')
        .send({ email: target.email, password: TEST_PASSWORD });
      expect(oldPassword.status).toBe(401);

      const newPassword = await httpClient(ctx.app)
        .post('/auth/login')
        .send({ email: target.email, password: ROTATED_PASSWORD });
      expect(newPassword.status).toBe(200);
      expect((newPassword.body as { user: User }).user.mustChangePassword).toBe(true);
    });

    it('lets a user change their own password and keeps the actor from the token, not the body', async () => {
      const victimHttp = httpClient(ctx.app);
      const attackerHttp = httpClient(ctx.app);
      const victim = await createUser(ctx.db);
      const attacker = await createUser(ctx.db);
      const attackerSession = await login(attackerHttp, attacker.email);

      // A client-supplied id must not be able to redirect the change onto another account.
      const attempt = await attackerHttp.as(attackerSession.accessToken).post('/auth/change-password').send({
        userId: victim.id,
        id: victim.id,
        currentPassword: TEST_PASSWORD,
        newPassword: ROTATED_PASSWORD,
      });
      // 200 with a fresh session: the change succeeded, but for the ATTACKER's own account.
      expect(attempt.status).toBe(200);

      const victimUnchanged = await victimHttp
        .post('/auth/login')
        .send({ email: victim.email, password: TEST_PASSWORD });
      expect(victimUnchanged.status).toBe(200);

      const attackerChanged = await httpClient(ctx.app)
        .post('/auth/login')
        .send({ email: attacker.email, password: ROTATED_PASSWORD });
      expect(attackerChanged.status).toBe(200);
    });
  });

  describe('listing', () => {
    it('excludes deactivated users unless asked for them', async () => {
      const admin = await actingAdmin();
      // Scoped by a unique designation rather than reading page one of the whole list: rows
      // that other specs cannot clean up (a user who approved a requisition is never deleted)
      // would otherwise push these two off the first page and fail for the wrong reason.
      const marker = `listing-${randomUUID()}`;
      const active = await createUser(ctx.db, { isActive: true, designation: marker });
      const inactive = await createUser(ctx.db, { isActive: false, designation: marker });

      const byDefault = await admin.client.get(`/admin/users?search=${marker}`);
      const ids = (byDefault.body.items as User[]).map((u) => u.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(inactive.id);

      const including = await admin.client.get(
        `/admin/users?search=${marker}&includeInactive=true`,
      );
      expect((including.body.items as User[]).map((u) => u.id)).toContain(inactive.id);
    });

    it('never returns a password hash', async () => {
      const admin = await actingAdmin();
      await createUser(ctx.db);

      const response = await admin.client.get('/admin/users');

      expect(JSON.stringify(response.body)).not.toContain('$argon2');
      for (const item of response.body.items as User[]) {
        expect(Object.keys(item)).not.toContain('password_hash');
        expect(Object.keys(item)).not.toContain('passwordHash');
      }
    });
  });
});
