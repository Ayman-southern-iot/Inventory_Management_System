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
    const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
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

  it.each(Object.keys(cases))('%s answers a key without naming a person', async (route) => {
    const response = await cases[route]!();
    expect(response.status, `${route}: ${JSON.stringify(response.body)}`).toBeGreaterThanOrEqual(200);
    expect(response.status, `${route}: ${JSON.stringify(response.body)}`).toBeLessThan(300);

    const body = JSON.stringify(response.body);
    for (const person of people) {
      expect(body, `${route} names ${person.fullName}`).not.toContain(person.fullName);
      expect(body, `${route} carries ${person.email}`).not.toContain(person.email);
    }
    expect(body, `${route} carries the borrower's id`).not.toContain(borrowerId);
    for (const field of PERSON_FIELDS) {
      expect(body, `${route} has a "${field}" field`).not.toContain(`"${field}"`);
    }
  });
});
