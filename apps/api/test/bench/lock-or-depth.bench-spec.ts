import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createTestApp, type TestApp } from '../app';

/**
 * Where a 20,000-shelf apply dies.
 *
 * The apply benchmark reported `Maximum call stack size exceeded` at 20,000 changed shelves and
 * nothing at 5,000. This isolates the suspect: `lockPlacementsForImport` builds one `WHERE` with
 * an `OR` term per shelf, and Kysely compiles that tree by recursion. Nothing is executed here —
 * `.compile()` alone is enough to blow the stack if the tree is the cause, which also proves the
 * limit is in query construction rather than in Postgres.
 */
describe('OR-term depth in the import lock', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('finds the term count where compiling the lock query overflows', () => {
    const compileAt = (count: number): string => {
      const shelves = Array.from({ length: count }, () => ({
        productId: randomUUID(),
        compartmentId: randomUUID(),
      }));
      try {
        ctx.db
          .selectFrom('stock_placements')
          .select(['id'])
          .where((eb) =>
            eb.or(
              shelves.map((shelf) =>
                eb.and([
                  eb('product_id', '=', shelf.productId),
                  eb('compartment_id', '=', shelf.compartmentId),
                ]),
              ),
            ),
          )
          .orderBy('id')
          .compile();
        return 'ok';
      } catch (error) {
        if (!(error instanceof Error)) return String(error);
        const frames = (error.stack ?? '').split('\n').slice(1, 5).map((line) => line.trim());
        return `${error.message}\n${frames.join('\n')}`;
      }
    };

    for (const count of [5_000, 6_000, 7_000, 8_000, 9_000, 10_000]) {
      console.log(`${String(count).padStart(6)} terms → ${compileAt(count)}`);
    }
  });
});
