import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  RequisitionEventType,
  RequisitionStatus,
  type RecordFundReceiptInput,
  type RecordPurchaseInput,
  type RequisitionFunding,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { NotFoundError, ValidationFailedError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_LINKS } from '../notifications/notifications.links';
import { RequisitionsRepository } from '../requisitions/requisitions.repository';
import { FundsRepository, type Tx } from './funds.repository';
import { FundingExceedsApprovedError, InvalidFundingTransitionError } from './funds.errors';

/** Cents-level rounding, so every comparison agrees with the NUMERIC(14,2) columns. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Task 5.4 — the requisition's life after the BOM exists.
 *
 * ```
 * BOM_GENERATED → SENT_TO_ACCOUNTS → FUNDS_PARTIAL ⇄ FUNDS_RECEIVED → PURCHASED
 *                                                                        ↓
 *                                                              PURCHASE_VERIFIED
 * ```
 *
 * Three rules hold everywhere in here:
 *
 *  1. **Inventory-Manager only.** Enforced by `@Roles` at the controller, because it is a coarse
 *     role check with no per-row component (rules/20-backend.md).
 *  2. **Every transition is one transaction** carrying the status change, the tracker event, the
 *     audit row and the notification. A half-applied step would leave the tracker lying about
 *     where the money is.
 *  3. **The requisition row is locked first.** Two IMs recording receipts at the same instant
 *     would otherwise each read the same "already funded" total and both conclude the requisition
 *     is now fully funded — or worse, both write a status derived from a stale sum.
 */
@Injectable()
export class FundsService {
  private readonly logger = new Logger(FundsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: FundsRepository,
    private readonly requisitions: RequisitionsRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------ sent to accounts */

  async sendToAccounts(requisitionId: string, actorId: string, context: AuditContext) {
    return this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'sent to Accounts', [RequisitionStatus.BOM_GENERATED]);

      await this.requisitions.setStatus(tx, requisitionId, RequisitionStatus.SENT_TO_ACCOUNTS, false);
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.SENT_TO_ACCOUNTS,
        actorId,
        {},
      );
      await this.audit.record(
        {
          action: 'requisition.sent_to_accounts',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Sent ${requisition.requisition_no} to Accounts`,
          metadata: { approvedAmount: requisition.approved_amount },
        },
        context,
        tx,
      );
      // The requester is waiting on money; the approvers are not. Only the requester is told.
      await this.notifications.notify(
        {
          type: 'requisition.sent_to_accounts',
          userIds: [requisition.requester_id],
          ref: requisition.requisition_no,
          link: NOTIFICATION_LINKS.requisition(requisitionId),
          entityType: 'requisition',
          entityId: requisitionId,
          actorId,
          actorName: context.actorName,
        },
        tx,
      );

      return requisitionId;
    });
  }

  /* -------------------------------------------------------- fund receipts */

  async recordReceipt(
    requisitionId: string,
    input: RecordFundReceiptInput,
    actorId: string,
    context: AuditContext,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'funded', [
        RequisitionStatus.SENT_TO_ACCOUNTS,
        RequisitionStatus.FUNDS_PARTIAL,
        // A further instalment after "fully funded" is legitimate only if the approved amount was
        // revised upward; the ceiling check below is what actually decides.
        RequisitionStatus.FUNDS_RECEIVED,
      ]);

      const approved = round2(Number(requisition.approved_amount ?? 0));
      // Read under the same lock that will write the status, so the sum cannot move underneath.
      const alreadyFunded = await this.repo.sumReceipts(requisitionId, tx);
      const amount = round2(input.amount);

      if (approved > 0 && round2(alreadyFunded + amount) > approved) {
        throw new FundingExceedsApprovedError(approved, alreadyFunded, amount);
      }

      await this.repo.insertReceipt(tx, {
        requisitionId,
        amount,
        receivedAt: new Date(input.receivedAt),
        reference: input.reference,
        note: input.note,
        recordedBy: actorId,
      });

      const funded = round2(alreadyFunded + amount);
      // Derived from the sum, never from which endpoint was called.
      const fullyFunded = approved > 0 && funded >= approved;
      const nextStatus = fullyFunded
        ? RequisitionStatus.FUNDS_RECEIVED
        : RequisitionStatus.FUNDS_PARTIAL;

      await this.requisitions.setStatus(tx, requisitionId, nextStatus, false);
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.FUNDS_RECEIVED,
        actorId,
        { amount, funded, approved, fullyFunded },
      );
      await this.audit.record(
        {
          action: 'requisition.funds_received',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Recorded ${amount} received against ${requisition.requisition_no}`,
          metadata: { amount, funded, approved, fullyFunded, reference: input.reference },
        },
        context,
        tx,
      );

      // The plan's acceptance criterion for 5.1: the IM is *not* notified when a remaining
      // balance arrives — they are the one recording it. The requester is told only when the
      // funding is complete, so instalments do not become noise.
      if (fullyFunded) {
        await this.notifications.notify(
          {
            type: 'requisition.funds_received',
            userIds: [requisition.requester_id],
            ref: requisition.requisition_no,
            link: NOTIFICATION_LINKS.requisition(requisitionId),
            entityType: 'requisition',
            entityId: requisitionId,
            actorId,
            actorName: context.actorName,
            context: { amount: String(funded) },
          },
          tx,
        );
      }

