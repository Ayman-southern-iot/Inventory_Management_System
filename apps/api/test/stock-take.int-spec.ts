import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiKeyScope, BorrowStatus, ErrorCode, ReturnCondition, Role } from '@ims/shared';
import { StockService } from '../src/modules/stock/stock.service';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { issueBoundKey, type BoundKey } from './api-key-factories';
import { createUser, createUserAndLogin, login, resetData } from './factories';
import { createStockFixture, placementOf, type StockFixture } from './stock-factories';
import { TEST_ENV } from './config/test-env';

/**
 * ADR-0002 — `POST /stock/take`, stock off a shelf in one idempotent call.
 *
 * A take is the IM's issue-from-stock handover reached by another route, so most of this suite
 * is about sameness: the borrow, ledger and return rows it leaves must be the ones the ordinary
 * borrow flow leaves, compared record by record against a create → approve control, and the
 * nightly invariant `SUM(ledger) = placements` must hold after every scenario.
 */

const RETURN_BY = '2026-12-31';

describe('POST /stock/take (ADR-0002)', () => {
  let ctx: TestApp;
  let stock: StockService;
  let admin: HttpClient;
  let im: { id: string; client: HttpClient };
  let fixture: StockFixture;
  let key: BoundKey;

  const asKey = (token: string): HttpClient => httpClient(ctx.app, { token });

  const take = (client: HttpClient, body: Record<string, unknown> = {}, idem = randomUUID()) =>
    client
      .post('/stock/take')
      .set('Idempotency-Key', idem)
      .send({
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 1,
        ...body,
      });

  const setDefaultReturnable = (productId: string, value: boolean) =>
    ctx.db
      .updateTable('products')
      .set({ default_returnable: value })
      .where('id', '=', productId)
      .execute();

  const assertReconciled = async () => {
    expect(await stock.findReconciliationMismatches()).toEqual([]);
  };

  const ledgerRowsFor = async (productId: string): Promise<number> =>
    (await ctx.db.selectFrom('stock_ledger').select('id').where('product_id', '=', productId).execute())
      .length;

  beforeAll(async () => {
    ctx = await createTestApp({ directTake: { isEnabled: true } });
    stock = ctx.app.get(StockService, { strict: false });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    admin = (await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.ADMIN] }))
      .client;
    const imUser = await createUser(ctx.db, { roles: [Role.INVENTORY_MANAGER] });
    const imHttp = httpClient(ctx.app);
    im = { id: imUser.id, client: imHttp.as((await login(imHttp, imUser.email)).accessToken) };

    fixture = await createStockFixture(ctx.db);
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
      { performedBy: im.id, refType: 'TEST' },
    );
    key = await issueBoundKey(admin, [ApiKeyScope.STOCK_TAKE]);
  });

  it('issues a consumable, drops availability, and records which account and key took it', async () => {
    await setDefaultReturnable(fixture.productId, false);
    const response = await take(asKey(key.token), {
      quantity: 3,
      channel: 'panel',
      purpose: 'Rafiq, bench 4',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    // Ids and quantities only — no requester, holder or decider names (OQ-KT6).
    expect(Object.keys(response.body).sort()).toEqual(
      [
        'borrowId',
        'borrowNo',
        'compartmentId',
        'expectedReturnDate',
        'isReturnable',
        'placement',
        'productId',
        'quantity',
        'status',
      ].sort(),
    );
    expect(response.body).toMatchObject({
      status: BorrowStatus.ISSUED,
      quantity: 3,
      isReturnable: false,
      expectedReturnDate: null,
    });
    expect(response.body.placement).toMatchObject({ quantity: 7, reservedQty: 0, availableQty: 7 });

    const borrowId = response.body.borrowId as string;
    const borrow = await ctx.db
      .selectFrom('borrow_requests')
      .select(['requester_id', 'current_holder_id', 'decided_by', 'decision_note', 'status'])
      .where('id', '=', borrowId)
      .executeTakeFirstOrThrow();
    // The holder is always the caller (OQ-KT1); a person's name can only be in the note.
    expect(borrow).toEqual({
      requester_id: key.serviceAccountId,
      current_holder_id: key.serviceAccountId,
      decided_by: key.serviceAccountId,
      decision_note: 'Rafiq, bench 4',
      status: BorrowStatus.ISSUED,
    });

    const issue = await ctx.db
      .selectFrom('stock_ledger')
      .select(['movement_type', 'quantity', 'ref_type', 'performed_by'])
      .where('ref_id', '=', borrowId)
      .execute();
    expect(issue).toHaveLength(1);
    expect(issue[0]).toMatchObject({
      movement_type: 'ISSUE',
      ref_type: 'BORROW',
      performed_by: key.serviceAccountId,
    });
    expect(Math.abs(issue[0]!.quantity)).toBe(3);

    const audit = await ctx.db
      .selectFrom('audit_log')
      .select(['action', 'actor_id', 'api_key_id', 'metadata'])
      .where('entity_id', '=', borrowId)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'borrowing.issue_on_behalf',
      actor_id: key.serviceAccountId,
      api_key_id: key.keyId,
    });
    expect(audit[0]!.metadata).toMatchObject({ via: 'stock.take', channel: 'panel' });

    // OQ-KT4: every IM hears about a key's take; the account itself hears nothing.
    const notices = await ctx.db
      .selectFrom('notifications')
      .select(['type', 'user_id'])
      .where('entity_id', '=', borrowId)
      .execute();
    expect(notices).toContainEqual({ type: 'borrowing.taken_by_key', user_id: im.id });
    expect(notices.map((n) => n.user_id)).not.toContain(key.serviceAccountId);
    expect(notices.map((n) => n.type)).not.toContain('borrowing.issued_to_you');

    await assertReconciled();
  });

  it('records a person taking against themselves, and does not page the IMs about it', async () => {
    const response = await take(im.client, {
      isReturnable: true,
      expectedReturnDate: RETURN_BY,
      channel: 'web',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const borrowId = response.body.borrowId as string;

    const borrow = await ctx.db
      .selectFrom('borrow_requests')
      .select(['requester_id', 'decided_by'])
      .where('id', '=', borrowId)
      .executeTakeFirstOrThrow();
    expect(borrow).toEqual({ requester_id: im.id, decided_by: im.id });

    const notices = await ctx.db
      .selectFrom('notifications')
      .select('type')
      .where('entity_id', '=', borrowId)
      .where('type', '=', 'borrowing.taken_by_key')
      .execute();
    expect(notices).toEqual([]);

    const audit = await ctx.db
      .selectFrom('audit_log')
      .select('api_key_id')
      .where('entity_id', '=', borrowId)
      .executeTakeFirstOrThrow();
    expect(audit.api_key_id).toBeNull();
  });

  /**
   * The sameness proof. One loan is taken, the other raised and approved the ordinary way; both
   * are returned in the same two steps through the normal returns route. Their ledger rows and
   * final borrow rows must match field for field, bar the ids.
   */
  it('leaves exactly the records create → approve leaves, through a partial and a full return', async () => {
    const requester = await createUserAndLogin(ctx.db, httpClient(ctx.app), {});

    const taken = await take(asKey(key.token), {
      quantity: 4,
      isReturnable: true,
      expectedReturnDate: RETURN_BY,
    });
    expect(taken.status, JSON.stringify(taken.body)).toBe(201);

    const raised = await requester.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 4,
      isReturnable: true,
      expectedReturnDate: RETURN_BY,
      purpose: null,
    });
    expect(raised.status, JSON.stringify(raised.body)).toBe(201);
    const approved = await im.client
      .post(`/borrowing/${raised.body.id}/decision`)
      .set('Idempotency-Key', randomUUID())
      .send({ approve: true });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    const loans = { taken: taken.body.borrowId as string, control: raised.body.id as string };
    for (const id of Object.values(loans)) {
      const partial = await im.client
        .post(`/borrowing/${id}/returns`)
        .set('Idempotency-Key', randomUUID())
        .send({ quantity: 1, compartmentId: fixture.compartmentA, condition: ReturnCondition.GOOD });
      expect(partial.status, JSON.stringify(partial.body)).toBeLessThan(300);
      expect(await statusOf(id)).toBe(BorrowStatus.PARTIALLY_RETURNED);

      const rest = await im.client
        .post(`/borrowing/${id}/returns`)
        .set('Idempotency-Key', randomUUID())
        .send({ quantity: 3, compartmentId: fixture.compartmentA, condition: ReturnCondition.GOOD });
      expect(rest.status, JSON.stringify(rest.body)).toBeLessThan(300);
      expect(await statusOf(id)).toBe(BorrowStatus.RETURNED);
    }

    const shape = async (id: string) => {
      const ledger = await ctx.db
        .selectFrom('stock_ledger')
        .select(['movement_type', 'quantity', 'from_compartment_id', 'to_compartment_id', 'ref_type'])
        .where('ref_id', '=', id)
        .orderBy('created_at')
        .orderBy('id')
        .execute();
      const borrow = await ctx.db
        .selectFrom('borrow_requests')
        .select(['status', 'quantity', 'returned_qty', 'is_returnable', 'compartment_id'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return { ledger, borrow };
    };
    const [takenShape, controlShape] = await Promise.all([shape(loans.taken), shape(loans.control)]);
    expect(takenShape.ledger.length).toBeGreaterThan(0);
    expect(takenShape).toEqual(controlShape);

    await assertReconciled();
  });

  it('uses the product default when isReturnable is left out, and holds it to the date rule', async () => {
    await setDefaultReturnable(fixture.productId, true);
    const noDate = await take(asKey(key.token));
    expect(noDate.status).toBe(400);
    expect(noDate.body.code).toBe(ErrorCode.VALIDATION_FAILED);

    const withDate = await take(asKey(key.token), { expectedReturnDate: RETURN_BY });
    expect(withDate.status, JSON.stringify(withDate.body)).toBe(201);
    expect(withDate.body.isReturnable).toBe(true);

    await setDefaultReturnable(fixture.productId, false);
    const consumableWithDate = await take(asKey(key.token), { expectedReturnDate: RETURN_BY });
    expect(consumableWithDate.status).toBe(400);
    expect(consumableWithDate.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('replays a repeated Idempotency-Key and issues nothing more', async () => {
    await setDefaultReturnable(fixture.productId, false);
    const idem = randomUUID();
    const first = await take(asKey(key.token), { quantity: 2 }, idem);
    const second = await take(asKey(key.token), { quantity: 2 }, idem);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    const issues = await ctx.db
      .selectFrom('stock_ledger')
      .select('id')
      .where('product_id', '=', fixture.productId)
      .where('movement_type', '=', 'ISSUE')
      .execute();
    expect(issues).toHaveLength(1);
    expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))?.quantity).toBe(8);
  });

  it('refuses a take with no Idempotency-Key and issues nothing', async () => {
    const response = await asKey(key.token).post('/stock/take').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 1,
      isReturnable: false,
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))?.quantity).toBe(10);
  });

  it('lets exactly one of two simultaneous takes have the last unit', async () => {
    const lastUnit = await createStockFixture(ctx.db);
    await setDefaultReturnable(lastUnit.productId, false);
    await stock.receive(
      { productId: lastUnit.productId, compartmentId: lastUnit.compartmentA, quantity: 1 },
      { performedBy: im.id, refType: 'TEST' },
    );
    const race = () =>
      asKey(key.token)
        .post('/stock/take')
        .set('Idempotency-Key', randomUUID())
        .send({ productId: lastUnit.productId, compartmentId: lastUnit.compartmentA, quantity: 1 });

    const results = await Promise.all([race(), race()]);
    const winners = results.filter((r) => r.status === 201);
    expect(winners).toHaveLength(1);
    /*
     * The loser's answer depends on *when* it arrives, and both are refusals that change nothing:
     * one that locks the row before the winner commits sees 0 available (409 INSUFFICIENT_STOCK);
     * one that arrives after finds no row at all, because `StockService.issue` deletes a placement
     * that reaches zero, and `reserve` answers 404 for a compartment holding none of the product.
     * The same is true of the ordinary borrow form today. Recorded as OQ-KT9, not changed here:
     * it is StockService's contract, and the take reuses it rather than reinterpreting it.
     */
    const loser = results.find((r) => r.status !== 201)!;
    expect([
      `409 ${ErrorCode.INSUFFICIENT_STOCK}`,
      `404 ${ErrorCode.NOT_FOUND}`,
    ]).toContain(`${loser.status} ${loser.body.code}`);
    const winner = winners[0]!;
    // The shelf is empty and its row is gone, so there is no placement to describe.
    expect(winner.body.placement).toBeNull();

    const left = await placementOf(ctx.db, lastUnit.productId, lastUnit.compartmentA);
    expect(left === undefined || left.quantity >= 0).toBe(true);
    await assertReconciled();
  });

  it('caps a single take at DIRECT_TAKE_MAX_QTY', async () => {
    // TEST_ENV pins the cap at 10; the shelf holds 10, so only the cap can refuse 11.
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
      { performedBy: im.id, refType: 'TEST' },
    );
    const response = await take(asKey(key.token), { quantity: 11, isReturnable: false });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(JSON.stringify(response.body.details)).toContain('quantity');
    expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))?.quantity).toBe(15);
  });

  it('refuses the eleventh take in a window from one key (THROTTLE_TAKE_LIMIT), taking nothing', async () => {
    const limit = Number(TEST_ENV.THROTTLE_TAKE_LIMIT);
    // Enough on the shelf that, without the throttle, the extra take would succeed rather than
    // fail on stock — so only the throttle can be what refuses it.
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: limit },
      { performedBy: im.id, refType: 'TEST' },
    );
    const client = asKey(key.token);
    for (let n = 1; n <= limit; n += 1) {
      expect((await take(client, { isReturnable: false })).status, `take ${n} of ${limit}`).toBe(201);
    }
    const ledgerBefore = await ledgerRowsFor(fixture.productId);

    const refused = await take(client, { isReturnable: false });
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe(ErrorCode.RATE_LIMITED);
    // The throttler's own text is its class name ("ThrottlerException: Too Many Requests"); a caller
    // reads a sentence, not an internal (message audit finding F6).
    expect(refused.body.message).not.toMatch(/Exception/);
    expect(refused.body.message).toMatch(/too many requests/i);
    expect(await ledgerRowsFor(fixture.productId)).toBe(ledgerBefore);
    await assertReconciled();
  });

  it('is refused to a key without stock:take and to a person without a stock role', async () => {
    const other = await issueBoundKey(admin, [ApiKeyScope.CATALOG_WRITE]);
    const wrongScope = await take(asKey(other.token), { isReturnable: false });
    expect(wrongScope.status).toBe(403);
    expect(wrongScope.body.code).toBe(ErrorCode.API_KEY_SCOPE_DENIED);

    const general = await createUserAndLogin(ctx.db, httpClient(ctx.app), {});
    const noRole = await take(general.client, { isReturnable: false });
    expect(noRole.status).toBe(403);
    expect(noRole.body.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('refuses an archived product, as the borrow form does', async () => {
    await ctx.db
      .updateTable('products')
      .set({ is_active: false })
      .where('id', '=', fixture.productId)
      .execute();
    const response = await take(asKey(key.token), { isReturnable: false });
    expect(response.status).toBe(409);
    expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))?.quantity).toBe(10);
  });

  it('is listed on the usage page with its body fields and the idempotency requirement', async () => {
    const usage = await admin.get('/admin/api-keys/usage');
    expect(usage.status).toBe(200);
    const entry = (
      usage.body.endpoints as Array<{
        method: string;
        path: string;
        requiresIdempotencyKey: boolean;
        bodyParams: Array<{ name: string; required: boolean }>;
      }>
    ).find((e) => e.method === 'POST' && e.path === '/stock/take');
    expect(entry).toBeDefined();
    expect(entry!.requiresIdempotencyKey).toBe(true);
    expect(entry!.bodyParams).toContainEqual(
      expect.objectContaining({ name: 'productId', required: true }),
    );
    expect(entry!.bodyParams).toContainEqual(
      expect.objectContaining({ name: 'isReturnable', required: false }),
    );
  });

  async function statusOf(id: string): Promise<string> {
    return (
      await ctx.db
        .selectFrom('borrow_requests')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;
  }
});

