import { Inject, Injectable } from '@nestjs/common';
import {
  BorrowStatus,
  ProjectUsage,
  type ListProjectItemsQuery,
  type PaginationQuery,
  type ProjectItem,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Tx } from '../audit/audit.repository';

/**
 * A borrow only counts as the project's once it has actually been handed over. PENDING has not
 * been approved, and REJECTED and CANCELLED never happened — listing them would put items in a
 * project that nobody can find on a shelf.
 *
 * OPEN QUESTION: OQ-23 — whether a pending borrow should appear, greyed, so a requester can see
 * their request against the project. Excluded for now as the smaller, defensible default.
 */
const VISIBLE_STATUSES = [
  BorrowStatus.ISSUED,
  BorrowStatus.PARTIALLY_RETURNED,
  BorrowStatus.RETURNED,
] as const;

/** Statuses that mean units are still out. The complement of RETURNED within VISIBLE_STATUSES. */
const IN_USE_STATUSES = [BorrowStatus.ISSUED, BorrowStatus.PARTIALLY_RETURNED] as const;

/**
 * `expected_return_date` is a `date` column, which the driver hands back as either a string or a
 * `Date` depending on how it was written. The contract is a plain `YYYY-MM-DD` string, so it is
 * normalised here rather than left for each client to guess — same treatment as
 * `toBorrowRequest` in the borrowing repository.
 */
function toDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

@Injectable()
export class ProjectsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private itemsBase(projectId: string) {
    return this.db
      .selectFrom('borrow_requests as br')
      .innerJoin('products as p', 'p.id', 'br.product_id')
      .innerJoin('users as u', 'u.id', 'br.requester_id')
      .where('br.project_id', '=', projectId)
      .where('br.status', 'in', [...VISIBLE_STATUSES]);
  }

  async listItems(
    projectId: string,
    query: ListProjectItemsQuery,
  ): Promise<{ items: ProjectItem[]; total: number }> {
    const offset = (query.page - 1) * query.limit;
    const usageFilter = <T extends ReturnType<ProjectsRepository['itemsBase']>>(qb: T) =>
      query.usage === ProjectUsage.RETURNED
        ? qb.where('br.status', '=', BorrowStatus.RETURNED)
        : qb.where('br.status', 'in', [...IN_USE_STATUSES]);

    const rows = await this.itemsBase(projectId)
      .$if(query.usage !== undefined, usageFilter)
      .select([
        'br.id as borrow_request_id',
        'br.borrow_no',
        'br.product_id',
        'p.product_code',
        'p.name as product_name',
        'br.quantity',
        'br.returned_qty',
        'br.status',
        'u.full_name as borrower_name',
        'br.purpose',
        'br.expected_return_date',
        'br.issued_at',
        'br.returned_at',
      ])
      // Newest first: the log is read to find what is out right now.
      .orderBy('br.created_at', 'desc')
      .orderBy('br.id', 'desc')
      .limit(query.limit)
      .offset(offset)
      .execute();

    const counted = await this.itemsBase(projectId)
      .$if(query.usage !== undefined, usageFilter)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return {
      items: rows.map((r) => ({
        borrowRequestId: r.borrow_request_id,
        borrowNo: r.borrow_no,
        productId: r.product_id,
        productCode: r.product_code,
        productName: r.product_name,
        quantity: Number(r.quantity),
        returnedQty: Number(r.returned_qty),
        outstandingQty: Number(r.quantity) - Number(r.returned_qty),
        usage: r.status === BorrowStatus.RETURNED ? ProjectUsage.RETURNED : ProjectUsage.IN_USE,
        borrowerName: r.borrower_name,
        purpose: r.purpose,
        expectedReturnDate: toDateOnly(r.expected_return_date),
        issuedAt: r.issued_at?.toISOString() ?? null,
        returnedAt: r.returned_at?.toISOString() ?? null,
      })),
      // `count(*)` arrives as a string from the driver; the contract says number.
      total: Number(counted?.count ?? 0),
    };
  }

  async countsByUsage(projectId: string): Promise<{ inUse: number; returned: number }> {
    const rows = await this.itemsBase(projectId)
      .select(['br.status'])
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .groupBy('br.status')
      .execute();

    let inUse = 0;
    let returned = 0;
    for (const row of rows) {
      if (row.status === BorrowStatus.RETURNED) returned += Number(row.count);
      else inUse += Number(row.count);
    }
    return { inUse, returned };
  }

  /**
   * Conditional on the current project, not read-then-write: two IMs on the same screen is the
   * normal case, and zero rows updated is how the loser finds out instead of both "succeeding".
   *
   * The status predicate is the same `VISIBLE_STATUSES` the item list derives from, so detach
   * and the derivation agree on what a project item is. Without it a PENDING or CANCELLED
   * borrow — a row the hub never showed — is still a valid target and answers 204 for something
   * that was never there; with it, the invisible row 404s like any other unknown item.
   */
  async detachItem(projectId: string, borrowRequestId: string, tx?: Tx): Promise<number> {
    const writer: Db | Tx = tx ?? this.db;
    const result = await writer
      .updateTable('borrow_requests')
      .set({ project_id: null })
      .where('id', '=', borrowRequestId)
      .where('project_id', '=', projectId)
      .where('status', 'in', [...VISIBLE_STATUSES])
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async listProjects(query: PaginationQuery) {
    const offset = (query.page - 1) * query.limit;
    const rows = await this.db
      .selectFrom('projects')
      .select(['id', 'name', 'is_active', 'created_at'])
      .where('is_active', '=', true)
      .orderBy('name')
      .orderBy('id')
      .limit(query.limit)
      .offset(offset)
      .execute();

    const counted = await this.db
      .selectFrom('projects')
      .where('is_active', '=', true)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return { rows, total: Number(counted?.count ?? 0) };
  }

  async findById(id: string) {
    return this.db
      .selectFrom('projects')
      .select(['id', 'name', 'is_active', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirst();
  }
}
