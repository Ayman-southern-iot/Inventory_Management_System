import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LogEvent } from 'kysely';
import { createTestApp, type TestApp } from './app';
import { config } from '../src/config';
import { createDatabase } from '../src/database/create-db';
import type { Db } from '../src/database/create-db';
import { StockService } from '../src/modules/stock/stock.service';
import { ConflictError } from '../src/common/errors';
import { UntrackedCategoryError } from '../src/modules/stock/stock.errors';
import {
  createCategory,
  createCompartment,
  createProduct,
  createZone,
  ledgerRows,
  placementOf,
} from './stock-factories';

/**
 * `StockService.adjustBatch` — the batch entry point of `importing_data.md` §11.2 (part H).
 *
 * The claim it exists to make is a *cost* claim: the trackable check runs once per distinct
 * product rather than once per changed shelf. That is only observable in the SQL, so this file
 * counts the SQL, through a second Kysely built with a `log` callback. Every query the service
 * runs goes through the transaction it is handed, so handing it one of these counts everything
 * it does and nothing else — no spy, no stubbed method, the real statements.
 *
 * The rest of the file is the part that matters more: the check has *moved*, not gone. A batch
 * containing a deactivated or untracked product must still be refused, and refused before it
 * writes anything.
 */

interface Counts {
  trackable: number;
  ledgerInserts: number;
}