describe('POST /stock/take while ALLOW_DIRECT_TAKE is off (the default)', () => {
  let ctx: TestApp;
  let admin: HttpClient;
  let fixture: StockFixture;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    admin = (await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.ADMIN] }))
      .client;
    fixture = await createStockFixture(ctx.db);
  });

  it('refuses a key and a person alike, with its own code, before asking for an Idempotency-Key', async () => {
    const key = await issueBoundKey(admin, [ApiKeyScope.STOCK_TAKE]);
    const im = await createUserAndLogin(ctx.db, httpClient(ctx.app), {
      roles: [Role.INVENTORY_MANAGER],
    });
    const body = {
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 1,
      isReturnable: false,
    };

    for (const client of [httpClient(ctx.app, { token: key.token }), im.client]) {
      // No Idempotency-Key on purpose: switched off answers first.
      const response = await client.post('/stock/take').send(body);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(ErrorCode.DIRECT_TAKE_DISABLED);
    }
  });

  it('is left off the usage page, so the admin is never shown what the API refuses', async () => {
    const usage = await admin.get('/admin/api-keys/usage');
    expect(usage.status).toBe(200);
    const paths = (usage.body.endpoints as Array<{ method: string; path: string }>).map(
      (e) => `${e.method} ${e.path}`,
    );
    expect(paths).not.toContain('POST /stock/take');
    expect(paths).toContain('POST /stock/receive');
  });
});

