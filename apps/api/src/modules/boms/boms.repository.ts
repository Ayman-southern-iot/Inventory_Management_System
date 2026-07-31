import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import {
  type ApprovalFootprint,
  type Bom,
  type BomDetail,
  type BomLine,
  type BomCandidate,
  type ListBomsQuery,
  type Paginated,
  type RequisitionFootprints,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';

type Tx = Transaction<Database> | Db;

/** NUMERIC arrives from pg as a string so it never passes through a float. */
const money = (value: string | null): number | null => (value === null ? null : Number(value));

/**
 * Reads + writes for the BOM module.
 *
 * Same shape as `RequisitionsRepository`: a typed select-builder, separate list/ detail
 * methods, and the four writes the service composes inside its transaction. Anything
 * that touches more than one table — the picker query, the detail with its lines and
 * snapshots — lives here rather than in the service so the SQL is one place to read.
 */
@Injectable()
export class BomsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ----------------------------------------------------------------- writes */

  /** Reserves a BOM number from `bom_no_seq`. Format: `BOM-000001`. */
  async nextBomNo(tx: Tx): Promise<string> {
    const row = await sql<{ n: string }>`SELECT nextval('bom_no_seq') AS n`.execute(tx);
    return `BOM-${String(Number(row.rows[0]?.n ?? 1)).padStart(6, '0')}`;
  }

  async insertBom(
    tx: Tx,
    values: {
      bomNo: string;
      generatedBy: string;
      subtotal: number;
      overBudgetBounced: boolean;
    },
  ): Promise<{ id: string; bomNo: string }> {
    const row = await tx
      .insertInto('boms')
      .values({
        bom_no: values.bomNo,
        generated_by: values.generatedBy,
        // Money columns travel as NUMERIC strings; round once here so the database stores
        // exactly what the over-budget comparison read.
        subtotal: values.subtotal.toFixed(2),
        over_budget_bounced: values.overBudgetBounced,
      })
      .returning(['id', 'bom_no'])
      .executeTakeFirstOrThrow();
    return { id: row.id, bomNo: row.bom_no };
  }

  /**
   * Freezes the footprints block. `approvalSnapshot` is the JSON the BOM PDF will draw
   * from forever after, so the bytes that go in here are the bytes Accounts will see.
   */
  async insertBomRequisitions(
    tx: Tx,
    values: {
      bomId: string;
      requisitionId: string;
      approvalSnapshot: ApprovalFootprint[];
    },
  ): Promise<void> {
    await tx
      .insertInto('bom_requisitions')
      .values({
        bom_id: values.bomId,
        requisition_id: values.requisitionId,
        approval_snapshot: JSON.stringify(values.approvalSnapshot),
      })
      .execute();
  }

  async insertBomLines(
    tx: Tx,
    values: {
      bomId: string;
      lines: Array<{
        requisitionItemId: string;
        productId: string | null;
        itemName: string;
        quantity: number;
        unitCost: number;
        vendor: string | null;
        purpose: string | null;
        projectId: string | null;
        sortOrder: number;
      }>;
    },
  ): Promise<void> {
    if (values.lines.length === 0) return;
    await tx
      .insertInto('bom_lines')
      .values(
        values.lines.map((line) => ({
          bom_id: values.bomId,
          requisition_item_id: line.requisitionItemId,
          product_id: line.productId,
          item_name: line.itemName,
          quantity: line.quantity,
          unit_cost: line.unitCost,
          vendor: line.vendor,
          purpose: line.purpose,
          project_id: line.projectId,
          sort_order: line.sortOrder,
        })),
      )
      .execute();
  }

  async setVoid(
    tx: Tx,
    id: string,
    values: { voidReason: string; voidedBy: string },
  ): Promise<void> {
    await tx
      .updateTable('boms')
      .set({
        is_void: true,
        void_reason: values.voidReason,
        voided_by: values.voidedBy,
        voided_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async findById(id: string) {
    return this.db.selectFrom('boms').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /* ----------------------------------------------- IM picker (candidates) */

  /**
   * Approved requisitions the IM can put on a new BOM. A requisition already on a live
   * BOM is hidden; a requisition whose prior BOM was voided is back in the list because
   * the partial index flipped its `is_void` to true.
   *
   * The `NOT EXISTS` is what makes "void frees the requisition" a database fact, not
   * just an application convention.
   */
  async candidatesForBom(): Promise<BomCandidate[]> {
    const requisitions = await this.db
      .selectFrom('requisitions')
      .innerJoin('users as requester', 'requester.id', 'requisitions.requester_id')
      .leftJoin('departments', 'departments.id', 'requisitions.department_id')
      .leftJoin('projects', 'projects.id', 'requisitions.project_id')
      .where('requisitions.status', '=', 'APPROVED')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('bom_requisitions as br')
              .select('br.id')
              .whereRef('br.requisition_id', '=', 'requisitions.id')
              .where('br.is_void', '=', false),
          ),
        ),
      )
      .select([
        'requisitions.id as requisition_id',
        'requisitions.requisition_no',
        'requester.full_name as requester_name',
        'departments.name as department_name',
        'projects.name as project_name',
        'requisitions.approved_amount',
      ])
      // Most recently decided first — that is what the IM is actually working on.
      .orderBy('requisitions.decided_at', 'desc')
      .execute();

    if (requisitions.length === 0) return [];

    const ids = requisitions.map((row) => row.requisition_id);
    const items = await this.db
      .selectFrom('requisition_items')
      .innerJoin('requisitions', 'requisitions.id', 'requisition_items.requisition_id')
      .where('requisition_items.requisition_id', 'in', ids)
      .select([
        'requisition_items.requisition_id',
        'requisition_items.id as requisition_item_id',
        'requisition_items.product_id',
        'requisition_items.item_name',
        'requisition_items.quantity',
        'requisition_items.estimated_unit_price',
        // The requisition's reason is the closest thing to a per-line purpose until
        // a future task grows per-line metadata; pre-filling it keeps the IM from
        // re-typing the rationale on every batched BOM.
        'requisitions.reason as purpose',
      ])
      .orderBy('requisition_items.created_at')
      .execute();

    const itemsByRequisition = new Map<string, BomCandidate['items']>();
    for (const item of items) {
      const list = itemsByRequisition.get(item.requisition_id) ?? [];
      list.push({
        requisitionItemId: item.requisition_item_id,
        productId: item.product_id,
        itemName: item.item_name,
        quantity: item.quantity,
        estimatedUnitPrice: Number(item.estimated_unit_price),
        purpose: item.purpose,
      });
      itemsByRequisition.set(item.requisition_id, list);
    }

    return requisitions.map((row) => ({
      requisitionId: row.requisition_id,
      requisitionNo: row.requisition_no,
      requesterName: row.requester_name,
      departmentName: row.department_name,
      projectName: row.project_name,
      approvedAmount: money(row.approved_amount),
      items: itemsByRequisition.get(row.requisition_id) ?? [],
    }));
  }

  /* --------------------------------------------------------------- list */

  private baseSelect() {
    return this.db
      .selectFrom('boms')
      .innerJoin('users as generator', 'generator.id', 'boms.generated_by')
      .leftJoin('users as voider', 'voider.id', 'boms.voided_by')
      .select([
        'boms.id',
        'boms.bom_no',
        'boms.generated_by',
        'generator.full_name as generated_by_name',
        'boms.subtotal',
        'boms.pdf_path',
        'boms.pdf_generated_at',
        'boms.is_void',
        'boms.void_reason',
        'boms.voided_by',
        'voider.full_name as voided_by_name',
        'boms.voided_at',
        'boms.over_budget_bounced',
        'boms.generated_at',
        'boms.updated_at',
      ]);
  }

  async list(query: ListBomsQuery): Promise<Paginated<Bom>> {
    const offset = (query.page - 1) * query.limit;

    const applyFilters = <T extends ReturnType<typeof this.baseSelect>>(qb: T) =>
      qb
        .$if(!query.includeVoid, (b) => b.where('boms.is_void', '=', false))
        .$if(query.search !== undefined && query.search.length > 0, (b) =>
          b.where((eb) =>
            eb(
              sql<string>`lower(${sql.ref('boms.bom_no')})`,
              'like',
              `%${query.search!.toLowerCase()}%`,
            ),
          ),
        );

    const rows = await applyFilters(this.baseSelect())
      // Most recent first — the IM is looking for the BOM they just made.
      .orderBy('boms.generated_at', 'desc')
      .limit(query.limit)
      .offset(offset)
      .execute();

    const counted = await applyFilters(this.baseSelect())
      .clearSelect()
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    const sourceNos = await this.sourceNosByBom(rows.map((row) => row.id));
    return {
      items: rows.map((row) => toBom(row, sourceNos.get(row.id) ?? [])),
      page: query.page,
      limit: query.limit,
      total: Number(counted?.count ?? 0),
    };
  }

  /**
   * Resolves the source `requisition_no`s for a whole page of BOMs in one query, so the list
   * view can show "this BOM covers REQ-0042, REQ-0043".
   *
   * Batched deliberately: doing this per row is an N+1 that costs 25 extra round trips on a
   * default page, and it grows with the page size rather than staying flat.
   */
  private async sourceNosByBom(bomIds: string[]): Promise<Map<string, string[]>> {
    const byBom = new Map<string, string[]>();
    if (bomIds.length === 0) return byBom;

    const sources = await this.db
      .selectFrom('bom_requisitions')
      .innerJoin('requisitions', 'requisitions.id', 'bom_requisitions.requisition_id')
      .where('bom_requisitions.bom_id', 'in', bomIds)
      .select(['bom_requisitions.bom_id', 'requisitions.requisition_no'])
      // Stable order, so the same BOM lists its sources the same way on every request.
      .orderBy('requisitions.requisition_no')
      .execute();

    for (const source of sources) {
      const existing = byBom.get(source.bom_id);
      if (existing) existing.push(source.requisition_no);
      else byBom.set(source.bom_id, [source.requisition_no]);
    }
    return byBom;
  }

  /* --------------------------------------------------------------- detail */

  async findDetail(id: string): Promise<BomDetail | undefined> {
    const row = await this.baseSelect().where('boms.id', '=', id).executeTakeFirst();
    if (!row) return undefined;

    const [lineRows, sourceRows] = await Promise.all([
      this.db
        .selectFrom('bom_lines')
        .innerJoin('requisition_items', 'requisition_items.id', 'bom_lines.requisition_item_id')
        .innerJoin('requisitions', 'requisitions.id', 'requisition_items.requisition_id')
        .leftJoin('projects', 'projects.id', 'bom_lines.project_id')
        .where('bom_lines.bom_id', '=', id)
        .select([
          'bom_lines.id',
          'bom_lines.requisition_item_id',
          'bom_lines.product_id',
          'bom_lines.item_name',
          'bom_lines.quantity',
          'bom_lines.unit_cost',
          'bom_lines.total_cost',
          'bom_lines.vendor',
          'bom_lines.purpose',
          'bom_lines.project_id',
          'projects.name as project_name',
          // Inherited — a batched BOM must stay legible line by line.
          'requisitions.requisition_no',
        ])
        .orderBy('bom_lines.sort_order')
        .execute(),
      this.db
        .selectFrom('bom_requisitions')
        .innerJoin('requisitions', 'requisitions.id', 'bom_requisitions.requisition_id')
        .innerJoin('users as requester', 'requester.id', 'requisitions.requester_id')
        .leftJoin('departments', 'departments.id', 'requisitions.department_id')
        .leftJoin('projects', 'projects.id', 'requisitions.project_id')
        .where('bom_requisitions.bom_id', '=', id)
        .select([
          'bom_requisitions.requisition_id',
          'requisitions.requisition_no',
          'requester.full_name as requester_name',
          'departments.name as department_name',
          // Task 5.3: the BOM header prints the project and the requester's own description.
          'projects.name as project_name',
          'requisitions.reason',
          'requisitions.requested_amount',
          'requisitions.approved_amount',
          'bom_requisitions.approval_snapshot',
        ])
        .execute(),
    ]);

    const sources: RequisitionFootprints[] = sourceRows.map((sourceRow) => {
      const requestedAmount = money(sourceRow.requested_amount);
      const approvedAmount = money(sourceRow.approved_amount);
      return {
        requisitionId: sourceRow.requisition_id,
        requisitionNo: sourceRow.requisition_no,
        requesterName: sourceRow.requester_name,
        departmentName: sourceRow.department_name,
        projectName: sourceRow.project_name,
        description: sourceRow.reason,
        requestedAmount,
        approvedAmount,
        // OQ-18: what the approvers did not sanction. Null unless both figures are known —
        // printing a "Remaining" of 0 when one side is unknown would be a lie on a payable
        // document. Rounded to the cent so it agrees with the NUMERIC(14,2) columns.
        remainingAmount:
          requestedAmount === null || approvedAmount === null
            ? null
            : Math.round((requestedAmount - approvedAmount) * 100) / 100,
        footprints: parseSnapshot(sourceRow.approval_snapshot),
      };
    });

    const lines: BomLine[] = lineRows.map((lineRow) => ({
      id: lineRow.id,
      requisitionItemId: lineRow.requisition_item_id,
      productId: lineRow.product_id,
      itemName: lineRow.item_name,
      quantity: lineRow.quantity,
      unitCost: Number(lineRow.unit_cost),
      totalCost: Number(lineRow.total_cost),
      vendor: lineRow.vendor,
      purpose: lineRow.purpose,
      projectId: lineRow.project_id,
      projectName: lineRow.project_name,
      requisitionNo: lineRow.requisition_no ?? '',
    }));

    return { ...toBom(row, sources.map((source) => source.requisitionNo)), lines, sources };
  }

  /* ----------------------------------------------------- PDF (task 4.3) */

  /**
   * The raw `pdf_path` for the download endpoint. `findDetail` deliberately collapses it to
   * `hasPdf: boolean` on the contract — the path is internal and never travels to the client.
   */
  async findPdfPath(id: string): Promise<{ pdfPath: string | null; pdfGeneratedAt: Date | null; isVoid: boolean } | undefined> {
    const row = await this.db
      .selectFrom('boms')
      .select(['pdf_path', 'pdf_generated_at', 'is_void'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      pdfPath: row.pdf_path,
      pdfGeneratedAt: row.pdf_generated_at,
      isVoid: row.is_void,
    };
  }

  /** `executor` so the caller's transaction owns this write — see `BomsService.ensurePdf`. */
  async setPdfPath(id: string, pdfPath: string, executor: Tx = this.db): Promise<void> {
    await executor
      .updateTable('boms')
      .set({ pdf_path: pdfPath, pdf_generated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async clearPdfPath(id: string): Promise<void> {
    await this.db
      .updateTable('boms')
      .set({ pdf_path: null, pdf_generated_at: null })
      .where('id', '=', id)
      .execute();
  }
}

interface BomRow {
  id: string;
  bom_no: string;
  generated_by: string;
  generated_by_name: string;
  /**
   * Kysely surfaces the NUMERIC column through its `Money` ColumnType wrapper, which
   * is structurally a string but typed differently at the typing layer. Treat it as
   * `unknown` at the boundary and coerce via `Number(...)` like every other money field.
   */
  subtotal: unknown;
  pdf_path: string | null;
  pdf_generated_at: Date | null;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_by_name: string | null;
  voided_at: Date | null;
  over_budget_bounced: boolean;
  generated_at: Date;
  updated_at: Date;
}

function toBom(row: BomRow, requisitionNos: string[]): Bom {
  return {
    id: row.id,
    bomNo: row.bom_no,
    generatedByName: row.generated_by_name,
    subtotal: Number(row.subtotal),
    isVoid: row.is_void,
    voidReason: row.void_reason,
    voidedByName: row.voided_by_name,
    voidedAt: row.voided_at ? row.voided_at.toISOString() : null,
    overBudgetBounced: row.over_budget_bounced,
    hasPdf: row.pdf_path !== null,
    generatedAt: row.generated_at.toISOString(),
    requisitionNos,
  };
}

/**
 * The snapshot column is JSONB; pg returns it as a parsed object on `selectFrom` but
 * remains an unparsed string inside `updateTable`/`returning`. The contract is the typed
 * `ApprovalFootprint[]` — parse defensively rather than trust the column.
 */
function parseSnapshot(value: unknown): ApprovalFootprint[] {
  if (Array.isArray(value)) return value as ApprovalFootprint[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as ApprovalFootprint[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}