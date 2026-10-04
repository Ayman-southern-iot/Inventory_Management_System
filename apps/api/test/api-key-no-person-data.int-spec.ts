import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { ApiKeyScope, IDEMPOTENCY_HEADER, Role } from '@ims/shared';
import { ApiKeyDocsService } from '../src/modules/api-keys/api-key-docs.service';
import { StockService } from '../src/modules/stock/stock.service';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { issueBoundKey } from './api-key-factories';
import { createUser, createUserAndLogin, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';

/**
 * K2 (Ayman, 2026-10-01): no person's name reaches an API key, on any route, response bodies
 * included. Proven by walking the registry rather than by naming routes (Arif, 2026-10-01): every
 * route a key can reach is called with a key that holds every scope, and no answer may carry a
 * person — a name, an email, a borrowerId or a requesterId.
 *
 * The routes come from `ApiKeyDocsService`, the registry the admin usage page is built from. A key
 * route added later without a case below fails the coverage test, and a case that leaks fails on
 * its own. Each case has to succeed: a refusal says nothing about what a successful answer leaks.
 *
 * Why this exists: the 2026-09-29 fix withheld the loan list from `GET /products/:id` only, and
 * `PATCH /products/:id` went on telling a `catalog:write` key who had an item for a day.
 */

/** Field names that only ever hold a person. Their presence is the leak, whatever the value. */
const PERSON_FIELDS = ['borrowerId', 'requesterId', 'borrowerName', 'requesterName'] as const;

describe('K2: no API key answer carries a person, on any key-reachable route', () => {
  const tag = randomUUID().slice(0, 8);
  const people: Array<{ id: string; fullName: string; email: string }> = [];
  let ctx: TestApp;
  let key: HttpClient;
  let fixture: StockFixture;
  let borrowerId: string;
  let im: Awaited<ReturnType<typeof createUserAndLogin>>;

  beforeAll(async () => {
    // The take is part of the walk, so it has to be switched on for this app.
    ctx = await createTestApp({ directTake: { isEnabled: true } });
    await resetData(ctx.db);

    const adminName = `Rehana Akter ${tag}`;
    const imName = `Nusrat Haque ${tag}`;
    const borrowerName = `Tahmid Karim ${tag}`;
    const admin = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.ADMIN],
      fullName: adminName,
    });
    im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.INVENTORY_MANAGER],
      fullName: imName,
    });
    const borrower = await createUser(ctx.db, { fullName: borrowerName });
    borrowerId = borrower.id;
    people.push(
      { id: admin.user.id, fullName: adminName, email: admin.user.email },
      { id: im.user.id, fullName: imName, email: im.user.email },
      { id: borrower.id, fullName: borrowerName, email: borrower.email },
    );

    fixture = await createStockFixture(ctx.db);
    await ctx.app
      .get(StockService, { strict: false })
      .receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 20 },
        { performedBy: im.user.id, refType: 'TEST' },
      );
    // A live loan, so every answer about this product has a person in reach to leak.
    const returnBy = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const issued = await im.client.post('/borrowing/issue-from-stock').send({
      borrowerId: borrower.id,
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 2,
      isReturnable: true,
      expectedReturnDate: returnBy,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);

    const allScopes = Object.values(ApiKeyScope) as ApiKeyScope[];
    key = httpClient(ctx.app, { token: (await issueBoundKey(admin.client, allScopes)).token });
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** One call per key-reachable route, each one that succeeds. Keyed `METHOD path` as registered. */
  const cases: Record<string, () => request.Test> = {
    'GET /catalogue': () => key.get('/catalogue'),
    'GET /products': () => key.get('/products'),
    'GET /products/:id': () => key.get(`/products/${fixture.productId}`),
    'GET /categories': () => key.get('/categories'),
    'GET /locations': () => key.get('/locations'),
    'GET /locations/rooms': () => key.get('/locations/rooms'),
    'POST /categories': () => key.post('/categories').send({ name: `K2 walk category ${tag}` }),
    'PATCH /categories/:id': () =>
      key.patch(`/categories/${fixture.categoryId}`).send({ name: `K2 walk renamed ${tag}` }),
    'POST /products': () => key.post('/products').send({ name: `K2 walk product ${tag}`, unit: 'pcs' }),
    'PATCH /products/:id': () =>
      key.patch(`/products/${fixture.productId}`).send({ description: `edited by a key ${tag}` }),
    'POST /locations/zones': () =>
      key.post('/locations/zones').send({ name: `K2 walk zone ${tag}`, roomId: fixture.roomId }),
    'POST /locations/compartments': () =>
      key.post('/locations/compartments').send({ zoneId: fixture.zoneId, code: `K2-${tag}` }),
    'POST /stock/receive': () =>
      key
        .post('/stock/receive')
        .set(IDEMPOTENCY_HEADER, randomUUID())
        .send({ productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 }),
    'POST /stock/take': () =>
      key.post('/stock/take').set(IDEMPOTENCY_HEADER, randomUUID()).send({
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 1,
        isReturnable: false,
      }),
  };

  it('has a case for every key-reachable route, and none that is not one', () => {
    const registered = ctx.app
      .get(ApiKeyDocsService, { strict: false })
      .build()
      .endpoints.map((e) => `${e.method} ${e.path}`)
      .sort();
    expect(Object.keys(cases).sort()).toEqual(registered);
  });

  /** `where` is a label for the failure message: which route, replay or refusal produced `payload`. */
  function expectNoPerson(where: string, payload: unknown): void {
    const body = JSON.stringify(payload);
    for (const person of people) {
      expect(body, `${where} names ${person.fullName}`).not.toContain(person.fullName);
      expect(body, `${where} carries ${person.email}`).not.toContain(person.email);
    }
    expect(body, `${where} carries the borrower's id`).not.toContain(borrowerId);
    for (const field of PERSON_FIELDS) {
      expect(body, `${where} has a "${field}" field`).not.toContain(`"${field}"`);
    }
  }

  it.each(Object.keys(cases))('%s answers a key without naming a person', async (route) => {
    const response = await cases[route]!();
    expect(response.status, `${route}: ${JSON.stringify(response.body)}`).toBeGreaterThanOrEqual(200);
    expect(response.status, `${route}: ${JSON.stringify(response.body)}`).toBeLessThan(300);
    expectNoPerson(route, response.body);
  });

  /**
   * The Idempotency-Key routes. A replay is answered from the copy `IdempotencyService` stored on
   * the first call, not by running the handler again, so it is a separate path to the client that
   * the cases above never take. It still leaves through the controller's return value, which is
   * what the interceptor wraps — but "still" is exactly the kind of claim this file exists to
   * replace with a call. The stored copy is read as well: it is the one place a person could sit
   * at rest, and a later change that stores a richer answer would otherwise leak only on replay.
   */
  describe('a replayed Idempotency-Key', () => {
    const replayed: Record<string, (idem: string) => request.Test> = {
      'POST /stock/receive': (idem) =>
        key
          .post('/stock/receive')
          .set(IDEMPOTENCY_HEADER, idem)
          .send({ productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 }),
      'POST /stock/take': (idem) =>
        key.post('/stock/take').set(IDEMPOTENCY_HEADER, idem).send({
          productId: fixture.productId,
          compartmentId: fixture.compartmentA,
          quantity: 1,
          isReturnable: false,
        }),
    };

    it('covers every key route that takes an Idempotency-Key', () => {
      const keyed = ctx.app
        .get(ApiKeyDocsService, { strict: false })
        .build()
        .endpoints.filter((e) => e.requiresIdempotencyKey)
        .map((e) => `${e.method} ${e.path}`)
        .sort();
      expect(Object.keys(replayed).sort()).toEqual(keyed);
    });

    it.each(Object.keys(replayed))('%s: the replay and the stored copy name no one', async (route) => {
      const idem = randomUUID();
      const first = await replayed[route]!(idem);
      const second = await replayed[route]!(idem);
      expect(first.status, `${route} first: ${JSON.stringify(first.body)}`).toBeLessThan(300);
      expect(second.status, `${route} replay: ${JSON.stringify(second.body)}`).toBeLessThan(300);
      // Same body proves it was the stored answer, not a second run of the handler.
      expect(second.body).toEqual(first.body);
      expectNoPerson(`${route} replay`, second.body);

      const stored = await ctx.db
        .selectFrom('idempotency_keys')
        .select('response')
        .where('key', '=', idem)
        .executeTakeFirstOrThrow();
      expectNoPerson(`${route} stored copy`, stored.response);
    });
  });

  /**
   * Errors never pass through an interceptor: the exception filter writes `details` and `message`
   * straight out, so the redaction interceptor cannot protect them. Each refusal below is forced
   * on a route a key can reach, against stock a person is holding, and has to be the 409 it is
   * named for — a call that failed for some other reason would prove nothing.
   */
  describe('a refusal a key can provoke', () => {
    const refusals: Record<string, () => Promise<request.Response>> = {
      'POST /categories (duplicate name)': async () => {
        const name = `K2 refusal category ${tag}`;
        const created = await key.post('/categories').send({ name });
        expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
        return key.post('/categories').send({ name });
      },
      'POST /products (duplicate product code)': async () => {
        const productCode = `K2-REFUSAL-${tag}`;
        const created = await key.post('/products').send({ name: `K2 refusal ${tag}`, unit: 'pcs', productCode });
        expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
        return key.post('/products').send({ name: `K2 refusal again ${tag}`, unit: 'pcs', productCode });
      },
      'POST /locations/zones (duplicate name in the room)': async () => {
        const body = { name: `K2 refusal zone ${tag}`, roomId: fixture.roomId };
        const created = await key.post('/locations/zones').send(body);
        expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
        return key.post('/locations/zones').send(body);
      },
      'POST /locations/compartments (duplicate code in the zone)': async () => {
        const body = { zoneId: fixture.zoneId, code: `K2-REFUSAL-${tag}` };
        const created = await key.post('/locations/compartments').send(body);
        expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
        return key.post('/locations/compartments').send(body);
      },
      // A product a person is holding, asked for more than is left: `details` carries the
      // shelf's numbers, and this is the answer that sits closest to the loan.
      'POST /stock/take (more than is available)': async () => {
        const held = await createStockFixture(ctx.db);
        await ctx.app
          .get(StockService, { strict: false })
          .receive(
            { productId: held.productId, compartmentId: held.compartmentA, quantity: 3 },
            { performedBy: im.user.id, refType: 'TEST' },
          );
        const returnBy = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
        const issued = await im.client.post('/borrowing/issue-from-stock').send({
          borrowerId,
          productId: held.productId,
          compartmentId: held.compartmentA,
          quantity: 1,
          isReturnable: true,
          expectedReturnDate: returnBy,
        });
        expect(issued.status, JSON.stringify(issued.body)).toBe(201);
        return key.post('/stock/take').set(IDEMPOTENCY_HEADER, randomUUID()).send({
          productId: held.productId,
          compartmentId: held.compartmentA,
          quantity: 5,
          isReturnable: false,
        });
      },
    };

    it.each(Object.keys(refusals))('%s answers 409 and names no one', async (label) => {
      const response = await refusals[label]!();
      expect(response.status, `${label}: ${JSON.stringify(response.body)}`).toBe(409);
      expectNoPerson(label, response.body);
    });

    it('the over-take refusal carries only the shelf figures in details', async () => {
      const response = await refusals['POST /stock/take (more than is available)']!();
      expect(response.body.details).toEqual({ available: 2, requested: 5, quarantined: 0 });
    });
  });
});
