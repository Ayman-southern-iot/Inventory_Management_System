import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { sql } from 'kysely';
import {
  ApprovalAction,
  ApprovalStage,
  RequisitionEventType,
  RequisitionStatus,
  Role,
  SettingKey,
  WITHDRAWABLE_STATUSES,
  type ApprovalPolicy,
  type DecideRequisitionInput,
  type SaveRequisitionInput,
  type WithdrawApprovalInput,
  missingForSubmit,
  type RequisitionSubmitField,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors';
import { documentNumber, nameTokenFor } from '../../common/document-number';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_LINKS } from '../notifications/notifications.links';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { ApproverSlotsService } from '../settings/approver-slots.service';
import { RequisitionsRepository } from './requisitions.repository';
import { FundsRepository } from '../funds/funds.repository';
import { DelegationsService } from './delegations.service';
import {
  ApprovalAlreadyActedError,
  ApprovalDeadlineInPastError,
  ApproverSlotUnassignedError,
  CannotSendBackForRevisionError,
  InvalidRequisitionTransitionError,
  RequisitionIncompleteError,
  NotYourApprovalError,
  ApprovedExceedsRequestedError,
  SelfApprovalForbiddenError,
  SignatureNotUploadedError,
  SubthresholdApproverUnassignedError,
} from './requisitions.errors';
import type { SendBackForRevisionInput } from '@ims/shared';

/**
 * Field key to the name the API says out loud. Deliberately not i18n: this is the message a
 * non-browser caller sees, and the SPA picks its own copy from the error code.
 */
const SUBMIT_FIELD_LABELS: Record<RequisitionSubmitField, string> = {
  departmentId: 'Department',
  approvalDeadline: 'Approval deadline',
  reason: 'Reason',
};

@Injectable()
export class RequisitionsService {
  private readonly logger = new Logger(RequisitionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: RequisitionsRepository,
    // Forward-ref: pairs with the same import on `RequisitionsRepository` — the modules are
    // mutually dependent now that `findDetail` reads `funding_snapshots` via the funds repo.
    @Inject(forwardRef(() => FundsRepository))
    private readonly fundsRepo: FundsRepository,
    private readonly settings: SettingsService,
    private readonly approverSlots: ApproverSlotsService,
    private readonly delegations: DelegationsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
  ) {}

  /**
   * The approval rules in force, for the form's live approver note.
   *
   * Reads the same settings `submit()` reads, so the number the requester is shown before
   * submitting is the number they will actually get. Anything that recomputed this
   * independently would eventually disagree with the server, and the requester would only find
   * out at the moment of submission.
   */
  async approvalPolicy(): Promise<ApprovalPolicy> {
    const [expenseThresholdBdt, approversBelowThreshold, approversAtOrAboveThreshold] =
      await Promise.all([
        this.settings.get(SettingKey.EXPENSE_THRESHOLD_BDT),
        this.settings.get(SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD),
        this.settings.get(SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD),
      ]);

    return { expenseThresholdBdt, approversBelowThreshold, approversAtOrAboveThreshold };
  }

