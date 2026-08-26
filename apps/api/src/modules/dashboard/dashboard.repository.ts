import { Inject, Injectable } from '@nestjs/common';
import {
  APPROVAL_STANDING_STATUSES,
  BorrowStatus,
  OUTSTANDING_STATUSES,
  RequisitionStatus,
  ReturnCondition,
  type BorrowingRecord,
  type RequisitionRecord,
  type SpendRecord,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

/** Cents-level rounding, so every figure agrees with the NUMERIC(14,2) columns behind it. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: string | null | undefined): number {
  return value === null || value === undefined ? 0 : round2(Number(value));
}

/**
 * One person's own record. Three queries, one per block, each an aggregate over the rows that
 * justify it — nothing here is a stored counter that could drift from what it counts.
 *
 * Every query is scoped by the caller's own id. There is no per-user parameter to abuse because
 * there is no "view anyone" variant (ruling 2026-08-26: own figures only).
 */
@Injectable()
export class DashboardRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Counted with FILTER rather than six round trips. The statuses come from the shared enum and
   * `APPROVAL_STANDING_STATUSES`, so a new lifecycle status cannot silently fall out of the
   * "in flight" bucket without someone editing the list it is derived from.
   */
  async requisitionsFor(userId: string): Promise<RequisitionRecord> {
    const standing = APPROVAL_STANDING_STATUSES as readonly string[];
    const decided: readonly string[] = [
      ...standing,
      RequisitionStatus.REJECTED,
      RequisitionStatus.CANCELLED,
      RequisitionStatus.DRAFT,
    ];

    const row = await this.db
      .selectFrom('requisitions')
      .where('requester_id', '=', userId)
      .select((eb) => [
        // "Raised" excludes drafts: a draft has not been put to anybody.
        eb.fn
          .count<string>('id')
          .filterWhere('status', '!=', RequisitionStatus.DRAFT)
          .as('raised'),
        eb.fn.count<string>('id').filterWhere('status', 'in', standing).as('approved'),
        eb.fn
          .count<string>('id')
          .filterWhere('status', '=', RequisitionStatus.REJECTED)
          .as('rejected'),
        eb.fn
          .count<string>('id')
          .filterWhere('status', '=', RequisitionStatus.CANCELLED)
          .as('cancelled'),
        eb.fn.count<string>('id').filterWhere('status', '=', RequisitionStatus.DRAFT).as('drafts'),
        // Anything neither approved, refused, cancelled nor still a draft is somewhere in the
        // approval chain. Derived by exclusion so a new mid-chain status lands here by default
        // rather than vanishing from every total.
        eb.fn.count<string>('id').filterWhere('status', 'not in', decided).as('in_flight'),
      ])
      .executeTakeFirst();

    return {
      raised: Number(row?.raised ?? 0),
      approved: Number(row?.approved ?? 0),
      rejected: Number(row?.rejected ?? 0),
      cancelled: Number(row?.cancelled ?? 0),
      drafts: Number(row?.drafts ?? 0),
      inFlight: Number(row?.in_flight ?? 0),
    };
  }

  /**
   * Borrowing from this person's side.
   *
   * Two shapes in one result, and they are not interchangeable. The first three are **requests**
   * — how many times they took something out. The condition counts are **units**, because
   * returning three of five cables damaged is three damaged units on a single request, and
   * counting requests would report one.
   */
  async borrowingFor(userId: string): Promise<BorrowingRecord> {
    const issued = [
      BorrowStatus.ISSUED,
      BorrowStatus.PARTIALLY_RETURNED,
      BorrowStatus.RETURNED,
    ];

    const requests = await this.db
      .selectFrom('borrow_requests')
      .where('requester_id', '=', userId)
      .select((eb) => [
        // A pending or rejected request never put anything in anyone's hands.
        eb.fn.count<string>('id').filterWhere('status', 'in', issued).as('borrowed'),
        eb.fn
          .count<string>('id')
          .filterWhere('status', '=', BorrowStatus.RETURNED)
          .as('returned'),
        eb.fn
          .count<string>('id')
          .filterWhere('status', 'in', [...OUTSTANDING_STATUSES])
          .as('still_out'),
      ])
      .executeTakeFirst();

    const conditions = await this.db
      .selectFrom('borrow_returns')
      .innerJoin('borrow_requests', 'borrow_requests.id', 'borrow_returns.borrow_request_id')
      .where('borrow_requests.requester_id', '=', userId)
      .select((eb) => [
        eb.fn
          .sum<string>('borrow_returns.quantity')
          .filterWhere('borrow_returns.condition', '=', ReturnCondition.PARTIALLY_DAMAGED_USABLE)
          .as('partially_damaged'),
        eb.fn
          .sum<string>('borrow_returns.quantity')
          .filterWhere('borrow_returns.condition', '=', ReturnCondition.DAMAGED)
          .as('damaged'),
        eb.fn
          .sum<string>('borrow_returns.quantity')
          .filterWhere('borrow_returns.condition', '=', ReturnCondition.NOT_WORKING)
          .as('not_working'),
      ])
      .executeTakeFirst();

    return {
      borrowed: Number(requests?.borrowed ?? 0),
      returned: Number(requests?.returned ?? 0),
      stillOut: Number(requests?.still_out ?? 0),
      partiallyDamagedUnits: Number(conditions?.partially_damaged ?? 0),
      damagedUnits: Number(conditions?.damaged ?? 0),
      notWorkingUnits: Number(conditions?.not_working ?? 0),
    };
  }

  /**
   * What this person's requisitions have cost.
   *
   * `spent` is the sum of purchase totals, matching the Expenses report's own definition exactly
   * — two screens naming the same figure differently is how a number gets argued about instead of
   * used. Voided purchases are excluded (migration 0028).
   *
   * `approved_amount` is summed only over the statuses where the approval still stands, for the
   * same reason the report does it: the column is written at submit and survives a rejection, so
   * summing it unfiltered would report money nobody ever sanctioned (OQ-27).
   */
  async spendFor(userId: string): Promise<SpendRecord> {
    // Two queries rather than one with a correlated subquery: they aggregate over different
    // tables at different grains, and the builder keeps both checked against the schema. The
    // raw-SQL version of this had a status-enum-to-text[] cast that only failed at runtime.
    const [totals, purchased] = await Promise.all([
      this.db
        .selectFrom('requisitions')
        .where('requester_id', '=', userId)
        // A draft is not a request for money; it has not been put to anybody.
        .where('status', '!=', RequisitionStatus.DRAFT)
        .select((eb) => [
          eb.fn.sum<string>('requested_amount').as('requested'),
          eb.fn
            .sum<string>('approved_amount')
            .filterWhere('status', 'in', [...APPROVAL_STANDING_STATUSES])
            .as('approved'),
        ])
        .executeTakeFirst(),
      this.db
        .selectFrom('purchases')
        .innerJoin('requisitions', 'requisitions.id', 'purchases.requisition_id')
        .where('requisitions.requester_id', '=', userId)
        .where('purchases.voided_at', 'is', null)
        .select((eb) => eb.fn.sum<string>('purchases.total_amount').as('spent'))
        .executeTakeFirst(),
    ]);

    return {
      requested: money(totals?.requested),
      approved: money(totals?.approved),
      spent: money(purchased?.spent),
    };
  }
}
