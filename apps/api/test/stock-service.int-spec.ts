import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { StockService } from '../src/modules/stock/stock.service';
import {
  InsufficientStockError,
  ReservedStockError,
  StockVersionConflictError,
  UntrackedCategoryError,
} from '../src/modules/stock/stock.errors';
import {
  createCategory,
  createCompartment,
  createProduct,
  createStockFixture,
  createZone,
  ledgerRows,
  placementOf,
  type StockFixture,
} from './stock-factories';

describe('StockService', () => {
  let ctx: TestApp;
  let stock: StockService;
  let fixture: StockFixture;
  let actor: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    stock = ctx.app.get(StockService);
    const user = await ctx.db.selectFrom('users').select('id').executeTakeFirst();
    actor =
      user?.id ??
      (
        await ctx.db
          .insertInto('users')
          .values({
            email: `stock-svc-${Date.now()}@ims.test`,
            password_hash: 'x'.repeat(60),
            full_name: 'Stock Service Actor',
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
    fixture = await createStockFixture(ctx.db);
  });

  const ctxOf = () => ({ performedBy: actor, refType: 'TEST' });

  describe('partial move and split (task 1.6)', () => {
    it('moving 30 of 70 leaves two placements totalling 70 and writes one MOVE row', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 70 },
        ctxOf(),
      );

      await stock.move(
        {
          productId: fixture.productId,
          fromCompartmentId: fixture.compartmentA,
          toCompartmentId: fixture.compartmentB,
          quantity: 30,
        },
        ctxOf(),
      );

      const a = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      const b = await placementOf(ctx.db, fixture.productId, fixture.compartmentB);

      expect(a!.quantity).toBe(40);
      expect(b!.quantity).toBe(30);
      expect(a!.quantity + b!.quantity).toBe(70);

      const moves = (await ledgerRows(ctx.db, fixture.productId)).filter(
        (r) => r.movement_type === 'MOVE',
      );
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({
        quantity: 30,
        from_compartment_id: fixture.compartmentA,
        to_compartment_id: fixture.compartmentB,
      });
    });

    it('removes the source placement when a move empties it', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
        ctxOf(),
      );

      await stock.move(
        {
          productId: fixture.productId,
          fromCompartmentId: fixture.compartmentA,
          toCompartmentId: fixture.compartmentB,
          quantity: 5,
        },
        ctxOf(),
      );

      // An empty placement would render as a "0" chip on the product card forever.
      expect(await placementOf(ctx.db, fixture.productId, fixture.compartmentA)).toBeUndefined();
      expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentB))!.quantity).toBe(5);
    });

    it('refuses to move units that are reserved for a pending borrow', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        ctxOf(),
      );
      await stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 8 },
        ctxOf(),
      );

      // Only 2 are free. Moving 5 would pull 3 out from under the pending borrow.
      await expect(
        stock.move(
          {
            productId: fixture.productId,
            fromCompartmentId: fixture.compartmentA,
            toCompartmentId: fixture.compartmentB,
            quantity: 5,
          },
          ctxOf(),
        ),
      ).rejects.toBeInstanceOf(ReservedStockError);

      expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))!.quantity).toBe(10);
    });

    it('allows moving exactly the unreserved remainder', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        ctxOf(),
      );
      await stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 8 },
        ctxOf(),
      );

      await stock.move(
        {
          productId: fixture.productId,
          fromCompartmentId: fixture.compartmentA,
          toCompartmentId: fixture.compartmentB,
          quantity: 2,
        },
        ctxOf(),
      );

      const a = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(a).toMatchObject({ quantity: 8, reserved_qty: 8 });
    });

    it('rejects a move whose expectedVersion is stale (§7.3.2)', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        ctxOf(),
      );
      const rendered = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);

      // Somebody else moves stock after the IM's screen was drawn.
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 1 },
        ctxOf(),
      );

      await expect(
        stock.move(
          {
            productId: fixture.productId,
            fromCompartmentId: fixture.compartmentA,
            toCompartmentId: fixture.compartmentB,
            quantity: 1,
            expectedVersion: rendered!.version,
          },
          ctxOf(),
        ),
      ).rejects.toBeInstanceOf(StockVersionConflictError);
    });

    it('refuses a move into the same compartment', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 3 },
        ctxOf(),
      );

      await expect(
        stock.move(
          {
            productId: fixture.productId,
            fromCompartmentId: fixture.compartmentA,
            toCompartmentId: fixture.compartmentA,
            quantity: 1,
          },
          ctxOf(),
        ),
      ).rejects.toThrow(/same/i);
    });
  });

  describe('availability arithmetic', () => {
    it('reserve reduces available without touching quantity', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        ctxOf(),
      );
      await stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 },
        ctxOf(),
      );

      const row = await placementOf(ctx.db, fixture.productId, fixture.compartmentA);
      expect(row).toMatchObject({ quantity: 10, reserved_qty: 4 });
      expect(row!.quantity - row!.reserved_qty).toBe(6);

      // A reservation is not a physical movement, so it must not appear in the ledger.
      expect(await ledgerRows(ctx.db, fixture.productId)).toHaveLength(1);
    });

    it('issue decrements quantity and the reservation together', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        ctxOf(),
      );
      await stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 },
        ctxOf(),
      );
      await stock.issue(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 },
        ctxOf(),
      );

      expect(await placementOf(ctx.db, fixture.productId, fixture.compartmentA)).toMatchObject({
        quantity: 6,
        reserved_qty: 0,
      });
    });

    it('refuses to issue more than is reserved', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        ctxOf(),
      );
      await stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 2 },
        ctxOf(),
      );

      await expect(
        stock.issue(
          { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 3 },
          ctxOf(),
        ),
      ).rejects.toThrow(/reserved/i);
    });

    it('release frees the reservation without moving stock', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        ctxOf(),
      );
      await stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 },
        ctxOf(),
      );
      await stock.release(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 4 },
        ctxOf(),
      );

      expect(await placementOf(ctx.db, fixture.productId, fixture.compartmentA)).toMatchObject({
        quantity: 10,
        reserved_qty: 0,
      });
    });

    it('a return adds stock back and records it', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
        ctxOf(),
      );
      await stock.reserve(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
        ctxOf(),
      );
      await stock.issue(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 5 },
        ctxOf(),
      );
      await stock.returnStock(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 3 },
        ctxOf(),
      );

      expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))!.quantity).toBe(3);
      const returns = (await ledgerRows(ctx.db, fixture.productId)).filter(
        (r) => r.movement_type === 'RETURN',
      );
      expect(returns).toHaveLength(1);
    });
  });

  describe('guards', () => {
    it('cannot drive stock negative through an adjustment', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 3 },
        ctxOf(),
      );

      await expect(
        stock.adjust(
          {
            productId: fixture.productId,
            compartmentId: fixture.compartmentA,
            delta: -5,
            reason: 'stock take',
          },
          ctxOf(),
        ),
      ).rejects.toBeInstanceOf(InsufficientStockError);

      expect((await placementOf(ctx.db, fixture.productId, fixture.compartmentA))!.quantity).toBe(3);
    });

    it('requires a reason for every adjustment', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 3 },
        ctxOf(),
      );

      await expect(
        stock.adjust(
          {
            productId: fixture.productId,
            compartmentId: fixture.compartmentA,
            delta: -1,
            reason: '   ',
          },
          ctxOf(),
        ),
      ).rejects.toThrow(/reason/i);
    });

    it('refuses stock for a product in an untracked category (requirements §11)', async () => {
      const untracked = await createCategory(ctx.db, { isTrackable: false });
      const product = await createProduct(ctx.db, { categoryId: untracked });

      await expect(
        stock.receive(
          { productId: product, compartmentId: fixture.compartmentA, quantity: 1 },
          ctxOf(),
        ),
      ).rejects.toBeInstanceOf(UntrackedCategoryError);
    });

    it('refuses stock into a deactivated compartment', async () => {
      const zone = await createZone(ctx.db);
      const compartment = await createCompartment(ctx.db, zone);
      await ctx.db
        .updateTable('storage_compartments')
        .set({ is_active: false })
        .where('id', '=', compartment)
        .execute();

      await expect(
        stock.receive(
          { productId: fixture.productId, compartmentId: compartment, quantity: 1 },
          ctxOf(),
        ),
      ).rejects.toThrow(/deactivated/i);
    });

    it('rejects a non-integer or non-positive quantity', async () => {
      for (const quantity of [0, -1, 1.5]) {
        await expect(
          stock.receive(
            { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity },
            ctxOf(),
          ),
        ).rejects.toThrow(/positive whole number/i);
      }
    });
  });

  describe('reconciliation invariant (§7.3.5)', () => {
    it('holds after a scripted sequence of 100 random operations', async () => {
      const compartments = [fixture.compartmentA, fixture.compartmentB];
      let onHand = 0;

      // Seeded so a failure is reproducible rather than a story about a flake.
      let seed = 20260728;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };

      for (let i = 0; i < 100; i += 1) {
        const compartment = compartments[Math.floor(random() * compartments.length)]!;
        const quantity = 1 + Math.floor(random() * 9);
        const roll = random();

        try {
          if (roll < 0.45 || onHand === 0) {
            await stock.receive(
              { productId: fixture.productId, compartmentId: compartment, quantity },
              ctxOf(),
            );
            onHand += quantity;
          } else if (roll < 0.75) {
            const from = compartments[Math.floor(random() * compartments.length)]!;
            const to = from === compartments[0] ? compartments[1]! : compartments[0]!;
            await stock.move(
              {
                productId: fixture.productId,
                fromCompartmentId: from,
                toCompartmentId: to,
                quantity,
              },
              ctxOf(),
            );
          } else {
            await stock.adjust(
              {
                productId: fixture.productId,
                compartmentId: compartment,
                delta: -quantity,
                reason: 'scripted stock take',
              },
              ctxOf(),
            );
            onHand -= quantity;
          }
        } catch {
          // Rejections are expected — the point is that a refused operation leaves no trace.
        }
      }

      const mismatches = await stock.findReconciliationMismatches();
      expect(mismatches).toEqual([]);
    });

    it('detects a discrepancy when placements are tampered with directly', async () => {
      await stock.receive(
        { productId: fixture.productId, compartmentId: fixture.compartmentA, quantity: 10 },
        ctxOf(),
      );

      // Simulates the exact failure the nightly job exists to catch: something wrote a
      // placement without a matching ledger row. If this test cannot detect it, the job is
      // decorative.
      await ctx.db
        .updateTable('stock_placements')
        .set({ quantity: 999 })
        .where('product_id', '=', fixture.productId)
        .where('compartment_id', '=', fixture.compartmentA)
        .execute();

      const mismatches = await stock.findReconciliationMismatches();
      expect(mismatches).toContainEqual(
        expect.objectContaining({
          product_id: fixture.productId,
          compartment_id: fixture.compartmentA,
          ledger_qty: 10,
          placement_qty: 999,
        }),
      );

      // Put it back so the suite-wide invariant in the concurrency spec still holds.
      await ctx.db
        .updateTable('stock_placements')
        .set({ quantity: 10 })
        .where('product_id', '=', fixture.productId)
        .where('compartment_id', '=', fixture.compartmentA)
        .execute();
    });
  });
});
