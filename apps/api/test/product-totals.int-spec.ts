import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReturnCondition, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * Product totals and active-borrow visibility on `GET /products/:id`.
 *
 * The endpoint is what the inventory page and product detail page both read. The plan requires
 * the four invariants below:
 *   - Total owned = on hand + outstanding issued.
 *   - Available excludes both reserved and quarantined.
 *   - Fully returned items disappear from active borrows.
 *   - Partial returns keep only the outstanding quantity visible.
 */
describe('product totals and active borrows', () => {
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

    // Stock the shelf with 10 units before each test.
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

  it('totalOwned = on hand + outstanding issued when stock is fully out and returned', async () => {
    // No borrow yet: 10 on hand, 0 in use, 10 owned.
    let detail = (await im.client.get(`/products/${fixture.productId}`)).body;
    expect(detail.totalOnHand).toBe(10);
    expect(detail.totalInUse).toBe(0);
    expect(detail.totalReserved).toBe(0);
    expect(detail.totalQuarantined).toBe(0);
    expect(detail.totalAvailable).toBe(10);
    expect(detail.totalOwned).toBe(10);
    expect(detail.activeBorrows).toHaveLength(0);

    // Borrow 5, approve: 5 on hand, 5 in use, 5 reserved→0 (issue), 10 owned.
    const created = await raise();
    await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

    detail = (await im.client.get(`/products/${fixture.productId}`)).body;
    expect(detail.totalOnHand).toBe(5);
    expect(detail.totalInUse).toBe(5);
    expect(detail.totalReserved).toBe(0);
    expect(detail.totalQuarantined).toBe(0);
    expect(detail.totalAvailable).toBe(5);
    expect(detail.totalOwned).toBe(10);
    expect(detail.activeBorrows).toHaveLength(1);
    expect(detail.activeBorrows[0].outstandingQty).toBe(5);

    // Return all 5 GOOD: 10 on hand, 0 in use, 10 owned, empty active list.
    await im.client
      .post(`/borrowing/${created.body.id}/returns`)
      .send({ quantity: 5, compartmentId: fixture.compartmentA, condition: ReturnCondition.GOOD });

    detail = (await im.client.get(`/products/${fixture.productId}`)).body;
    expect(detail.totalOnHand).toBe(10);
    expect(detail.totalInUse).toBe(0);
    expect(detail.totalAvailable).toBe(10);
    expect(detail.totalOwned).toBe(10);
    expect(detail.activeBorrows).toHaveLength(0);
  });

  it('available excludes reserved and quarantined together', async () => {
    // Borrow 4 to issue, then keep one separate reservation pending so reserved_qty stays > 0.
    const issued = await raise({ quantity: 4 });
    await im.client.post(`/borrowing/${issued.body.id}/decision`).send({ approve: true });

    // A second request reserves without issuing: this is what we need to assert available
    // excludes reserved on top of plain on-hand.
    await raise({ quantity: 1 });

    let detail = (await im.client.get(`/products/${fixture.productId}`)).body;
    expect(detail.totalOnHand).toBe(6);
    expect(detail.totalInUse).toBe(4);
    expect(detail.totalReserved).toBe(1);
    expect(detail.totalQuarantined).toBe(0);
    // 6 on hand - 1 reserved - 0 quarantined = 5 available.
    expect(detail.totalAvailable).toBe(5);

    // Now return 2 of the issued borrow as DAMAGED. On hand goes 6→8, quarantined 0→2.
    // The other unit stays in use (outstanding). Available stays 5 (8-0-2 plus in-use is owned, not available).
    await im.client
      .post(`/borrowing/${issued.body.id}/returns`)
      .send({
        quantity: 2,
        compartmentId: fixture.compartmentA,
        condition: ReturnCondition.DAMAGED,
      });

    detail = (await im.client.get(`/products/${fixture.productId}`)).body;
    expect(detail.totalOnHand).toBe(8);
    expect(detail.totalInUse).toBe(2);
    expect(detail.totalReserved).toBe(1);
    expect(detail.totalQuarantined).toBe(2);
    // 8 on hand - 1 reserved - 2 quarantined = 5 available.
    expect(detail.totalAvailable).toBe(5);
    // Total owned = on hand + in use = 8 + 2 = 10.
    expect(detail.totalOwned).toBe(10);
  });

  it('fully returned borrows disappear from activeBorrows; partial returns keep outstanding visible', async () => {
    // First borrow: 3 units, fully returned.
    const first = await raise({ quantity: 3 });
    await im.client.post(`/borrowing/${first.body.id}/decision`).send({ approve: true });
    await im.client
      .post(`/borrowing/${first.body.id}/returns`)
      .send({ quantity: 3, compartmentId: fixture.compartmentA, condition: ReturnCondition.GOOD });

    // Second borrow: 4 units, partially returned (3 of 4).
    const second = await raise({ quantity: 4 });
    await im.client.post(`/borrowing/${second.body.id}/decision`).send({ approve: true });
    await im.client
      .post(`/borrowing/${second.body.id}/returns`)
      .send({ quantity: 3, compartmentId: fixture.compartmentA, condition: ReturnCondition.GOOD });

    const detail = (await im.client.get(`/products/${fixture.productId}`)).body;
    // Only the second borrow should appear (and its outstanding qty is 1).
    expect(detail.activeBorrows).toHaveLength(1);
    expect(detail.activeBorrows[0].borrowId).toBe(second.body.id);
    expect(detail.activeBorrows[0].outstandingQty).toBe(1);
    expect(detail.activeBorrows[0].returnedQty).toBe(3);
    expect(detail.activeBorrows[0].quantity).toBe(4);
    // In use counts the outstanding of the second only.
    expect(detail.totalInUse).toBe(1);
    expect(detail.totalOnHand).toBe(9);
    expect(detail.totalOwned).toBe(10);
  });

  it('exposes borrower and project on every active borrow', async () => {
    const created = await raise({ quantity: 2 });
    await im.client.post(`/borrowing/${created.body.id}/decision`).send({ approve: true });

    const detail = (await im.client.get(`/products/${fixture.productId}`)).body;
    expect(detail.activeBorrows).toHaveLength(1);
    const row = detail.activeBorrows[0];
    // The user fixtures stamp `fullName` from the email local part; just check presence and shape.
    expect(typeof row.borrowerId).toBe('string');
    expect(typeof row.borrowerName).toBe('string');
    expect(typeof row.borrowNo).toBe('string');
    // projectId is null when raised without one.
    expect(row.projectId).toBeNull();
    expect(row.projectName).toBeNull();
  });
});