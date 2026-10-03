import { createHash, randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_KEY_QUERY_PARAM,
  ApiKeyScope,
  ErrorCode,
  Role,
  isReadOnlyApiKeyScope,
} from '@ims/shared';
import { API_KEY_SCOPES_KEY } from '../src/modules/api-keys/api-key.decorators';
import { IS_PUBLIC_KEY } from '../src/modules/auth/auth.decorators';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { RequisitionsRepository } from '../src/modules/requisitions/requisitions.repository';
import { StockService } from '../src/modules/stock/stock.service';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import {
  createServiceAccount,
  issueBoundKey,
  serviceAccountWithKnownPassword,
} from './api-key-factories';
import { createUser, createUserAndLogin, login, resetData } from './factories';
import { TEST_PASSWORD } from './config/test-env';
import { createCategory, createStockFixture, createRoom } from './stock-factories';

/**
 * ADR-0002 — API keys that can act, through a service account.
 *
 * Phase 10 made keys safe by giving them no principal at all. Writing needs one, so this suite
 * is mostly about the two ways that can go wrong: a key reaching something it should not (the
 * route walk at the bottom proves default-deny against the live route table), and a service
 * account being treated as a *person* — sent notifications, handed a requisition to review,
 * offered in a picker, or signed in as.
 */

const ALL_SCOPES = Object.values(ApiKeyScope);

