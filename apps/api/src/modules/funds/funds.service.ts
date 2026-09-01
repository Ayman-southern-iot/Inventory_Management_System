import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  RequisitionEventType,
  RequisitionStatus,
  Role,
  type RecordFundReceiptInput,
  type RecordPurchaseInput,
  type UnverifyPurchaseInput,
  type UndoSendToAccountsInput,
  type VoidFundReceiptInput,
  type VoidPurchaseInput,
  type VerifyPurchaseInput,
  type SendToAccountsInput,
  type ReceiveIntoStockInput,
  type BorrowToUserInput,
  type RequisitionFunding,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_LINKS } from '../notifications/notifications.links';
import { RequisitionsRepository } from '../requisitions/requisitions.repository';
import { FilesService } from '../files/files.service';
import { StockService } from '../stock/stock.service';
import { ProductsService } from '../products/products.service';
import { BorrowingService } from '../borrowing/borrowing.service';
import { FundsRepository, type Tx } from './funds.repository';
import {
  CannotUndoSendWithReceiptsError,
  CannotUnverifyWithReturnsError,
  CannotVoidReceiptWithPurchasesError,
  CannotVoidReceivedPurchaseError,
  FundingExceedsApprovedError,
  InvalidFundingTransitionError,
  PurchaseExceedsFundedError,
  MoneyRowNotFoundError,
  ReceiveExceedsPurchasedError,
  ReturnExceedsUnspentError,
} from './funds.errors';

