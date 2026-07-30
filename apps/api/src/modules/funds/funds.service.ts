import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  RequisitionEventType,
  RequisitionStatus,
  Role,
  type RecordFundReceiptInput,
  type RecordPurchaseInput,
  type VerifyPurchaseInput,
  type ReceiveIntoStockInput,
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
import { FundsRepository, type Tx } from './funds.repository';
import {
  FundingExceedsApprovedError,
  InvalidFundingTransitionError,
  InvoiceMissingError,
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
    private readonly requisitions: RequisitionsRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly stock: StockService,
    private readonly products: ProductsService,
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
  async assertCanReadInvoice(
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

  /** The invoice bytes. Call `assertCanReadInvoice` first — this does no authorisation. */
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

      const missing = await this.repo.countPurchasesWithoutInvoice(requisitionId, tx);
      if (missing > 0) throw new InvoiceMissingError(missing);

      const returned = round2(input.returnedAmount);
      if (returned > 0) {
        // All three sums read under the lock that will write the status, so the ceiling cannot
        // move underneath a concurrent return.
        const [funded, spent, alreadyReturned] = await Promise.all([
          this.repo.sumReceipts(requisitionId, tx),
          this.repo.sumPurchases(requisitionId, tx),
          this.repo.sumReturns(requisitionId, tx),
        ]);
        const unspent = round2(funded - spent - alreadyReturned);
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

        // A free-text requisition line becomes a real catalogue product the first time anything
        // is received against it, and the item is repointed so the next receipt reuses it.
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
            { ...line.newProduct, defaultReturnable: true, description: null },
            context,
          );
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

  /* ----------------------------------------------------------- the summary */

  /**
   * The money view. Everything is derived from the rows on every read — see the migration's note
   * on why there is no stored balance.
   */
  async funding(requisitionId: string): Promise<RequisitionFunding> {
    const requisition = await this.requisitions.findById(requisitionId);
    if (!requisition) throw new NotFoundError('Requisition');

    const [receipts, purchases, returns, funded, spent, returned] = await Promise.all([
      this.repo.listReceipts(requisitionId),
      this.repo.listPurchases(requisitionId),
      this.repo.listReturns(requisitionId),
      this.repo.sumReceipts(requisitionId),
      this.repo.sumPurchases(requisitionId),
      this.repo.sumReturns(requisitionId),
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
      returned: round2(returned),
      netFunded: round2(funded - returned),
      // Floored at zero: if Accounts released more than was approved, that is an overage to
      // investigate, not a negative amount still owed.
      outstanding: approved === null ? 0 : Math.max(0, round2(approved - funded)),
      // Also floored: spending past what was released is a real condition worth seeing on the
      // screen, but it is not "negative money available to hand back".
      unspent: Math.max(0, round2(funded - spent - returned)),
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
}
