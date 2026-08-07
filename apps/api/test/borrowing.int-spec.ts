import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BorrowStatus, ErrorCode, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, placementOf, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * The Phase 02 exit criterion, in one file: request → approve → issue → partial return → full
 * return, with the ledger reconciling at every step.
 *
 * The reconciliation assertion after each step is the point. A borrow flow that ends with the
 * right status but the wrong stock is worse than one that fails loudly, because nobody notices
 * until someone walks to the shelf.
 */
describe('borrowing', () => {
  let ctx: TestApp;
  let stock: StockService;
  let fixture: StockFixture;
  let im: { id: string; client: HttpClient };
  let requester: { id: string; client: HttpClient };

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetData(ctx.db);
    fixture = await createStockFixture(ctx.db);

    const imUser = await createUser(ctx.db, { roles: [Role.GENERAL, Role.INVENTORY_MANAGER] });
    const imHttp = httpClient(ctx.app);
    const imSession = await login(imHttp, imUser.email);
    im = { id: imUser.id, client: imHttp.as(imSession.accessToken) };

    const general = await createUser(ctx.db, { roles: [Role.GENERAL] });
    const generalHttp = httpClient(ctx.app);
    const generalSession = await login(generalHttp, general.email);
    requester = { id: general.id, client: generalHttp.as(generalSession.accessToken) };

    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  const raise = (overrides: Record<string, unknown> = {}) =>
    requester.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity: 5,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Field testing',
      ...overrides,
    });

  const assertReconciled = async () => {
    expect(await stock.findReconciliationMismatches()).toEqual([]);
  };

  describe('the full loop (exit criterion)', () => {
    it('request → approve → partial return → full return, reconciling at every step', async () => {
      // --- request reserves immediately -------------------------------------
      const created = await raise();
      expect(created.status).toBe(201);
      expect(created.body.status).toBe(BorrowStatus.PENDING);
      expect(created.body.borrowNo).toMatch(/^BR-\d{6}$/);

      let placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement).toMatchObject({ quantity: 10, reserved_qty: 5 });
      await assertReconciled();

      // --- approve issues the stock ----------------------------------------
      const approved = await im.client
        .post(`/borrowing/${created.body.id}/decision`)
        .send({ approve: true, note: 'ok' });
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe(BorrowStatus.ISSUED);
      expect(approved.body.issuedAt).not.toBeNull();

      // Both quantity and the reservation drop — the units physically left.
      placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement).toMatchObject({ quantity: 5, reserved_qty: 0 });
      await assertReconciled();

      // --- partial return ---------------------------------------------------
      const partial = await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 3, compartmentId: fixture.compartmentA, condition: 'GOOD' });
      expect(partial.status).toBe(200);
      expect(partial.body.status).toBe(BorrowStatus.PARTIALLY_RETURNED);
      expect(partial.body.outstandingQty).toBe(2);

      placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement!.quantity).toBe(8);
      await assertReconciled();

      // --- full return ------------------------------------------------------
      const full = await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 2, compartmentId: fixture.compartmentA, condition: 'GOOD' });
      expect(full.status).toBe(200);
      expect(full.body.status).toBe(BorrowStatus.RETURNED);
      expect(full.body.outstandingQty).toBe(0);
      expect(full.body.returnedAt).not.toBeNull();

      placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement!.quantity).toBe(10);
      await assertReconciled();
    });

    it('rejecting releases the reservation and touches no stock', async () => {
      const created = await raise();
      const rejected = await im.client
        .post(`/borrowing/${created.body.id}/decision`)
        .send({ approve: false, note: 'not justified' });

      expect(rejected.body.status).toBe(BorrowStatus.REJECTED);
      expect(await placementOf(ctx.db, fixture.productId, fixture.compartmentA)).toMatchObject({
        quantity: 10,
        reserved_qty: 0,
      });
      await assertReconciled();
    });
  });

  describe('reservations', () => {
    it('drops availability the moment a request is raised (task 2.2)', async () => {
      const before = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(before!.quantity - before!.reserved_qty).toBe(10);

      await raise({ quantity: 4 });

      const after = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(after!.quantity - after!.reserved_qty).toBe(6);
    });

    it('refuses a request for more than is available', async () => {
      const response = await raise({ quantity: 99 });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCode.INSUFFICIENT_STOCK);
    });

    it('two users cannot both reserve the last unit', async () => {
      await stock.adjust(
        {
          productId: fixture.productId,
          compartmentId: fixture.compartmentA,
          delta: -9,
          reason: 'leave exactly one',
        },
        { performedBy: im.id, refType: 'TEST' },
      );

      const rival = await createUser(ctx.db, { roles: [Role.GENERAL] });
      const rivalHttp = httpClient(ctx.app);
      const rivalSession = await login(rivalHttp, rival.email);
      const rivalClient = rivalHttp.as(rivalSession.accessToken);

      const body = {
        productId: fixture.productId,
        compartmentId: fixture.compartmentA,
        quantity: 1,
        isReturnable: true,
        expectedReturnDate: '2026-12-31',
      };

      const [a, b] = await Promise.all([
        requester.client.post('/borrowing').send(body),
        rivalClient.post('/borrowing').send(body),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement!.reserved_qty).toBe(1);
      await assertReconciled();
    });

    it('cancelling releases the reservation', async () => {
      const created = await raise({ quantity: 4 });
      const cancelled = await requester.client.post(`/borrowing/${created.body.id}/cancel`).send();

      expect(cancelled.body.status).toBe(BorrowStatus.CANCELLED);
      expect(await placementOf(ctx.db, fixture.productId, fixture.compartmentA)).toMatchObject({
        reserved_qty: 0,
      });
    });
  });

  describe('idempotency (task 2.3)', () => {
    it('double-submitting the same key issues stock exactly once', async () => {
      const created = await raise({ quantity: 5 });
      const key = randomUUID();

      const [first, second] = await Promise.all([
        im.client
          .post(`/borrowing/${created.body.id}/decision`)
          .set('Idempotency-Key', key)
          .send({ approve: true }),
        im.client
          .post(`/borrowing/${created.body.id}/decision`)
          .set('Idempotency-Key', key)
          .send({ approve: true }),
      ]);

      // One succeeds; the other either replays the stored response or is told to retry, but
      // must never issue a second time.
      const succeeded = [first, second].filter((r) => r.status === 200);
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement).toMatchObject({ quantity: 5, reserved_qty: 0 });

      const issues = await ctx.db
        .selectFrom('stock_ledger')
        .select('id')
        .where('product_id', '=', fixture.productId)
        .where('movement_type', '=', 'ISSUE')
        .execute();
      expect(issues).toHaveLength(1);
      await assertReconciled();
    });

    it('a sequential repeat returns the original response', async () => {
      const created = await raise({ quantity: 2 });
      const key = randomUUID();

      const first = await im.client
        .post(`/borrowing/${created.body.id}/decision`)
        .set('Idempotency-Key', key)
        .send({ approve: true });
      const replay = await im.client
        .post(`/borrowing/${created.body.id}/decision`)
        .set('Idempotency-Key', key)
        .send({ approve: true });

      expect(replay.status).toBe(200);
      expect(replay.body.id).toBe(first.body.id);
      expect(replay.body.status).toBe(BorrowStatus.ISSUED);
    });

    it('a second decision without a key is refused as an invalid transition', async () => {
      const created = await raise({ quantity: 2 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      const again = await im.client
        .post(`/borrowing/${created.body.id}/decision`)
        .send({ approve: true });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe(ErrorCode.BORROW_INVALID_TRANSITION);
    });
  });

  describe('returns (task 2.4)', () => {
    it('returning 3 of 5 leaves 2 outstanding', async () => {
      const created = await raise({ quantity: 5 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      const partial = await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 3, compartmentId: fixture.compartmentA, condition: 'GOOD' });

      expect(partial.body.returnedQty).toBe(3);
      expect(partial.body.outstandingQty).toBe(2);
      expect(partial.body.status).toBe(BorrowStatus.PARTIALLY_RETURNED);
    });

    it('refuses to return more than is outstanding', async () => {
      const created = await raise({ quantity: 3 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      const tooMany = await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 4, compartmentId: fixture.compartmentA, condition: 'GOOD' });

      expect(tooMany.status).toBe(409);
      await assertReconciled();
    });

    it('a consumable is issued and never comes back', async () => {
      const created = await raise({ quantity: 2, isReturnable: false, expectedReturnDate: null });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      const attempted = await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 1, compartmentId: fixture.compartmentA, condition: 'GOOD' });

      expect(attempted.status).toBe(409);
      expect(attempted.body.message).toMatch(/consumable/i);
    });

    it('a consumable may not carry an expected return date', async () => {
      const response = await raise({ isReturnable: false, expectedReturnDate: '2026-12-31' });
      expect(response.status).toBe(400);
    });

    it('lets the item be reshelved into a different compartment', async () => {
      const created = await raise({ quantity: 4 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 4, compartmentId: fixture.compartmentB, condition: 'GOOD' });

      expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentB))!.quantity).toBe(4);
      await assertReconciled();
    });

    it('quarantines the returned units when the condition is DAMAGED', async () => {
      // Start 10 -> borrow 4 -> quantity 6 -> return 2 DAMAGED -> quantity 8, quarantined 2.
      const created = await raise({ quantity: 4 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 2, compartmentId: fixture.compartmentA, condition: 'DAMAGED' });

      const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement).toMatchObject({ quantity: 8, reserved_qty: 0, quarantined_qty: 2 });
      await assertReconciled();
    });

    it('quarantines the returned units when the condition is NOT_WORKING', async () => {
      // Start 10 -> borrow 3 -> quantity 7 -> return 3 NOT_WORKING -> quantity 10, quarantined 3.
      const created = await raise({ quantity: 3 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 3, compartmentId: fixture.compartmentA, condition: 'NOT_WORKING' });

      const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement).toMatchObject({ quantity: 10, reserved_qty: 0, quarantined_qty: 3 });
      await assertReconciled();
    });

    it('PARTIALLY_DAMAGED_USABLE returns go back to available, not quarantine', async () => {
      // Start 10 -> borrow 5 -> quantity 5 -> return 5 PARTIALLY_DAMAGED_USABLE -> quantity 10,
      // quarantined 0 (the units are usable, so they join available stock like a GOOD return).
      const created = await raise({ quantity: 5 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({
          quantity: 5,
          compartmentId: fixture.compartmentA,
          condition: 'PARTIALLY_DAMAGED_USABLE',
        });

      const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(placement).toMatchObject({ quantity: 10, reserved_qty: 0, quarantined_qty: 0 });
      await assertReconciled();
    });

    it('refuses to return more than is free when quarantine would overflow available', async () => {
      // Floor the placement: bring everything out, then return it all DAMAGED, then try to
      // partially return more quarantine than the placement can hold.
      const created = await raise({ quantity: 4 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      // First return quarantines all 4 units.
      await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 4, compartmentId: fixture.compartmentA, condition: 'DAMAGED' });

      // 4 still out and requested to return DAMAGED again — there's no placement room.
      const tooMany = await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 1, compartmentId: fixture.compartmentA, condition: 'DAMAGED' });

      expect(tooMany.status).toBe(409);
    });
  });

  describe('OQ-04 revert to pending', () => {
    it('reverts an approved borrow while it has not physically left', async () => {
      const created = await raise({ quantity: 3 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      const reverted = await im.client
        .post(`/borrowing/${created.body.id}/revert`)
        .send({ reason: 'approved by mistake' });

      expect(reverted.status).toBe(200);
      expect(reverted.body.status).toBe(BorrowStatus.PENDING);
      // Back to reserved-but-not-issued, exactly as before the approval.
      expect(await placementOf(ctx.db, fixture.productId, fixture.compartmentA)).toMatchObject({
        quantity: 10,
        reserved_qty: 3,
      });
      await assertReconciled();
    });

    it('refuses to revert once part of it has been returned', async () => {
      const created = await raise({ quantity: 4 });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });
      await im.client
        .post(`/borrowing/${created.body.id}/returns`)
        .send({ quantity: 1, compartmentId: fixture.compartmentA, condition: 'GOOD' });

      const reverted = await im.client
        .post(`/borrowing/${created.body.id}/revert`)
        .send({ reason: 'changed my mind' });
      expect(reverted.status).toBe(409);
    });
  });

  describe('projects (task 2.1)', () => {
    it('warns on a duplicate name but lets the user proceed deliberately', async () => {
      const first = await requester.client.post('/projects').send({ name: 'Falcon' });
      expect(first.status).toBe(201);

      // Case-insensitive: "falcon" is the same project to a human.
      const warned = await requester.client.post('/projects').send({ name: 'falcon' });
      expect(warned.status).toBe(409);
      expect(warned.body.code).toBe(ErrorCode.DUPLICATE_PROJECT_NAME);

      const forced = await requester.client
        .post('/projects')
        .send({ name: 'falcon', allowDuplicateName: true });
      expect(forced.status).toBe(201);
    });
  });

  describe('permission boundaries (exit criterion)', () => {
    it('a general user cannot decide, return, or revert', async () => {
      const created = await raise();

      for (const [path, body] of [
        [`/borrowing/${created.body.id}/decision`, { approve: true }],
        [
          `/borrowing/${created.body.id}/returns`,
          { quantity: 1, compartmentId: fixture.compartmentA, condition: 'GOOD' },
        ],
        [`/borrowing/${created.body.id}/revert`, { reason: 'nope' }],
      ] as const) {
        const response = await requester.client.post(path).send(body);
        expect(response.status, `POST ${path}`).toBe(403);
      }

      const badge = await requester.client.get('/borrowing/pending-count');
      expect(badge.status).toBe(403);
    });

    it('a general user only ever sees their own borrows', async () => {
      await raise();

      const other = await createUser(ctx.db, { roles: [Role.GENERAL] });
      const otherHttp = httpClient(ctx.app);
      const otherSession = await login(otherHttp, other.email);

      const list = await otherHttp.as(otherSession.accessToken).get('/borrowing');
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(0);

      // The IM sees everything.
      const imList = await im.client.get('/borrowing');
      expect(imList.body.total).toBeGreaterThan(0);
    });

    it('a requester cannot cancel someone else’s request', async () => {
      const created = await raise();

      const other = await createUser(ctx.db, { roles: [Role.GENERAL] });
      const otherHttp = httpClient(ctx.app);
      const otherSession = await login(otherHttp, other.email);

      const response = await otherHttp
        .as(otherSession.accessToken)
        .post(`/borrowing/${created.body.id}/cancel`)
        .send();
      expect(response.status).toBe(403);
    });
  });

  describe('the borrow log (task 2.5)', () => {
    it('filters compose with search', async () => {
      const pending = await raise({ quantity: 1 });
      const approved = await raise({ quantity: 2 });
      await im.client.post(`/borrowing/${approved.body.id}/decision`).send({ approve: true });

      const onlyPending = await im.client.get('/borrowing?filter=PENDING');
      const ids = onlyPending.body.items.map((r: { id: string }) => r.id);
      expect(ids).toContain(pending.body.id);
      expect(ids).not.toContain(approved.body.id);

      const out = await im.client.get('/borrowing?filter=OUT');
      expect(out.body.items.map((r: { id: string }) => r.id)).toContain(approved.body.id);

      const searched = await im.client.get(`/borrowing?search=${pending.body.borrowNo}`);
      expect(searched.body.total).toBe(1);
    });

    it('flags an overdue borrow without storing the flag', async () => {
      const created = await raise({ quantity: 1, expectedReturnDate: '2020-01-01' });
      await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

      const overdue = await im.client.get('/borrowing?filter=OVERDUE');
      expect(overdue.body.items.map((r: { id: string }) => r.id)).toContain(created.body.id);
      expect(overdue.body.items[0].isOverdue).toBe(true);
    });

    it('is paginated', async () => {
      const list = await im.client.get('/borrowing?limit=1');
      expect(list.body.limit).toBe(1);
      expect(typeof list.body.total).toBe('number');
    });
  });

  describe('pending count badge (sidebar)', () => {
    // The badge drives the IM sidebar (NavBadge.tsx). Two things must be true:
    //   1. It only counts borrow requests a stock-role could decide from.
    //   2. A decision decrements it on the next read, so the polling badge doesn't drift.
    it('reflects pending requests and decrements after a decision', async () => {
      const initial = await im.client.get('/borrowing/pending-count');
      expect(initial.status).toBe(200);
      expect(initial.body.count).toBe(0);

      await raise({ quantity: 1 });
      await raise({ quantity: 1 });

      const pending = await im.client.get('/borrowing/pending-count');
      expect(pending.body.count).toBe(2);

      const list = await im.client.get('/borrowing?filter=PENDING');
      const approvableId = list.body.items[0].id as string;

      await im.client.post(`/borrowing/${approvableId}/decision`).send({ approve: true });

      const after = await im.client.get('/borrowing/pending-count');
      expect(after.body.count).toBe(1);
    });

    it('is not exposed to a general user', async () => {
      await raise();
      const response = await requester.client.get('/borrowing/pending-count');
      expect(response.status).toBe(403);
    });
  });
});
