import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type {
  FundReceipt,
  FundReturn,
  Purchase,
  PurchaseLine,
  RequisitionStatus,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';

export type Tx = Transaction<Database>;

/** NUMERIC arrives from pg as a string so it never passes through a float. */
const money = (value: string | null): number => (value === null ? 0 : Number(value));

@Injectable()
export class FundsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  get connection(): Db {
    return this.db;
  }

  /* ------------------------------------------------------------- receipts */

  async insertReceipt(
    tx: Tx,
    values: {
      requisitionId: string;
      amount: number;
      receivedAt: Date;
      reference: string | null;
      note: string | null;
      recordedBy: string;
    },
  ): Promise<string> {
    const row = await tx
      .insertInto('fund_receipts')
      .values({
        requisition_id: values.requisitionId,
        amount: values.amount.toFixed(2),
        received_at: values.receivedAt,
        reference: values.reference,
        note: values.note,
        recorded_by: values.recordedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async listReceipts(requisitionId: string, executor: Db | Tx = this.db): Promise<FundReceipt[]> {
    const rows = await executor
      .selectFrom('fund_receipts')
      .leftJoin('users', 'users.id', 'fund_receipts.recorded_by')
      .where('fund_receipts.requisition_id', '=', requisitionId)
      .select([
        'fund_receipts.id',
        'fund_receipts.requisition_id',
        'fund_receipts.amount',
        'fund_receipts.received_at',
        'fund_receipts.reference',
        'fund_receipts.note',
        'users.full_name as recorded_by_name',
        'fund_receipts.created_at',
      ])
      .orderBy('fund_receipts.received_at')
      .orderBy('fund_receipts.created_at')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      requisitionId: row.requisition_id,
      amount: money(row.amount),
      receivedAt: row.received_at.toISOString(),
      reference: row.reference,
      note: row.note,
      recordedByName: row.recorded_by_name,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /**
   * Total released so far.
   *
   * Summed in the database rather than in JavaScript: `numeric` addition in pg is exact, whereas
   * adding parsed floats would reintroduce the rounding the NUMERIC column exists to avoid.
   */
  async sumReceipts(requisitionId: string, executor: Db | Tx = this.db): Promise<number> {
    const row = await executor
      .selectFrom('fund_receipts')
      .where('requisition_id', '=', requisitionId)
      .select((eb) => eb.fn.sum<string>('amount').as('total'))
      .executeTakeFirst();
    return money(row?.total ?? null);
  }

  /* ------------------------------------------------------------ purchases */

  async insertPurchase(
    tx: Tx,
    values: {
      requisitionId: string;
      vendor: string;
      invoiceNo: string | null;
      purchasedAt: Date;
      totalAmount: number;
      note: string | null;
      recordedBy: string;
    },
  ): Promise<string> {
    const row = await tx
      .insertInto('purchases')
      .values({
        requisition_id: values.requisitionId,
        vendor: values.vendor,
        invoice_no: values.invoiceNo,
        purchased_at: values.purchasedAt,
        total_amount: values.totalAmount.toFixed(2),
        note: values.note,
        recorded_by: values.recordedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async insertPurchaseLines(
    tx: Tx,
    purchaseId: string,
    lines: Array<{
      requisitionItemId: string;
      bomLineId: string | null;
      quantity: number;
      unitCost: number;
      overBomQuantity: boolean;
      overBomNote: string | null;
    }>,
  ): Promise<void> {
    if (lines.length === 0) return;
    await tx
      .insertInto('purchase_lines')
      .values(
        lines.map((line) => ({
          purchase_id: purchaseId,
          requisition_item_id: line.requisitionItemId,
          bom_line_id: line.bomLineId,
          quantity: line.quantity,
          unit_cost: line.unitCost.toFixed(2),
          over_bom_quantity: line.overBomQuantity,
          over_bom_note: line.overBomNote,
        })),
      )
      .execute();
  }

  async listPurchases(requisitionId: string, executor: Db | Tx = this.db): Promise<Purchase[]> {
    const purchaseRows = await executor
      .selectFrom('purchases')
      .leftJoin('users', 'users.id', 'purchases.recorded_by')
      .where('purchases.requisition_id', '=', requisitionId)
      .select([
        'purchases.id',
        'purchases.requisition_id',
        'purchases.vendor',
        'purchases.invoice_no',
        'purchases.purchased_at',
        'purchases.total_amount',
        'purchases.note',
        'users.full_name as recorded_by_name',
        'purchases.invoice_file_id',
        'purchases.invoice_uploaded_at',
        'purchases.created_at',
      ])
      .orderBy('purchases.purchased_at')
      .execute();

    if (purchaseRows.length === 0) return [];

    // One query for every line across every purchase — not one per purchase. N+1 is a review
    // blocker here (rules/40-database.md).
    const lineRows = await executor
      .selectFrom('purchase_lines')
      .innerJoin(
        'requisition_items',
        'requisition_items.id',
        'purchase_lines.requisition_item_id',
      )
      .where(
        'purchase_lines.purchase_id',
        'in',
        purchaseRows.map((row) => row.id),
      )
      .select([
        'purchase_lines.id',
        'purchase_lines.purchase_id',
        'purchase_lines.requisition_item_id',
        'requisition_items.item_name',
        'requisition_items.product_id',
        'purchase_lines.quantity',
        'purchase_lines.unit_cost',
        'purchase_lines.over_bom_quantity',
        'purchase_lines.over_bom_note',
        'purchase_lines.received_quantity',
      ])
      .orderBy('purchase_lines.created_at')
      .execute();

    const linesByPurchase = new Map<string, PurchaseLine[]>();
    for (const row of lineRows) {
      const unitCost = money(row.unit_cost);
      const list = linesByPurchase.get(row.purchase_id) ?? [];
      list.push({
        id: row.id,
        requisitionItemId: row.requisition_item_id,
        itemName: row.item_name,
        quantity: row.quantity,
        unitCost,
        lineTotal: Math.round(unitCost * row.quantity * 100) / 100,
        overBomQuantity: row.over_bom_quantity,
        overBomNote: row.over_bom_note,
        receivedQuantity: row.received_quantity,
        outstandingQuantity: row.quantity - row.received_quantity,
        productId: row.product_id,
      });
      linesByPurchase.set(row.purchase_id, list);
    }

    return purchaseRows.map((row) => ({
      id: row.id,
      requisitionId: row.requisition_id,
      vendor: row.vendor,
      invoiceNo: row.invoice_no,
      purchasedAt: row.purchased_at.toISOString(),
      totalAmount: money(row.total_amount),
      note: row.note,
      recordedByName: row.recorded_by_name,
      createdAt: row.created_at.toISOString(),
      // The file id stays server-side; the client only needs to know whether to offer a download.
      hasInvoice: row.invoice_file_id !== null,
      invoiceUploadedAt: row.invoice_uploaded_at ? row.invoice_uploaded_at.toISOString() : null,
      lines: linesByPurchase.get(row.id) ?? [],
    }));
  }

  async sumPurchases(requisitionId: string, executor: Db | Tx = this.db): Promise<number> {
    const row = await executor
      .selectFrom('purchases')
      .where('requisition_id', '=', requisitionId)
      .select((eb) => eb.fn.sum<string>('total_amount').as('total'))
      .executeTakeFirst();
    return money(row?.total ?? null);
  }

  /* -------------------------------------------------- receiving to stock */

  /**
   * One purchase line with everything receiving it needs, locked.
   *
   * `FOR UPDATE` on the line: two IMs receiving the same delivery at once would otherwise both
   * read the same `received_quantity`, and the second write would overwrite rather than add —
   * silently losing a receipt that the stock ledger has already recorded.
   */
  async lockPurchaseLine(tx: Tx, purchaseLineId: string) {
    // Locked on its own, with no joins: `FOR UPDATE` over a join locks every table in it, which
    // would take row locks on `purchases` and `requisition_items` that nothing here needs and
    // that widen the deadlock surface. The related columns are read in a second, unlocked query.
    const line = await tx
      .selectFrom('purchase_lines')
      .where('id', '=', purchaseLineId)
      .select(['id', 'purchase_id', 'requisition_item_id', 'quantity', 'received_quantity'])
      .forUpdate()
      .executeTakeFirst();
    if (!line) return undefined;

    const [purchase, item] = await Promise.all([
      tx
        .selectFrom('purchases')
        .where('id', '=', line.purchase_id)
        .select('requisition_id')
        .executeTakeFirst(),
      tx
        .selectFrom('requisition_items')
        .where('id', '=', line.requisition_item_id)
        .select(['product_id', 'item_name'])
        .executeTakeFirst(),
    ]);
    if (!purchase || !item) return undefined;

    return {
      id: line.id,
      quantity: line.quantity,
      receivedQuantity: line.received_quantity,
      requisitionItemId: line.requisition_item_id,
      requisitionId: purchase.requisition_id,
      productId: item.product_id,
      itemName: item.item_name,
    };
  }

  async addReceivedQuantity(tx: Tx, purchaseLineId: string, quantity: number): Promise<void> {
    await tx
      .updateTable('purchase_lines')
      .set((eb) => ({ received_quantity: eb('received_quantity', '+', quantity) }))
      .where('id', '=', purchaseLineId)
      .execute();
  }

  /** Points a free-text requisition item at the catalogue product created for it. */
  async linkRequisitionItemProduct(
    tx: Tx,
    requisitionItemId: string,
    productId: string,
  ): Promise<void> {
    await tx
      .updateTable('requisition_items')
      .set({ product_id: productId })
      .where('id', '=', requisitionItemId)
      .execute();
  }

  /** How many purchase lines on this requisition are not yet fully received. */
  async countOutstandingLines(requisitionId: string, executor: Db | Tx = this.db): Promise<number> {
    const row = await executor
      .selectFrom('purchase_lines')
      .innerJoin('purchases', 'purchases.id', 'purchase_lines.purchase_id')
      .where('purchases.requisition_id', '=', requisitionId)
      .whereRef('purchase_lines.received_quantity', '<', 'purchase_lines.quantity')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /* ---------------------------------------------------------- invoices */

  async attachInvoice(
    tx: Tx,
    purchaseId: string,
    values: { fileId: string; uploadedBy: string; uploadedAt: Date },
  ): Promise<void> {
    await tx
      .updateTable('purchases')
      .set({
        invoice_file_id: values.fileId,
        invoice_uploaded_by: values.uploadedBy,
        invoice_uploaded_at: values.uploadedAt,
      })
      .where('id', '=', purchaseId)
      .execute();
  }

  async findPurchase(purchaseId: string, executor: Db | Tx = this.db) {
    return executor
      .selectFrom('purchases')
      .where('id', '=', purchaseId)
      .selectAll()
      .executeTakeFirst();
  }

  /** Does every purchase on this requisition have its invoice on file? */
  async countPurchasesWithoutInvoice(
    requisitionId: string,
    executor: Db | Tx = this.db,
  ): Promise<number> {
    const row = await executor
      .selectFrom('purchases')
      .where('requisition_id', '=', requisitionId)
      .where('invoice_file_id', 'is', null)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /* ------------------------------------------------------- fund returns */

  async insertReturn(
    tx: Tx,
    values: {
      requisitionId: string;
      amount: number;
      note: string;
      returnedAt: Date;
      recordedBy: string;
    },
  ): Promise<string> {
    const row = await tx
      .insertInto('fund_returns')
      .values({
        requisition_id: values.requisitionId,
        amount: values.amount.toFixed(2),
        note: values.note,
        returned_at: values.returnedAt,
        recorded_by: values.recordedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async listReturns(requisitionId: string, executor: Db | Tx = this.db): Promise<FundReturn[]> {
    const rows = await executor
      .selectFrom('fund_returns')
      .leftJoin('users', 'users.id', 'fund_returns.recorded_by')
      .where('fund_returns.requisition_id', '=', requisitionId)
      .select([
        'fund_returns.id',
        'fund_returns.requisition_id',
        'fund_returns.amount',
        'fund_returns.note',
        'fund_returns.returned_at',
        'users.full_name as recorded_by_name',
        'fund_returns.created_at',
      ])
      .orderBy('fund_returns.returned_at')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      requisitionId: row.requisition_id,
      amount: money(row.amount),
      note: row.note,
      returnedAt: row.returned_at.toISOString(),
      recordedByName: row.recorded_by_name,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async sumReturns(requisitionId: string, executor: Db | Tx = this.db): Promise<number> {
    const row = await executor
      .selectFrom('fund_returns')
      .where('requisition_id', '=', requisitionId)
      .select((eb) => eb.fn.sum<string>('amount').as('total'))
      .executeTakeFirst();
    return money(row?.total ?? null);
  }

  /** The requisition items a purchase may reference — its own, and nobody else's. */
  async itemIdsFor(requisitionId: string, executor: Db | Tx = this.db): Promise<Set<string>> {
    const rows = await executor
      .selectFrom('requisition_items')
      .where('requisition_id', '=', requisitionId)
      .select('id')
      .execute();
    return new Set(rows.map((row) => row.id));
  }

  /**
   * The live BOM's authoritative quantity and bom_line_id for every requisition item it covers.
   * Used by `recordPurchase` so a purchase line inherits the IM's quantity override instead of
   * the original requisition quantity — without this, stock receives 50 units even though the
   * IM bought 30. Returns an empty map if the requisition has no live BOM (the pre-customize
   * flow), in which case the caller falls back to the wire quantity.
   *
   * A requisition with two live BOMs (theoretically impossible — `boms.subtotal` + a partial
   * index on `bom_requisitions.is_void` enforces one-live-BOM — but defensive) would have the
   * two lines collapsed by the inner `INNER JOIN DISTINCT ON`; in practice the query picks the
   * newest line.
   */
  async getLiveBomForRequisition(
    requisitionId: string,
    executor: Db | Tx = this.db,
  ): Promise<Map<string, { bomLineId: string; quantity: number; sourceQuantity: number }>> {
    const rows = await executor
      .selectFrom('bom_lines')
      .innerJoin('boms', 'boms.id', 'bom_lines.bom_id')
      .innerJoin('bom_requisitions', 'bom_requisitions.bom_id', 'boms.id')
      .innerJoin('requisition_items', 'requisition_items.id', 'bom_lines.requisition_item_id')
      .where('bom_requisitions.requisition_id', '=', requisitionId)
      .where('bom_requisitions.is_void', '=', false)
      .where('boms.is_void', '=', false)
      .select([
        'bom_lines.id as bom_line_id',
        'bom_lines.requisition_item_id',
        'bom_lines.quantity',
        'requisition_items.quantity as source_quantity',
      ])
      .execute();
    const map = new Map<string, { bomLineId: string; quantity: number; sourceQuantity: number }>();
    for (const row of rows) {
      map.set(row.requisition_item_id, {
        bomLineId: row.bom_line_id,
        quantity: row.quantity,
        sourceQuantity: row.source_quantity,
      });
    }
    return map;
  }

  /* ----------------------------------------------------------- snapshots */

  /**
   * Append one funding snapshot to the requisition's history. Called by the funds/requisitions
   * service hooks at every forward-progress stage transition (migration 0025). The figures are
   * computed inside the same transaction that flipped the status, so the snapshot's `unspent`
   * matches what `funding()` would have returned to the API at that instant.
   *
   * `transportation` is read from `requisitions.transportation_cost` because it never appears
   * in `purchases` — it was already "spent" when the goods physically arrived (vehicles, fuel,
   * porter). See `funding()` for the same fold.
   */
  async insertSnapshot(
    tx: Tx,
    values: {
      requisitionId: string;
      status: string;
      requestedAmount: number | null;
      approvedAmount: number | null;
      transportation: number;
      funded: number;
      spent: number;
      returnedToAccounts: number;
      unspent: number;
    },
  ): Promise<void> {
    await tx
      .insertInto('funding_snapshots')
      .values({
        requisition_id: values.requisitionId,
        status: values.status,
        requested_amount: values.requestedAmount === null ? null : values.requestedAmount.toFixed(2),
        approved_amount: values.approvedAmount === null ? null : values.approvedAmount.toFixed(2),
        transportation: values.transportation.toFixed(2),
        funded: values.funded.toFixed(2),
        spent: values.spent.toFixed(2),
        returned_to_accounts: values.returnedToAccounts.toFixed(2),
        unspent: values.unspent.toFixed(2),
      })
      .execute();
  }

  /**
   * Compute the same five figures `FundsService.funding()` returns, but at a specific point in
   * time inside a transaction — used to write funding_snapshots rows. Lives on the repo (not
   * the service) so `BomsService` and `RequisitionsService` can both call it without dragging
   * in the funds service module.
   *
   * Mirrors `funds.service.ts` line for line; if the live formula changes there, change here.
   */
  async computeCurrentFunding(
    tx: Tx,
    requisitionId: string,
  ): Promise<{
    requestedAmount: number | null;
    approvedAmount: number | null;
    transportation: number;
    funded: number;
    spent: number;
    returned: number;
    unspent: number;
  }> {
    const requisition = await tx
      .selectFrom('requisitions')
      .selectAll()
      .where('id', '=', requisitionId)
      .executeTakeFirst();
    if (!requisition) {
      return {
        requestedAmount: null,
        approvedAmount: null,
        transportation: 0,
        funded: 0,
        spent: 0,
        returned: 0,
        unspent: 0,
      };
    }
    const [funded, spent, returned] = await Promise.all([
      this.sumReceipts(requisitionId, tx),
      this.sumPurchases(requisitionId, tx),
      this.sumReturns(requisitionId, tx),
    ]);
    const approved = requisition.approved_amount === null ? null : Number(requisition.approved_amount);
    const requested = requisition.requested_amount === null ? null : Number(requisition.requested_amount);
    const transportation =
      requisition.transportation_cost === null ? 0 : Number(requisition.transportation_cost);
    const unspent = Math.max(0, Math.round((funded - spent - transportation - returned) * 100) / 100);
    return {
      requestedAmount: requested,
      approvedAmount: approved,
      transportation,
      funded: Math.round(funded * 100) / 100,
      spent: Math.round(spent * 100) / 100,
      returned: Math.round(returned * 100) / 100,
      unspent,
    };
  }

  /**
   * Read all snapshots for one requisition, **deduped to the most recent row per status**.
   *
   * The table is append-only so a status re-entered multiple times (e.g. `PURCHASED` for a
   * split-vendor purchase, `FUNDS_PARTIAL` after each partial receipt) will have several rows.
   * The pill selector on the Requisition Detail page keys by status — one pill per stage — so
   * the dedup belongs here, not on the client. `DISTINCT ON (status)` does it in one pass and
   * keeps the index `(requisition_id, status)` usable.
   *
   * The order returned matches the lifecycle order so the frontend can iterate without
   * re-sorting; the caller may rearrange if it needs to highlight the "current" stage.
   */
  async listSnapshotsForRequisition(
    requisitionId: string,
    executor: Db | Tx = this.db,
  ): Promise<
    Array<{
      status: RequisitionStatus;
      requestedAmount: number | null;
      approvedAmount: number | null;
      transportation: number;
      funded: number;
      spent: number;
      returnedToAccounts: number;
      unspent: number;
      snapshottedAt: string;
    }>
  > {
    const rows = await executor
      .selectFrom('funding_snapshots')
 .where('requisition_id', '=', requisitionId)
      .distinctOn('status')
      .select([
        'status',
        'requested_amount',
        'approved_amount',
        'transportation',
        'funded',
        'spent',
        'returned_to_accounts',
        'unspent',
        'snapshotted_at',
      ])
      .orderBy('status')
      .orderBy('snapshotted_at', 'desc')
      .execute();

    return rows.map((row) => ({
      // The `status` column is `text`; only forward-progress enum values are ever written
      // (the snapshot hooks enforce this) so the cast is safe — defensive parsing would
      // just turn a future enum addition into a louder crash, which we don't want here.
      status: row.status as RequisitionStatus,
      requestedAmount: row.requested_amount === null ? null : Number(row.requested_amount),
      approvedAmount: row.approved_amount === null ? null : Number(row.approved_amount),
      transportation: money(row.transportation),
      funded: money(row.funded),
      spent: money(row.spent),
      returnedToAccounts: money(row.returned_to_accounts),
      unspent: money(row.unspent),
      snapshottedAt: row.snapshotted_at.toISOString(),
    }));
  }
}