describe('API keys that act (ADR-0002)', () => {
  let ctx: TestApp;
  let admin: HttpClient;
  let adminUserId: string;

  const asKey = (token: string): HttpClient => httpClient(ctx.app, { token });

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
    adminUserId = session.user.id;
  });

  /* ---------------------------------------------------------------- issuing */

  describe('issuing a key that can write', () => {
    it('refuses a write scope with no service account', async () => {
      const response = await admin.post('/admin/api-keys').send({
        name: 'No principal',
        scopes: [ApiKeyScope.STOCK_TAKE],
        expiresInDays: 30,
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
      // Refused for the missing principal, not for anything else about the body.
      expect(JSON.stringify(response.body.details)).toContain('serviceAccountId');
    });

    it('refuses a write key that never expires (OQ-KT3)', async () => {
      const serviceAccountId = await createServiceAccount(admin);
      const response = await admin.post('/admin/api-keys').send({
        name: 'Forever writer',
        scopes: [ApiKeyScope.CATALOG_WRITE],
        expiresInDays: null,
        serviceAccountId,
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('refuses a write key that would outlive API_KEY_WRITE_MAX_LIFETIME_DAYS', async () => {
      const serviceAccountId = await createServiceAccount(admin);
      const response = await admin.post('/admin/api-keys').send({
        name: 'Too long',
        scopes: [ApiKeyScope.CATALOG_WRITE],
        // TEST_ENV pins the ceiling at 180, the production default.
        expiresInDays: 181,
        serviceAccountId,
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(JSON.stringify(response.body.details)).toContain('expiresInDays');
    });

    it('refuses to bind a key to a person', async () => {
      const response = await admin.post('/admin/api-keys').send({
        name: 'Impersonator',
        scopes: [ApiKeyScope.CATALOG_WRITE],
        expiresInDays: 30,
        serviceAccountId: adminUserId,
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(JSON.stringify(response.body.details)).toContain('serviceAccountId');
    });

    /** The service check is for a sentence; this is the guarantee behind it (migration 0039). */
    it('is refused by the database too, if anything ever skipped the service', async () => {
      await expect(
        ctx.db
          .insertInto('api_keys')
          .values({
            name: 'Bypass',
            key_prefix: `ims_${randomUUID().slice(0, 8)}`,
            token_hash: randomUUID(),
            scopes: ['stock:take'] as never,
            expires_at: new Date(Date.now() + 86_400_000),
            created_by: adminUserId,
            service_user_id: adminUserId,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('stores only the hash of a write key and returns the token exactly once', async () => {
      const { token, keyId } = await issueBoundKey(admin, [ApiKeyScope.STOCK_TAKE]);
      const row = await ctx.db
        .selectFrom('api_keys')
        .select(['token_hash'])
        .where('id', '=', keyId)
        .executeTakeFirstOrThrow();
      expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));

      const list = await admin.get('/admin/api-keys');
      expect(JSON.stringify(list.body)).not.toContain(token);
      expect(JSON.stringify(list.body)).not.toContain(row.token_hash);
    });

    it('still issues a read-only key with no account and no expiry (K6 unchanged)', async () => {
      const response = await admin.post('/admin/api-keys').send({
        name: 'Catalogue sync',
        scopes: [ApiKeyScope.INVENTORY_READ],
        expiresInDays: null,
      });
      expect(response.status).toBe(201);
      expect(response.body.key.serviceAccountId).toBeNull();
      expect(response.body.key.expiresAt).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- service accounts */

  describe('a service account', () => {
    it('is created by an admin with exactly GENERAL and INVENTORY_MANAGER, and audited', async () => {
      const id = await createServiceAccount(admin, 'Lab drawer panel C576');

      const user = await ctx.db
        .selectFrom('users')
        .select(['is_service_account', 'is_active', 'full_name'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(user).toMatchObject({ is_service_account: true, is_active: true });
      expect(user.full_name).toBe('Lab drawer panel C576');

      const roles = await ctx.db
        .selectFrom('user_roles')
        .select('role')
        .where('user_id', '=', id)
        .orderBy('role')
        .execute();
      expect(roles.map((r) => r.role)).toEqual([Role.GENERAL, Role.INVENTORY_MANAGER]);

      const audit = await ctx.db
        .selectFrom('audit_log')
        .select(['action', 'actor_id'])
        .where('entity_id', '=', id)
        .execute();
      expect(audit).toEqual([{ action: 'service_account.create', actor_id: adminUserId }]);
    });

    it('can only be created by an admin', async () => {
      const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
        roles: [Role.INVENTORY_MANAGER],
      });
      const response = await im.client.post('/admin/api-keys/service-accounts').send({ name: 'x' });
      expect(response.status).toBe(403);
    });

    it('cannot sign in, even with the right password', async () => {
      const account = await serviceAccountWithKnownPassword(ctx.db, [Role.INVENTORY_MANAGER]);
      const response = await httpClient(ctx.app)
        .post('/auth/login')
        .send({ email: account.email, password: TEST_PASSWORD });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    });

    it('is not offered in the user admin list or any people picker', async () => {
      const id = await createServiceAccount(admin);
      const approver = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
        roles: [Role.APPROVER],
      });

      const adminList = await admin.get('/admin/users?limit=100&role=INVENTORY_MANAGER');
      expect(adminList.status).toBe(200);
      expect(adminList.body.items.map((u: { id: string }) => u.id)).not.toContain(id);

      const picker = await approver.client.get(
        '/users/selectable?limit=100&role=INVENTORY_MANAGER',
      );
      expect(picker.status).toBe(200);
      expect(picker.body.items.map((u: { id: string }) => u.id)).not.toContain(id);
    });

    it('cannot be edited, switched off or given a password through the user admin paths', async () => {
      const id = await createServiceAccount(admin);
      const edit = await admin.patch(`/admin/users/${id}`).send({ fullName: 'Renamed' });
      const active = await admin.patch(`/admin/users/${id}/active`).send({ isActive: false });
      const password = await admin
        .post(`/admin/users/${id}/password`)
        .send({ newPassword: 'abcd1234', mustChangePassword: false });
      for (const response of [edit, active, password]) {
        expect(response.status).toBe(409);
        expect(response.body.code).toBe(ErrorCode.CONFLICT);
      }
    });

    /*
     * The two resolvers that turn "INVENTORY_MANAGER" into people. The service account is made
     * the *oldest* IM, because `findAnyActiveUserWithRole` picks by `created_at` — without the
     * filter it would be the one handed the requisition.
     */
    it('is never the IM a requisition is assigned to, nor an IM who is notified', async () => {
      const serviceAccountId = await createServiceAccount(admin);
      // `created_at` is insert-only in the typed schema; ageing a row is test-only surgery.
      await sql`UPDATE users SET created_at = '2000-01-01T00:00:00Z' WHERE id = ${serviceAccountId}`.execute(
        ctx.db,
      );
      const humanIm = await createUser(ctx.db, { roles: [Role.INVENTORY_MANAGER] });

      const assignee = await ctx.app
        .get(RequisitionsRepository, { strict: false })
        .findAnyActiveUserWithRole(Role.INVENTORY_MANAGER);
      expect(assignee).not.toBe(serviceAccountId);

      const recipients = await ctx.app
        .get(NotificationsService, { strict: false })
        .usersWithRole(Role.INVENTORY_MANAGER);
      expect(recipients).toContain(humanIm.id);
      expect(recipients).not.toContain(serviceAccountId);
    });

    it('does not receive the "new borrow" notice that every IM gets', async () => {
      const serviceAccountId = await createServiceAccount(admin);
      const humanIm = await createUser(ctx.db, { roles: [Role.INVENTORY_MANAGER] });
      const fixture = await createStockFixture(ctx.db);
      await ctx.app
        .get(StockService, { strict: false })
        .receive(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
          { performedBy: humanIm.id, refType: 'TEST' },
        );
      const requester = await createUserAndLogin(ctx.db, httpClient(ctx.app), {});
      const raised = await requester.client.post('/borrowing').send({
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 1,
        isReturnable: false,
        expectedReturnDate: null,
        purpose: null,
      });
      expect(raised.status).toBe(201);

      const notified = await ctx.db
        .selectFrom('notifications')
        .select('user_id')
        .where('type', '=', 'borrowing.requested')
        .where('entity_id', '=', raised.body.id)
        .execute();
      const userIds = notified.map((n) => n.user_id);
      expect(userIds).toContain(humanIm.id);
      expect(userIds).not.toContain(serviceAccountId);
    });

    it('cannot be named as the holder of an IM handover or a reassignment', async () => {
      const serviceAccountId = await createServiceAccount(admin);
      const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
        roles: [Role.INVENTORY_MANAGER],
      });
      const fixture = await createStockFixture(ctx.db);
      await ctx.app
        .get(StockService, { strict: false })
        .receive(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
          { performedBy: im.user.id, refType: 'TEST' },
        );

      const toAccount = await im.client.post('/borrowing/issue-from-stock').send({
        borrowerId: serviceAccountId,
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 1,
        isReturnable: false,
      });
      expect(toAccount.status).toBe(404);

      const person = await createUser(ctx.db, {});
      const toPerson = await im.client.post('/borrowing/issue-from-stock').send({
        borrowerId: person.id,
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 1,
        isReturnable: false,
      });
      expect(toPerson.status).toBe(201);
      const reassign = await im.client
        .post(`/borrowing/${toPerson.body.id}/holder`)
        .send({ holderId: serviceAccountId, reason: 'test' });
      expect(reassign.status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------- acting */

  describe('a bound key acting', () => {
    it('creates a product, and the audit row names the account and the key', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const response = await asKey(key.token)
        .post('/products')
        .send({ name: `Resistor ${randomUUID().slice(0, 6)}`, unit: 'pcs' });
      expect(response.status, JSON.stringify(response.body)).toBe(201);

      const audit = await ctx.db
        .selectFrom('audit_log')
        .select(['actor_id', 'api_key_id'])
        .where('entity_id', '=', response.body.id)
        .execute();
      expect(audit.length).toBeGreaterThan(0);
      for (const row of audit) {
        expect(row).toEqual({ actor_id: key.serviceAccountId, api_key_id: key.keyId });
      }
    });

    it('a session leaves api_key_id empty on the same action', async () => {
      const response = await admin
        .post('/products')
        .send({ name: `Capacitor ${randomUUID().slice(0, 6)}`, unit: 'pcs' });
      expect(response.status).toBe(201);
      const audit = await ctx.db
        .selectFrom('audit_log')
        .select(['actor_id', 'api_key_id'])
        .where('entity_id', '=', response.body.id)
        .execute();
      expect(audit.length).toBeGreaterThan(0);
      for (const row of audit) expect(row).toEqual({ actor_id: adminUserId, api_key_id: null });
    });

    it('receives stock, and the ledger records the service account as the one who did it', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.STOCK_RECEIVE]);
      const fixture = await createStockFixture(ctx.db);
      const response = await asKey(key.token)
        .post('/stock/receive')
        .set('Idempotency-Key', randomUUID())
        .send({ productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 7 });
      expect(response.status, JSON.stringify(response.body)).toBe(200);

      const ledger = await ctx.db
        .selectFrom('stock_ledger')
        .select(['movement_type', 'quantity', 'performed_by'])
        .where('product_id', '=', fixture.productId)
        .execute();
      expect(ledger).toEqual([
        { movement_type: 'RECEIPT', quantity: 7, performed_by: key.serviceAccountId },
      ]);
    });

    it('creates a zone with locations:write', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.LOCATIONS_WRITE]);
      const roomId = await createRoom(ctx.db);
      const response = await asKey(key.token)
        .post('/locations/zones')
        .send({ name: `Zone ${randomUUID().slice(0, 6)}`, roomId });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    });

    it('is refused a write its scopes do not cover', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const fixture = await createStockFixture(ctx.db);
      const response = await asKey(key.token)
        .post('/stock/receive')
        .send({ productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.API_KEY_SCOPE_DENIED);
    });

    /** Scopes narrow; `@Roles` still applies on top of them. */
    it('is refused when its account no longer holds the role the route demands', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      await ctx.db
        .deleteFrom('user_roles')
        .where('user_id', '=', key.serviceAccountId)
        .where('role', '=', Role.INVENTORY_MANAGER)
        .execute();
      const response = await asKey(key.token).post('/products').send({ name: 'Nope', unit: 'pcs' });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.FORBIDDEN);
    });

    it('stops every key at once when the account is deactivated, and resumes when reactivated', async () => {
      const first = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const second = await issueBoundKey(admin, [ApiKeyScope.INVENTORY_READ], {
        serviceAccountId: first.serviceAccountId,
      });

      const off = await admin
        .patch(`/admin/api-keys/service-accounts/${first.serviceAccountId}`)
        .send({ isActive: false });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ isActive: false, activeKeyCount: 2 });

      for (const token of [first.token, second.token]) {
        const response = await asKey(token).get('/products');
        expect(response.status).toBe(403);
        expect(response.body.code).toBe(ErrorCode.API_KEY_DISABLED);
      }
      // The key list must say so too: each key is still enabled, its account is not.
      const listed = await admin.get('/admin/api-keys');
      for (const id of [first.keyId, second.keyId]) {
        const row = (
          listed.body.items as Array<{ id: string; isActive: boolean; serviceAccountIsActive: boolean }>
        ).find((k) => k.id === id);
        expect(row).toMatchObject({ isActive: true, serviceAccountIsActive: false });
      }

      const on = await admin
        .patch(`/admin/api-keys/service-accounts/${first.serviceAccountId}`)
        .send({ isActive: true });
      expect(on.status).toBe(200);
      expect((await asKey(second.token).get('/products')).status).toBe(200);
    });

    it('counts only keys that would still work as the account\'s active keys', async () => {
      const live = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const expired = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE], {
        serviceAccountId: live.serviceAccountId,
      });
      await ctx.db
        .updateTable('api_keys')
        .set({ expires_at: new Date(Date.now() - 60_000) })
        .where('id', '=', expired.keyId)
        .execute();
      const accounts = await admin.get('/admin/api-keys/service-accounts');
      expect(
        (accounts.body as Array<{ id: string; activeKeyCount: number }>).find(
          (a) => a.id === live.serviceAccountId,
        ),
      ).toMatchObject({ activeKeyCount: 1 });
    });

    it('is refused once revoked (401) or past its expiry (401)', async () => {
      const revoked = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      expect((await admin.delete(`/admin/api-keys/${revoked.keyId}`)).status).toBe(204);
      const afterRevoke = await asKey(revoked.token).get('/products');
      expect(afterRevoke.status).toBe(401);
      expect(afterRevoke.body.code).toBe(ErrorCode.API_KEY_INVALID);

      const expired = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      await ctx.db
        .updateTable('api_keys')
        .set({ expires_at: new Date(Date.now() - 60_000) })
        .where('id', '=', expired.keyId)
        .execute();
      const afterExpiry = await asKey(expired.token).get('/products');
      expect(afterExpiry.status).toBe(401);
      expect(afterExpiry.body.code).toBe(ErrorCode.API_KEY_INVALID);
    });
  });

  /* ---------------------------------------------------------------- receive from a key */

  /**
   * OQ-KT10 (Arif, 2026-09-29): a key must send an Idempotency-Key on receive. A retried
   * receive silently doubles stock, and reconciliation cannot see it — the ledger and the
   * placements agree. A person in the web app is unchanged: the SPA does not send one today.
   */
  describe('receiving stock with a key', () => {
    const ledgerCount = async (productId: string) =>
      Number(
        (
          await ctx.db
            .selectFrom('stock_ledger')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('product_id', '=', productId)
            .executeTakeFirstOrThrow()
        ).n,
      );

    it('refuses a key that sends no Idempotency-Key, and receives nothing', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.STOCK_RECEIVE]);
      const fixture = await createStockFixture(ctx.db);
      const response = await asKey(key.token)
        .post('/stock/receive')
        .send({ productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(JSON.stringify(response.body.details).toLowerCase()).toContain('idempotency-key');
      expect(await ledgerCount(fixture.productId)).toBe(0);
    });

    it('receives once when a key replays the same Idempotency-Key', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.STOCK_RECEIVE]);
      const fixture = await createStockFixture(ctx.db);
      const idem = randomUUID();
      const send = () =>
        asKey(key.token)
          .post('/stock/receive')
          .set('Idempotency-Key', idem)
          .send({ productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 });
      const first = await send();
      const second = await send();
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(second.status).toBe(200);
      expect(await ledgerCount(fixture.productId)).toBe(1);
    });

    it('still lets a signed-in person receive without one, as today', async () => {
      const fixture = await createStockFixture(ctx.db);
      const response = await admin
        .post('/stock/receive')
        .send({ productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await ledgerCount(fixture.productId)).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- archiving is a person's call */

  /**
   * OQ-KT12 (Arif, 2026-09-29): `catalog:write` creates and edits, but a key can neither archive
   * nor re-activate a product or a category. Archiving takes an item out of circulation — nobody
   * can borrow or take it — and that is a decision for a person in the web app.
   */
  describe('archiving with a key', () => {
    it('refuses to archive or re-activate a product, and leaves it as it was', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const fixture = await createStockFixture(ctx.db);
      for (const isActive of [false, true]) {
        const response = await asKey(key.token)
          .patch(`/products/${fixture.productId}`)
          .send({ isActive });
        expect(response.status, `isActive: ${isActive}`).toBe(403);
        expect(response.body.code).toBe(ErrorCode.API_KEY_SCOPE_DENIED);
      }
      const row = await ctx.db
        .selectFrom('products')
        .select('is_active')
        .where('id', '=', fixture.productId)
        .executeTakeFirstOrThrow();
      expect(row.is_active).toBe(true);
    });

    it('refuses to archive a category, and leaves it active', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      // Empty, so a person *could* archive it: only the key rule may stop this one.
      const categoryId = await createCategory(ctx.db);
      const response = await asKey(key.token)
        .patch(`/categories/${categoryId}`)
        .send({ isActive: false });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.API_KEY_SCOPE_DENIED);
      const row = await ctx.db
        .selectFrom('categories')
        .select('is_active')
        .where('id', '=', categoryId)
        .executeTakeFirstOrThrow();
      expect(row.is_active).toBe(true);

      // The control: the same request from a person succeeds.
      const asPerson = await admin.patch(`/categories/${categoryId}`).send({ isActive: false });
      expect(asPerson.status, JSON.stringify(asPerson.body)).toBe(200);
    });

    it('still lets a key rename a product', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const fixture = await createStockFixture(ctx.db);
      const name = `Renamed by key ${randomUUID().slice(0, 6)}`;
      const response = await asKey(key.token).patch(`/products/${fixture.productId}`).send({ name });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.name).toBe(name);
    });

    it('still lets an Inventory Manager archive a product in the web app', async () => {
      const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
        roles: [Role.INVENTORY_MANAGER],
      });
      const fixture = await createStockFixture(ctx.db);
      const response = await im.client
        .patch(`/products/${fixture.productId}`)
        .send({ isActive: false });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.isActive).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- the URL form */

  describe('a key in the URL', () => {
    it('cannot write, even when it could through the header', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const response = await httpClient(ctx.app)
        .post(`/products?${API_KEY_QUERY_PARAM}=${key.token}`)
        .send({ name: 'Via URL', unit: 'pcs' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.API_KEY_QUERY_NOT_ALLOWED);
    });

    /**
     * Security review, 2026-09-29: the URL form was accepted when every key was read-only. A key
     * that can write must not be pasteable into a browser at all — the proxy's access log and the
     * browser history keep the URL, and from there the key works in a header.
     */
    it('is refused for a key that can write, even on a read', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.INVENTORY_READ, ApiKeyScope.CATALOG_WRITE]);
      const response = await httpClient(ctx.app).get(`/products?${API_KEY_QUERY_PARAM}=${key.token}`);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.API_KEY_QUERY_NOT_ALLOWED);
    });

    it('beside a session on a write is refused rather than resolved (mixed auth)', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const response = await admin
        .post(`/products?${API_KEY_QUERY_PARAM}=${key.token}`)
        .send({ name: 'Two principals', unit: 'pcs' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.API_KEY_QUERY_NOT_ALLOWED);
    });
  });

  /* ---------------------------------------------------------------- K2, on the read routes */

  /**
   * Security review, 2026-09-29: `GET /products/:id` lists what is on loan, with the borrower's
   * name. It has been key-readable since Phase 10, which contradicts K2 — borrowing names
   * employees and stays out of key reach (reaffirmed as OQ-KT6). A key still learns how much is
   * out; it does not learn who has it.
   */
  describe('what a key reads about loans', () => {
    it('shows a person the borrower, and a key nothing about who has it', async () => {
      const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
        roles: [Role.INVENTORY_MANAGER],
      });
      const fixture = await createStockFixture(ctx.db);
      await ctx.app
        .get(StockService, { strict: false })
        .receive(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
          { performedBy: im.user.id, refType: 'TEST' },
        );
      const borrower = await createUser(ctx.db, { fullName: 'Saad Rahman' });
      const issued = await im.client.post('/borrowing/issue-from-stock').send({
        borrowerId: borrower.id,
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 2,
        isReturnable: true,
        expectedReturnDate: '2026-12-31',
      });
      expect(issued.status, JSON.stringify(issued.body)).toBe(201);

      const asPerson = await im.client.get(`/products/${fixture.productId}`);
      expect(asPerson.status).toBe(200);
      expect(JSON.stringify(asPerson.body.activeBorrows)).toContain('Saad Rahman');

      const key = await issueBoundKey(admin, [ApiKeyScope.INVENTORY_READ]);
      const asKey = await httpClient(ctx.app, { token: key.token }).get(
        `/products/${fixture.productId}`,
      );
      expect(asKey.status).toBe(200);
      expect(JSON.stringify(asKey.body)).not.toContain('Saad Rahman');
      expect(JSON.stringify(asKey.body)).not.toContain(borrower.id);
    });

    /**
     * Review of 223396d, 2026-10-01: `PATCH /products/:id` and `POST /products` answer with the
     * same `ProductDetail` the GET does, and only the GET withheld the loan list. So a
     * `catalog:write` key learned who had an item by editing it. K2 covers a response body, not
     * only the scopes: no person's name reaches a key on any route.
     */
    it('does not tell a key who has an item when it edits that item', async () => {
      const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
        roles: [Role.INVENTORY_MANAGER],
      });
      const fixture = await createStockFixture(ctx.db);
      await ctx.app
        .get(StockService, { strict: false })
        .receive(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
          { performedBy: im.user.id, refType: 'TEST' },
        );
      const borrower = await createUser(ctx.db, { fullName: 'Tahmid Karim' });
      const issued = await im.client.post('/borrowing/issue-from-stock').send({
        borrowerId: borrower.id,
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 2,
        isReturnable: true,
        expectedReturnDate: '2026-12-31',
      });
      expect(issued.status, JSON.stringify(issued.body)).toBe(201);

      // A person editing the same product still sees the loan: the redaction is for keys only.
      const editedByPerson = await im.client
        .patch(`/products/${fixture.productId}`)
        .send({ description: 'edited by a person' });
      expect(editedByPerson.status).toBe(200);
      expect(JSON.stringify(editedByPerson.body.activeBorrows)).toContain('Tahmid Karim');

      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const editedByKey = await httpClient(ctx.app, { token: key.token })
        .patch(`/products/${fixture.productId}`)
        .send({ description: 'edited by a key' });
      expect(editedByKey.status, JSON.stringify(editedByKey.body)).toBe(200);
      expect(editedByKey.body.description).toBe('edited by a key');
      expect(editedByKey.body.activeBorrows).toEqual([]);
      expect(JSON.stringify(editedByKey.body)).not.toContain('Tahmid Karim');
      expect(JSON.stringify(editedByKey.body)).not.toContain(borrower.id);
    });

    it('answers a key that creates a product with an empty loan list', async () => {
      const key = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
      const created = await httpClient(ctx.app, { token: key.token })
        .post('/products')
        .send({ name: `K2 create ${Date.now()}`, unit: 'pcs' });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.activeBorrows).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------- default-deny, proven */

  /**
   * Walks every route the running application registered, rather than a hand-written list —
   * a route added next month is covered without anyone remembering this file.
   *
   * The key used holds **every** scope and acts as an IM, the strongest key that can exist.
   * Every route without `@ApiKeyScopes` must still refuse it, before its own role check or body
   * validation run. And the set of routes that do accept keys is pinned exactly, so widening it
   * is a deliberate edit here, never a side effect.
   */
  describe('the live route table', () => {
    interface RouteInfo {
      method: string;
      path: string;
      scopes: readonly string[] | undefined;
      isPublic: boolean;
    }

    function routes(): RouteInfo[] {
      const discovery = ctx.app.get(DiscoveryService, { strict: false });
      const scanner = new MetadataScanner();
      const found: RouteInfo[] = [];
      for (const wrapper of discovery.getControllers()) {
        const { instance, metatype } = wrapper;
        if (!instance || !metatype) continue;
        const base = (Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined) ?? '';
        const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, metatype) === true;
        const prototype = Object.getPrototypeOf(instance) as object;
        for (const name of scanner.getAllMethodNames(prototype)) {
          const handler = (instance as Record<string, unknown>)[name];
          if (typeof handler !== 'function') continue;
          const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
          const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          if (sub === undefined || verb === undefined) continue;
          const path = `/${[base, sub]
            .map((s) => s.replace(/^\/+|\/+$/g, ''))
            .filter((s) => s.length > 0)
            .join('/')}`;
          found.push({
            method: RequestMethod[verb],
            path,
            scopes: Reflect.getMetadata(API_KEY_SCOPES_KEY, handler) as string[] | undefined,
            isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
          });
        }
      }
      return found;
    }

    it('accepts keys on exactly the routes ADR-0002 opened, and nowhere else', () => {
      const keyRoutes = routes()
        .filter((r) => r.scopes && r.scopes.length > 0)
        .map((r) => `${r.method} ${r.path}`)
        .sort();
      expect(keyRoutes).toEqual(
        [
          'GET /catalogue',
          'GET /categories',
          'GET /locations',
          'GET /locations/rooms',
          'GET /products',
          'GET /products/:id',
          'PATCH /categories/:id',
          'PATCH /products/:id',
          'POST /categories',
          'POST /locations/compartments',
          'POST /locations/zones',
          'POST /products',
          'POST /stock/receive',
          'POST /stock/take',
        ].sort(),
      );
    });

    it('never lets a write route be reached with a read-only scope alone', () => {
      for (const route of routes()) {
        if (!route.scopes?.length || route.method === 'GET') continue;
        const scopes = route.scopes as ApiKeyScope[];
        expect(
          scopes.some((scope) => !isReadOnlyApiKeyScope(scope)),
          `${route.method} ${route.path} declares only read scopes`,
        ).toBe(true);
      }
    });

    it('refuses the strongest possible key on every route that does not declare a scope', async () => {
      const key = await issueBoundKey(admin, ALL_SCOPES);
      const client = asKey(key.token);
      const undeclared = routes().filter((r) => !r.isPublic && !(r.scopes && r.scopes.length > 0));
      // Sanity: the walk found the application, not an empty table.
      expect(undeclared.length).toBeGreaterThan(50);

      const leaks: string[] = [];
      for (const route of undeclared) {
        const path = route.path.replace(/:[A-Za-z]+/g, randomUUID());
        const verb = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
        const response = await client[verb](path).send({});
        if (response.status !== 403 || response.body.code !== ErrorCode.API_KEY_SCOPE_DENIED) {
          leaks.push(
            `${route.method} ${route.path} → ${response.status} ${JSON.stringify(response.body)} ${response.text?.slice(0, 200)}`,
          );
        }
      }
      expect(leaks).toEqual([]);
    });
  });
});

