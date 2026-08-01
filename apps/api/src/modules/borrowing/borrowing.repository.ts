import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  BorrowFilter,
  BorrowStatus,
  OUTSTANDING_STATUSES,
  type BorrowRequest,
  type ListBorrowsQuery,
  type Paginated,
  type ReturnCondition,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ConflictError } from '../../common/errors';
import type { Tx } from '../audit/audit.repository';

/** A writer that is either the pool-backed db or a kysely transaction handle. */
type Writer = Db | Tx;

@Injectable()
export class BorrowingRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findProductForBorrow(productId: string) {
    return this.db
      .selectFrom('products')
      .innerJoin('categories', 'categories.id', 'products.category_id')
      .where('products.id', '=', productId)
      .select([
        'products.id',
        'products.is_active',
        'products.default_returnable',
        'categories.is_trackable',
      ])
      .executeTakeFirst();
  }

  async findById(id: string) {
    return this.db
      .selectFrom('borrow_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async insert(
    values: {
      borrowNo: string;
      requesterId: string;
      productId: string;
      placementId: string;
      compartmentId: string;
      quantity: number;
      projectId: string | null;
      isReturnable: boolean;
      expectedReturnDate: string | null;
      purpose: string | null;
    },
    tx?: Tx,
  ): Promise<string> {
    const writer: Writer = tx ?? this.db;
    const row = await writer
      .insertInto('borrow_requests')
      .values({
        borrow_no: values.borrowNo,
        requester_id: values.requesterId,
        product_id: values.productId,
        placement_id: values.placementId,
        compartment_id: values.compartmentId,
        quantity: values.quantity,
        project_id: values.projectId,
        is_returnable: values.isReturnable,
        expected_return_date: values.expectedReturnDate,
        purpose: values.purpose,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * Conditional on the row still being PENDING.
   *
   * Two inventory managers pressing Approve at the same instant is not hypothetical on a shared
   * screen. `WHERE status = 'PENDING'` means the database decides the winner; returning
   * zero updated rows is how the loser learns it, instead of both proceeding to issue stock.
   */
  async claimPendingDecision(
    id: string,
    values: {
      status: BorrowStatus;
      decidedBy: string;
      decisionNote: string | null;
      markIssued: boolean;
    },
    tx?: Tx,
  ): Promise<boolean> {
    const writer: Writer = tx ?? this.db;
    const result = await writer
      .updateTable('borrow_requests')
      .set({
        status: values.status,
        decided_by: values.decidedBy,
        decision_note: values.decisionNote,
        decided_at: new Date(),
        ...(values.markIssued ? { issued_at: new Date() } : {}),
      })
      .where('id', '=', id)
      .where('status', '=', BorrowStatus.PENDING)
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0n) === 1;
  }

  /**
   * Conditional on `returned_qty` still being what the caller read. Two concurrent returns of
   * the last unit would otherwise both pass their outstanding check and put the stock back
   * twice.
   */
  async claimReturn(
    id: string,
    values: {
      quantity: number;
      expectedReturnedQty: number;
      status: BorrowStatus;
      markReturnedAt: boolean;
    },
    tx?: Tx,
  ): Promise<boolean> {
    const writer: Writer = tx ?? this.db;
    const result = await writer
      .updateTable('borrow_requests')
      .set((eb) => ({
        returned_qty: eb('returned_qty', '+', values.quantity),
        status: values.status,
        ...(values.markReturnedAt ? { returned_at: new Date() } : {}),
      }))
      .where('id', '=', id)
      .where('returned_qty', '=', values.expectedReturnedQty)
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0n) === 1;
  }

  // `rollbackReturn` used to live here: an unconditional `returned_qty - quantity` plus a status
  // captured before the claim, used to unwind a return whose stock movement failed. It was
  // removed with G-15 — the return and its stock movement now share one transaction, so there is
  // nothing to compensate. Reintroducing a hand-rolled compensation is the bug, not the fix.

  async revertToPending(id: string, tx?: Tx): Promise<void> {
    const writer: Writer = tx ?? this.db;
    await writer
      .updateTable('borrow_requests')
      .set({
        status: BorrowStatus.PENDING,
        decided_by: null,
        decision_note: null,
        decided_at: null,
        issued_at: null,
      })
      .where('id', '=', id)
      .execute();
  }

  async insertReturn(
    values: {
      borrowRequestId: string;
      quantity: number;
      compartmentId: string;
      receivedBy: string;
      condition: ReturnCondition;
    },
    tx?: Tx,
  ): Promise<void> {
    const writer: Writer = tx ?? this.db;
    await writer
      .insertInto('borrow_returns')
      .values({
        borrow_request_id: values.borrowRequestId,
        quantity: values.quantity,
        compartment_id: values.compartmentId,
        received_by: values.receivedBy,
        condition: values.condition,
      })
      .execute();
  }

  /**
   * Increment quarantined_qty on a placement by `delta`. A no-op when delta is zero. Throws
   * `ConflictError` if the increment would push `quarantined + reserved > quantity`, which the
   * CHECK constraint also enforces — the explicit check turns the DB error into a useful
   * message instead of a 500.
   */
  async incrementQuarantine(
    tx: Writer,
    productId: string,
    compartmentId: string,
    delta: number,
  ): Promise<void> {
    if (delta === 0) return;
    if (!Number.isInteger(delta) || delta < 0) {
      throw new ConflictError('Quarantine increment must be a non-negative whole number');
    }
    const result = await tx
      .updateTable('stock_placements')
      .set((eb) => ({
        quarantined_qty: eb('quarantined_qty', '+', delta),
        version: eb('version', '+', 1),
      }))
      .where('product_id', '=', productId)
      .where('compartment_id', '=', compartmentId)
      .returningAll()
      .executeTakeFirst();
    if (!result) {
      throw new ConflictError('Placement has disappeared; cannot quarantine this return');
    }
    // The DB CHECK is the real guarantee — if the UPDATE somehow slipped past it the second
    // statement would catch us. We surface its message rather than a raw constraint name.
    if (result.quarantined_qty + result.reserved_qty > result.quantity) {
      throw new ConflictError(
        'Cannot quarantine that many units; the placement does not have that much free stock',
      );
    }
  }

  /** Everything a row needs, joined once. The log is the screen the IM lives on. */
  private viewSelect() {
    return this.db
      .selectFrom('borrow_requests')
      .innerJoin('users as requester', 'requester.id', 'borrow_requests.requester_id')
      .innerJoin('products', 'products.id', 'borrow_requests.product_id')
      .innerJoin(
        'storage_compartments',
        'storage_compartments.id',
        'borrow_requests.compartment_id',
      )
      .innerJoin('storage_zones', 'storage_zones.id', 'storage_compartments.zone_id')
      .leftJoin('projects', 'projects.id', 'borrow_requests.project_id')
      .leftJoin('users as decider', 'decider.id', 'borrow_requests.decided_by')
      .select([
        'borrow_requests.id',
        'borrow_requests.borrow_no',
        'borrow_requests.requester_id',
        'requester.full_name as requester_name',
        'borrow_requests.product_id',
        'products.name as product_name',
        'products.product_code',
        'products.unit',
        'borrow_requests.compartment_id',
        'storage_compartments.code as compartment_code',
        'storage_zones.name as zone_name',
        'borrow_requests.quantity',
        'borrow_requests.returned_qty',
        'borrow_requests.project_id',
        'projects.name as project_name',
        'borrow_requests.is_returnable',
        'borrow_requests.expected_return_date',
        'borrow_requests.purpose',
        'borrow_requests.status',
        'decider.full_name as decided_by_name',
        'borrow_requests.decision_note',
        'borrow_requests.decided_at',
        'borrow_requests.issued_at',
        'borrow_requests.returned_at',
        'borrow_requests.created_at',
      ]);
  }

  async findViewById(id: string): Promise<BorrowRequest | undefined> {
    const row = await this.viewSelect().where('borrow_requests.id', '=', id).executeTakeFirst();
    return row ? toBorrowRequest(row) : undefined;
  }

  async list(
    query: ListBorrowsQuery,
    restrictToRequesterId?: string,
  ): Promise<Paginated<BorrowRequest>> {
    const offset = (query.page - 1) * query.limit;

    const applyFilters = <T extends ReturnType<typeof this.viewSelect>>(qb: T) =>
      qb
        .$if(restrictToRequesterId !== undefined, (b) =>
          b.where('borrow_requests.requester_id', '=', restrictToRequesterId!),
        )
        .$if(query.productId !== undefined, (b) =>
          b.where('borrow_requests.product_id', '=', query.productId!),
        )
        .$if(query.projectId !== undefined, (b) =>
          b.where('borrow_requests.project_id', '=', query.projectId!),
        )
        .$if(query.filter === BorrowFilter.PENDING, (b) =>
          b.where('borrow_requests.status', '=', BorrowStatus.PENDING),
        )
        .$if(query.filter === BorrowFilter.OUT, (b) =>
          b.where('borrow_requests.status', 'in', [...OUTSTANDING_STATUSES]),
        )
        .$if(query.filter === BorrowFilter.RETURNED, (b) =>
          b.where('borrow_requests.status', '=', BorrowStatus.RETURNED),
        )
        // Overdue is derived, never stored: a stored flag would be wrong every midnight.
        .$if(query.filter === BorrowFilter.OVERDUE, (b) =>
          b
            .where('borrow_requests.status', 'in', [...OUTSTANDING_STATUSES])
            .where('borrow_requests.expected_return_date', '<', sql<string>`current_date`),
        )
        .$if(query.search !== undefined && query.search.length > 0, (b) =>
          b.where((eb) =>
            eb.or([
              eb(sql`lower(products.name)`, 'like', `%${query.search!.toLowerCase()}%`),
              eb(sql`lower(products.product_code)`, 'like', `%${query.search!.toLowerCase()}%`),
              eb(sql`lower(requester.full_name)`, 'like', `%${query.search!.toLowerCase()}%`),
              eb(sql`lower(borrow_requests.borrow_no)`, 'like', `%${query.search!.toLowerCase()}%`),
            ]),
          ),
        );

    const rows = await applyFilters(this.viewSelect())
      .orderBy('borrow_requests.created_at', 'desc')
      .orderBy('borrow_requests.id', 'desc')
      .limit(query.limit)
      .offset(offset)
      .execute();

    const counted = await applyFilters(this.viewSelect())
      .clearSelect()
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return {
      items: rows.map(toBorrowRequest),
      page: query.page,
      limit: query.limit,
      total: Number(counted?.count ?? 0),
    };
  }

  /** Powers the IM's pending badge without loading the list. */
  async countPending(): Promise<number> {
    const row = await this.db
      .selectFrom('borrow_requests')
      .where('status', '=', BorrowStatus.PENDING)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async findOverdue(): Promise<Array<{ id: string; borrow_no: string; requester_id: string }>> {
    return this.db
      .selectFrom('borrow_requests')
      .select(['id', 'borrow_no', 'requester_id'])
      .where('status', 'in', [...OUTSTANDING_STATUSES])
      .where('expected_return_date', '<', sql<string>`current_date`)
      .execute();
  }

  /**
   * Active borrows for a single product, ordered by issue date desc. The product detail page
   * shows this list under "Currently in use" so people can see who has the product and on
   * which project, without having to walk the borrow list one row at a time.
   *
   * Status scope follows `OUTSTANDING_STATUSES`: a fully-returned borrow is gone from this
   * list — the moment the last unit came back is the moment its information stops being
   * useful. PENDING borrows are excluded because the stock is still on the shelf, not in
   * use; the borrowing list shows PENDING already.
   *
   * `lastReturnCondition` is fetched with a LATERAL so a partial return that came back
   * DAMAGED still shows on the borrow row even though the borrow is still active. NULL for
   * borrows that have no returns yet (newly issued).
   */
  async listActiveForProduct(productId: string): Promise<
    Array<{
      borrowId: string;
      borrowNo: string;
      borrowerId: string;
      borrowerName: string;
      projectId: string | null;
      projectName: string | null;
      quantity: number;
      returnedQty: number;
      outstandingQty: number;
      expectedReturnDate: Date | string | null;
      issuedAt: Date | null;
      isOverdue: boolean;
      lastReturnCondition: ReturnCondition | null;
    }>
  > {
    const rows = await this.db
      .selectFrom('borrow_requests')
      .innerJoin('users as requester', 'requester.id', 'borrow_requests.requester_id')
      .leftJoin('projects', 'projects.id', 'borrow_requests.project_id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('borrow_returns')
            .whereRef('borrow_returns.borrow_request_id', '=', 'borrow_requests.id')
            .orderBy('borrow_returns.returned_at', 'desc')
            .limit(1)
            .select('borrow_returns.condition as last_return_condition')
            .as('latest_return'),
        (join) => join.onTrue(),
      )
      .where('borrow_requests.product_id', '=', productId)
      .where('borrow_requests.status', 'in', [...OUTSTANDING_STATUSES])
      .select([
        'borrow_requests.id as borrow_id',
        'borrow_requests.borrow_no as borrow_no',
        'borrow_requests.requester_id as borrower_id',
        'requester.full_name as borrower_name',
        'borrow_requests.project_id as project_id',
        'projects.name as project_name',
        'borrow_requests.quantity as quantity',
        'borrow_requests.returned_qty as returned_qty',
        'borrow_requests.expected_return_date as expected_return_date',
        'borrow_requests.issued_at as issued_at',
        sql<boolean>`borrow_requests.expected_return_date IS NOT NULL
          AND borrow_requests.expected_return_date < current_date`.as('is_overdue'),
        'latest_return.last_return_condition as last_return_condition',
      ])
      .orderBy('borrow_requests.issued_at', 'desc')
      .execute();

    return rows.map((row) => ({
      borrowId: row.borrow_id,
      borrowNo: row.borrow_no,
      borrowerId: row.borrower_id,
      borrowerName: row.borrower_name,
      projectId: row.project_id,
      projectName: row.project_name,
      quantity: row.quantity,
      returnedQty: row.returned_qty,
      outstandingQty: row.quantity - row.returned_qty,
      expectedReturnDate: row.expected_return_date,
      issuedAt: row.issued_at,
      isOverdue: row.is_overdue,
      lastReturnCondition: row.last_return_condition,
    }));
  }
}

/** The joined row shape, so the mapper cannot drift away from the projection above. */
interface BorrowViewRow {
  id: string;
  borrow_no: string;
  requester_id: string;
  requester_name: string;
  product_id: string;
  product_name: string;
  product_code: string;
  unit: string;
  compartment_id: string;
  compartment_code: string;
  zone_name: string;
  quantity: number;
  returned_qty: number;
  project_id: string | null;
  project_name: string | null;
  is_returnable: boolean;
  expected_return_date: Date | string | null;
  purpose: string | null;
  status: BorrowStatus;
  decided_by_name: string | null;
  decision_note: string | null;
  decided_at: Date | null;
  issued_at: Date | null;
  returned_at: Date | null;
  created_at: Date;
}

function toBorrowRequest(row: BorrowViewRow): BorrowRequest {
  const outstanding = row.is_returnable ? row.quantity - row.returned_qty : 0;
  const expected: string | null = row.expected_return_date
    ? typeof row.expected_return_date === 'string'
      ? row.expected_return_date
      : new Date(row.expected_return_date).toISOString().slice(0, 10)
    : null;

  const isOut =
    row.status === BorrowStatus.ISSUED || row.status === BorrowStatus.PARTIALLY_RETURNED;

  return {
    id: row.id,
    borrowNo: row.borrow_no,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    productId: row.product_id,
    productName: row.product_name,
    productCode: row.product_code,
    unit: row.unit,
    compartmentId: row.compartment_id,
    location: `${row.zone_name} / ${row.compartment_code}`,
    quantity: row.quantity,
    returnedQty: row.returned_qty,
    outstandingQty: outstanding,
    projectId: row.project_id,
    projectName: row.project_name,
    isReturnable: row.is_returnable,
    expectedReturnDate: expected,
    purpose: row.purpose,
    status: row.status,
    decidedByName: row.decided_by_name,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
    returnedAt: row.returned_at ? new Date(row.returned_at).toISOString() : null,
    // Computed here rather than stored: a persisted flag is wrong the moment midnight passes.
    isOverdue: isOut && expected !== null && expected < new Date().toISOString().slice(0, 10),
    createdAt: new Date(row.created_at).toISOString(),
  };
}
