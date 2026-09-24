import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { StockService } from '../src/modules/stock/stock.service';
import { IMPORT_LOCK_LOOKUP_CHUNK } from '../src/modules/stock/constants';
import { createCategory, createCompartment, createProduct, createZone } from './stock-factories';

/**
 * `StockService.lockPlacementsForImport` at import scale.
 *
 * The apply benchmark found this: a 20,000-shelf import died with `Maximum call stack size
 * exceeded` **before Postgres saw a statement**. The lookup built one `WHERE … OR …` with a term
 * per shelf, and the query builder compiles that tree by recursion. It was not a clean ceiling
 * either — the same 5,000-term list compiled in one run and overflowed in another, depending on
 * how deep the stack already was, which put the shipped `IMPORT_MAX_CHANGED_SHELVES` of 5,000
 * exactly on the edge rather than safely below it.
 *
 * The first test is the one that was red. It needs no data at all: the shelves are invented, the
 * lookup matches nothing, and the failure was in constructing the SQL rather than running it.
 */
describe('lockPlacementsForImport at scale', () => {
  let ctx: TestApp;
  let stock: StockService;

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Well past any size that has ever compiled. Nothing is written — `creating` is false. */
  it('builds a lookup for twenty thousand shelves without overflowing the stack', async () => {
    const shelves = Array.from({ length: 20_000 }, () => ({
      productId: randomUUID(),
      compartmentId: randomUUID(),
      creating: false,
    }));

    const locked = await ctx.db
      .transaction()
      .execute((tx) => stock.lockPlacementsForImport(tx, shelves));

    // No such placements exist, so the map is empty — the point is that it answered at all.
    expect(locked.size).toBe(0);
  });

  /**
   * Chunking must not lose a row or change the order things are locked in. This crosses the
   * chunk boundary in both directions: more shelves than one chunk holds, and a remainder.
   */
  it('locks every shelf across chunk boundaries, in one ascending id order', async () => {
    const count = IMPORT_LOCK_LOOKUP_CHUNK + 137;
    const categoryId = await createCategory(ctx.db, { name: `Lock ${randomUUID().slice(0, 8)}` });
    const zoneId = await createZone(ctx.db, `Lock zone ${randomUUID().slice(0, 8)}`);

    const shelves: { productId: string; compartmentId: string; creating: boolean }[] = [];
    for (let index = 0; index < count; index += 1) {
      shelves.push({
        productId: await createProduct(ctx.db, { categoryId }),
        compartmentId: await createCompartment(ctx.db, zoneId),
        creating: true,
      });
    }

    const locked = await ctx.db
      .transaction()
      .execute((tx) => stock.lockPlacementsForImport(tx, shelves));

    expect(locked.size).toBe(count);
    for (const shelf of shelves) {
      expect(locked.has(`${shelf.productId}:${shelf.compartmentId}`)).toBe(true);
    }

    /*
     * The ids must come back in one ascending sequence, not one per chunk. A per-chunk ordering
     * is the subtle way chunking reintroduces the deadlock the function exists to prevent, and
     * it would still pass every assertion above.
     */
    const ids = [...locked.values()].map((row) => row.id);
    expect(ids.length).toBeGreaterThan(IMPORT_LOCK_LOOKUP_CHUNK);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});