/* -------------------------------------------------------------------- last_used_at, debounced */

describe('API key last_used_at with a real touch interval', () => {
  let ctx: TestApp;
  let admin: HttpClient;

  beforeAll(async () => {
    // TEST_ENV pins the interval at 0 so the main suite sees every stamp; here it is an hour.
    ctx = await createTestApp({ apiKeys: { touchIntervalSeconds: 3600 } });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    admin = (await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.ADMIN] }))
      .client;
  });

  it('is stamped on first use and left alone inside the interval', async () => {
    const key = await issueBoundKey(admin, [ApiKeyScope.INVENTORY_READ, ApiKeyScope.CATALOG_WRITE]);
    const stampOf = async () =>
      (
        await ctx.db
          .selectFrom('api_keys')
          .select('last_used_at')
          .where('id', '=', key.keyId)
          .executeTakeFirstOrThrow()
      ).last_used_at;

    expect(await stampOf()).toBeNull();
    expect((await httpClient(ctx.app, { token: key.token }).get('/products')).status).toBe(200);
    // The stamp is fire-and-forget after the response; give it a moment to land.
    await expect.poll(stampOf, { timeout: 5000 }).not.toBeNull();
    const first = await stampOf();

    expect((await httpClient(ctx.app, { token: key.token }).get('/products')).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await stampOf()).toEqual(first);
  });
});

