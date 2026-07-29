import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import {
  ApprovalAction,
  ApprovalStage,
  RequisitionEventType,
  RequisitionStatus,
  Role,
  SettingKey,
  WITHDRAWABLE_STATUSES,
  type DecideRequisitionInput,
  type SaveRequisitionInput,
  type WithdrawApprovalInput,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import { SettingsService } from '../settings/settings.service';
import { ApproverSlotsService } from '../settings/approver-slots.service';
import { RequisitionsRepository } from './requisitions.repository';
import { DelegationsService } from './delegations.service';
import {
  ApprovalAlreadyActedError,
  ApproverSlotUnassignedError,
  InvalidRequisitionTransitionError,
  NotYourApprovalError,
} from './requisitions.errors';

@Injectable()
export class RequisitionsService {
  private readonly logger = new Logger(RequisitionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: RequisitionsRepository,
    private readonly settings: SettingsService,
    private readonly approverSlots: ApproverSlotsService,
    private readonly delegations: DelegationsService,
  ) {}

  async createDraft(input: SaveRequisitionInput, requesterId: string) {
    const id = await this.db.transaction().execute(async (tx) => {
      const requisitionNo = await this.nextRequisitionNo(tx);
      const created = await this.repo.insertDraft(tx, requisitionNo, input, requesterId);
      await this.repo.replaceItems(tx, created, input.items);
      await this.repo.appendEvent(tx, created, RequisitionEventType.CREATED, requesterId, {});
      return created;
    });

    return this.requireDetail(id);
  }

  async updateDraft(id: string, input: SaveRequisitionInput, actorId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Requisition');
    if (existing.requester_id !== actorId) {
      throw new ForbiddenError('You can only edit your own requisition');
    }
    // Once submitted the figures are frozen; editing would silently change what was approved.
    if (existing.status !== RequisitionStatus.DRAFT) {
      throw new InvalidRequisitionTransitionError(existing.status as RequisitionStatus, 'edited');
    }

    await this.db.transaction().execute(async (tx) => {
      await this.repo.updateDraft(tx, id, input);
      await this.repo.replaceItems(tx, id, input.items);
    });

    return this.requireDetail(id);
  }

  /**
   * Submitting is the moment everything freezes.
   *
   * `requested_amount`, `threshold_at_submit` and `required_approver_count` are written once,
   * from the settings as they are *right now*, and never recomputed. An admin raising the
   * expense threshold next week must not retroactively add an approver to a request already
   * halfway through its chain (requirements §11) — and a year later, this row still explains
   * why it needed the approvers it did.
   *
   * The approval rows are seeded here too, for the same reason: resolving approvers lazily at
   * each stage would mean a staffing change mid-flight silently reroutes an in-progress request.
   */
  async submit(id: string, actorId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Requisition');
    if (existing.requester_id !== actorId) {
      throw new ForbiddenError('You can only submit your own requisition');
    }
    if (existing.status !== RequisitionStatus.DRAFT) {
      throw new InvalidRequisitionTransitionError(existing.status as RequisitionStatus, 'submitted');
    }

    const items = await this.repo.findItems(id);
    if (items.length === 0) throw new ConflictError('Add at least one item before submitting');

    const requestedAmount = items.reduce((sum, item) => sum + Number(item.estimated_line_total), 0);

    const threshold = await this.settings.get(SettingKey.EXPENSE_THRESHOLD_BDT);
    // OQ-01: one approver below the threshold, two at or above it. Both counts are settings,
    // so the policy changes without a redeploy.
    const approverCount =
      requestedAmount >= threshold
        ? await this.settings.get(SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD)
        : await this.settings.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD);

    // OQ-02: the department's slots win over the company-wide default.
    const approverIds = await this.approverSlots
      .resolveForDepartment(existing.department_id, approverCount)
      .catch(() => {
        throw new ApproverSlotUnassignedError(approverCount);
      });

    const inventoryManagerId = await this.repo.findAnyActiveUserWithRole(Role.INVENTORY_MANAGER);
    if (!inventoryManagerId) {
      throw new ConflictError('No active Inventory Manager exists to review this requisition');
    }

    await this.db.transaction().execute(async (tx) => {
      await this.repo.markSubmitted(tx, id, {
        requestedAmount,
        // Defaults to requested; an approver may revise it down later (domain-context.md).
        approvedAmount: requestedAmount,
        requiredApproverCount: approverCount,
        thresholdAtSubmit: threshold,
        // The IM reviews first: "confirmed, we don't have this" before anyone spends money.
        status: RequisitionStatus.IM_REVIEW,
      });

      await this.repo.freezeInStockQuantities(tx, id);

      await this.repo.insertApproval(tx, {
        requisitionId: id,
        stage: ApprovalStage.INVENTORY_MANAGER,
        slot: 1,
        assignedUserId: inventoryManagerId,
      });

      for (const [index, approverId] of approverIds.entries()) {
        await this.repo.insertApproval(tx, {
          requisitionId: id,
          stage: ApprovalStage.APPROVER,
          slot: index + 1,
          assignedUserId: approverId,
        });
      }

      await this.repo.appendEvent(tx, id, RequisitionEventType.SUBMITTED, actorId, {
        requestedAmount,
        thresholdAtSubmit: threshold,
        requiredApproverCount: approverCount,
      });
    });

    this.logger.log(
      `Requisition ${existing.requisition_no} submitted: ${requestedAmount} BDT, ` +
        `${approverCount} approver(s) at threshold ${threshold}`,
    );
    return this.requireDetail(id);
  }

  /**
   * One approval decision.
   *
   * The rules that matter, from domain-context.md:
   *   - the IM acts first; approvers only become actionable once the IM has approved
   *   - approvers act in parallel, in no fixed order
   *   - **any single rejection is terminal** — it does not need both
   */
  async decide(approvalId: string, input: DecideRequisitionInput, actorId: string) {
    const approval = await this.repo.findApproval(approvalId);
    if (!approval) throw new NotFoundError('Approval');

    // A delegate may act on the assignee's behalf, but only inside a live delegation.
    const actingFor = await this.resolveActingFor(approval.assigned_user_id, actorId);
    if (!actingFor) throw new NotYourApprovalError();

    const requisition = await this.repo.findById(approval.requisition_id);
    if (!requisition) throw new NotFoundError('Requisition');

    this.assertStageIsActionable(approval.stage, requisition.status as RequisitionStatus);

    const nextAction = input.approve ? ApprovalAction.APPROVED : ApprovalAction.REJECTED;

    // Conditional on the row still being PENDING — two approvers clicking at once must not
    // both proceed, and zero rows updated is how the loser finds out (§7.3.4).
    const claimed = await this.repo.claimApproval(approvalId, {
      action: nextAction,
      actedBy: actorId,
      note: input.note,
      // WITHDRAWN is decidable again: withdrawing exists precisely so the approver can think
      // again and then act. The row carries its latest state; the event log carries the history.
      expectedActions: [ApprovalAction.PENDING, ApprovalAction.WITHDRAWN],
    });
    if (!claimed) throw new ApprovalAlreadyActedError();

    await this.db.transaction().execute(async (tx) => {
      const isIm = approval.stage === ApprovalStage.INVENTORY_MANAGER;

      if (!input.approve) {
        // Terminal. One rejection kills the whole request, whatever anyone else has said.
        await this.repo.setStatus(tx, approval.requisition_id, RequisitionStatus.REJECTED, true);
        await this.repo.appendEvent(
          tx,
          approval.requisition_id,
          isIm ? RequisitionEventType.IM_REJECTED : RequisitionEventType.APPROVER_REJECTED,
          actorId,
          { note: input.note, stage: approval.stage, slot: approval.slot },
        );
        return;
      }

      if (isIm) {
        await this.repo.setStatus(
          tx,
          approval.requisition_id,
          RequisitionStatus.AWAITING_APPROVAL,
          false,
        );
        await this.repo.appendEvent(
          tx,
          approval.requisition_id,
          RequisitionEventType.IM_APPROVED,
          actorId,
          { note: input.note },
        );
        return;
      }

      if (input.approvedAmount !== null) {
        await this.repo.setApprovedAmount(tx, approval.requisition_id, input.approvedAmount);
        await this.repo.appendEvent(
          tx,
          approval.requisition_id,
          RequisitionEventType.AMOUNT_REVISED,
          actorId,
          { approvedAmount: input.approvedAmount },
        );
      }

      await this.repo.appendEvent(
        tx,
        approval.requisition_id,
        RequisitionEventType.APPROVER_APPROVED,
        actorId,
        { note: input.note, slot: approval.slot },
      );

      // Fully approved only when every approver slot has said yes. Counted from the rows
      // rather than from a tally column, so it cannot drift.
      const outstanding = await this.repo.countOutstandingApprovers(tx, approval.requisition_id);
      if (outstanding === 0) {
        await this.repo.setStatus(tx, approval.requisition_id, RequisitionStatus.APPROVED, true);
        await this.repo.appendEvent(
          tx,
          approval.requisition_id,
          RequisitionEventType.FULLY_APPROVED,
          actorId,
          {},
        );
      }
    });

    return this.requireDetail(approval.requisition_id);
  }

  /**
   * An approver taking their approval back. Legal until the BOM is generated
   * (domain-context.md), which is why the guard is on the requisition's status rather than on
   * a timestamp.
   */
  async withdraw(approvalId: string, input: WithdrawApprovalInput, actorId: string) {
    const approval = await this.repo.findApproval(approvalId);
    if (!approval) throw new NotFoundError('Approval');

    const actingFor = await this.resolveActingFor(approval.assigned_user_id, actorId);
    if (!actingFor) throw new NotYourApprovalError();

    if (approval.action !== ApprovalAction.APPROVED) {
      throw new ConflictError('Only an approval that was granted can be withdrawn');
    }

    const requisition = await this.repo.findById(approval.requisition_id);
    if (!requisition) throw new NotFoundError('Requisition');
    if (!WITHDRAWABLE_STATUSES.includes(requisition.status as RequisitionStatus)) {
      throw new InvalidRequisitionTransitionError(
        requisition.status as RequisitionStatus,
        'withdrawn from',
      );
    }

    const claimed = await this.repo.claimApproval(approvalId, {
      action: ApprovalAction.WITHDRAWN,
      actedBy: actorId,
      note: input.reason,
      expectedActions: [ApprovalAction.APPROVED],
    });
    if (!claimed) throw new ApprovalAlreadyActedError();

    await this.db.transaction().execute(async (tx) => {
      // Back to awaiting approval: the chain is incomplete again, whatever it was before.
      await this.repo.setStatus(
        tx,
        approval.requisition_id,
        RequisitionStatus.AWAITING_APPROVAL,
        false,
      );
      await this.repo.appendEvent(
        tx,
        approval.requisition_id,
        RequisitionEventType.APPROVER_WITHDREW,
        actorId,
        { reason: input.reason, slot: approval.slot },
      );
    });

    return this.requireDetail(approval.requisition_id);
  }

  async cancel(id: string, actorId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Requisition');
    if (existing.requester_id !== actorId) {
      throw new ForbiddenError('You can only cancel your own requisition');
    }

    const cancellable: string[] = [RequisitionStatus.DRAFT, RequisitionStatus.IM_REVIEW];
    if (!cancellable.includes(existing.status)) {
      throw new InvalidRequisitionTransitionError(existing.status as RequisitionStatus, 'cancelled');
    }

    await this.db.transaction().execute(async (tx) => {
      await this.repo.setStatus(tx, id, RequisitionStatus.CANCELLED, true);
      await this.repo.appendEvent(tx, id, RequisitionEventType.CANCELLED, actorId, {});
    });

    return this.requireDetail(id);
  }

  async requireDetail(id: string) {
    const detail = await this.repo.findDetail(id);
    if (!detail) throw new NotFoundError('Requisition');
    return detail;
  }

  /**
   * The IM gates the approvers. Letting an approver act during IM_REVIEW would defeat the whole
   * point of the IM going first — they are the one who knows whether we already have the item.
   */
  private assertStageIsActionable(stage: string, status: RequisitionStatus): void {
    if (stage === ApprovalStage.INVENTORY_MANAGER) {
      if (status !== RequisitionStatus.IM_REVIEW) {
        throw new InvalidRequisitionTransitionError(status, 'reviewed by the Inventory Manager');
      }
      return;
    }
    if (status !== RequisitionStatus.AWAITING_APPROVAL) {
      throw new InvalidRequisitionTransitionError(status, 'approved');
    }
  }

  /** Returns the assignee whose authority the actor is using, or null if they have none. */
  private async resolveActingFor(
    assignedUserId: string,
    actorId: string,
  ): Promise<string | null> {
    if (assignedUserId === actorId) return assignedUserId;
    const delegated = await this.delegations.isEffectiveDelegate(assignedUserId, actorId);
    return delegated ? assignedUserId : null;
  }

  private async nextRequisitionNo(tx: Db): Promise<string> {
    const row = await sql<{ n: string }>`SELECT nextval('requisition_no_seq') AS n`.execute(tx);
    return `REQ-${String(Number(row.rows[0]?.n ?? 1)).padStart(6, '0')}`;
  }
}
