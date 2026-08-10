import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReturnCondition, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * Recent Movements (GET /stock/ledger) shows a Condition column. Only borrow-referencing
 * rows have a condition; non-borrow rows are NULL.
 *
 * 2026-08-10 — left-join lateral on `borrow_returns` keyed by `ref_id` and `ref_type='BORROW'`,
 * pinned to the most recent return at-or-before the ledger row's timestamp. Pins the contract
 * the UI depends on; any drift here would silently blank the column on the product detail.
 */
describe('stock ledger surfaces borrow return condition', () => {
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

    // Seed 5 units so the ledger has a RECEIPT row to assert null-condition on.
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  it('RECEIPT rows have a null condition', async () => {
    const res = await im.client.get(
      `/stock/ledger?productId=${fixture.productId}&limit=50`,
    );
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ movementType: string; condition: string | null }>;
    expect(items.length).toBeGreaterThan(0);
    const receipt = items.find((it) => it.movementType === 'RECEIPT');
    expect(receipt).toBeDefined();
    expect(receipt?.condition).toBeNull();
  });

  it('RETURN rows for a DAMAGED borrow carry that condition through to the ledger', async () => {
    const req = await im.client.post('/borrowing').send({
      productId: fixture.productId,
      quantity: 1,
      compartmentId: fixture.compartmentA,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Condition probe',
    });
    expect(req.status).toBe(201);
    await im.client.post(`/borrowing/${req.body.id}/decision`).send({ approve: true });
    const ret = await im.client.post(`/borrowing/${req.body.id}/returns`).send({
      quantity: 1,
      compartmentId: fixture.compartmentA,
      condition: ReturnCondition.DAMAGED,
    });
    expect(ret.status).toBe(200);

    const res = await im.client.get(
      `/stock/ledger?productId=${fixture.productId}&limit=50`,
    );
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ movementType: string; condition: string | null }>;
    const returned = items.find((it) => it.movementType === 'RETURN');
    expect(returned).toBeDefined();
    expect(returned?.condition).toBe('DAMAGED');
  });
});