  async createDraft(input: SaveRequisitionInput, requesterId: string) {
    const id = await this.db.transaction().execute(async (tx) => {
      const requisitionNo = await this.nextRequisitionNo(tx, requesterId);
      const created = await this.repo.insertDraft(tx, requisitionNo, input, requesterId);
      await this.repo.replaceItems(tx, created, input.items);

      // Pre-draft attach (orphan-upload flow). If the requester picked a file on the empty form,
      // claim it now — same transaction as the row insert, same `lockRequisition`-equivalent
      // ownership check the existing attach path uses. The FK repoint and the `pending_claim_by`
      // null commit together; if either fails, the orphan is still pending and the sweep will
      // catch it.
      let claimedFileId: string | null = null;
      if (input.pendingSupportingDocumentId) {
        const orphan = await tx
          .selectFrom('stored_files')
          .select(['id', 'pending_claim_by', 'kind', 'original_name'])
          .where('id', '=', input.pendingSupportingDocumentId)
          .executeTakeFirst();
        if (!orphan || orphan.kind !== 'SUPPORTING_DOCUMENT') {
          throw new ValidationFailedError({
            path: 'pendingSupportingDocumentId',
            message: 'Unknown supporting document.',
          });
        }
        if (orphan.pending_claim_by !== requesterId) {
          // Either another user's orphan (the audit row says who picked it) or already claimed.
          // We never leak which one — both are "you cannot claim this" from the caller's view.
          throw new ForbiddenError('You cannot claim this supporting document.');
        }
        await this.repo.setSupportingDocumentFileId(created, orphan.id, tx);
        await tx
          .updateTable('stored_files')
          .set({ pending_claim_by: null })
          .where('id', '=', orphan.id)
          .execute();
        claimedFileId = orphan.id;
      }

      await this.repo.appendEvent(tx, created, RequisitionEventType.CREATED, requesterId, {
        ...(claimedFileId ? { claimedSupportingDocumentId: claimedFileId } : {}),
      });
      await this.audit.record(
        {
          action: 'requisition.create',
          entityType: 'requisition',
          entityId: created,
          entityRef: requisitionNo,
          summary: `Drafted requisition ${requisitionNo}`,
          metadata: {
            urgency: input.urgency,
            itemCount: input.items.length,
            ...(claimedFileId ? { claimedSupportingDocumentId: claimedFileId } : {}),
          },
        },
        { actorId: requesterId, actorName: null, actorEmail: null, actorRoles: [], requestMethod: null, requestPath: null, requestIp: null, userAgent: null },
        tx,
      );
      if (claimedFileId) {
        await this.audit.record(
          {
            action: 'requisition.supporting_document_attached',
            entityType: 'requisition',
            entityId: created,
            entityRef: requisitionNo,
            summary: `Claimed a pre-draft supporting document on ${requisitionNo}`,
            metadata: { fileId: claimedFileId, via: 'claim-on-create' },
          },
          { actorId: requesterId, actorName: null, actorEmail: null, actorRoles: [], requestMethod: null, requestPath: null, requestIp: null, userAgent: null },
          tx,
        );
      }
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
      await this.audit.record(
        {
          action: 'requisition.update',
          entityType: 'requisition',
          entityId: id,
          entityRef: existing.requisition_no,
          summary: `Updated draft requisition ${existing.requisition_no}`,
          metadata: { urgency: input.urgency, itemCount: input.items.length },
        },
        { actorId: actorId, actorName: null, actorEmail: null, actorRoles: [], requestMethod: null, requestPath: null, requestIp: null, userAgent: null },
        tx,
      );
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

    // D-006, Ayman's ruling 2026-08-26. Required at *submit*, never at save: a draft is allowed
    // to be half-finished, which is the whole point of a draft. Project is not on this list —
    // no project means personal development, which is an answer and not an omission.
    //
    // The rule itself lives in `shared` so the form and this guard cannot drift on what
    // "required" means. The form refuses to send an incomplete submit at all; this stays as the
    // authority, because a form is a suggestion and an API is a rule.
    const missing = missingForSubmit({
      departmentId: existing.department_id,
      approvalDeadline: existing.approval_deadline ? String(existing.approval_deadline) : null,
      reason: existing.reason,
    });
    if (missing.length > 0) {
      throw new RequisitionIncompleteError(missing.map((field) => SUBMIT_FIELD_LABELS[field]));
    }

    /**
     * D-003: the field's helper text says the deadline cannot be in the past and the browser
     * enforces it; the API did not, so a requisition could be submitted already overdue and trip
     * the §5 reminder at the moment of submission.
     *
     * An instant comparison since migration 0027, per Ayman's ruling of 2026-08-26: "previous
     * time and date not accepted". A deadline of 09:00 today **is** in the past at 17:00 today,
     * which the old calendar-day comparison could not see — it passed anything dated today.
     *
     * No time zone arithmetic is needed any more, which is the quiet benefit of the column being
     * an instant: two instants compare directly, and there is no day boundary to get wrong.
     *
     * Submit only. A draft may hold a stale deadline its author has not revisited.
     */
    const deadline = existing.approval_deadline;
    if (deadline !== null && deadline.getTime() < Date.now()) {
      throw new ApprovalDeadlineInPastError(deadline.toISOString(), new Date().toISOString());
    }

    // Frozen at submit: items total + transportation cost. The cost is what the requester
    // entered (or 0 / null when they did not need any). The DB has already enforced the
    // both-or-neither constraint via Zod + a CHECK, so a non-null cost here is paired with
    // a non-null description.
    const itemsTotal = items.reduce((sum, item) => sum + Number(item.estimated_line_total), 0);
    const transportationCost = Number(existing.transportation_cost ?? 0);
    const requestedAmount = itemsTotal + transportationCost;

    const threshold = await this.settings.get(SettingKey.EXPENSE_THRESHOLD_BDT);

    // OQ-01: above the threshold we still pick from the configured approver-slot chain
    // (one or two, depending on the settings).
    //
    // Phase 05 — below the threshold we now read a single admin-designated approver
    // (SUBTHRESHOLD_APPROVER_USER_ID) instead of the historical "count + slot 1" setup.
    // That setup shared slot 1 with the at-or-above case, which made "below" brittle when
    // an admin reassigned the company default for slot 1.
    /**
     * Somebody raising a requisition does not approve their own stage — their stage is simply
     * not created. Ayman's ruling, 2026-09-01.
     *
     * This replaces substitution (OQ-07), which stood one other person in for the requester at
     * every stage they occupied. Substitution had a failure mode that made the system unusable
     * for the people who run it: with one Inventory Manager, that IM could never submit
     * anything at all — there was nobody to substitute, so submit refused outright.
     *
     * The comment that used to sit here cited "requirements §10: nobody approves their own
     * requisition". **No such rule exists.** The transcription's own notes say so: "No
     * self-approval rule. Nothing prohibits an approver approving their own request. The entire
     * substitution mechanism is derived." The citation was wrong and is removed rather than
     * moved.
     *
     * Skipped, not auto-approved: the audit trail never shows a person approving their own
     * money. The stage is absent, which is the honest record of what happened.
     */
    const isSubThreshold = requestedAmount < threshold;
    const approverIds: string[] = isSubThreshold
      ? await this.subthresholdApproverIds(existing.requester_id)
      : await (async () => {
          const approverCount = await this.settings.get(
            SettingKey.APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD,
          );
          const resolved = await this.approverSlots
            .resolveForDepartment(existing.department_id, approverCount)
            .catch(() => {
              throw new ApproverSlotUnassignedError(approverCount);
            });
          // Their own slot drops out; the others still have to sign. A two-approver
          // requisition raised by one of them needs the other one, not nobody.
          return resolved.filter((id) => id !== existing.requester_id);
        })();

    // For the at-or-above branch, `approverCount` is what we ask of the slot chain. We
    // expose it back to the caller for the audit log + the SUBMITTED event payload, which
    // has been downstream of this name for several releases.
    const approverCount = isSubThreshold ? 1 : approverIds.length;

    /**
     * The IM stage, unless the IM is the one asking.
     *
     * An IM raising their own requisition skips it: they are the person who would have checked
     * "do we already have this", and they know. Previously this looked for a *different* IM and
     * refused when there was none — so in an office with one Inventory Manager, that IM could
     * not raise a requisition at all.
     */
    const requesterIsInventoryManager = await this.repo.userHasRole(
      existing.requester_id,
      Role.INVENTORY_MANAGER,
    );

    const inventoryManagerId = requesterIsInventoryManager
      ? null
      : await this.repo.findAnyActiveUserWithRole(Role.INVENTORY_MANAGER);

    if (!requesterIsInventoryManager && !inventoryManagerId) {
      throw new ConflictError('No active Inventory Manager exists to review this requisition');
    }

    /**
     * Where it lands.
     *
     * Skipping stages can leave nothing to wait for: an Inventory Manager who is also the
     * designated sub-threshold approver, raising a small requisition of their own, has no stage
     * left. Ayman's ruling for that case (2026-09-01) is that it stands approved — it is below
     * the threshold and it is their own money to authorise.
     */
    const submitStatus =
      inventoryManagerId === null && approverIds.length === 0
        ? RequisitionStatus.APPROVED
        : inventoryManagerId === null
          ? RequisitionStatus.AWAITING_APPROVAL
          : RequisitionStatus.IM_REVIEW;

    await this.db.transaction().execute(async (tx) => {
      await this.repo.markSubmitted(tx, id, {
        requestedAmount,
        // Defaults to requested; an approver may revise it down later (domain-context.md).
        approvedAmount: requestedAmount,
        requiredApproverCount: approverCount,
        thresholdAtSubmit: threshold,
        status: submitStatus,
      });

      await this.repo.freezeInStockQuantities(tx, id);

      if (inventoryManagerId) {
        await this.repo.insertApproval(tx, {
          requisitionId: id,
          stage: ApprovalStage.INVENTORY_MANAGER,
          slot: 1,
          assignedUserId: inventoryManagerId,
        });
      }

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
      // Snapshot at submit — captures the frozen requested_amount (and the default
      // approved_amount, which mirrors requested until an approver revises it). No money
      // activity exists yet, so the rest are zero. Lives on the funds repo, not on
      // FundsService, to avoid a service-to-service import.
      const submitFigures = await this.fundsRepo.computeCurrentFunding(tx, id);
      await this.fundsRepo.insertSnapshot(tx, {
        requisitionId: id,
        status: submitStatus,
        requestedAmount: submitFigures.requestedAmount,
        approvedAmount: submitFigures.approvedAmount,
        transportation: submitFigures.transportation,
        funded: submitFigures.funded,
        spent: submitFigures.spent,
        returnedToAccounts: submitFigures.returned,
        unspent: submitFigures.unspent,
      });
      await this.audit.record(
        {
          action: 'requisition.submit',
          entityType: 'requisition',
          entityId: id,
          entityRef: existing.requisition_no,
          summary: `Submitted requisition ${existing.requisition_no}`,
          metadata: {
            requestedAmount,
            thresholdAtSubmit: threshold,
            requiredApproverCount: approverCount,
          },
        },
        { actorId: actorId, actorName: null, actorEmail: null, actorRoles: [], requestMethod: null, requestPath: null, requestIp: null, userAgent: null },
        tx,
      );

      /*
       * Told: whoever can act right now, and nobody else.
       *
       * Normally that is the IM alone — the approvers wait their turn and hear when the IM
       * clears it, because telling everyone at submit trains them to ignore the message. When
       * the IM is the requester their stage does not exist, so the approvers are up
       * immediately and are the ones to tell. When nothing is left to wait for, there is
       * nobody to notify and the requisition is already approved.
       */
      const awaiting = inventoryManagerId ? [inventoryManagerId] : approverIds;
      if (awaiting.length > 0) {
      await this.notifications.notify(
        {
          type: 'requisition.awaiting_your_approval',
          userIds: awaiting,
          ref: existing.requisition_no,
          link: NOTIFICATION_LINKS.requisition(id),
          entityType: 'requisition',
          entityId: id,
          actorId,
          actorName: null,
          context: {
            amount: String(requestedAmount),
          },
        },
        tx,
      );
      }
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

    const nextAction = input.approve ? ApprovalAction.APPROVED : ApprovalAction.REJECTED;
    // Read outside the transaction: it is display copy for the notification ("approved by Rana"),
    // not a value any decision depends on, so it must not extend the lock's lifetime.
    const actor = await this.users.findAuthRecordById(actorId);

    // Resolve the signature *before* the transaction, and refuse rather than silently approving
    // unsigned. Signing is only meaningful on an approval, so a rejection never carries one.
    const signWith = input.approve && input.withSignature;
    if (signWith && !actor?.signature_file_id) {
      throw new SignatureNotUploadedError();
    }
    const signatureFileId = signWith ? (actor?.signature_file_id ?? null) : null;

    await this.db.transaction().execute(async (tx) => {
      // Lock first, read second. Everything below decides based on the requisition's status,
      // so the status must not be able to change underneath us — the other approver's
      // decision, or a withdrawal, waits here until we commit.
      const requisition = await this.repo.lockRequisition(tx, approval.requisition_id);
      if (!requisition) throw new NotFoundError('Requisition');

      // requirements §10: nobody approves their own requisition. `submit` already keeps the
      // requester out of the chain, so reaching this means a row predating that rule or an
      // assignment changed since. Refusing here is what makes the rule an invariant rather than
      // a property of one code path — and a delegation must not become a way around it either.
      if (requisition.requester_id === actorId || requisition.requester_id === actingFor) {
        throw new SelfApprovalForbiddenError();
      }

      this.assertStageIsActionable(approval.stage, requisition.status as RequisitionStatus);

      // Conditional on the row still being PENDING — two approvers clicking at once must not
      // both proceed, and zero rows updated is how the loser finds out (§7.3.4). Inside the
      // transaction so the claim rolls back with everything else if any step below fails.
      const claimed = await this.repo.claimApproval(
        approvalId,
        {
          action: nextAction,
          actedBy: actorId,
          note: input.note,
          // WITHDRAWN is decidable again: withdrawing exists precisely so the approver can
          // think again and then act. The row carries its latest state; the event log carries
          // the history.
          expectedActions: [ApprovalAction.PENDING, ApprovalAction.WITHDRAWN],
          signedWithSignature: signWith,
          signatureFileId,
        },
        tx,
      );
      if (!claimed) throw new ApprovalAlreadyActedError();

      const isIm = approval.stage === ApprovalStage.INVENTORY_MANAGER;

      // Every branch below records this same audit row before it returns. Recording it once
      // here rather than at the end means the early-returning reject and IM branches cannot
      // silently skip it — which is exactly what they used to do.
      const recordDecision = () =>
        this.audit.record(
          {
            action: input.approve ? 'requisition.approve' : 'requisition.reject',
            entityType: 'requisition',
            entityId: approval.requisition_id,
            entityRef: requisition.requisition_no,
            summary: `${input.approve ? 'Approved' : 'Rejected'} requisition ${requisition.requisition_no} (${approval.stage})`,
            metadata: {
              stage: approval.stage,
              slot: approval.slot,
              decision: input.approve ? 'approve' : 'reject',
              note: input.note ?? null,
              approvedAmount: input.approvedAmount ?? null,
            },
          },
          { actorId: actorId, actorName: null, actorEmail: null, actorRoles: [], requestMethod: null, requestPath: null, requestIp: null, userAgent: null },
          tx,
        );

      // Common shape for every notification this method raises.
      const notifyOn = (
        type: Parameters<typeof this.notifications.notify>[0]['type'],
        userIds: readonly string[],
      ) =>
        this.notifications.notify(
          {
            type,
            userIds,
            ref: requisition.requisition_no,
            link: NOTIFICATION_LINKS.requisition(approval.requisition_id),
            entityType: 'requisition',
            entityId: approval.requisition_id,
            actorId,
            actorName: actor?.full_name ?? null,
            context: { note: input.note ?? null },
          },
          tx,
        );

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
        await recordDecision();
        // The requester is the only one who needs to act on this — it is dead for everyone else.
        await notifyOn('requisition.rejected', [requisition.requester_id]);
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
        // Snapshot at IM-approve. `approved_amount` is still the default (= requested)
        // because the IM stage does not revise the sanctioned amount; that's the
        // approvers' job. So the snapshot's approvedAmount mirrors requestedAmount here.
        const imFigures = await this.fundsRepo.computeCurrentFunding(
          tx,
          approval.requisition_id,
        );
        await this.fundsRepo.insertSnapshot(tx, {
          requisitionId: approval.requisition_id,
          status: RequisitionStatus.AWAITING_APPROVAL,
          requestedAmount: imFigures.requestedAmount,
          approvedAmount: imFigures.approvedAmount,
          transportation: imFigures.transportation,
          funded: imFigures.funded,
          spent: imFigures.spent,
          returnedToAccounts: imFigures.returned,
          unspent: imFigures.unspent,
        });
        await recordDecision();
        await notifyOn('requisition.im_approved', [requisition.requester_id]);
        // Now, and only now, the money approvers can act — so now is when they are told.
        await notifyOn(
          'requisition.awaiting_your_approval',
          await this.notifications.pendingApproversFor(approval.requisition_id, tx),
        );
        return;
      }

      if (input.approvedAmount !== null) {
        // Ayman's ruling, 2026-08-20: approved may not exceed requested. Revising down is the
        // point of the field; revising up would make the BOM's "Remaining" (requested minus
        // approved) negative and the printed document nonsense. requested_amount is frozen at
        // submit and already includes transportation cost, so it is the bound as-is. Read from
        // the locked row rather than a value fetched earlier in the request.
        const requested = Number(requisition.requested_amount ?? 0);
        if (input.approvedAmount > requested) {
          throw new ApprovedExceedsRequestedError(requested, input.approvedAmount);
        }
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
        // Snapshot at final-approve. This is the canonical "Approved" stage figure: if any
        // approver revised `approved_amount` (e.g. REQ-000018 — 4,178 requested, revised down
        // to 3,000), `setApprovedAmount` has already run above, so the snapshot captures the
        // revised figure. Requested_amount stays at its frozen value across every snapshot.
        const finalFigures = await this.fundsRepo.computeCurrentFunding(
          tx,
          approval.requisition_id,
        );
        await this.fundsRepo.insertSnapshot(tx, {
          requisitionId: approval.requisition_id,
          status: RequisitionStatus.APPROVED,
          requestedAmount: finalFigures.requestedAmount,
          approvedAmount: finalFigures.approvedAmount,
          transportation: finalFigures.transportation,
          funded: finalFigures.funded,
          spent: finalFigures.spent,
          returnedToAccounts: finalFigures.returned,
          unspent: finalFigures.unspent,
        });
      }

      await recordDecision();

      if (outstanding === 0) {
        // Done. The requester learns it cleared, and the IMs learn there is a BOM to generate.
        await notifyOn('requisition.approved', [requisition.requester_id]);
        await notifyOn(
          'requisition.approved',
          await this.notifications.usersWithRole(Role.INVENTORY_MANAGER, tx),
        );
      } else {
        // Still waiting on someone. Nudge whoever is left rather than the whole chain.
        await notifyOn(
          'requisition.awaiting_your_approval',
          await this.notifications.pendingApproversFor(approval.requisition_id, tx),
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

    if (
      approval.action !== ApprovalAction.APPROVED &&
      approval.action !== ApprovalAction.REJECTED
    ) {
      throw new ConflictError('Only an approval that was granted or refused can be withdrawn');
    }

    const actor = await this.users.findAuthRecordById(actorId);

    await this.db.transaction().execute(async (tx) => {
      // Same lock as `decide`, for the same reason and taken in the same place: a withdrawal
      // and a concurrent final approval must not each read the other's "before". Crucially
      // this is also what stops a withdrawal landing on a requisition whose BOM was generated
      // a millisecond ago — the status re-read below happens under the lock.
      const requisition = await this.repo.lockRequisition(tx, approval.requisition_id);
      if (!requisition) throw new NotFoundError('Requisition');
      if (!WITHDRAWABLE_STATUSES.includes(requisition.status as RequisitionStatus)) {
        throw new InvalidRequisitionTransitionError(
          requisition.status as RequisitionStatus,
          'withdrawn from',
        );
      }

      const claimed = await this.repo.claimApproval(
        approvalId,
        {
          action: ApprovalAction.WITHDRAWN,
          actedBy: actorId,
          note: input.reason,
          expectedActions: [ApprovalAction.APPROVED, ApprovalAction.REJECTED],
        },
        tx,
      );
      if (!claimed) throw new ApprovalAlreadyActedError();

      // Back to the right "in flight" stage for the chain. Withdrawing an IM rejection
      // resurrects the requisition to IM_REVIEW so the IM can re-decide; withdrawing an
      // approver decision (approval or rejection) sends it back to AWAITING_APPROVAL.
      const nextStatus =
        approval.stage === ApprovalStage.INVENTORY_MANAGER
          ? RequisitionStatus.IM_REVIEW
          : RequisitionStatus.AWAITING_APPROVAL;
      await this.repo.setStatus(tx, approval.requisition_id, nextStatus, false);
      await this.repo.appendEvent(
        tx,
        approval.requisition_id,
        RequisitionEventType.APPROVER_WITHDREW,
        actorId,
        { reason: input.reason, stage: approval.stage, slot: approval.slot },
      );
      await this.audit.record(
        {
          action: 'requisition.withdraw',
          entityType: 'requisition',
          entityId: approval.requisition_id,
          entityRef: requisition.requisition_no,
          summary: `Withdrew approval on ${requisition.requisition_no}`,
          metadata: { stage: approval.stage, slot: approval.slot, reason: input.reason },
        },
        { actorId: actorId, actorName: null, actorEmail: null, actorRoles: [], requestMethod: null, requestPath: null, requestIp: null, userAgent: null },
        tx,
      );

      // A withdrawal moves the requisition backwards, so two groups care: the requester, whose
      // approved request is no longer approved, and whoever now has to decide again.
      const withdrawal = {
        ref: requisition.requisition_no,
        link: NOTIFICATION_LINKS.requisition(approval.requisition_id),
        entityType: 'requisition',
        entityId: approval.requisition_id,
        actorId,
        actorName: actor?.full_name ?? null,
        context: { note: input.reason },
      };
      await this.notifications.notify(
        { ...withdrawal, type: 'requisition.withdrawn', userIds: [requisition.requester_id] },
        tx,
      );
      await this.notifications.notify(
        {
          ...withdrawal,
          type: 'requisition.awaiting_your_approval',
          userIds: await this.notifications.pendingApproversFor(approval.requisition_id, tx),
        },
        tx,
      );
    });

    return this.requireDetail(approval.requisition_id);
  }

  /**
   * Single-item + over-budget branch (plan D2/D3).
   *
   * The IM is at the BOM-generate step and the variance is unbridgeable — the line cannot
   * shrink enough to fit, yet there is exactly one item so the BOM-customise path (shrink
   * qty / drop a line) offers nothing. The IM sends the requisition back to the requester
   * for budget revision. Status flips to DRAFT, the requester is notified, and the
   * "for revise" tag becomes visible on the detail page. The chain replays when the
   * requester re-submits.
   *
   * Pre-conditions:
   *   - status === APPROVED (else the requester can just edit the draft, or the BOM already
   *     moved forward).
   *   - items.length === 1 (the multi-item case has its own handle — the BOM-customise
   *     flow — and silently bouncing a multi-item requisition would be a worse failure
   *     mode than a 409 the IM can read).
   *
   * The existing approved `requisition_approvals` rows are kept (immutable audit history).
   * When the requester re-submits, `submit` inserts a fresh chain — that is the existing
   * path, exercised by every fresh requisition submit; we are not reimplementing it here.
   *
   * The `requisition_approvals.action` is not flipped to WITHDRAWN, mirroring the
   * "leave the audit trail intact" pattern rather than the "mask old decisions" approach:
   * a downstream reader can see the original approvers thought this was fine and the
   * IM later reconsidered. The `requiresRevisionTag` view-layer flag is what the UI
   * uses to surface the "for revise" pill.
   */
  async sendBackForRevision(
    id: string,
    input: SendBackForRevisionInput,
    actorId: string,
  ) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Requisition');

    if (existing.status !== RequisitionStatus.APPROVED) {
      throw new CannotSendBackForRevisionError('not_approved');
    }

    const items = await this.repo.findItems(id);
    if (items.length !== 1) {
      throw new CannotSendBackForRevisionError('multi_item');
    }

    const actor = await this.users.findAuthRecordById(actorId);

    await this.db.transaction().execute(async (tx) => {
      // Re-read under the lock so a status flip that landed between the initial read and
      // the transaction open cannot be silently overwritten. Same pattern as withdraw.
      const requisition = await this.repo.lockRequisition(tx, id);
      if (!requisition) throw new NotFoundError('Requisition');
      if (requisition.status !== RequisitionStatus.APPROVED) {
        throw new CannotSendBackForRevisionError('not_approved');
      }

      // DRAFT is the land here. The `requisition_approvals` rows are deleted so the
      // requester's re-submit can seed a fresh chain — the `UNIQUE (requisition_id,
      // stage, slot)` constraint would otherwise reject the new rows. The audit history
      // is preserved on the `requisition_events` table: the original approvals show up
      // here as `IM_APPROVED` / `APPROVER_APPROVED` events with the actor and timestamp,
      // which is what the audit feed renders anyway. Also clear the approved_amount so
      // the requester sees a blank field again — the IM's previous figure was a one-shot
      // sanction, not a permanent cap.
      await tx
        .deleteFrom('requisition_approvals')
        .where('requisition_id', '=', id)
        .execute();
      await sql`
        UPDATE requisitions
        SET status = ${RequisitionStatus.DRAFT}::requisition_status,
            approved_amount = NULL,
            decided_at = NULL,
            submitted_at = NULL,
            required_approver_count = NULL,
            threshold_at_submit = NULL
        WHERE id = ${id}::uuid
      `.execute(tx);

      await this.repo.appendEvent(
        tx,
        id,
        RequisitionEventType.SEND_BACK_FOR_REVISION,
        actorId,
        { reason: input.reason, itemCount: items.length },
      );
      await this.audit.record(
        {
          action: 'requisition.send_back_for_revision',
          entityType: 'requisition',
          entityId: id,
          entityRef: existing.requisition_no,
          summary: `Sent back ${existing.requisition_no} for budget revision`,
          metadata: { reason: input.reason, itemCount: items.length },
        },
        { actorId, actorName: actor?.full_name ?? null, actorEmail: null, actorRoles: [], requestMethod: null, requestPath: null, requestIp: null, userAgent: null },
        tx,
      );

      // The requester must see this — the requisition is back on their desk. The original
      // approvers get a heads-up too: their decision has been thrown out, and they may be
      // asked to act again if the requester re-submits at the same amount.
      const originalActorName = actor?.full_name ?? null;
      await this.notifications.notify(
        {
          type: 'requisition.sent_back_for_revision',
          userIds: [existing.requester_id],
          ref: existing.requisition_no,
          link: NOTIFICATION_LINKS.requisition(id),
          entityType: 'requisition',
          entityId: id,
          actorId,
          actorName: originalActorName,
          context: { note: input.reason },
        },
        tx,
      );
    });

    return this.requireDetail(id);
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
      await this.audit.record(
        {
          action: 'requisition.cancel',
          entityType: 'requisition',
          entityId: id,
          entityRef: existing.requisition_no,
          summary: `Cancelled requisition ${existing.requisition_no}`,
          metadata: {},
        },
        { actorId: actorId, actorName: null, actorEmail: null, actorRoles: [], requestMethod: null, requestPath: null, requestIp: null, userAgent: null },
        tx,
      );

      // Whoever had this sitting in their queue needs it to disappear from their queue.
      await this.notifications.notify(
        {
          type: 'requisition.cancelled',
          userIds: await this.notifications.pendingApproversFor(id, tx),
          ref: existing.requisition_no,
          link: NOTIFICATION_LINKS.requisition(id),
          entityType: 'requisition',
          entityId: id,
          actorId,
          actorName: null,
        },
        tx,
      );
    });

    return this.requireDetail(id);
  }

  async requireDetail(id: string) {
    const detail = await this.repo.findDetail(id);
    if (!detail) throw new NotFoundError('Requisition');
    return detail;
  }

  /**
   * The admin-designated approver for sub-threshold requisitions.
   *
   * This is a *different* setting from the approver slots, which is exactly why it gets its own
   * error: reporting "Approver 1 is not assigned" here sent admins to a screen that was already
   * correctly filled in. The user is also checked for `is_active`, so a freshly-deactivated
   * approver does not silently win the assignment (Phase 05 inactive-slot guard).
   */
  /**
   * The single designated sub-threshold approver — or nobody, when that person is the one
   * asking.
   *
   * Ayman's ruling, 2026-09-01. Substitution used to stand the slot chain in for them; that
   * chain is configured for requisitions *at or above* the threshold and borrowing it here made
   * a small requisition need a signature the policy never asked for. Below the threshold the
   * policy names one person, and when that person is the requester their own stage is simply
   * absent — the requisition stands approved on submit.
   *
   * Returns a list so the caller can treat "one approver" and "none" the same way.
   */
  private async subthresholdApproverIds(requesterId: string): Promise<string[]> {
    const userId = await this.settings.get(SettingKey.SUBTHRESHOLD_APPROVER_USER_ID);
    if (userId === null) {
      throw new SubthresholdApproverUnassignedError('unset');
    }
    const active = await this.repo.isUserActive(userId);
    if (!active) {
      throw new SubthresholdApproverUnassignedError('inactive');
    }
    return userId === requesterId ? [] : [userId];
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

  /**
   * `REQ-000015-GINA`. Ayman's ruling, 2026-08-29: the number says whose it is, so a stack of
   * printouts sorts by hand without opening any of them.
   *
   * The name is decoration and the serial is the identity — see `document-number.ts`. Rows
   * created before this change keep their plain `REQ-000014`, which is why the column has no
   * format constraint and nothing in the codebase parses one: both shapes are valid forever, and
   * rewriting historical numbers would break every audit row, notification and printout that
   * already quotes them.
   */
  private async nextRequisitionNo(tx: Db, requesterId: string): Promise<string> {
    const row = await sql<{ n: string }>`SELECT nextval('requisition_no_seq') AS n`.execute(tx);
    const requester = await tx
      .selectFrom('users')
      .where('id', '=', requesterId)
      .select(['full_name', 'email'])
      .executeTakeFirst();
    return documentNumber(
      'REQ',
      Number(row.rows[0]?.n ?? 1),
      nameTokenFor(requester?.full_name ?? null, requester?.email ?? null),
    );
  }
}