      return requisitionId;
    });
  }

  /* ------------------------------------------------------------ purchases */

  async recordPurchase(
    requisitionId: string,
    input: RecordPurchaseInput,
    actorId: string,
    context: AuditContext,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'marked purchased', [
        RequisitionStatus.FUNDS_RECEIVED,
        RequisitionStatus.FUNDS_PARTIAL,
        // More than one purchase per requisition is normal — different vendors, different days.
        RequisitionStatus.PURCHASED,
      ]);

      // Every line must belong to *this* requisition. Without this check a caller could attach
      // their purchase to somebody else's requisition item by id.
      const ownItems = await this.repo.itemIdsFor(requisitionId, tx);
      const foreign = input.lines.filter((line) => !ownItems.has(line.requisitionItemId));
      if (foreign.length > 0) {
        throw new ValidationFailedError(
          foreign.map((line) => ({
            path: `lines.${line.requisitionItemId}`,
            message: 'That item does not belong to this requisition',
          })),
        );
      }

      const totalAmount = round2(
        input.lines.reduce((sum, line) => sum + line.unitCost * line.quantity, 0),
      );

      const purchaseId = await this.repo.insertPurchase(tx, {
        requisitionId,
        vendor: input.vendor,
        invoiceNo: input.invoiceNo,
        purchasedAt: new Date(input.purchasedAt),
        totalAmount,
        note: input.note,
        recordedBy: actorId,
      });

      await this.repo.insertPurchaseLines(
        tx,
        purchaseId,
        input.lines.map((line) => ({
          requisitionItemId: line.requisitionItemId,
          // Linking back to the BOM line is 5.6's concern; nothing reads it yet.
          bomLineId: null,
          quantity: line.quantity,
          unitCost: line.unitCost,
          overBomQuantity: line.overBomQuantity,
          overBomNote: line.overBomNote,
        })),
      );

      await this.requisitions.setStatus(tx, requisitionId, RequisitionStatus.PURCHASED, false);
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.PURCHASED,
        actorId,
        { purchaseId, vendor: input.vendor, totalAmount, lineCount: input.lines.length },
      );
      await this.audit.record(
        {
          action: 'requisition.purchased',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Recorded a purchase of ${totalAmount} from ${input.vendor} for ${requisition.requisition_no}`,
          metadata: {
            purchaseId,
            vendor: input.vendor,
            invoiceNo: input.invoiceNo,
            totalAmount,
            lineCount: input.lines.length,
          },
        },
        context,
        tx,
      );
      await this.notifications.notify(
        {
          type: 'requisition.purchased',
          userIds: [requisition.requester_id],
          ref: requisition.requisition_no,
          link: NOTIFICATION_LINKS.requisition(requisitionId),
          entityType: 'requisition',
          entityId: requisitionId,
          actorId,
          actorName: context.actorName,
          context: { amount: String(totalAmount) },
        },
        tx,
      );

      return purchaseId;
    });
  }

  /* ----------------------------------------------------------- the summary */

  /**
   * The money view. Everything is derived from the rows on every read — see the migration's note
   * on why there is no stored balance.
   */
  async funding(requisitionId: string): Promise<RequisitionFunding> {
    const requisition = await this.requisitions.findById(requisitionId);
    if (!requisition) throw new NotFoundError('Requisition');

    const [receipts, purchases, funded, spent] = await Promise.all([
      this.repo.listReceipts(requisitionId),
      this.repo.listPurchases(requisitionId),
      this.repo.sumReceipts(requisitionId),
      this.repo.sumPurchases(requisitionId),
    ]);

    const approved = requisition.approved_amount === null ? null : Number(requisition.approved_amount);
    const requested =
      requisition.requested_amount === null ? null : Number(requisition.requested_amount);

    return {
      requisitionId,
      requestedAmount: requested,
      approvedAmount: approved,
      funded: round2(funded),
      spent: round2(spent),
      // Floored at zero: if Accounts released more than was approved, that is an overage to
      // investigate, not a negative amount still owed.
      outstanding: approved === null ? 0 : Math.max(0, round2(approved - funded)),
      isFullyFunded: approved !== null && approved > 0 && round2(funded) >= round2(approved),
      receipts,
      purchases,
    };
  }

  /* -------------------------------------------------------------- helpers */

  /**
   * Lock the requisition, then read it. Every mutation in this service decides based on the
   * status and the funded sum, so both have to be stable for the life of the transaction.
   */
  private async lock(tx: Tx, requisitionId: string) {
    const requisition = await this.requisitions.lockRequisition(tx, requisitionId);
    if (!requisition) throw new NotFoundError('Requisition');
    return requisition;
  }

  private assertStatus(
    current: string,
    attempted: string,
    allowed: readonly RequisitionStatus[],
  ): void {
    if (!allowed.includes(current as RequisitionStatus)) {
      throw new InvalidFundingTransitionError(current as RequisitionStatus, attempted, allowed);
    }
  }
}
