import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BorrowStatus, ReturnCondition, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, placementOf, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * Reversing a recorded return. The original `borrow_returns` row stays — append-only — but a
 * compensating `ADJUST` ledger row is written, the borrow's `returned_qty` is decremented, and
 * the status recomputed. For DAMAGED / NOT_WORKING returns, the quarantine is decremented in
 * lock-step so the placement invariant holds.
 *
 * 2026-08-10 — coverage for the bug where an IM had no path to correct a return they recorded
 * wrong. The borrow cycle is "pending → issued → returned" and an off-by-one on the return
 * quantity stranded stock on the shelf that nobody could remove without a hand-crafted DB edit.
 */
describe('borrowing reverse a recorded return', () => {
  let ctx: TestApp;
  let stock: StockService;
  let fixture: StockFixture;
  let im: { id: string; client: HttpClient };

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
    const imSession = await login(imHttp, imUser.email, imUser.password);
    im = { id: imUser.id, client: imHttp.as(imSession.accessToken) };

    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  /** Borrow + approve + return with the given condition. Returns the borrow id. */
  async function borrowAndReturn(
    quantity: number,
    condition: ReturnCondition,
  ): Promise<string> {
    const req = await im.client.post('/borrowing').send({
      productId: fixture.productId,
      quantity,
      compartmentId: fixture.compartmentA,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Reverse probe',
    });
    expect(req.status).toBe(201);
    await im.client.post(`/borrowing/${req.body.id}/decision`).send({ approve: true });
    const ret = await im.client.post(`/borrowing/${req.body.id}/returns`).send({
      quantity,
      compartmentId: fixture.compartmentA,
      condition,
    });
    expect(ret.status).toBe(200);
    return req.body.id as string;
  }

  it('a partial return can be reversed: stock returns to shelf, status flips back to ISSUED', async () => {
    // Borrow 5, return 3 of them. Status becomes PARTIALLY_RETURNED with returnedQty=3.
    const req = await im.client.post('/borrowing').send({
      productId: fixture.productId,
      quantity: 5,
      compartmentId: fixture.compartmentA,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Partial return probe',
    });
    expect(req.status).toBe(201);
    const borrowId = req.body.id as string;
    await im.client.post(`/borrowing/${borrowId}/decision`).send({ approve: true });
    const partial = await im.client.post(`/borrowing/${borrowId}/returns`).send({
      quantity: 3,
      compartmentId: fixture.compartmentA,
      condition: ReturnCondition.GOOD,
    });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({ status: BorrowStatus.PARTIALLY_RETURNED, returnedQty: 3 });

    // Before reversal: 8 on hand (10 received − 5 borrowed + 3 returned), 0 quarantined.
    let placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
    expect(placement).toMatchObject({ quantity: 8, reserved_qty: 0, quarantined_qty: 0 });

    // Find the return row id.
    const list = await im.client.get(`/borrowing/${borrowId}/returns`);
    expect(list.status).toBe(200);
    const returnId = (list.body as Array<{ id: string }>)[0]!.id;

    // Reverse.
    const reverse = await im.client
      .post(`/borrowing/${borrowId}/returns/${returnId}/reverse`)
      .send({ reason: 'Wrong condition recorded' });
    expect(reverse.status).toBe(200);
    expect(reverse.body).toMatchObject({
      id: borrowId,
      status: BorrowStatus.ISSUED,
      returnedQty: 0,
    });

    // After reversal: 5 on hand (the compensating ADJUST subtracted the 3 returned units),
    // 0 quarantined, the borrow's status is back to ISSUED with 5 still outstanding.
    placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
    expect(placement).toMatchObject({ quantity: 5, reserved_qty: 0, quarantined_qty: 0 });

    // Reconciliation must still pass — the compensating ADJUST row restores the balance.
    expect(await stock.findReconciliationMismatches()).toEqual([]);
  });

  it('reversing a DAMAGED return decrements quarantined_qty', async () => {
    const borrowId = await borrowAndReturn(2, ReturnCondition.DAMAGED);

    let placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
    expect(placement).toMatchObject({ quantity: 10, quarantined_qty: 2 });

    const list = await im.client.get(`/borrowing/${borrowId}/returns`);
    const returnId = (list.body as Array<{ id: string }>)[0]!.id;

    const reverse = await im.client
      .post(`/borrowing/${borrowId}/returns/${returnId}/reverse`)
      .send({ reason: 'Re-evaluate damage' });
    expect(reverse.status).toBe(200);

    placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
    expect(placement).toMatchObject({ quantity: 8, quarantined_qty: 0 });
  });

  it('refuses to reverse a return that does not belong to the borrow', async () => {
    const borrowIdA = await borrowAndReturn(1, ReturnCondition.GOOD);
    const borrowIdB = await borrowAndReturn(1, ReturnCondition.GOOD);

    const listA = await im.client.get(`/borrowing/${borrowIdA}/returns`);
    const returnIdA = (listA.body as Array<{ id: string }>)[0]!.id;

    const wrong = await im.client
      .post(`/borrowing/${borrowIdB}/returns/${returnIdA}/reverse`)
      .send({ reason: 'Trying to cross-reverse' });
    expect(wrong.status).toBe(404);
  });
});