import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import {
  StockMovementType,
  type Database,
  type StockLedgerTable,
  type StockPlacementsTable,
} from '../../database/schema';
import type { Selectable, Transaction } from 'kysely';
import { ConflictError, NotFoundError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import {
  InsufficientStockError,
  ReservedStockError,
  StockVersionConflictError,
  UntrackedCategoryError,
} from './stock.errors';

type Tx = Transaction<Database>;
export type PlacementRow = Selectable<StockPlacementsTable>;
export type LedgerRow = Selectable<StockLedgerTable>;

/** Who did it and why — every stock write carries provenance into the ledger. */
export interface StockContext {
  performedBy: string;
  refType?: string;
  refId?: string;
  note?: string;
}

export interface ReceiveInput {
  productId: string;
  compartmentId: string;
  quantity: number;
}

export interface MoveInput {
  productId: string;
  fromCompartmentId: string;
  toCompartmentId: string;
  quantity: number;
  /** Optimistic lock from the screen the IM was looking at (§7.3.2). */
  expectedVersion?: number;
}

export interface ReserveInput {
  productId: string;
  compartmentId: string;
  quantity: number;
}

export interface AdjustInput {
  productId: string;
  compartmentId: string;
  /** Signed: the delta to apply. Zero is rejected — it would be a ledger row saying nothing. */
  delta: number;
  reason: string;
}

/**
 * THE ONLY MODULE PERMITTED TO WRITE `stock_placements` OR `stock_ledger`.
 *
 * Borrowing, requisitions and BOM all call in here (rules/40-database.md, ADR-0001). Every
 * operation follows the same shape, and the order matters:
 *
 *   1. open one transaction
 *   2. `SELECT ... FOR UPDATE` the affected placements, **ordered by id ascending**
 *   3. re-read quantities from the locked rows — never trust a value read earlier in the request
 *   4. apply the change
 *   5. append exactly one `stock_ledger` row
 *   6. commit
 *
 * Step 2's ordering is not stylistic: two concurrent moves touching the same pair of
 * compartments in opposite directions will deadlock without it.
 *
 * `available = quantity - reserved_qty`. Borrow requests reserve; issuing decrements both;
 * returns increment quantity. A consumable is issued and never returns.
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * New stock arriving: a purchase received, or opening balance.
   *
   * `existingTx` lets a caller join its own transaction so the receipt and whatever the caller is
   * doing alongside it commit together — receiving a purchase into stock and marking the
   * requisition STOCKED, for instance. Without it those are two transactions with a window
   * between them, which is the shape of the still-open G-14 bug: a crash in the gap leaves stock
   * moved and the status not, and reconciliation cannot see it.
   *
   * `StockService` is still the only writer (ADR-0001). Callers hand in a transaction; they never
   * touch `stock_placements` or `stock_ledger` themselves.
   */
  async receive(
    input: ReceiveInput,
    context: StockContext,
    auditContext?: AuditContext,
    existingTx?: Tx,
  ): Promise<PlacementRow> {
    this.assertPositive(input.quantity);

    const run = async (tx: Tx): Promise<PlacementRow> => {
      await this.assertProductIsTrackable(tx, input.productId);
      await this.assertCompartmentUsable(tx, input.compartmentId);

      const placement = await this.lockOrCreatePlacement(
        tx,
        input.productId,
        input.compartmentId,
      );
      const updated = await this.applyDelta(tx, placement.id, input.quantity, 0);

      const ledgerId = await this.appendLedger(tx, {
        product_id: input.productId,
        to_compartment_id: input.compartmentId,
        from_compartment_id: null,
        quantity: input.quantity,
        movement_type: StockMovementType.RECEIPT,
        ...this.provenance(context),
      });

      // Audit joins the same transaction as the ledger insert: a successful receive always
      // has both rows and a failed receive has neither. The product code is the human
      // reference so the admin feed can be read without joining back to the products table.
      // When called from the borrow lifecycle (no audit context) the borrowing service records
      // its own `borrowing.*` row; writing one here too would be a duplicate.
      if (auditContext) {
        const productRef = await this.lookupProductRef(tx, input.productId);
        await this.audit.record(
          {
            action: 'stock.receive',
            entityType: 'stock',
            entityId: ledgerId,
            entityRef: productRef,
            summary: `Received ${input.quantity} of ${productRef}`,
            metadata: {
              product_id: input.productId,
              compartment_id: input.compartmentId,
              quantity: input.quantity,
              ...(context.note ? { note: context.note } : {}),
            },
          },
          auditContext,
          tx,
        );
      }

      return updated;
    };

    return existingTx ? run(existingTx) : this.db.transaction().execute(run);
  }

  /**
   * Moves N of M between compartments. The source row is deleted when it reaches zero so the
   * product card does not accumulate empty chips, and reserved units cannot be moved out from
   * under a pending borrow.
   */
  async move(
    input: MoveInput,
    context: StockContext,
    auditContext?: AuditContext,
  ): Promise<{ from: PlacementRow | null; to: PlacementRow }> {
    this.assertPositive(input.quantity);
    if (input.fromCompartmentId === input.toCompartmentId) {
      throw new ConflictError('Source and destination compartments are the same');
    }

    return this.db.transaction().execute(async (tx) => {
      await this.assertCompartmentUsable(tx, input.toCompartmentId);

      // Both rows are locked together in ascending id order. Locking source-then-destination
      // instead deadlocks the moment someone moves A->B while someone else moves B->A, which
      // is not hypothetical — the concurrency spec reproduces it every run.
      const locked = await this.lockPlacementsInOrder(tx, input.productId, [
        input.fromCompartmentId,
        input.toCompartmentId,
      ]);

      const source = locked.get(input.fromCompartmentId);
      if (!source || source.quantity === 0) throw new NotFoundError('Stock in that compartment');

      if (input.expectedVersion !== undefined && source.version !== input.expectedVersion) {
        throw new StockVersionConflictError();
      }

      // Reserved units are spoken for by a pending borrow; only the free ones may leave.
      const available = source.quantity - source.reserved_qty;
      if (input.quantity > available) {
        if (source.reserved_qty > 0 && input.quantity <= source.quantity) {
          throw new ReservedStockError(source.reserved_qty, input.quantity);
        }
        throw new InsufficientStockError(available, input.quantity);
      }

      const destination = locked.get(input.toCompartmentId);
      if (!destination) throw new ConflictError('Could not lock the destination; please retry');

      const remaining = source.quantity - input.quantity;
      let from: PlacementRow | null = null;

      if (remaining === 0 && source.reserved_qty === 0) {
        await tx.deleteFrom('stock_placements').where('id', '=', source.id).execute();
      } else {
        from = await this.applyDelta(tx, source.id, -input.quantity, 0);
      }

      const to = await this.applyDelta(tx, destination.id, input.quantity, 0);

      const ledgerId = await this.appendLedger(tx, {
        product_id: input.productId,
        from_compartment_id: input.fromCompartmentId,
        to_compartment_id: input.toCompartmentId,
        quantity: input.quantity,
        movement_type: StockMovementType.MOVE,
        ...this.provenance(context),
      });

      // One audit row per move, joined to the same transaction as the ledger insert. Skipped
      // when called from a borrow-driven path: the borrowing service records its own
      // `borrowing.*` row for that flow.
      if (auditContext) {
        const productRef = await this.lookupProductRef(tx, input.productId);
        await this.audit.record(
          {
            action: 'stock.move',
            entityType: 'stock',
            entityId: ledgerId,
            entityRef: productRef,
            summary: `Moved ${input.quantity} of ${productRef}`,
            metadata: {
              product_id: input.productId,
              from_compartment_id: input.fromCompartmentId,
              to_compartment_id: input.toCompartmentId,
              quantity: input.quantity,
              ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
              ...(context.note ? { note: context.note } : {}),
            },
          },
          auditContext,
          tx,
        );
      }

      return { from, to };
    });
  }

  /**
   * Units coming back onto the shelf that must stay held for the same borrow — the undo of an
   * issue, used when an IM reverts an issued borrow to pending.
   *
   * This exists because doing it as `receive()` then `reserve()` is two transactions with a gap
   * between them. In that gap the units are free: another user's borrow can reserve them, the
   * `reserve()` half then fails with InsufficientStock, and the `receive()` half is already
   * committed. The borrow stays ISSUED while the ledger says the units are back on the shelf —
   * permanent phantom stock that reconciliation cannot see, because SUM(ledger) and quantity
   * still agree.
   *
   * One transaction, one lock, one RECEIPT ledger row (the reservation is a column, not a
   * movement — see `reserve`), so it either all happens or none of it does.
   */
  async receiveAndHold(
    input: ReceiveInput,
    context: StockContext,
    existingTx?: Tx,
  ): Promise<PlacementRow> {
    this.assertPositive(input.quantity);

    const run = async (tx: Tx): Promise<PlacementRow> => {
      await this.assertProductIsTrackable(tx, input.productId);
      await this.assertCompartmentUsable(tx, input.compartmentId);

      const placement = await this.lockOrCreatePlacement(tx, input.productId, input.compartmentId);
      // quantity and reserved_qty move together by the same amount, so availability is
      // unchanged throughout and no other borrower can ever see these units as free.
      const updated = await this.applyDelta(tx, placement.id, input.quantity, input.quantity);

      await this.appendLedger(tx, {
        product_id: input.productId,
        to_compartment_id: input.compartmentId,
        from_compartment_id: null,
        quantity: input.quantity,
        movement_type: StockMovementType.RECEIPT,
        ...this.provenance(context),
      });

      return updated;
    };

    return existingTx ? run(existingTx) : this.db.transaction().execute(run);
  }

  /**
   * Holds stock for a pending borrow without moving it. Writes no ledger row on purpose: a
   * reservation changes availability, not the physical shelf, and the ledger records physical
   * reality. Reconciliation would break if reservations appeared there.
   */
  async reserve(input: ReserveInput, _context: StockContext): Promise<PlacementRow> {
    this.assertPositive(input.quantity);

    return this.db.transaction().execute(async (tx) => {
      const placement = await this.lockPlacement(tx, input.productId, input.compartmentId);
      if (!placement) throw new NotFoundError('Stock in that compartment');

      const available = placement.quantity - placement.reserved_qty;
      if (input.quantity > available) {
        throw new InsufficientStockError(available, input.quantity);
      }

      return this.applyDelta(tx, placement.id, 0, input.quantity);
    });
  }

  /** Releases a reservation — the borrow was rejected or cancelled. */
  async release(input: ReserveInput, _context: StockContext): Promise<PlacementRow> {
    this.assertPositive(input.quantity);

    return this.db.transaction().execute(async (tx) => {
      const placement = await this.lockPlacement(tx, input.productId, input.compartmentId);
      if (!placement) throw new NotFoundError('Stock in that compartment');

      if (input.quantity > placement.reserved_qty) {
        throw new ConflictError(
          `Cannot release ${input.quantity} units; only ${placement.reserved_qty} are reserved`,
        );
      }

      return this.applyDelta(tx, placement.id, 0, -input.quantity);
    });
  }

  /**
   * The stock physically leaves. Decrements quantity and the reservation together, because an
   * issue always follows a reservation — releasing first and issuing second would briefly
   * expose the units to another borrower.
   */
  async issue(
    input: ReserveInput,
    context: StockContext,
    /** See `receive` — lets a caller make the issue atomic with whatever it is doing alongside. */
    existingTx?: Tx,
  ): Promise<PlacementRow | null> {
    this.assertPositive(input.quantity);

    const run = async (tx: Tx): Promise<PlacementRow | null> => {
      const placement = await this.lockPlacement(tx, input.productId, input.compartmentId);
      if (!placement) throw new NotFoundError('Stock in that compartment');

      if (input.quantity > placement.reserved_qty) {
        throw new ConflictError(
          `Cannot issue ${input.quantity} units; only ${placement.reserved_qty} are reserved`,
        );
      }

      await this.appendLedger(tx, {
        product_id: input.productId,
        from_compartment_id: input.compartmentId,
        to_compartment_id: null,
        quantity: input.quantity,
        movement_type: StockMovementType.ISSUE,
        ...this.provenance(context),
      });

      const remaining = placement.quantity - input.quantity;
      const remainingReserved = placement.reserved_qty - input.quantity;

      if (remaining === 0 && remainingReserved === 0) {
        await tx.deleteFrom('stock_placements').where('id', '=', placement.id).execute();
        return null;
      }

      return this.applyDelta(tx, placement.id, -input.quantity, -input.quantity);
    };

    return existingTx ? run(existingTx) : this.db.transaction().execute(run);
  }

  /** A borrowed item comes back. Increments quantity only — the reservation ended at issue. */
  async returnStock(input: ReserveInput, context: StockContext): Promise<PlacementRow> {
    this.assertPositive(input.quantity);

    return this.db.transaction().execute(async (tx) => {
      await this.assertCompartmentUsable(tx, input.compartmentId);

      const placement = await this.lockOrCreatePlacement(
        tx,
        input.productId,
        input.compartmentId,
      );
      const updated = await this.applyDelta(tx, placement.id, input.quantity, 0);

      await this.appendLedger(tx, {
        product_id: input.productId,
        from_compartment_id: null,
        to_compartment_id: input.compartmentId,
        quantity: input.quantity,
        movement_type: StockMovementType.RETURN,
        ...this.provenance(context),
      });

      return updated;
    });
  }

  /**
   * A stock take correction. Requires a reason: an unexplained adjustment is indistinguishable
   * from theft when someone reads the ledger back in six months.
   */
  async adjust(
    input: AdjustInput,
    context: StockContext,
    auditContext?: AuditContext,
  ): Promise<PlacementRow | null> {
    if (input.delta === 0) throw new ConflictError('An adjustment of zero changes nothing');
    if (!input.reason.trim()) throw new ConflictError('An adjustment requires a reason');

    return this.db.transaction().execute(async (tx) => {
      await this.assertProductIsTrackable(tx, input.productId);

      const placement =
        input.delta > 0
          ? await this.lockOrCreatePlacement(tx, input.productId, input.compartmentId)
          : await this.lockPlacement(tx, input.productId, input.compartmentId);

      if (!placement) throw new NotFoundError('Stock in that compartment');

      if (input.delta < 0) {
        const available = placement.quantity - placement.reserved_qty;
        if (Math.abs(input.delta) > available) {
          throw new InsufficientStockError(available, Math.abs(input.delta));
        }
      }

      const ledgerId = await this.appendLedger(tx, {
        product_id: input.productId,
        from_compartment_id: input.delta < 0 ? input.compartmentId : null,
        to_compartment_id: input.delta > 0 ? input.compartmentId : null,
        quantity: Math.abs(input.delta),
        movement_type: StockMovementType.ADJUST,
        ...this.provenance({ ...context, note: input.reason }),
      });

      // The reason is the entire point of the audit row — without it, a "stock.adjust" entry
      // is indistinguishable from the next one's. Join the same transaction so an adjust with
      // no reason never makes it to disk.
      if (auditContext) {
        const productRef = await this.lookupProductRef(tx, input.productId);
        await this.audit.record(
          {
            action: 'stock.adjust',
            entityType: 'stock',
            entityId: ledgerId,
            entityRef: productRef,
            summary: `Adjusted ${productRef} by ${input.delta}`,
            metadata: {
              product_id: input.productId,
              compartment_id: input.compartmentId,
              delta: input.delta,
              reason: input.reason,
            },
          },
          auditContext,
          tx,
        );
      }

      const remaining = placement.quantity + input.delta;
      if (remaining === 0 && placement.reserved_qty === 0) {
        await tx.deleteFrom('stock_placements').where('id', '=', placement.id).execute();
        return null;
      }

      return this.applyDelta(tx, placement.id, input.delta, 0);
    });
  }

  /* ------------------------------------------------------------------ reads */

  async placementsForProduct(productId: string) {
    return this.db
      .selectFrom('stock_placements')
      .innerJoin(
        'storage_compartments',
        'storage_compartments.id',
        'stock_placements.compartment_id',
      )
      .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
      .where('stock_placements.product_id', '=', productId)
      .select([
        'stock_placements.id',
        'stock_placements.compartment_id',
        'stock_placements.quantity',
        'stock_placements.reserved_qty',
        'stock_placements.version',
        'storage_compartments.code as compartment_code',
        'storage_zones.id as zone_id',
        'storage_zones.name as zone_name',
      ])
      .orderBy('storage_zones.name')
      .orderBy('storage_compartments.code')
      .execute();
  }

  /**
   * The nightly invariant (§7.3.5). Per (product, compartment) rather than per product: a
   * per-product check would pass while two compartments were individually wrong in opposite
   * directions, which is exactly the state a bad MOVE leaves behind.
   */
  async findReconciliationMismatches(): Promise<
    Array<{ product_id: string; compartment_id: string; ledger_qty: number; placement_qty: number }>
  > {
    const result = await sql<{
      product_id: string;
      compartment_id: string;
      ledger_qty: number;
      placement_qty: number;
    }>`
      WITH ledger_totals AS (
        SELECT product_id, compartment_id, SUM(delta)::int AS ledger_qty
        FROM (
          SELECT product_id, to_compartment_id   AS compartment_id,  quantity AS delta
            FROM stock_ledger WHERE to_compartment_id IS NOT NULL
          UNION ALL
          SELECT product_id, from_compartment_id AS compartment_id, -quantity AS delta
            FROM stock_ledger WHERE from_compartment_id IS NOT NULL
        ) movements
        GROUP BY product_id, compartment_id
      ),
      placement_totals AS (
        SELECT product_id, compartment_id, quantity AS placement_qty FROM stock_placements
      )
      SELECT
        COALESCE(l.product_id, p.product_id)         AS product_id,
        COALESCE(l.compartment_id, p.compartment_id) AS compartment_id,
        COALESCE(l.ledger_qty, 0)                    AS ledger_qty,
        COALESCE(p.placement_qty, 0)                 AS placement_qty
      FROM ledger_totals l
      FULL OUTER JOIN placement_totals p
        ON l.product_id = p.product_id AND l.compartment_id = p.compartment_id
      WHERE COALESCE(l.ledger_qty, 0) <> COALESCE(p.placement_qty, 0)
    `.execute(this.db);

    return result.rows;
  }

  /* --------------------------------------------------------------- internals */

  private assertPositive(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ConflictError('Quantity must be a positive whole number');
    }
  }

  /**
   * `SELECT ... FOR UPDATE` on the placement. The second concurrent caller blocks here and then
   * re-reads the true quantity, which is the whole reason oversell cannot happen.
   */
  private async lockPlacement(
    tx: Tx,
    productId: string,
    compartmentId: string,
  ): Promise<PlacementRow | undefined> {
    return tx
      .selectFrom('stock_placements')
      .selectAll()
      .where('product_id', '=', productId)
      .where('compartment_id', '=', compartmentId)
      // Consistent order for multi-row locks elsewhere; harmless for a single row.
      .orderBy('id')
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * Locks several placements of one product in a deadlock-free order.
   *
   * The rule from rules/40-database.md: always acquire placement locks by id ascending. Two
   * concurrent moves in opposite directions between the same pair of compartments will
   * otherwise take the two locks in opposite orders and deadlock — Postgres kills one of them
   * with "deadlock detected" and the user sees a 500 for no reason they can act on.
   *
   * Rows are created first (unlocked, ON CONFLICT DO NOTHING) so that every id exists before
   * any lock is taken; then each is locked in its own statement, in sorted order. A single
   * `ORDER BY id ... FOR UPDATE` is not sufficient — the planner is free to lock in scan order
   * before the sort is applied.
   */
  private async lockPlacementsInOrder(
    tx: Tx,
    productId: string,
    compartmentIds: readonly string[],
  ): Promise<Map<string, PlacementRow>> {
    // Sorted, because the insert loop below locks too. `ON CONFLICT DO NOTHING` against a row
    // another transaction has already touched waits on that transaction, so iterating in
    // caller-supplied order reintroduces exactly the cycle the sorted FOR UPDATE phase exists
    // to prevent: `move` passes [from, to], and two opposite moves A→B and B→A would take the
    // same two keys in opposite orders and deadlock.
    const unique = [...new Set(compartmentIds)].sort();

    for (const compartmentId of unique) {
      await tx
        .insertInto('stock_placements')
        .values({ product_id: productId, compartment_id: compartmentId, quantity: 0 })
        .onConflict((oc) => oc.columns(['product_id', 'compartment_id']).doNothing())
        .execute();
    }

    const ids = await tx
      .selectFrom('stock_placements')
      .select(['id'])
      .where('product_id', '=', productId)
      .where('compartment_id', 'in', unique)
      .orderBy('id')
      .execute();

    const locked = new Map<string, PlacementRow>();
    for (const { id } of ids) {
      const row = await tx
        .selectFrom('stock_placements')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (row) locked.set(row.compartment_id, row);
    }
    return locked;
  }

  /**
   * Locks the placement, creating it at zero if absent.
   *
   * Two concurrent receives into a brand-new compartment both find nothing and both insert;
   * the UNIQUE (product_id, compartment_id) index makes one of them fail, and that loser
   * re-reads the winner's row rather than surfacing a constraint error to the user.
   */
  private async lockOrCreatePlacement(
    tx: Tx,
    productId: string,
    compartmentId: string,
  ): Promise<PlacementRow> {
    const existing = await this.lockPlacement(tx, productId, compartmentId);
    if (existing) return existing;

    const inserted = await tx
      .insertInto('stock_placements')
      .values({ product_id: productId, compartment_id: compartmentId, quantity: 0 })
      .onConflict((oc) => oc.columns(['product_id', 'compartment_id']).doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) return inserted;

    const raced = await this.lockPlacement(tx, productId, compartmentId);
    if (!raced) throw new ConflictError('Could not lock the placement; please retry');
    return raced;
  }

  /**
   * The single UPDATE. `version` increments on every write so the IM's screen can detect that
   * the numbers moved underneath it. The database CHECK constraints are the real guarantee —
   * if a delta would drive quantity negative, this statement fails rather than writing.
   */
  private async applyDelta(
    tx: Tx,
    placementId: string,
    quantityDelta: number,
    reservedDelta: number,
  ): Promise<PlacementRow> {
    return tx
      .updateTable('stock_placements')
      .set((eb) => ({
        quantity: eb('quantity', '+', quantityDelta),
        reserved_qty: eb('reserved_qty', '+', reservedDelta),
        version: eb('version', '+', 1),
      }))
      .where('id', '=', placementId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async appendLedger(
    tx: Tx,
    row: {
      product_id: string;
      from_compartment_id: string | null;
      to_compartment_id: string | null;
      quantity: number;
      movement_type: StockMovementType;
      ref_type: string | null;
      ref_id: string | null;
      performed_by: string;
      note: string | null;
    },
  ): Promise<string> {
    // Returning the ledger id so the audit row can reference it as `entityId` — the admin
    // detail drawer looks the ledger row up to show the full movement context.
    const inserted = await tx
      .insertInto('stock_ledger')
      .values(row)
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  }

  /**
   * The product's human reference: the on-shelf product_code and, in parentheses, the name so
   * the audit row reads naturally without a join. Falls back to the bare id when the product
   * has been deleted — the audit row must remain readable even after the row is gone.
   */
  private async lookupProductRef(tx: Tx, productId: string): Promise<string> {
    const row = await tx
      .selectFrom('products')
      .select(['product_code', 'name'])
      .where('id', '=', productId)
      .executeTakeFirst();
    return row ? `${row.product_code} (${row.name})` : productId;
  }

  private provenance(context: StockContext) {
    return {
      ref_type: context.refType ?? null,
      ref_id: context.refId ?? null,
      performed_by: context.performedBy,
      note: context.note ?? null,
    };
  }

  /** requirements §11 — an untracked category's products exist but hold no stock. */
  private async assertProductIsTrackable(tx: Tx, productId: string): Promise<void> {
    const row = await tx
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .where('products.id', '=', productId)
      .select(['products.is_active', 'categories.is_trackable', 'categories.name as category_name'])
      .executeTakeFirst();

    if (!row) throw new NotFoundError('Product');
    if (!row.is_active) throw new ConflictError('That product has been deactivated');
    if (!row.is_trackable) throw new UntrackedCategoryError(row.category_name);
  }

  private async assertCompartmentUsable(tx: Tx, compartmentId: string): Promise<void> {
    const row = await tx
      .selectFrom('storage_compartments')
      .where('id', '=', compartmentId)
      .select(['is_active'])
      .executeTakeFirst();

    if (!row) throw new NotFoundError('Compartment');
    if (!row.is_active) throw new ConflictError('That compartment has been deactivated');
  }
}
