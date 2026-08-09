import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import {
  ApprovalAction,
  Role,
  ApprovalStage,
  RequisitionStatus,
  type Approval,
  type ListRequisitionsQuery,
  type Paginated,
  type Requisition,
  type RequisitionDetail,
  type RequisitionEvent,
  type RequisitionItem,
  type RequisitionItemInput,
  type SaveRequisitionInput,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';

type Tx = Transaction<Database> | Db;

/** NUMERIC arrives from pg as a string so it never passes through a float. */
const money = (value: string | null): number | null => (value === null ? null : Number(value));

/**
 * The DB CHECK constraint requires both `transportation_cost` and `transportation_description`
 * to be null or both non-null. The web form treats `0` as "not set" and clears the description;
 * a client that sends `cost: 0` with `description: null` would otherwise hit the constraint
 * and surface as a 500. Map both `null` and `0` to `null` here so the DB rule stays in sync
 * with what the form promises.
 */
function normalizeTransportation(input: SaveRequisitionInput): {
  transportationCost: string | null;
  transportationDescription: string | null;
} {
  const cost = input.transportationCost;
  if (cost === null || cost === undefined || cost === 0) {
    return { transportationCost: null, transportationDescription: null };
  }
  return {
    transportationCost: String(cost),
    transportationDescription: input.transportationDescription ?? null,
  };
}

@Injectable()
export class RequisitionsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findById(id: string) {
    return this.db.selectFrom('requisitions').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /**
   * Serialises everyone acting on one requisition. `decide` and `withdraw` both read the
   * requisition's status, then write it — two approvers acting in the same second would
   * otherwise each read the other's "before" and the second commit would erase the first
   * (a withdrawal silently reinstated as APPROVED, §7.3.4).
   *
   * Must be the first statement in the transaction, so the lock is held for the whole decision.
   */
  async lockRequisition(tx: Tx, id: string) {
    return tx
      .selectFrom('requisitions')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
  }

  async findItems(id: string) {
    return this.db
      .selectFrom('requisition_items')
      .selectAll()
      .where('requisition_id', '=', id)
      .orderBy('created_at')
      .execute();
  }

  async findApproval(id: string) {
    return this.db
      .selectFrom('requisition_approvals')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Repoint the supporting-document FK. The caller must already have inserted the new
   * `stored_files` row (so the FK is satisfied) and verified that the requisition is
   * still in DRAFT — the row's CHECK there is the structural guarantee, not this one.
   */
  async setSupportingDocumentFileId(id: string, fileId: string | null, tx: Tx = this.db) {
    await tx
      .updateTable('requisitions')
      .set({ supporting_document_file_id: fileId })
      .where('id', '=', id)
      .execute();
  }

  /**
   * `excludeUserId` keeps a requester out of their own approval chain — requirements §10
   * forbids approving your own requisition, and the Inventory Manager stage is an approval
   * stage like any other.
   */
  async findAnyActiveUserWithRole(
    role: Role,
    excludeUserId?: string,
  ): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .where('users.is_active', '=', true)
      .where('user_roles.role', '=', role)
      .$if(excludeUserId !== undefined, (qb) => qb.where('users.id', '!=', excludeUserId!))
      .select('users.id')
      .orderBy('users.created_at')
      .executeTakeFirst();
    return row?.id;
  }

  /** Cheap guard for the sub-threshold approver path (Phase 05). */
  async isUserActive(userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('users')
      .where('id', '=', userId)
      .select('is_active')
      .executeTakeFirst();
    return row?.is_active ?? false;
  }

  async insertDraft(
    tx: Tx,
    requisitionNo: string,
    input: SaveRequisitionInput,
    requesterId: string,
  ): Promise<string> {
    const { transportationCost, transportationDescription } = normalizeTransportation(input);
    const row = await tx
      .insertInto('requisitions')
      .values({
        requisition_no: requisitionNo,
        requester_id: requesterId,
        department_id: input.departmentId,
        project_id: input.projectId,
        urgency: input.urgency,
        approval_deadline: input.approvalDeadline,
        reason: input.reason,
        // Money columns accept `string | null`; null clears them. The CHECK constraints reject a
        // cost without a description and vice-versa, which Zod also enforces upstream.
        transportation_cost: transportationCost,
        transportation_description: transportationDescription,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateDraft(tx: Tx, id: string, input: SaveRequisitionInput): Promise<void> {
    const { transportationCost, transportationDescription } = normalizeTransportation(input);
    await tx
      .updateTable('requisitions')
      .set({
        department_id: input.departmentId,
        project_id: input.projectId,
        urgency: input.urgency,
        approval_deadline: input.approvalDeadline,
        reason: input.reason,
        transportation_cost: transportationCost,
        transportation_description: transportationDescription,
      })
      .where('id', '=', id)
      .execute();
  }

  /** Replace rather than diff: a draft's lines are edited as a set, not row by row. */
  async replaceItems(tx: Tx, id: string, items: RequisitionItemInput[]): Promise<void> {
    await tx.deleteFrom('requisition_items').where('requisition_id', '=', id).execute();
    if (items.length === 0) return;

    await tx
      .insertInto('requisition_items')
      .values(
        items.map((item) => ({
          requisition_id: id,
          product_id: item.productId,
          item_name: item.itemName,
          quantity: item.quantity,
          estimated_unit_price: item.estimatedUnitPrice,
          note: item.note,
        })),
      )
      .execute();
  }

  async markSubmitted(
    tx: Tx,
    id: string,
    values: {
      requestedAmount: number;
      approvedAmount: number;
      requiredApproverCount: number;
      thresholdAtSubmit: number;
      status: RequisitionStatus;
    },
  ): Promise<void> {
    await tx
      .updateTable('requisitions')
      .set({
        requested_amount: values.requestedAmount,
        approved_amount: values.approvedAmount,
        required_approver_count: values.requiredApproverCount,
        threshold_at_submit: values.thresholdAtSubmit,
        status: values.status,
        submitted_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Snapshots what the register held at submit, so the IM sees the same numbers the requester
   * did. Recomputing later would show today's stock next to a months-old request.
   */
  async freezeInStockQuantities(tx: Tx, id: string): Promise<void> {
    await sql`
      UPDATE requisition_items ri
      SET in_stock_qty_at_submit = COALESCE((
        SELECT SUM(sp.quantity - sp.reserved_qty)::int
        FROM stock_placements sp
        WHERE sp.product_id = ri.product_id
      ), 0)
      WHERE ri.requisition_id = ${id} AND ri.product_id IS NOT NULL
    `.execute(tx);
  }

  async insertApproval(
    tx: Tx,
    values: { requisitionId: string; stage: string; slot: number; assignedUserId: string },
  ): Promise<void> {
    await tx
      .insertInto('requisition_approvals')
      .values({
        requisition_id: values.requisitionId,
        stage: values.stage,
        slot: values.slot,
        assigned_user_id: values.assignedUserId,
      })
      .execute();
  }

  /**
   * Conditional on the approval still being in the expected state. Two approvers acting at the
   * same instant must not both proceed; zero rows updated is how the loser finds out.
   */
  async claimApproval(
    id: string,
    values: {
      action: string;
      actedBy: string;
      note: string | null;
      /** Prior actions this claim may transition from. Defaults to just PENDING. */
      expectedActions?: string[];
      /**
       * Snapshot of the signature used, resolved by the service before the claim. Frozen here
       * so a later signature change cannot alter what this approval was signed with.
       */
      signedWithSignature?: boolean;
      signatureFileId?: string | null;
    },
    /**
     * The caller's transaction. Not optional in practice: claiming on the pool auto-commits
     * the claim, so a later failure inside the caller's transaction leaves an approval marked
     * decided against a requisition whose status, event log and audit row never happened —
     * and `expectedActions` no longer matches, so nobody can decide it again.
     */
    executor: Tx = this.db,
  ): Promise<boolean> {
    const result = await executor
      .updateTable('requisition_approvals')
      .set({
        action: values.action,
        acted_by_user_id: values.actedBy,
        signed_with_signature: values.signedWithSignature ?? false,
        signature_file_id: values.signatureFileId ?? null,
        note: values.note,
        acted_at: new Date(),
      })
      .where('id', '=', id)
      .where('action', 'in', values.expectedActions ?? [ApprovalAction.PENDING])
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0n) === 1;
  }

  async setStatus(
    tx: Tx,
    id: string,
    status: RequisitionStatus,
    markDecided: boolean,
  ): Promise<void> {
    await tx
      .updateTable('requisitions')
      .set({ status, ...(markDecided ? { decided_at: new Date() } : { decided_at: null }) })
      .where('id', '=', id)
      .execute();
  }

  async setApprovedAmount(tx: Tx, id: string, amount: number): Promise<void> {
    await tx
      .updateTable('requisitions')
      .set({ approved_amount: amount })
      .where('id', '=', id)
      .execute();
  }

  /** Counted from the rows rather than a tally column, so it cannot drift out of step. */
  async countOutstandingApprovers(tx: Tx, requisitionId: string): Promise<number> {
    const row = await tx
      .selectFrom('requisition_approvals')
      .where('requisition_id', '=', requisitionId)
      .where('stage', '=', ApprovalStage.APPROVER)
      .where('action', '!=', ApprovalAction.APPROVED)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async appendEvent(
    tx: Tx,
    requisitionId: string,
    eventType: string,
    actorId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx
      .insertInto('requisition_events')
      .values({
        requisition_id: requisitionId,
        event_type: eventType,
        actor_id: actorId,
        payload: JSON.stringify(payload),
      })
      .execute();
  }

  /* --------------------------------------------------------------- reads */

  private baseSelect() {
    return this.db
      .selectFrom('requisitions')
      .innerJoin('users as requester', 'requester.id', 'requisitions.requester_id')
      .leftJoin('departments', 'departments.id', 'requisitions.department_id')
      .leftJoin('projects', 'projects.id', 'requisitions.project_id')
      .leftJoin(
        'stored_files as supporting_document',
        'supporting_document.id',
        'requisitions.supporting_document_file_id',
      )
      .select([
        'requisitions.id',
        'requisitions.requisition_no',
        'requisitions.requester_id',
        'requester.full_name as requester_name',
        'requisitions.department_id',
        'departments.name as department_name',
        'requisitions.project_id',
        'projects.name as project_name',
        'requisitions.urgency',
        'requisitions.approval_deadline',
        'requisitions.reason',
        'requisitions.requested_amount',
        'requisitions.approved_amount',
        'requisitions.required_approver_count',
        'requisitions.threshold_at_submit',
        'requisitions.status',
        'requisitions.submitted_at',
        'requisitions.decided_at',
        'requisitions.supporting_document_file_id',
        'supporting_document.original_name as supporting_document_original_name',
        'supporting_document.mime_type as supporting_document_mime_type',
        'supporting_document.size_bytes as supporting_document_size_bytes',
        'supporting_document.created_at as supporting_document_uploaded_at',
        'requisitions.transportation_cost',
        'requisitions.transportation_description',
        'requisitions.created_at',
        'requisitions.updated_at',
      ]);
  }

  async findDetail(id: string): Promise<RequisitionDetail | undefined> {
    const row = await this.baseSelect().where('requisitions.id', '=', id).executeTakeFirst();
    if (!row) return undefined;

    const [items, approvals, events] = await Promise.all([
      this.listItems(id),
      this.listApprovals(id),
      this.listEvents(id),
    ]);

    const base = toRequisition(row);
    const supportingDocument =
      row.supporting_document_file_id && row.supporting_document_original_name
        ? {
            fileId: row.supporting_document_file_id,
            originalName: row.supporting_document_original_name,
            mimeType: row.supporting_document_mime_type!,
            sizeBytes: row.supporting_document_size_bytes!,
            uploadedAt: row.supporting_document_uploaded_at!.toISOString(),
          }
        : null;

    return {
      ...base,
      items,
      approvals,
      events,
      supportingDocument,
      // URL is built by the controller so the repo stays HTTP-free.
      supportingDocumentUrl: null,
    };
  }

  async listItems(requisitionId: string): Promise<RequisitionItem[]> {
    const rows = await this.db
      .selectFrom('requisition_items')
      .selectAll()
      .where('requisition_id', '=', requisitionId)
      .orderBy('created_at')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      itemName: row.item_name,
      quantity: row.quantity,
      estimatedUnitPrice: Number(row.estimated_unit_price),
      estimatedLineTotal: Number(row.estimated_line_total),
      inStockQtyAtSubmit: row.in_stock_qty_at_submit,
      note: row.note,
    }));
  }

  async listApprovals(requisitionId: string): Promise<Approval[]> {
    const rows = await this.db
      .selectFrom('requisition_approvals')
      .innerJoin('users as assignee', 'assignee.id', 'requisition_approvals.assigned_user_id')
      .leftJoin('users as actor', 'actor.id', 'requisition_approvals.acted_by_user_id')
      .where('requisition_approvals.requisition_id', '=', requisitionId)
      .select([
        'requisition_approvals.id',
        'requisition_approvals.stage',
        'requisition_approvals.slot',
        'requisition_approvals.assigned_user_id',
        'assignee.full_name as assignee_name',
        'assignee.designation as assignee_designation',
        'requisition_approvals.acted_by_user_id',
        'actor.full_name as actor_name',
        'requisition_approvals.action',
        'requisition_approvals.note',
        'requisition_approvals.acted_at',
      ])
      // IM first, then approvers by slot — the order the chain is actually walked.
      .orderBy('requisition_approvals.stage')
      .orderBy('requisition_approvals.slot')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      stage: row.stage as Approval['stage'],
      slot: row.slot,
      assignedUserId: row.assigned_user_id,
      assignedUserName: row.assignee_name,
      assignedUserDesignation: row.assignee_designation,
      actedByUserId: row.acted_by_user_id,
      actedByUserName: row.actor_name,
      action: row.action as Approval['action'],
      note: row.note,
      actedAt: row.acted_at ? row.acted_at.toISOString() : null,
    }));
  }

  async listEvents(requisitionId: string): Promise<RequisitionEvent[]> {
    const rows = await this.db
      .selectFrom('requisition_events')
      .leftJoin('users', 'users.id', 'requisition_events.actor_id')
      .where('requisition_events.requisition_id', '=', requisitionId)
      .select([
        'requisition_events.id',
        'requisition_events.event_type',
        'requisition_events.actor_id',
        'users.full_name as actor_name',
        'requisition_events.payload',
        'requisition_events.created_at',
      ])
      .orderBy('requisition_events.id')
      .execute();

    return rows.map((row) => ({
      id: String(row.id),
      eventType: row.event_type,
      actorId: row.actor_id,
      actorName: row.actor_name,
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async list(
    query: ListRequisitionsQuery,
    context: { actorId: string; restrictToRequester: boolean },
  ): Promise<Paginated<Requisition>> {
    const offset = (query.page - 1) * query.limit;

    const applyFilters = <T extends ReturnType<typeof this.baseSelect>>(qb: T) =>
      qb
        .$if(context.restrictToRequester || query.mine, (b) =>
          b.where('requisitions.requester_id', '=', context.actorId),
        )
        .$if(query.status !== undefined, (b) =>
          b.where('requisitions.status', '=', query.status!),
        )
        // Project Hub (task 4): requisitions charged to one project. Applied here, inside the
        // shared closure, so the row query and the count query never disagree on the total.
        .$if(query.projectId !== undefined, (b) =>
          b.where('requisitions.project_id', '=', query.projectId!),
        )
        // "Waiting on me": an approval assigned to me, or to someone I am standing in for.
        .$if(query.awaitingMe, (b) =>
          b.where((eb) =>
            eb.exists(
              eb
                .selectFrom('requisition_approvals as ra')
                .select('ra.id')
                .whereRef('ra.requisition_id', '=', 'requisitions.id')
                .where('ra.action', '=', ApprovalAction.PENDING)
                .where((inner) =>
                  inner.or([
                    inner('ra.assigned_user_id', '=', context.actorId),
                    inner.exists(
                      inner
                        .selectFrom('delegations as d')
                        .select('d.id')
                        .whereRef('d.approver_user_id', '=', 'ra.assigned_user_id')
                        .where('d.delegate_user_id', '=', context.actorId)
                        .where('d.is_active', '=', true)
                        .where('d.starts_at', '<=', sql<Date>`now()`)
                        .where('d.ends_at', '>', sql<Date>`now()`),
                    ),
                  ]),
                )
                // Only actionable stages, so the queue never shows something you cannot act on.
                .where((inner) =>
                  inner.or([
                    inner.and([
                      inner('ra.stage', '=', ApprovalStage.INVENTORY_MANAGER),
                      inner('requisitions.status', '=', RequisitionStatus.IM_REVIEW),
                    ]),
                    inner.and([
                      inner('ra.stage', '=', ApprovalStage.APPROVER),
                      inner('requisitions.status', '=', RequisitionStatus.AWAITING_APPROVAL),
                    ]),
                  ]),
                ),
            ),
          ),
        )
        .$if(query.search !== undefined && query.search.length > 0, (b) =>
          b.where((eb) =>
            eb.or([
              eb(sql`lower(requisitions.requisition_no)`, 'like', `%${query.search!.toLowerCase()}%`),
              eb(sql`lower(requester.full_name)`, 'like', `%${query.search!.toLowerCase()}%`),
              eb(sql`lower(coalesce(requisitions.reason, ''))`, 'like', `%${query.search!.toLowerCase()}%`),
            ]),
          ),
        );

    const rows = await applyFilters(this.baseSelect())
      // Most recent activity, not creation date (task 3.8).
      .orderBy('requisitions.updated_at', 'desc')
      .limit(query.limit)
      .offset(offset)
      .execute();

    const counted = await applyFilters(this.baseSelect())
      .clearSelect()
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return {
      items: rows.map(toRequisition),
      page: query.page,
      limit: query.limit,
      total: Number(counted?.count ?? 0),
    };
  }

  async countAwaiting(actorId: string): Promise<number> {
    const result = await this.list(
      { page: 1, limit: 1, mine: false, awaitingMe: true },
      { actorId, restrictToRequester: false },
    );
    return result.total;
  }
}

interface RequisitionRow {
  id: string;
  requisition_no: string;
  requester_id: string;
  requester_name: string;
  department_id: string | null;
  department_name: string | null;
  project_id: string | null;
  project_name: string | null;
  urgency: string;
  approval_deadline: Date | string | null;
  reason: string | null;
  requested_amount: string | null;
  approved_amount: string | null;
  required_approver_count: number | null;
  threshold_at_submit: string | null;
  status: string;
  submitted_at: Date | null;
  decided_at: Date | null;
  supporting_document_file_id: string | null;
  /** Joined from `stored_files`. Null when no document is attached. */
  supporting_document_original_name: string | null;
  supporting_document_mime_type: string | null;
  supporting_document_size_bytes: number | null;
  supporting_document_uploaded_at: Date | null;
  transportation_cost: string | null;
  transportation_description: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRequisition(row: RequisitionRow): Requisition {
  const deadline = row.approval_deadline
    ? typeof row.approval_deadline === 'string'
      ? row.approval_deadline
      : row.approval_deadline.toISOString().slice(0, 10)
    : null;

  const awaitingDecision: string[] = [
    RequisitionStatus.IM_REVIEW,
    RequisitionStatus.AWAITING_APPROVAL,
  ];

  return {
    id: row.id,
    requisitionNo: row.requisition_no,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    projectId: row.project_id,
    projectName: row.project_name,
    urgency: row.urgency as Requisition['urgency'],
    approvalDeadline: deadline,
    reason: row.reason,
    requestedAmount: money(row.requested_amount),
    approvedAmount: money(row.approved_amount),
    requiredApproverCount: row.required_approver_count,
    thresholdAtSubmit: money(row.threshold_at_submit),
    status: row.status as Requisition['status'],
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    transportationCost: money(row.transportation_cost),
    transportationDescription: row.transportation_description,
    // Derived, never stored: a persisted flag is wrong the moment the date rolls over.
    isOverdue:
      awaitingDecision.includes(row.status) &&
      deadline !== null &&
      deadline < new Date().toISOString().slice(0, 10),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
