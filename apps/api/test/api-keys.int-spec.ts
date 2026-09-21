import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiKeyScope, ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUserAndLogin, resetData } from './factories';

/**
 * Phase 10 — API keys.
 *
 * This feature is almost entirely a permission boundary, which `rules/50-testing.md` puts at
 * priority 4, so the bar here is higher than a happy path. The property that matters is
 * **default-deny**: a key reaches a route only if that route carries `@ApiKeyScopes`. The
 * tempting implementation — give the key a synthetic `request.user` — would quietly hand it
 * every "any authenticated user" route in the system, so most of what follows is proving that
 * did not happen.
 */
describe('API keys', () => {
  let ctx: TestApp;
  let admin: HttpClient;

  /** Issues a key and returns the raw token. The only moment it is ever readable. */
  async function issueKey(
    options: { name?: string; expiresInDays?: number | null } = {},
  ): Promise<{ token: string; id: string }> {
    const response = await admin.post('/admin/api-keys').send({
      name: options.name ?? 'Test integration',
      scopes: [ApiKeyScope.INVENTORY_READ],
      expiresInDays: options.expiresInDays ?? null,
    });
    expect(response.status).toBe(201);
    return { token: response.body.token as string, id: response.body.key.id as string };
  }

  /** A client presenting a key rather than a session. */
  function asKey(token: string): HttpClient {
    return httpClient(ctx.app, { token });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.ADMIN],
    });
    admin = session.client;
  });

  describe('issuing', () => {
    it('returns the raw token exactly once, and never again', async () => {
      const { token, id } = await issueKey();
      expect(token).toMatch(/^ims_/);

      const list = await admin.get('/admin/api-keys');
      expect(list.status).toBe(200);
      const found = list.body.items.find((k: { id: string }) => k.id === id);
      expect(found).toBeDefined();
      // Not the token, not its hash, not a fragment long enough to be useful.
      expect(JSON.stringify(found)).not.toContain(token);
      expect(found.keyPrefix.length).toBeLessThan(token.length);
    });

    it('never puts the hash in a response', async () => {
      await issueKey();
      const list = await admin.get('/admin/api-keys');
      expect(JSON.stringify(list.body)).not.toContain('token_hash');
      expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    });

    it('returns scopes as a list, not a Postgres array literal', async () => {
      const { id } = await issueKey();
      const list = await admin.get('/admin/api-keys');
      const found = list.body.items.find((k: { id: string }) => k.id === id);
      // Regression: pg has no parser for a custom enum array and hands back "{inventory:read}".
      // A string passes `.includes('inventory:read')` by substring, which is how a scope check
      // silently stops being a scope check.
      expect(Array.isArray(found.scopes)).toBe(true);
      expect(found.scopes).toEqual([ApiKeyScope.INVENTORY_READ]);
    });

    it('is refused to everyone but an admin', async () => {
      const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
        roles: [Role.INVENTORY_MANAGER],
      });
      const response = await im.client.post('/admin/api-keys').send({
        name: 'Should not exist',
        scopes: [ApiKeyScope.INVENTORY_READ],
        expiresInDays: null,
      });
      expect(response.status).toBe(403);
    });
  });

  describe('what a key can reach', () => {
    it('reads the four inventory endpoints it is scoped for', async () => {
      const { token } = await issueKey();
      const key = asKey(token);

      for (const path of ['/products', '/categories', '/locations', '/locations/rooms']) {
        const response = await key.get(path);
        expect(response.status, `GET ${path}`).toBe(200);
      }
    });

    /**
     * The test this whole design exists for. None of these routes carries `@Roles` — they are
     * "any signed-in user" — so a key holding a synthetic RequestUser would sail straight
     * through every one of them.
     */
    it('is refused on every route that does not declare a scope', async () => {
      const { token } = await issueKey();
      const key = asKey(token);

      for (const path of ['/borrowing', '/requisitions', '/projects', '/dashboard/me']) {
        const response = await key.get(path);
        expect(response.status, `GET ${path}`).toBe(403);
        expect(response.body.code, `GET ${path}`).toBe(ErrorCode.API_KEY_SCOPE_DENIED);
      }
    });

    /** A key must never be able to mint another key. */
    it('cannot reach the admin API, including the endpoint that issues keys', async () => {
      const { token } = await issueKey();
      const key = asKey(token);

      for (const path of ['/admin/users', '/admin/api-keys']) {
        const response = await key.get(path);
        expect(response.status, `GET ${path}`).toBe(403);
      }
    });

    it('is read-only, even on a route it is scoped for', async () => {
      const { token } = await issueKey();
      const response = await asKey(token)
        .post('/products')
        .send({ name: 'Smuggled', unit: 'pcs', defaultReturnable: true, categoryId: null });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.API_KEY_SCOPE_DENIED);
    });
  });

  describe('lifecycle', () => {
    it('stops working when disabled and works again when re-enabled', async () => {
      const { token, id } = await issueKey();
      const key = asKey(token);
      expect((await key.get('/products')).status).toBe(200);

      await admin.patch(`/admin/api-keys/${id}`).send({ isActive: false });
      const disabled = await key.get('/products');
      expect(disabled.status).toBe(403);
      // Distinct from INVALID so the integrator knows to ask their admin (OQ-G2).
      expect(disabled.body.code).toBe(ErrorCode.API_KEY_DISABLED);

      await admin.patch(`/admin/api-keys/${id}`).send({ isActive: true });
      expect((await key.get('/products')).status).toBe(200);
    });

    it('stops working when revoked, and cannot be re-enabled', async () => {
      const { token, id } = await issueKey();
      await admin.delete(`/admin/api-keys/${id}`);

      const revoked = await asKey(token).get('/products');
      expect(revoked.status).toBe(401);
      expect(revoked.body.code).toBe(ErrorCode.API_KEY_INVALID);

      // Revocation is final — the CHECK constraint refuses an active revoked row, and the
      // service refuses before it gets there.
      const reEnable = await admin.patch(`/admin/api-keys/${id}`).send({ isActive: true });
      expect(reEnable.status).toBe(409);
      expect((await asKey(token).get('/products')).status).toBe(401);
    });

    it('refuses a key that is past its expiry', async () => {
      const { token, id } = await issueKey({ expiresInDays: 30 });
      expect((await asKey(token).get('/products')).status).toBe(200);

      // Wind the clock rather than the calendar: the alternative is a sleep.
      await ctx.db
        .updateTable('api_keys')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('id', '=', id)
        .execute();

      const expired = await asKey(token).get('/products');
      expect(expired.status).toBe(401);
      expect(expired.body.code).toBe(ErrorCode.API_KEY_INVALID);
    });

    /** Ayman asked for this explicitly: some integrations outlive the person who set them up. */
    it('never expires when issued with no expiry', async () => {
      const { token, id } = await issueKey({ expiresInDays: null });
      const row = await ctx.db
        .selectFrom('api_keys')
        .select('expires_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.expires_at).toBeNull();
      expect((await asKey(token).get('/products')).status).toBe(200);
    });

    it('refuses a key that was never issued', async () => {
      const response = await asKey('ims_thisWasNeverIssuedByAnybody').get('/products');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.API_KEY_INVALID);
    });

    it('records when a key was last used', async () => {
      const { token, id } = await issueKey();
      const before = await ctx.db
        .selectFrom('api_keys')
        .select('last_used_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(before.last_used_at).toBeNull();

      await asKey(token).get('/products');

      // The stamp is written fire-and-forget, so it may land just after the response.
      await expect
        .poll(async () => {
          const row = await ctx.db
            .selectFrom('api_keys')
            .select('last_used_at')
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          return row.last_used_at !== null;
        })
        .toBe(true);
    });
  });

  describe('sessions are unaffected', () => {
    /**
     * The regression that matters most. Adding `@ApiKeyScopes` to five routes must not change
     * what a logged-in human can do on any of them.
     */
    it('still lets an ordinary user read every route a key can', async () => {
      const general = await createUserAndLogin(ctx.db, httpClient(ctx.app), {});
      for (const path of ['/products', '/categories', '/locations', '/locations/rooms']) {
        const response = await general.client.get(path);
        expect(response.status, `GET ${path}`).toBe(200);
      }
    });

    it('still refuses an unauthenticated caller on those routes', async () => {
      const anonymous = httpClient(ctx.app);
      const response = await anonymous.get('/products');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
    });
  });

  describe('the generated usage document', () => {
    /**
     * Generated from the live route table, so this asserts the mechanism rather than a list:
     * a hand-maintained list is exactly what the feature exists to avoid.
     */
    it('lists every route that declares a scope, and nothing else', async () => {
      const response = await admin.get('/admin/api-keys/usage');
      expect(response.status).toBe(200);

      const paths = response.body.endpoints.map((e: { path: string }) => e.path).sort();
      expect(paths).toEqual([
        '/categories',
        '/locations',
        '/locations/rooms',
        '/products',
        '/products/:id',
      ]);
      expect(
        response.body.endpoints.every((e: { method: string }) => e.method === 'GET'),
      ).toBe(true);
    });

    it('describes the query parameters a caller may send', async () => {
      const response = await admin.get('/admin/api-keys/usage');
      const products = response.body.endpoints.find(
        (e: { path: string }) => e.path === '/products',
      );
      const names = products.queryParams.map((p: { name: string }) => p.name);
      expect(names).toContain('limit');
      expect(names).toContain('search');
      // Every one has a default, so an integrator has to send none of them.
      expect(products.queryParams.every((p: { required: boolean }) => !p.required)).toBe(true);
    });
  });
});
