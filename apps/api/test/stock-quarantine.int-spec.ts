import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReturnCondition, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';
import { createStockFixture, type StockFixture } from './stock-factories';
import { StockService } from '../src/modules/stock/stock.service';

/**
 * Quarantined units must not count as available in the write paths that gate moves, reservations,
 * and adjustments. Read paths (`GET /products/:id`, `GET /stock/placements`) already exclude
 * quarantine — see product-totals.int-spec.ts. These tests pin the write-path invariant that
 * previously let quarantined units leak back into circulation.
 *
 * 2026-08-10 — regression coverage for the bug where `available = quantity - reserved_qty`
 * ignored `quarantined_qty`, so a 5/4-available/1-quarantined placement could still issue
 * its 5 units on the next borrow.
 */
describe('quarantine excludes from available in write paths', () => {
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

    // Fresh IM per test: `resetData` deletes users with no stock_ledger rows, so any user
    // pinned across runs would be wiped after its first movement.
    const imUser = await createUser(ctx.db, { roles: [Role.GENERAL, Role.INVENTORY_MANAGER] });
    const imHttp = httpClient(ctx.app);
    const imSession = await login(imHttp, imUser.email, imUser.password);
    im = { id: imUser.id, client: imHttp.as(imSession.accessToken) };

    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
      { performedBy: im.id, refType: 'TEST' },
    );
  });

  /** Push 1 unit into quarantine via a borrow + damaged return (the only writer that sets it). */
  async function putOneInQuarantine(): Promise<void> {
    const req = await im.client.post('/borrowing').send({
      productId: fixture.productId,
      quantity: 1,
      compartmentId: fixture.compartmentA,
      isReturnable: true,
      expectedReturnDate: '2026-12-31',
      purpose: 'Quarantine probe',
    });
    if (req.status !== 201) {
      throw new Error(`borrow create failed: ${req.status} ${JSON.stringify(req.body)}`);
    }
    await im.client.post(`/borrowing/${req.body.id}/decision`).send({ approve: true });
    await im.client.post(`/borrowing/${req.body.id}/returns`).send({
      quantity: 1,
      compartmentId: fixture.compartmentA,
      condition: ReturnCondition.DAMAGED,
    });
  }

  const stockCtx = (): { performedBy: string } => ({ performedBy: im.id });

  it('reserve caps at quantity - reserved - quarantined (move and reserve paths)', async () => {
    await putOneInQuarantine();
    // After a borrow(1) → approve → return(1 DAMAGED): the placement has quantity=5,
    // reserved=0, quarantined=1 → available=4. The pre-fix bug would have allowed a reserve
    // of 5 (because quarantine was ignored); reserving 4 must succeed.
    await expect(
      stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
        stockCtx(),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await expect(
      stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 },
        stockCtx(),
      ),
    ).resolves.toBeDefined();
  });

  it('adjust (negative delta) refuses to over-draw past quarantine', async () => {
    await putOneInQuarantine();
    // quantity=5, reserved=0, quarantined=1 → available=4. Adjusting by -5 should fail.
    await expect(
      stock.adjust(
        {
          productId: fixture.productId,
          compartmentId: fixture.compartmentA,
          delta: -5,
          reason: 'TEST',
        },
        stockCtx(),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await expect(
      stock.adjust(
        {
          productId: fixture.productId,
          compartmentId: fixture.compartmentA,
          delta: -4,
          reason: 'TEST',
        },
        stockCtx(),
      ),
    ).resolves.toBeDefined();
  });

  it('InsufficientStockError carries the quarantined count when known', async () => {
    await putOneInQuarantine();
    try {
      await stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 999 },
        stockCtx(),
      );
      throw new Error('reserve should have failed');
    } catch (err) {
      expect(err).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        quarantined: 1,
        available: 4,
        requested: 999,
      });
    }
  });
});