/**
 * The daily allowance of one service account (DIRECT_TAKE_DAILY_UNITS_PER_ACCOUNT, Arif
 * 2026-10-01). Here one call may take the whole allowance, so the cap — not the per-call
 * DIRECT_TAKE_MAX_QTY nor the THROTTLE_TAKE_LIMIT window — is what refuses. At the shipped
 * defaults those two multiply to exactly the daily cap, so the cap only binds across windows.
 */
describe('POST /stock/take against DIRECT_TAKE_DAILY_UNITS_PER_ACCOUNT', () => {
  const dailyCap = Number(TEST_ENV.DIRECT_TAKE_DAILY_UNITS_PER_ACCOUNT);
  let ctx: TestApp;
  let stock: StockService;
  let admin: HttpClient;
  let im: { id: string; client: HttpClient };
  let fixture: StockFixture;

  const asKey = (token: string): HttpClient => httpClient(ctx.app, { token });

  const take = (client: HttpClient, quantity: number) =>
    client
      .post('/stock/take')
      .set('Idempotency-Key', randomUUID())
      .send({
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity,
        isReturnable: false,
      });

  const ledgerRows = async (): Promise<number> =>
    (await ctx.db.selectFrom('stock_ledger').select('id').where('product_id', '=', fixture.productId).execute())
      .length;

  beforeAll(async () => {
    ctx = await createTestApp({ directTake: { isEnabled: true, maxQuantityPerCall: dailyCap } });
    stock = ctx.app.get(StockService, { strict: false });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    admin = (await createUserAndLogin(ctx.db, httpClient(ctx.app), { roles: [Role.ADMIN] }))
      .client;
    const imUser = await createUser(ctx.db, { roles: [Role.INVENTORY_MANAGER] });
    const imHttp = httpClient(ctx.app);
    im = { id: imUser.id, client: imHttp.as((await login(imHttp, imUser.email)).accessToken) };
    fixture = await createStockFixture(ctx.db);
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: dailyCap * 4 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  it("refuses the unit past a service account's daily allowance, taking nothing", async () => {
    const key = await issueBoundKey(admin, [ApiKeyScope.STOCK_TAKE]);
    const client = asKey(key.token);
    expect((await take(client, dailyCap)).status).toBe(201);
    const ledgerBefore = await ledgerRows();

    const refused = await take(client, 1);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe(ErrorCode.DIRECT_TAKE_DAILY_LIMIT_REACHED);
    expect(refused.body.details).toEqual({ limit: dailyCap, takenToday: dailyCap, requested: 1 });
    expect(await ledgerRows()).toBe(ledgerBefore);
    expect(await stock.findReconciliationMismatches()).toEqual([]);
  });

  it('lets only one of two simultaneous takes spend the last of the allowance', async () => {
    const key = await issueBoundKey(admin, [ApiKeyScope.STOCK_TAKE]);
    const client = asKey(key.token);
    expect((await take(client, dailyCap - 5)).status).toBe(201);

    const statuses = (await Promise.all([take(client, 5), take(client, 5)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 429]);
    const taken = await ctx.db
      .selectFrom('borrow_requests')
      .select(ctx.db.fn.sum<number>('quantity').as('units'))
      .where('requester_id', '=', key.serviceAccountId)
      .executeTakeFirstOrThrow();
    expect(Number(taken.units)).toBe(dailyCap);
  });

  it('counts each service account on its own, and never a person', async () => {
    const first = await issueBoundKey(admin, [ApiKeyScope.STOCK_TAKE]);
    const second = await issueBoundKey(admin, [ApiKeyScope.STOCK_TAKE]);
    expect((await take(asKey(first.token), dailyCap)).status).toBe(201);
    // A second account's allowance is untouched by the first one's day.
    expect((await take(asKey(second.token), dailyCap)).status).toBe(201);
    // A person at the shelf is not a key: no daily allowance applies to them.
    expect((await take(im.client, dailyCap)).status).toBe(201);
    expect((await take(im.client, 1)).status).toBe(201);
  });
});