/** Ledger provenance, so a receipt traces back to the requisition that caused it. */
const REQUISITION_REF_TYPE = 'REQUISITION';

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
    // Forward-ref: RequisitionsModule also imports FundsModule so RequisitionsService can
    // call our snapshot hooks. A plain `@Inject` would resolve before the other side is ready.
    @Inject(forwardRef(() => RequisitionsRepository))
    private readonly requisitions: RequisitionsRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly stock: StockService,
    private readonly products: ProductsService,
    private readonly borrowing: BorrowingService,
  ) {}

  /* ------------------------------------------------------ sent to accounts */

  async sendToAccounts(
    requisitionId: string,
    input: SendToAccountsInput,
    actorId: string,
    context: AuditContext,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'sent to Accounts', [RequisitionStatus.BOM_GENERATED]);

      await this.requisitions.setStatus(tx, requisitionId, RequisitionStatus.SENT_TO_ACCOUNTS, false);
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.SENT_TO_ACCOUNTS,
        actorId,
        { note: input.note },
      );
      // Snapshot the figures as they stood the moment money was handed off — funded/spent/
      // returned are still zero at this point, which is correct: Accounts has not released
      // anything yet. The pill selector uses this to confirm "BOM done, Accounts pending".
      await this.recordFundingSnapshot(tx, requisitionId, RequisitionStatus.SENT_TO_ACCOUNTS);
      await this.audit.record(
        {
          action: 'requisition.sent_to_accounts',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Sent ${requisition.requisition_no} to Accounts`,
          metadata: { approvedAmount: requisition.approved_amount, note: input.note },
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
      // Snapshot the funded figure as of this receipt. If the requisition went through
      // several partial receipts, the dedup-on-read keeps the latest snapshot alive and the
      // earlier ones are never surfaced (appendix C of the migration).
      await this.recordFundingSnapshot(tx, requisitionId, nextStatus);
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

      // The BOM is the source of truth for purchase quantity *only when* the IM edited it.
      // A BOM line whose quantity matches its source (`bom_lines.quantity === requisition_items.quantity`)
      // carries no override, so the wire quantity stands — preserving the pre-customiser
      // behaviour where the IM bought whatever they wanted up to what was approved.
      //
      // When the IM *did* shrink the line (50 → 30 in the customiser), the wire quantity
      // usually reflects the stale dialog and must be capped to the BOM ceiling. The IM
      // can still legitimately exceed it via the dialog's `overBomQuantity` flag — the
      // server records the BOM quantity but flags the row so the audit trail shows why.
      // A wire below the ceiling is a partial shipment — keep the wire quantity.
      //
      // When no live BOM exists at all (older requisitions pre-dating the BOM flow), the
      // wire is trusted verbatim — same fallback the test fixtures exercise.
      //
      // The lookup joins both `bom_lines.quantity` and `requisition_items.quantity` so we
      // can tell whether the IM actually shrunk the line vs. merely inheriting the source.
      // If the two numbers agree, there is no override to enforce.
      const bomMap = await this.repo.getLiveBomForRequisition(requisitionId, tx);

      // `settled` is what actually gets persisted: every per-line `quantity` has been
      // reconciled against the BOM (when the IM shrunk it), and the wire-supplied
      // `overBomQuantity` flag is recomputed.
      const settled = input.lines.map((line) => {
        const bom = bomMap.get(line.requisitionItemId);
        const bomQuantity = bom?.quantity;
        const sourceQuantity = bom?.sourceQuantity;
        // The BOM "ceiling" rule only fires when the IM *actually* shrunk the line. A line
        // whose BOM quantity matches the source carries no override, so the wire wins.
        const isShrunk =
          bomQuantity !== undefined && sourceQuantity !== undefined && bomQuantity < sourceQuantity;
        const quantity = isShrunk ? Math.min(line.quantity, bomQuantity) : line.quantity;
        const overBomQuantity = isShrunk && line.quantity > bomQuantity;
        // When the server flips `overBomQuantity` on (the wire thought the dialog still
        // showed the source qty), the note stays as the IM typed it. If the IM did not
        // type one — the common case — the server adds a default so the database
        // constraint `purchase_lines_over_bom_needs_note` does not reject the row.
        const overBomNote =
          overBomQuantity && (line.overBomNote ?? '').trim().length === 0
            ? `Wire quantity exceeded the BOM ceiling (${line.quantity} → ${quantity})`
            : line.overBomNote;
        return {
          requisitionItemId: line.requisitionItemId,
          bomLineId: isShrunk && bom ? bom.bomLineId : null,
          quantity,
          unitCost: line.unitCost,
          overBomQuantity,
          overBomNote,
        };
      });

      // The purchase total uses the persisted `quantity` (not the wire), so the column stays
      // consistent with `purchase_lines.quantity * unit_cost` for any auditor pulling receipts.
      const totalAmount = round2(
        settled.reduce((sum, line) => sum + line.unitCost * line.quantity, 0),
      );

      /**
       * A purchase may not spend more than has been funded. Ayman's ruling, 2026-08-31.
       *
       * Read under the lock this transaction already holds, so two purchases racing on the
       * same requisition cannot both see the same headroom and both take it.
       *
       * Skipped when nothing has been funded yet: the status guard above already restricts
       * this to funded requisitions, and inventing a ceiling of zero would refuse every
       * purchase on a requisition whose receipts were recorded outside the normal flow.
       */
      const [alreadyFunded, alreadySpent] = await Promise.all([
        this.repo.sumReceipts(requisitionId, tx),
        this.repo.sumPurchases(requisitionId, tx),
      ]);
      // This purchase's own carriage plus whatever earlier purchases already committed. The
      // requisition's planned figure is not used here: what matters is the money going out.
      const carriage = round2(input.transportationCost ?? 0);
      const alreadyCarried = await this.repo.sumPurchaseTransportation(requisitionId, tx);
      const committed = round2(alreadySpent + alreadyCarried + totalAmount + carriage);
      if (alreadyFunded > 0 && committed > alreadyFunded) {
        throw new PurchaseExceedsFundedError({
          committed,
          funded: round2(alreadyFunded),
          alreadySpent: round2(alreadySpent),
          transportation: round2(alreadyCarried + carriage),
        });
      }

      const purchaseId = await this.repo.insertPurchase(tx, {
        requisitionId,
        vendor: input.vendor,
        invoiceNo: input.invoiceNo,
        purchasedAt: new Date(input.purchasedAt),
        totalAmount,
        transportationCost: carriage,
        note: input.note,
        recordedBy: actorId,
      });

      await this.repo.insertPurchaseLines(tx, purchaseId, settled);

      await this.requisitions.setStatus(tx, requisitionId, RequisitionStatus.PURCHASED, false);
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.PURCHASED,
        actorId,
        { purchaseId, vendor: input.vendor, totalAmount, lineCount: input.lines.length },
      );
      // Split-vendor purchases are a real flow — a requisition can land on PURCHASED more
      // than once. Each snapshot is appended; listSnapshotsForRequisition() dedups to the
      // latest, which is the figure the pill selector renders.
      await this.recordFundingSnapshot(tx, requisitionId, RequisitionStatus.PURCHASED);
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

  /* -------------------------------------------------------------- invoices */

  /**
   * Attach the scanned invoice to one purchase.
   *
   * Separate from `verifyPurchase` on purpose: a requisition bought across three vendors has
   * three invoices arriving on three different days, and forcing them into the verify call would
   * mean the IM cannot record the first until the last turns up.
   */
  async attachInvoice(
    requisitionId: string,
    purchaseId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    actorId: string,
    context: AuditContext,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      const purchase = await this.repo.findPurchase(purchaseId, tx);
      if (!purchase || purchase.requisition_id !== requisitionId) {
        // Checked against the requisition in the path, so a valid purchase id belonging to
        // somebody else's requisition is a 404 rather than a silent cross-attach.
        throw new NotFoundError('Purchase');
      }

      const stored = await this.files.upload(
        {
          kind: 'INVOICE',
          contents: file.buffer,
          originalName: file.originalname,
          uploadedBy: actorId,
        },
        tx,
      );

      // A new upload points the purchase at a new row rather than overwriting the old file, so
      // replacing an invoice never rewrites what an earlier verification was based on.
      await this.repo.attachInvoice(tx, purchaseId, {
        fileId: stored.id,
        uploadedBy: actorId,
        uploadedAt: new Date(),
      });

      await this.audit.record(
        {
          action: 'requisition.invoice_attached',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Attached an invoice to a purchase on ${requisition.requisition_no}`,
          metadata: {
            purchaseId,
            vendor: purchase.vendor,
            fileId: stored.id,
            originalName: file.originalname,
          },
        },
        context,
        tx,
      );

      return stored.id;
    });
  }

  /**
   * Who may read a requisition's invoices.
   *
   * A per-row check, so it lives here rather than on a guard (rules/20-backend.md): IM and Admin
   * always; the requester because it is their request; and the approvers on *this* requisition,
   * because someone who sanctioned the spend has a legitimate interest in what it actually cost.
   * Nobody else — an invoice carries vendor pricing.
   */
  async assertCanReadFunding(
    requisitionId: string,
    actor: { id: string; roles: readonly Role[] },
  ): Promise<void> {
    if (actor.roles.includes(Role.INVENTORY_MANAGER) || actor.roles.includes(Role.ADMIN)) return;

    const requisition = await this.requisitions.findById(requisitionId);
    if (!requisition) throw new NotFoundError('Requisition');
    if (requisition.requester_id === actor.id) return;

    const approval = await this.db
      .selectFrom('requisition_approvals')
      .where('requisition_id', '=', requisitionId)
      .where('assigned_user_id', '=', actor.id)
      .select('id')
      .executeTakeFirst();
    if (approval) return;

    throw new ForbiddenError('You cannot view the invoices on this requisition');
  }

  /** The invoice bytes. Call `assertCanReadFunding` first — this does no authorisation. */
  async readInvoice(
    requisitionId: string,
    purchaseId: string,
  ): Promise<{ contents: Buffer; mimeType: string; fileName: string }> {
    const purchase = await this.repo.findPurchase(purchaseId);
    if (!purchase || purchase.requisition_id !== requisitionId || !purchase.invoice_file_id) {
      throw new NotFoundError('Invoice');
    }
    const { contents, row } = await this.files.readContents(purchase.invoice_file_id);
    return { contents, mimeType: row.mime_type, fileName: row.original_name };
  }

  /* -------------------------------------------------------- verification */

  /**
   * The IM has checked the goods against the invoice, and hands back whatever was not spent.
   *
   * Verification and the return are one call because they are one decision: the moment the IM
   * reconciles the paperwork is the moment they know what is left over.
   */
  async verifyPurchase(
    requisitionId: string,
    input: VerifyPurchaseInput,
    actorId: string,
    context: AuditContext,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'verified', [RequisitionStatus.PURCHASED]);

      /*
       * The invoice is optional. Ayman, 2026-09-01, reversing his own ruling of 2026-08-26.
       *
       * That earlier decision was made after I had wrongly described the invoice as optional
       * and he chose to keep the status quo; this is the deliberate change, made knowing what
       * the rule was. The attach control stays where it is on the verify form — most purchases
       * will still have one — but a purchase whose invoice has not arrived no longer blocks
       * the requisition from being verified and its unspent money from going back.
       *
       * `countPurchasesWithoutInvoice` and `InvoiceMissingError` are deliberately kept: the
       * count is what a future "3 purchases still have no invoice" warning would read, and the
       * error's code is quoted in audit rows written while the gate was live.
       */

      const returned = round2(input.returnedAmount);
      // Transportation is part of `approved_amount` at submit time but never reaches purchases
      // (it isn't a stock movement), so without this fold the verify-purchase dialog still
      // shows it as unspent and the IM is asked to hand back money that was already spent on
      // getting the goods here. Treat it as spent for unspent math; `transportation_cost`
      // stays null when the IM never declared any.
      //
      // Summed from the purchases themselves (migration 0029), so this is what the carriage
      // actually came to rather than what was planned — and a requisition whose only purchase
      // was voided has no purchases to add up, which is OQ-32 falling out of the arithmetic.
      const transportation = await this.repo.sumPurchaseTransportation(requisitionId, tx);
      if (returned > 0) {
        // All three sums read under the lock that will write the status, so the ceiling cannot
        // move underneath a concurrent return.
        const [funded, spent, alreadyReturned] = await Promise.all([
          this.repo.sumReceipts(requisitionId, tx),
          this.repo.sumPurchases(requisitionId, tx),
          this.repo.sumReturns(requisitionId, tx),
        ]);
        const unspent = round2(funded - spent - transportation - alreadyReturned);
        if (returned > unspent) throw new ReturnExceedsUnspentError(unspent, returned);

        await this.repo.insertReturn(tx, {
          requisitionId,
          amount: returned,
          // Non-null by the contract's refine and by a NOT NULL column — belt and braces, because
          // an unexplained return is the thing this step exists to prevent.
          note: (input.returnNote ?? '').trim(),
          returnedAt: new Date(),
          recordedBy: actorId,
        });

        await this.requisitions.appendEvent(
          tx,
          requisitionId,
          RequisitionEventType.FUNDS_RETURNED,
          actorId,
          { amount: returned, note: input.returnNote },
        );
        await this.audit.record(
          {
            action: 'requisition.funds_returned',
            entityType: 'requisition',
            entityId: requisitionId,
            entityRef: requisition.requisition_no,
            summary: `Returned ${returned} to Accounts on ${requisition.requisition_no}`,
            metadata: { amount: returned, note: input.returnNote },
          },
          context,
          tx,
        );
      }

      await this.requisitions.setStatus(
        tx,
        requisitionId,
        RequisitionStatus.PURCHASE_VERIFIED,
        false,
      );
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.PURCHASE_VERIFIED,
        actorId,
        { returnedAmount: returned },
      );
      // `returned` may have grown if a refund was just recorded in the same verify call —
      // snapshot captures the post-refund figure. UnverifyPurchase below does NOT snapshot:
      // a rewind to PURCHASED is a correction, not a new money moment.
      await this.recordFundingSnapshot(tx, requisitionId, RequisitionStatus.PURCHASE_VERIFIED);
      await this.audit.record(
        {
          action: 'requisition.purchase_verified',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Verified the purchase on ${requisition.requisition_no}`,
          metadata: { returnedAmount: returned },
        },
        context,
        tx,
      );
      await this.notifications.notify(
        {
          type: 'requisition.purchase_verified',
          userIds: [requisition.requester_id],
          ref: requisition.requisition_no,
          link: NOTIFICATION_LINKS.requisition(requisitionId),
          entityType: 'requisition',
          entityId: requisitionId,
          actorId,
          actorName: context.actorName,
          context: { amount: returned > 0 ? String(returned) : null },
        },
        tx,
      );

      return requisitionId;
    });
  }

  /**
   * Reverse a verify-purchase. The IM needs to fix something they recorded wrong, so the
   * requisition is back at PURCHASED and the next verify will write a fresh PURCHASE_VERIFIED
   * event. Refused if any money has been returned to Accounts — the right way to undo a refund
   * is a corrective refund, not a status flip.
   *
   * Purchases and `fund_returns` rows stay in place — they are evidence of what was bought and
   * handed back. Only the status flips; the next verify reads the same purchases again.
   */
  async unverifyPurchase(
    requisitionId: string,
    input: UnverifyPurchaseInput,
    actorId: string,
    context: AuditContext,
  ): Promise<RequisitionFunding> {
    await this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'unverified', [RequisitionStatus.PURCHASE_VERIFIED]);

      const alreadyReturned = await this.repo.sumReturns(requisitionId, tx);
      if (alreadyReturned > 0) {
        throw new CannotUnverifyWithReturnsError(alreadyReturned);
      }

      await this.requisitions.setStatus(
        tx,
        requisitionId,
        RequisitionStatus.PURCHASED,
        false,
      );
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.UNVERIFIED_PURCHASE,
        actorId,
        { reason: input.reason },
      );
      await this.audit.record(
        {
          action: 'requisition.unverify_purchase',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Unverified the purchase on ${requisition.requisition_no}`,
          metadata: { reason: input.reason },
        },
        context,
        tx,
      );

    });

    // Read after the commit, never from inside it. `funding()` runs on its own connection, so
    // a read taken within the transaction returns the figures as they were *before* this call —
    // which is exactly the state the caller is asking to see changed.
    return this.funding(requisitionId);
  }

  /* ---------------------------------------------------------- reversals */

  /**
   * Take the requisition back off the Accounts queue.
   *
   * Nothing is voided here because nothing was recorded — "sent to Accounts" is a status and a
   * note, not a money row (OQ-19: nothing leaves the system). Refused the moment Accounts has
   * released anything against it: at that point the requisition is not waiting to be sent, and a
   * receipt hanging off a requisition that claims it was never sent describes a state that never
   * existed rather than an earlier one.
   */
  async undoSendToAccounts(
    requisitionId: string,
    input: UndoSendToAccountsInput,
    actorId: string,
    context: AuditContext,
  ): Promise<RequisitionFunding> {
    await this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      // The funded statuses are admitted here only so the *next* check can refuse them with a
      // useful message. A partial receipt has already moved the status off SENT_TO_ACCOUNTS, so
      // without this the IM pressing Back would get "this requisition is FUNDS_PARTIAL, expected
      // SENT_TO_ACCOUNTS" — true, and no help at all in working out what to do about it.
      this.assertStatus(requisition.status, 'taken back from Accounts', [
        RequisitionStatus.SENT_TO_ACCOUNTS,
        RequisitionStatus.FUNDS_PARTIAL,
        RequisitionStatus.FUNDS_RECEIVED,
      ]);

      // Read under the lock that will write the status, so a receipt cannot land between the
      // check and the flip.
      const [receiptCount, funded] = await Promise.all([
        this.repo.countReceipts(requisitionId, tx),
        this.repo.sumReceipts(requisitionId, tx),
      ]);
      if (receiptCount > 0) throw new CannotUndoSendWithReceiptsError(funded, receiptCount);

      await this.requisitions.setStatus(tx, requisitionId, RequisitionStatus.BOM_GENERATED, false);
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.UNDO_SENT_TO_ACCOUNTS,
        actorId,
        { reason: input.reason },
      );
      await this.audit.record(
        {
          action: 'requisition.undo_send_to_accounts',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Took ${requisition.requisition_no} back from Accounts`,
          metadata: { reason: input.reason },
        },
        context,
        tx,
      );

    });

    // Read after the commit, never from inside it. `funding()` runs on its own connection, so
    // a read taken within the transaction returns the figures as they were *before* this call —
    // which is exactly the state the caller is asking to see changed.
    return this.funding(requisitionId);
  }

  /**
   * Void one fund receipt.
   *
   * The status is **re-derived from what remains**, never assumed. Two instalments minus one is
   * still `FUNDS_PARTIAL`; only voiding the last one goes back to `SENT_TO_ACCOUNTS`. That is the
   * same rule `recordReceipt` applies in the other direction, and deriving it here rather than
   * remembering a "previous status" is what keeps a three-instalment requisition correct.
   *
   * Refused while a purchase stands on the money. Undo happens in the order things happened;
   * otherwise a purchase is left funded by a receipt that no longer counts.
   */
  async voidReceipt(
    requisitionId: string,
    receiptId: string,
    input: VoidFundReceiptInput,
    actorId: string,
    context: AuditContext,
  ): Promise<RequisitionFunding> {
    await this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      // `PURCHASED` is admitted only so the purchase check below can refuse it by name. Recording
      // a purchase moves the status off the funded stages, so leaving it out would answer "this
      // requisition is PURCHASED, expected FUNDS_RECEIVED" — accurate, and no use to an IM trying
      // to work out that they must undo the purchase first.
      this.assertStatus(requisition.status, 'un-funded', [
        RequisitionStatus.FUNDS_PARTIAL,
        RequisitionStatus.FUNDS_RECEIVED,
        RequisitionStatus.PURCHASED,
      ]);

      const purchaseCount = await this.repo.countPurchases(requisitionId, tx);
      if (purchaseCount > 0) throw new CannotVoidReceiptWithPurchasesError(purchaseCount);

      const amount = await this.repo.voidReceipt(
        tx,
        receiptId,
        requisitionId,
        actorId,
        input.reason,
      );
      if (amount === undefined) throw new MoneyRowNotFoundError('receipt', receiptId);

      // Re-read after the void, inside the same transaction: this is the sum the status derives
      // from, and reading it beforehand would re-derive the status we just left.
      const funded = await this.repo.sumReceipts(requisitionId, tx);
      const approved = round2(Number(requisition.approved_amount ?? 0));
      const nextStatus =
        funded <= 0
          ? RequisitionStatus.SENT_TO_ACCOUNTS
          : approved > 0 && funded >= approved
            ? RequisitionStatus.FUNDS_RECEIVED
            : RequisitionStatus.FUNDS_PARTIAL;

      await this.requisitions.setStatus(tx, requisitionId, nextStatus, false);
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.FUND_RECEIPT_VOIDED,
        actorId,
        { receiptId, amount, funded, reason: input.reason },
      );
      await this.recordFundingSnapshot(tx, requisitionId, nextStatus);
      await this.audit.record(
        {
          action: 'requisition.void_fund_receipt',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Voided a ${amount} receipt on ${requisition.requisition_no}`,
          metadata: { receiptId, amount, funded, reason: input.reason },
        },
        context,
        tx,
      );

    });

    // Read after the commit, never from inside it. `funding()` runs on its own connection, so
    // a read taken within the transaction returns the figures as they were *before* this call —
    // which is exactly the state the caller is asking to see changed.
    return this.funding(requisitionId);
  }

  /**
   * Void one purchase, with its lines.
   *
   * Refused once any of its units have been received: stock exists that this purchase is the
   * justification for, and voiding it would leave the ledger describing goods nobody bought. The
   * correction at that point is a stock adjustment, deliberately a different and harder operation
   * (ADR-0001 — only StockService moves stock, and nothing in here touches it).
   *
   * The lines are not marked individually. They hang off the purchase and every read reaches them
   * through it, so one marker on the parent is the whole story; a second marker on each child
   * would be two places for the same fact to disagree.
   */
  async voidPurchase(
    requisitionId: string,
    purchaseId: string,
    input: VoidPurchaseInput,
    actorId: string,
    context: AuditContext,
  ): Promise<RequisitionFunding> {
    await this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'un-purchased', [RequisitionStatus.PURCHASED]);

      const received = await this.repo.sumReceivedForPurchase(purchaseId, tx);
      if (received > 0) throw new CannotVoidReceivedPurchaseError(received);

      const amount = await this.repo.voidPurchase(
        tx,
        purchaseId,
        requisitionId,
        actorId,
        input.reason,
      );
      if (amount === undefined) throw new MoneyRowNotFoundError('purchase', purchaseId);

      // A split-vendor requisition stays PURCHASED while any purchase is still standing. Only
      // when the last one goes does it fall back to the funded status — itself re-derived from
      // the receipts rather than remembered.
      const remaining = await this.repo.countPurchases(requisitionId, tx);
      let nextStatus: RequisitionStatus = RequisitionStatus.PURCHASED;
      if (remaining === 0) {
        const funded = await this.repo.sumReceipts(requisitionId, tx);
        const approved = round2(Number(requisition.approved_amount ?? 0));
        nextStatus =
          approved > 0 && funded >= approved
            ? RequisitionStatus.FUNDS_RECEIVED
            : RequisitionStatus.FUNDS_PARTIAL;
      }

      await this.requisitions.setStatus(tx, requisitionId, nextStatus, false);
      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.PURCHASE_VOIDED,
        actorId,
        { purchaseId, amount, remaining, reason: input.reason },
      );
      await this.recordFundingSnapshot(tx, requisitionId, nextStatus);
      await this.audit.record(
        {
          action: 'requisition.void_purchase',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Voided a ${amount} purchase on ${requisition.requisition_no}`,
          metadata: { purchaseId, amount, remaining, reason: input.reason },
        },
        context,
        tx,
      );

    });

    // Read after the commit, never from inside it. `funding()` runs on its own connection, so
    // a read taken within the transaction returns the figures as they were *before* this call —
    // which is exactly the state the caller is asking to see changed.
    return this.funding(requisitionId);
  }

  /* ------------------------------------------------------ add to inventory */

  /**
   * Put a verified purchase onto the shelf.
   *
   * The whole operation — creating any missing catalogue products, every stock receipt, the
   * received counters, the status change, the events and the audit row — is **one transaction**.
   * `StockService.receive` takes the transaction rather than opening its own, which is what stops
   * this becoming the split-transaction shape of G-14: a crash halfway would otherwise leave
   * stock on the shelf with the requisition still saying PURCHASE_VERIFIED, and the nightly
   * reconciliation would see nothing wrong because the ledger and the placements would agree.
   *
   * Stock is still written only by `StockService` (ADR-0001); this service supplies the
   * transaction, never the SQL.
   */
  async receiveIntoStock(
    requisitionId: string,
    input: ReceiveIntoStockInput,
    actorId: string,
    context: AuditContext,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'received into stock', [
        RequisitionStatus.PURCHASE_VERIFIED,
        // Receiving the rest of a part-delivered purchase.
        RequisitionStatus.STOCKED,
      ]);

      // Sorted by purchase-line id so two IMs receiving overlapping sets take the row locks in
      // the same order and queue instead of deadlocking (rules/40-database.md).
      const lines = [...input.lines].sort((a, b) =>
        a.purchaseLineId.localeCompare(b.purchaseLineId),
      );

      const received: Array<{ itemName: string; quantity: number; productId: string }> = [];

      for (const line of lines) {
        const locked = await this.repo.lockPurchaseLine(tx, line.purchaseLineId);
        if (!locked || locked.requisitionId !== requisitionId) {
          throw new NotFoundError('Purchase line');
        }

        const outstanding = locked.quantity - locked.receivedQuantity;
        if (line.quantity > outstanding) {
          throw new ReceiveExceedsPurchasedError(
            locked.itemName,
            outstanding,
            line.quantity,
          );
        }

        /**
         * A free-text requisition line is resolved to a real catalogue product the first time
         * anything is received against it, and the item is repointed so every later receipt —
         * and every later requisition that picks it — reuses the same product.
         *
         * Two ways to resolve it, and the second is the one that keeps the shelf honest:
         *
         *  - **an existing product**, when the goods are something we already stock. Receiving
         *    into a different compartment then adds a second placement under one product, and the
         *    totals roll up. Ayman's ESP32 case (2026-08-26).
         *  - **a new product**, when they genuinely are new.
         *
         * Without the first, "ESP32" free-typed a second time became a second ESP32 forever.
         * Product names are not unique — only `product_code` is — so nothing downstream would
         * have noticed.
         */
        let productId = locked.productId;
        if (!productId) {
          if (line.existingProductId) {
            // Asserted rather than trusted: an id that names nothing would otherwise be written
            // into `requisition_items.product_id` and fail later, further from the cause.
            await this.products.findById(line.existingProductId);
            productId = line.existingProductId;
          } else if (line.newProduct) {
            productId = await this.products.createWithin(
              tx,
              { ...line.newProduct, defaultReturnable: true, description: null },
              context,
            );
          } else {
            throw new ValidationFailedError({
              path: `lines.${line.purchaseLineId}.newProduct`,
              message: `"${locked.itemName}" is not in the catalogue yet, so pick the product it is, or describe a new one`,
            });
          }
          await this.repo.linkRequisitionItemProduct(tx, locked.requisitionItemId, productId);
        }

        await this.stock.receive(
          { productId, compartmentId: line.compartmentId, quantity: line.quantity },
          {
            performedBy: actorId,
            refType: REQUISITION_REF_TYPE,
            refId: requisitionId,
            ...(input.note ? { note: input.note } : {}),
          },
          // No audit context: the `requisition.stocked` row below describes the whole operation.
          // Letting StockService write one `stock.receive` row per line would bury it.
          undefined,
          tx,
        );

        await this.repo.addReceivedQuantity(tx, line.purchaseLineId, line.quantity);
        received.push({ itemName: locked.itemName, quantity: line.quantity, productId });
      }

      // Fully stocked only when nothing is outstanding anywhere on the requisition — counted from
      // the rows, so a part-delivery cannot flip the tracker to complete.
      const outstandingLines = await this.repo.countOutstandingLines(requisitionId, tx);
      const fullyStocked = outstandingLines === 0;

      if (fullyStocked) {
        await this.requisitions.setStatus(tx, requisitionId, RequisitionStatus.STOCKED, false);
        // Snapshot at the terminal stocked stage. Same figures the live endpoint would report;
        // the row's value is the historical "what did the money look like when it shipped".
        await this.recordFundingSnapshot(tx, requisitionId, RequisitionStatus.STOCKED);
      }

      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.STOCKED,
        actorId,
        { lines: received.length, fullyStocked, outstandingLines },
      );
      await this.audit.record(
        {
          action: 'requisition.stocked',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Received ${received.length} line(s) of ${requisition.requisition_no} into stock`,
          metadata: { received, fullyStocked, outstandingLines },
        },
        context,
        tx,
      );

      if (fullyStocked) {
        await this.notifications.notify(
          {
            type: 'requisition.stocked',
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
      }

      return requisitionId;
    });
  }

  /* --------------------------------------------------------- borrow to user */

  /**
   * The other exit from a verified purchase: the goods go straight out to a person.
   *
   * Same transaction discipline as `receiveIntoStock`, and for the same reason — the stock
   * movements, the borrow rows, the received counters and the requisition's status either all
   * happen or none do. `BorrowingService.issueOnBehalf` does the stock work through
   * `StockService`, so the ledger records a RECEIPT and an ISSUE exactly as an ordinary borrow
   * would; nothing here shortcuts to "issued".
   */
  async borrowToUser(
    requisitionId: string,
    input: BorrowToUserInput,
    actorId: string,
    context: AuditContext,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const requisition = await this.lock(tx, requisitionId);
      this.assertStatus(requisition.status, 'issued to a user', [
        RequisitionStatus.PURCHASE_VERIFIED,
        RequisitionStatus.STOCKED,
      ]);

      const borrower = await tx
        .selectFrom('users')
        .where('id', '=', input.borrowerId)
        .select(['id', 'is_active'])
        .executeTakeFirst();
      if (!borrower) throw new NotFoundError('User');
      // Issuing to a deactivated account would create a borrow nobody can return.
      if (!borrower.is_active) {
        throw new ValidationFailedError({
          path: 'borrowerId',
          message: 'That user is deactivated, so nothing can be issued to them',
        });
      }

      // Same sorted lock order as receiving, so the two paths cannot deadlock against each other.
      const lines = [...input.lines].sort((a, b) =>
        a.purchaseLineId.localeCompare(b.purchaseLineId),
      );

      const issued: Array<{ borrowNo: string; itemName: string; quantity: number }> = [];

      for (const line of lines) {
        const locked = await this.repo.lockPurchaseLine(tx, line.purchaseLineId);
        if (!locked || locked.requisitionId !== requisitionId) {
          throw new NotFoundError('Purchase line');
        }

        const outstanding = locked.quantity - locked.receivedQuantity;
        if (line.quantity > outstanding) {
          throw new ReceiveExceedsPurchasedError(locked.itemName, outstanding, line.quantity);
        }

        let productId = locked.productId;
        if (!productId) {
          if (!line.newProduct) {
            throw new ValidationFailedError({
              path: `lines.${line.purchaseLineId}.newProduct`,
              message: `"${locked.itemName}" is not in the catalogue yet, so it needs product details`,
            });
          }
          productId = await this.products.createWithin(
            tx,
            { ...line.newProduct, defaultReturnable: input.isReturnable, description: null },
            context,
          );
          await this.repo.linkRequisitionItemProduct(tx, locked.requisitionItemId, productId);
        }

        const borrow = await this.borrowing.issueOnBehalf(
          tx,
          {
            requesterId: input.borrowerId,
            productId,
            compartmentId: line.compartmentId,
            quantity: line.quantity,
            projectId: input.projectId,
            isReturnable: input.isReturnable,
            expectedReturnDate: input.expectedReturnDate,
            purpose: input.purpose,
            refType: REQUISITION_REF_TYPE,
            refId: requisitionId,
          },
          actorId,
          context,
        );

        // Counted as received: it left the purchase and is now accounted for by a borrow, so it
        // must not also be receivable onto a shelf.
        await this.repo.addReceivedQuantity(tx, line.purchaseLineId, line.quantity);
        issued.push({
          borrowNo: borrow.borrowNo,
          itemName: locked.itemName,
          quantity: line.quantity,
        });
      }

      const outstandingLines = await this.repo.countOutstandingLines(requisitionId, tx);
      const fullyHandled = outstandingLines === 0;
      if (fullyHandled) {
        await this.requisitions.setStatus(tx, requisitionId, RequisitionStatus.STOCKED, false);
        // Snapshot at the terminal stocked stage via the borrow-out path. The figures are
        // identical to receiveIntoStock's STOCKED snapshot — both paths converge on the same
        // status with the same money state.
        await this.recordFundingSnapshot(tx, requisitionId, RequisitionStatus.STOCKED);
      }

      await this.requisitions.appendEvent(
        tx,
        requisitionId,
        RequisitionEventType.BORROWED_OUT,
        actorId,
        { borrowerId: input.borrowerId, issued, fullyHandled },
      );
      await this.audit.record(
        {
          action: 'requisition.borrowed_out',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Issued ${issued.length} line(s) of ${requisition.requisition_no} to a user`,
          metadata: { borrowerId: input.borrowerId, issued, fullyHandled },
        },
        context,
        tx,
      );

      return issued;
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

    const [receipts, purchases, returns, funded, spent, returned, transportation] =
      await Promise.all([
        this.repo.listReceipts(requisitionId),
        this.repo.listPurchases(requisitionId),
        this.repo.listReturns(requisitionId),
        this.repo.sumReceipts(requisitionId),
        this.repo.sumPurchases(requisitionId),
        this.repo.sumReturns(requisitionId),
        this.repo.sumPurchaseTransportation(requisitionId),
      ]);

    const approved = requisition.approved_amount === null ? null : Number(requisition.approved_amount);
    const requested =
      requisition.requested_amount === null ? null : Number(requisition.requested_amount);
    // The carriage actually paid, summed over live purchases (migration 0029). No purchases,
    // no rows, no carriage — which is OQ-32 without needing a rule of its own.

    return {
      requisitionId,
      requestedAmount: requested,
      approvedAmount: approved,
      funded: round2(funded),
      spent: round2(spent),
      returned: round2(returned),
      netFunded: round2(funded - returned),
      // Transportation is included for the same reason it is folded into verifyPurchase: it was
      // already spent (getting the goods here) but never appears in `purchases`.
      transportation,
      spentInclTransportation: round2(spent + transportation),
      // Floored at zero: if Accounts released more than was approved, that is an overage to
      // investigate, not a negative amount still owed.
      outstanding: approved === null ? 0 : Math.max(0, round2(approved - funded)),
      // Also floored: spending past what was released is a real condition worth seeing on the
      // screen, but it is not "negative money available to hand back".
      unspent: Math.max(0, round2(funded - spent - transportation - returned)),
      isFullyFunded: approved !== null && approved > 0 && round2(funded) >= round2(approved),
      receipts,
      purchases,
      returns,
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

  /**
   * Append a snapshot of the requisition's current money figures to `funding_snapshots`.
   * Called by every forward-progress stage transition (submit, IM approve, final approve,
   * BOM generate, send to accounts, funds received, purchased, purchase verified, stocked)
   * *after* `setStatus` and `appendEvent` run, so the row's `status` field reflects the
   * stage just entered.
   *
   * Reuses the same sum helpers as `funding()` — `sumReceipts`, `sumPurchases`,
   * `sumReturns` — so a snapshot can never drift from what the live endpoint would have
   * reported at the same instant. Reads inside the same transaction as the status flip
   * are safe (the requisition row is locked); there is no race between "snapshot" and
   * "funding endpoint called immediately after".
   *
   * The status set passed in is the "snapshot-eligible" subset — REJECTED, CANCELLED,
   * and the rewinds (UNVERIFIED_PURCHASE) are filtered out by the callers, not here.
   */
  async recordFundingSnapshot(
    tx: Tx,
    requisitionId: string,
    enteredStatus: RequisitionStatus,
  ): Promise<void> {
    const figures = await this.repo.computeCurrentFunding(tx, requisitionId);
    await this.repo.insertSnapshot(tx, {
      requisitionId,
      status: enteredStatus,
      requestedAmount: figures.requestedAmount,
      approvedAmount: figures.approvedAmount,
      transportation: figures.transportation,
      funded: figures.funded,
      spent: figures.spent,
      returnedToAccounts: figures.returned,
      unspent: figures.unspent,
    });
  }
}