/* -------------------------------------------------------------------- demo mode in production */

describe('API keys on a production deployment running demo accounts', () => {
  let ctx: TestApp;
  let admin: HttpClient;
  let adminId: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      nodeEnv: 'production',
      isProduction: true,
      demo: { accountsEnabled: true, accountEmails: [] },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    const session = await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.ADMIN] });
    admin = session.client;
    adminId = session.user.id;
  });

  it('refuses every key, including one issued before demo mode was switched on', async () => {
    const token = `ims_${randomUUID().replace(/-/g, '')}`;
    await ctx.db
      .insertInto('api_keys')
      .values({
        name: 'Issued earlier',
        key_prefix: token.slice(0, 12),
        token_hash: createHash('sha256').update(token).digest('hex'),
        scopes: ['inventory:read'] as never,
        created_by: adminId,
      })
      .execute();

    const response = await httpClient(ctx.app, { token }).get('/products');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(ErrorCode.API_KEYS_DISABLED_IN_DEMO);
  });

  it('refuses to issue a key or create a service account', async () => {
    const key = await admin
      .post('/admin/api-keys')
      .send({ name: 'Minted in demo', scopes: [ApiKeyScope.INVENTORY_READ], expiresInDays: 30 });
    expect(key.status).toBe(403);
    expect(key.body.code).toBe(ErrorCode.API_KEYS_DISABLED_IN_DEMO);

    const account = await admin.post('/admin/api-keys/service-accounts').send({ name: 'Panel' });
    expect(account.status).toBe(403);
    expect(account.body.code).toBe(ErrorCode.API_KEYS_DISABLED_IN_DEMO);
  });

  /**
   * Security review, 2026-09-29: refusing to *create* was not enough. Re-enabling a key an admin
   * had switched off — say, one suspected of leaking — or re-activating a service account would
   * bring those keys back the day demo mode ends, just as a newly minted one would. Switching
   * things *off* stays allowed: that only ever makes the deployment safer.
   */
  it('refuses to switch a key or a service account back on, but lets either be switched off', async () => {
    const account = await serviceAccountWithKnownPassword(ctx.db, [Role.INVENTORY_MANAGER]);
    const inserted = await ctx.db
      .insertInto('api_keys')
      .values({
        name: 'Switched off earlier',
        key_prefix: `ims_${randomUUID().slice(0, 8)}`,
        token_hash: randomUUID(),
        scopes: ['inventory:read'] as never,
        is_active: false,
        created_by: adminId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const keyOn = await admin.patch(`/admin/api-keys/${inserted.id}`).send({ isActive: true });
    expect(keyOn.status).toBe(403);
    expect(keyOn.body.code).toBe(ErrorCode.API_KEYS_DISABLED_IN_DEMO);

    const accountOff = await admin
      .patch(`/admin/api-keys/service-accounts/${account.id}`)
      .send({ isActive: false });
    expect(accountOff.status).toBe(200);
    const accountOn = await admin
      .patch(`/admin/api-keys/service-accounts/${account.id}`)
      .send({ isActive: true });
    expect(accountOn.status).toBe(403);
    expect(accountOn.body.code).toBe(ErrorCode.API_KEYS_DISABLED_IN_DEMO);
  });

  it('tells the admin page, so it can say so instead of offering Create', async () => {
    const usage = await admin.get('/admin/api-keys/usage');
    expect(usage.status).toBe(200);
    expect(usage.body.keysDisabledInDemo).toBe(true);
  });

  /**
   * With no email list, demo mode lists every active user — service accounts must not be.
   * Asked of the service, not the route: `GET /auth/demo-accounts` reads the module-level config,
   * which a test override cannot reach, so over HTTP it would only ever answer 404 here.
   */
  it('never lists a service account among the demo personas', async () => {
    /*
     * The persona list is the first page of active users by name (PAGINATION_MAX_LIMIT), and a
     * full suite leaves well over a page of users behind — anyone who moved stock cannot be
     * deleted. Both rows are named to sort first, so the page provably covers them: the person
     * appearing is what makes the service account's absence mean something.
     */
    const tag = randomUUID().slice(0, 8);
    const account = await serviceAccountWithKnownPassword(
      ctx.db,
      [Role.INVENTORY_MANAGER],
      `0000 demo service account ${tag}`,
    );
    const person = await createUser(ctx.db, { fullName: `0000 demo persona ${tag}` });
    const personas = await ctx.app.get(UsersService, { strict: false }).demoAccounts();
    const emails = personas.map((p) => p.email);
    expect(emails).toContain(person.email);
    expect(emails).not.toContain(account.email);
  });

  it('still lets a person sign in, so the rest of the system is untouched', async () => {
    const person = await createUser(ctx.db, {});
    await expect(login(httpClient(ctx.app), person.email)).resolves.toBeTruthy();
  });
});