describe('StockService.adjustBatch', () => {
  let ctx: TestApp;
  let stock: StockService;
  let logged: Db;
  let closeLogged: () => Promise<void>;
  let sql: string[];
  let actor: string;

  let categoryId: string;
  let productId: string;
  let shelves: string[];

  /**
   * The trackable check is the only statement in the service that reads `products` joined to
   * `categories`; the ledger insert is the only one writing `stock_ledger`. Matching on those
   * shapes rather than on a method name keeps the measurement about what reaches Postgres.
   */
  const countsSince = (from: number): Counts => ({
    trackable: sql
      .slice(from)
      .filter((q) => /from "products"/.test(q) && /left join "categories"/.test(q)).length,
    ledgerInserts: sql.slice(from).filter((q) => /insert into "stock_ledger"/.test(q)).length,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);

    sql = [];
    const created = createDatabase(config, (event: LogEvent) => {
      if (event.level === 'query') sql.push(event.query.sql);
    });
    logged = created.db;
    closeLogged = async () => {
      await created.db.destroy();
    };

    const user = await ctx.db.selectFrom('users').select('id').executeTakeFirst();
    actor =
      user?.id ??
      (
        await ctx.db
          .insertInto('users')
          .values({
            email: `adjust-batch-${Date.now()}@ims.test`,
            password_hash: 'x'.repeat(60),
            full_name: 'Adjust Batch Actor',
            designation: 'Inventory Manager',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
  });

  afterAll(async () => {
    await closeLogged();
    await ctx.close();
  });

  beforeEach(async () => {
    categoryId = await createCategory(ctx.db);
    productId = await createProduct(ctx.db, { categoryId });
    const zoneId = await createZone(ctx.db);
    shelves = [
      await createCompartment(ctx.db, zoneId),
      await createCompartment(ctx.db, zoneId),
      await createCompartment(ctx.db, zoneId),
    ];
    sql = [];
  });

  const changesOf = (deltas: number[], product = productId) =>
    deltas.map((delta, index) => ({
      productId: product,
      compartmentId: shelves[index]!,
      delta,
      reason: 'CSV import fixture',
    }));

  const ctxOf = () => ({ performedBy: actor, refType: 'TEST' });

  /**
   * The cost claim, measured. Three shelves of one product, and the join that decides
   * trackability must appear exactly once — while the ledger, which is the actual work, still
   * gets one row per change.
   */
  it('asks whether a product is trackable once, however many of its shelves change', async () => {
    const before = sql.length;

    await ctx.db.transaction().execute(async (tx) => {
      await stock.adjustBatch(tx, changesOf([5, 7, 9]), ctxOf());
    });

    // Counted on the app's own connection, which this transaction ran on.
    const rows = await ledgerRows(ctx.db, productId);
    expect(rows).toHaveLength(3);

    // And the same batch again, this time on the logging connection, to count the statements.
    const product2 = await createProduct(ctx.db, { categoryId });
    const start = sql.length;
    await logged.transaction().execute(async (tx) => {
      await stock.adjustBatch(tx, changesOf([5, 7, 9], product2), ctxOf());
    });
    const counts = countsSince(start);

    expect(counts.ledgerInserts).toBe(3);
    expect(counts.trackable).toBe(1);
    expect(before).toBeLessThanOrEqual(start);
  });

  /** The contrast, on the same instrument: three separate `adjust` calls ask three times. */
  it('single adjusts still ask once each — which is what the batch removes', async () => {
    const start = sql.length;

    await logged.transaction().execute(async (tx) => {
      for (const change of changesOf([5, 7, 9])) {
        await stock.adjust(change, ctxOf(), undefined, tx);
      }
    });

    expect(countsSince(start).trackable).toBe(3);
  });

  /** Two products in one batch are two distinct answers, so two questions — not one, not five. */
  it('asks once per distinct product, not once per batch', async () => {
    const other = await createProduct(ctx.db, { categoryId });
    const start = sql.length;

    await logged.transaction().execute(async (tx) => {
      await stock.adjustBatch(
        tx,
        [...changesOf([4, 6]), ...changesOf([8], other)],
        ctxOf(),
      );
    });

    expect(countsSince(start).trackable).toBe(2);
    expect(countsSince(start).ledgerInserts).toBe(3);
  });

  it('applies every change, in the order given', async () => {
    await ctx.db.transaction().execute(async (tx) => {
      await stock.adjustBatch(tx, changesOf([5, 7, 9]), ctxOf());
    });

    expect((await placementOf(ctx.db, productId, shelves[0]!))?.quantity).toBe(5);
    expect((await placementOf(ctx.db, productId, shelves[1]!))?.quantity).toBe(7);
    expect((await placementOf(ctx.db, productId, shelves[2]!))?.quantity).toBe(9);

    const rows = await ledgerRows(ctx.db, productId);
    expect(rows.map((row) => row.quantity)).toEqual([5, 7, 9]);
    expect(rows.map((row) => row.to_compartment_id)).toEqual(shelves);
  });

  it('reports each change as it lands, so a long batch is not silent', async () => {
    const seen: number[] = [];

    await ctx.db.transaction().execute(async (tx) => {
      await stock.adjustBatch(tx, changesOf([5, 7, 9]), ctxOf(), async (change) => {
        seen.push(change.delta);
      });
    });

    expect(seen).toEqual([5, 7, 9]);
  });

  /**
   * The check moved; it did not go. An untracked category must stop the batch — and because the
   * hoisted check runs before any write, it stops it before the first shelf, not after two.
   */
  it('refuses an untracked product without writing any of the batch', async () => {
    const untracked = await createCategory(ctx.db, { isTrackable: false });
    const product = await createProduct(ctx.db, { categoryId: untracked });

    await expect(
      ctx.db.transaction().execute(async (tx) => {
        await stock.adjustBatch(tx, changesOf([5, 7, 9], product), ctxOf());
      }),
    ).rejects.toBeInstanceOf(UntrackedCategoryError);

    expect(await ledgerRows(ctx.db, product)).toHaveLength(0);
    expect(await placementOf(ctx.db, product, shelves[0]!)).toBeUndefined();
  });

  it('refuses a deactivated product without writing any of the batch', async () => {
    const product = await createProduct(ctx.db, { categoryId, isActive: false });

    await expect(
      ctx.db.transaction().execute(async (tx) => {
        await stock.adjustBatch(tx, changesOf([5, 7], product), ctxOf());
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await ledgerRows(ctx.db, product)).toHaveLength(0);
  });

  /**
   * One untrackable product late in a batch of otherwise fine ones. Checking every product up
   * front is what makes this cost nothing: the good changes are never written and then rolled
   * back, they are never attempted.
   */
  it('rejects the whole batch when any one product in it is untrackable', async () => {
    const untracked = await createCategory(ctx.db, { isTrackable: false });
    const bad = await createProduct(ctx.db, { categoryId: untracked });
    const start = sql.length;

    await expect(
      logged.transaction().execute(async (tx) => {
        await stock.adjustBatch(tx, [...changesOf([5, 7]), ...changesOf([9], bad)], ctxOf());
      }),
    ).rejects.toBeInstanceOf(UntrackedCategoryError);

    expect(countsSince(start).ledgerInserts).toBe(0);
    expect(await ledgerRows(ctx.db, productId)).toHaveLength(0);
  });

  it('rejects a zero delta and an empty reason before it writes anything', async () => {
    await expect(
      ctx.db.transaction().execute(async (tx) => {
        await stock.adjustBatch(tx, changesOf([5, 0]), ctxOf());
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      ctx.db.transaction().execute(async (tx) => {
        await stock.adjustBatch(
          tx,
          changesOf([5, 7]).map((change, index) => (index === 1 ? { ...change, reason: '  ' } : change)),
          ctxOf(),
        );
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await ledgerRows(ctx.db, productId)).toHaveLength(0);
  });

  it('does nothing at all for an empty batch', async () => {
    const start = sql.length;

    await logged.transaction().execute(async (tx) => {
      await stock.adjustBatch(tx, [], ctxOf());
    });

    expect(countsSince(start)).toEqual({ trackable: 0, ledgerInserts: 0 });
  });
});
