import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { FundReceipt, Purchase, PurchaseLine } from '@ims/shared';
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
        'purchase_lines.quantity',
        'purchase_lines.unit_cost',
        'purchase_lines.over_bom_quantity',
        'purchase_lines.over_bom_note',
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

  /** The requisition items a purchase may reference — its own, and nobody else's. */
  async itemIdsFor(requisitionId: string, executor: Db | Tx = this.db): Promise<Set<string>> {
    const rows = await executor
      .selectFrom('requisition_items')
      .where('requisition_id', '=', requisitionId)
      .select('id')
      .execute();
    return new Set(rows.map((row) => row.id));
  }
}
