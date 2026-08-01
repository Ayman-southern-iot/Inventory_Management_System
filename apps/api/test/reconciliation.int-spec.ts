import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createStockFixture, resetInventory, type StockFixture } from './stock-factories';
import { createUser, login } from './factories';
import { StockService } from '../src/modules/stock/stock.service';
import { StockReconciliationJob } from '../src/modules/stock/stock-reconciliation.job';

/**
 * Phase 06 task 6.2 — the nightly invariant job.
 *
 * Two invariants, and the second is the point of this file. `SUM(ledger) = quantity` has been
 * checked since Phase 01, but `reserved_qty` never appears in the ledger, so a reservation held
 * by nothing balances perfectly and the old job saw nothing wrong (gap G-14). These tests
 * deliberately corrupt `reserved_qty` behind the service's back to prove the check fires, then
 * walk the real borrow flows to prove they no longer produce that state.
 */
describe('stock reconciliation', () => {
  let ctx: TestApp;
  let stock: StockService;
  let job: StockReconciliationJob;
  let fixture: StockFixture;
  let im: { id: string; client: HttpClient };
  let requester: { id: string; client: HttpClient };

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
    job = ctx.app.get(StockReconciliationJob);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetInventory(ctx.db);
    fixture = await createStockFixture(ctx.db);

    im = await signIn([Role.GENERAL, Role.INVENTORY_MANAGER]);
    requester = await signIn([Role.GENERAL]);

    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 20 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  it('is clean when nothing is reserved', async () => {
    expect(await mismatches()).toEqual([]);
  });

  it('is clean while a borrow is genuinely pending', async () => {
    await raiseBorrow(5);

    // 5 reserved, one PENDING borrow for 5 — the invariant holds.
    expect(await mismatches()).toEqual([]);
  });

  /**
   * The G-14 failure, forced directly: units reserved with no request holding them.
   *
   * Written by updating the placement behind the service's back, because the service no longer
   * has a code path that produces it — which is the point. If a future change reintroduces one,
   * this check is what catches it at 2am instead of a user finding it at the shelf.
   */
  it('catches a reservation that no pending borrow accounts for', async () => {
    await ctx.db
      .updateTable('stock_placements')
      .set({ reserved_qty: 4 })
      .where('product_id', '=', fixture.productId)
      .where('compartment_id', '=', fixture.compartmentA)
      .execute();

    const found = await mismatches();
    expect(found).toHaveLength(1);
    expect(found[0]!.reserved_qty).toBe(4);
    expect(found[0]!.expected_qty).toBe(0);
    // The job itself reports a non-zero count; the exact number is global to the test database.
    expect(await job.reconcileReservations()).toBeGreaterThan(0);

    // The quantity invariant is undisturbed — which is exactly why this needed its own check.
    expect(await quantityMismatches()).toEqual([]);
  });

  it('catches a pending borrow whose units were never reserved', async () => {
    await raiseBorrow(5);
    await ctx.db
      .updateTable('stock_placements')
      .set({ reserved_qty: 0 })
      .where('product_id', '=', fixture.productId)
      .where('compartment_id', '=', fixture.compartmentA)
      .execute();

    const found = await mismatches();
    expect(found).toHaveLength(1);
    expect(found[0]!.reserved_qty).toBe(0);
    expect(found[0]!.expected_qty).toBe(5);
  });

  /* ------------------------------------- the real flows leave no residue */

  it('leaves nothing reserved after an approval', async () => {
    const borrow = await raiseBorrow(5);
    const decided = await im.client
      .post(`/borrowing/${borrow.id}/decision`)
      .send({ approve: true, note: null });
    expect(decided.status).toBe(200);

    expect(await mismatches()).toEqual([]);
    expect(await quantityMismatches()).toEqual([]);
  });

  it('leaves nothing reserved after a rejection', async () => {
    const borrow = await raiseBorrow(5);
    await im.client.post(`/borrowing/${borrow.id}/decision`).send({ approve: false, note: 'No' });

    expect(await mismatches()).toEqual([]);
  });

  it('leaves nothing reserved after a cancellation', async () => {
    const borrow = await raiseBorrow(5);
    await requester.client.post(`/borrowing/${borrow.id}/cancel`).send();

    expect(await mismatches()).toEqual([]);
  });

  it('leaves nothing reserved after a full return', async () => {
    const borrow = await raiseBorrow(5);
    await im.client.post(`/borrowing/${borrow.id}/decision`).send({ approve: true, note: null });
    const returned = await im.client
      .post(`/borrowing/${borrow.id}/returns`)
      .send({ quantity: 5, compartmentId: fixture.compartmentA, condition: 'GOOD' });
    expect(returned.status).toBe(200);

    expect(await mismatches()).toEqual([]);
    expect(await quantityMismatches()).toEqual([]);
  });

  /**
   * G-15: a partial return used to be compensated by an unconditional subtraction using a status
   * read before the claim. Two of them back to back is where that went wrong.
   */
  it('keeps returned_qty and the return rows agreeing across partial returns', async () => {
    const borrow = await raiseBorrow(6);
    await im.client.post(`/borrowing/${borrow.id}/decision`).send({ approve: true, note: null });

    for (const quantity of [2, 3]) {
      const response = await im.client
        .post(`/borrowing/${borrow.id}/returns`)
        .send({ quantity, compartmentId: fixture.compartmentA, condition: 'GOOD' });
      expect(response.status).toBe(200);
    }

    const row = await ctx.db
      .selectFrom('borrow_requests')
      .where('id', '=', borrow.id)
      .select(['returned_qty', 'status'])
      .executeTakeFirstOrThrow();
    const rows = await ctx.db
      .selectFrom('borrow_returns')
      .where('borrow_request_id', '=', borrow.id)
      .select('quantity')
      .execute();

    const summed = rows.reduce((total, entry) => total + entry.quantity, 0);
    expect(row.returned_qty).toBe(summed);
    expect(row.returned_qty).toBe(5);
    // 5 of 6 back: partially returned, not returned.
    expect(row.status).toBe('PARTIALLY_RETURNED');
    expect(await mismatches()).toEqual([]);
  });

  /* ----------------------------------------------------------- helpers */

  /**
   * Scoped to this fixture.
   *
   * The test database accumulates borrow requests from every other spec, and resetInventory
   * wipes their stock without being able to delete them — so a global check legitimately reports
   * dozens of mismatches that have nothing to do with this test. Filtering by the product this
   * fixture created is what makes the assertions mean something.
   */
  async function mismatches() {
    const rows = await stock.findReservationMismatches();
    return rows.filter((row) => row.product_id === fixture.productId);
  }

  async function quantityMismatches() {
    const rows = await stock.findReconciliationMismatches();
    return rows.filter((row) => row.product_id === fixture.productId);
  }

  async function signIn(roles: Role[]): Promise<{ id: string; client: HttpClient }> {
    const user = await createUser(ctx.db, { roles });
    const client = httpClient(ctx.app);
    const session = await login(client, user.email);
    return { id: user.id, client: client.as(session.accessToken) };
  }

  async function raiseBorrow(quantity: number): Promise<{ id: string }> {
    const created = await requester.client.post('/borrowing').send({
      productId: fixture.productId,
      compartmentId: fixture.compartmentA,
      quantity,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Reconciliation fixture',
    });
    expect(created.status).toBe(201);
    return { id: created.body.id as string };
  }
});
