import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { StockService } from '../src/modules/stock/stock.service';
import { InsufficientStockError } from '../src/modules/stock/stock.errors';
import {
  createStockFixture,
  ledgerRows,
  placementOf,
  resetInventory,
  type StockFixture,
} from './stock-factories';

/**
 * THE test this phase exists for (rules/50-testing.md: "the concurrency test is mandatory").
 *
 * Three people pressing Borrow on the last item at the same instant is the scenario that breaks
 * naive implementations, and a stock bug is the one bug this system cannot recover from — the
 * physical shelf and the database diverge silently and nobody notices for a month.
 *
 * These run against real Postgres with real connections and real `Promise.all`. Mocking any part
 * of this would test nothing: the entire mechanism under test is `SELECT ... FOR UPDATE`.
 */
describe('stock concurrency', () => {
  let ctx: TestApp;
  let stock: StockService;
  let fixture: StockFixture;
  let actor: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);

    const user = await ctx.db
      .selectFrom('users')
      .select('id')
      .executeTakeFirst();
    actor =
      user?.id ??
      (
        await ctx.db
          .insertInto('users')
          .values({
            email: `stock-actor-${Date.now()}@ims.test`,
            password_hash: 'x'.repeat(60),
            full_name: 'Stock Actor',
            designation: 'Inventory Manager',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetInventory(ctx.db);
    fixture = await createStockFixture(ctx.db);
  });

  const context = () => ({ performedBy: actor, refType: 'TEST' });

  it('lets exactly one of ten simultaneous reservations win when only one unit exists', async () => {
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 },
      context(),
    );

    const CONTENDERS = 10;
    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, () =>
        stock.reserve(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 },
          context(),
        ),
      ),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(CONTENDERS - 1);
    // The losers must fail for the right reason, not on a deadlock or a constraint violation.
    for (const failure of lost) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientStockError);
    }

    const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
    expect(placement).toMatchObject({ quantity: 1, reserved_qty: 1 });
  });

  it('issues the last unit exactly once under ten simultaneous attempts', async () => {
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 },
      context(),
    );
    await stock.reserve(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 },
      context(),
    );

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        stock.issue(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 },
          context(),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    // Exactly one ISSUE row. A second would mean the shelf and the ledger disagree forever.
    const issues = (await ledgerRows(ctx.db, fixture.productId)).filter(
      (r) => r.movement_type === 'ISSUE',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.quantity).toBe(1);

    // The placement is gone: zero quantity and zero reserved leaves no empty chip behind.
    expect(await placementOf(ctx.db, fixture.productId, fixture.compartmentA)).toBeUndefined();
  });

  it('never oversells when twenty requests chase twelve units', async () => {
    const STOCK = 12;
    const CONTENDERS = 20;

    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: STOCK },
      context(),
    );

    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, () =>
        stock.reserve(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 },
          context(),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(STOCK);

    const placement = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
    expect(placement!.reserved_qty).toBe(STOCK);
    // The database CHECK is the real guarantee; this asserts it was never even approached.
    expect(placement!.reserved_qty).toBeLessThanOrEqual(placement!.quantity);
  });

  it('does not deadlock when moves run in opposite directions at once', async () => {
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 50 },
      context(),
    );
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentB, quantity: 50 },
      context(),
    );

    // A→B and B→A concurrently is the classic deadlock shape. Consistent lock ordering by
    // placement id is what stops it, and nothing else would.
    const results = await Promise.allSettled([
      ...Array.from({ length: 5 }, () =>
        stock.move(
          {
            productId: fixture.productId,
            fromCompartmentId: fixture.compartmentA,
            toCompartmentId: fixture.compartmentB,
            quantity: 2,
          },
          context(),
        ),
      ),
      ...Array.from({ length: 5 }, () =>
        stock.move(
          {
            productId: fixture.productId,
            fromCompartmentId: fixture.compartmentB,
            toCompartmentId: fixture.compartmentA,
            quantity: 2,
          },
          context(),
        ),
      ),
    ]);

    const failures = results.filter((r) => r.status === 'rejected');
    for (const failure of failures) {
      const message = String((failure as PromiseRejectedResult).reason?.message ?? '');
      expect(message).not.toMatch(/deadlock/i);
    }
    expect(failures).toHaveLength(0);

    // Total is conserved: a MOVE is net-zero for the product however the races interleaved.
    const a = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
    const b = await placementOf(ctx.db, fixture.productId, fixture.compartmentB);
    expect((a?.quantity ?? 0) + (b?.quantity ?? 0)).toBe(100);
  });

  it('keeps the ledger and placements reconciled through concurrent mixed traffic', async () => {
    await stock.receive(
      { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 100 },
      context(),
    );

    await Promise.allSettled([
      ...Array.from({ length: 8 }, () =>
        stock.receive(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 3 },
          context(),
        ),
      ),
      ...Array.from({ length: 8 }, () =>
        stock.move(
          {
            productId: fixture.productId,
            fromCompartmentId: fixture.compartmentA,
            toCompartmentId: fixture.compartmentB,
            quantity: 4,
          },
          context(),
        ),
      ),
      ...Array.from({ length: 8 }, () =>
        stock.returnStock(
          { productId: fixture.productId, compartmentId: fixture.compartmentB, quantity: 2 },
          context(),
        ),
      ),
    ]);

    const mismatches = await stock.findReconciliationMismatches();
    expect(mismatches).toEqual([]);
  });
});
