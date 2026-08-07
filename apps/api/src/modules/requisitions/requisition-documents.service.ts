import { Inject, Injectable } from '@nestjs/common';
import { RequisitionStatus, Role, type SupportingDocument } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ForbiddenError, NotFoundError } from '../../common/errors';
import { InvalidRequisitionTransitionError } from './requisitions.errors';
import { FilesService } from '../files/files.service';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { RequisitionsRepository } from './requisitions.repository';

/**
 * The supporting document on a requisition.
 *
 * One optional PDF/PNG/JPEG ("quote sheet", "vendor proposal", "spec sheet") the requester
 * attaches so the approvers can see the supporting evidence when they decide. Same lifecycle
 * rule as the amount figures: attached or replaced only while the requisition is DRAFT, frozen
 * at submit. The document is **not** part of the BOM PDF — it is reference material for the
 * decision, not the payable document.
 *
 * The file itself is stored via `FilesService.upload` (the same path signatures and invoices
 * use); this module is the read/authorise/gate, the area the file module deliberately does
 * not know about.
 */
@Injectable()
export class RequisitionDocumentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: RequisitionsRepository,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Attach (or replace) the supporting document on a DRAFT requisition.
   *
   * The byte model is insert-only: a replace inserts a new `stored_files` row and repoints
   * the FK. The old row stays — it is the only thing that proves what an earlier signature
   * decision was based on. The same property is established for invoices in DECISIONS.md.
   */
  async attach(
    requisitionId: string,
    file: Express.Multer.File,
    actorId: string,
    context: AuditContext,
  ): Promise<SupportingDocument> {
    return this.db.transaction().execute(async (tx) => {
      // Lock the row so a concurrent submit (which freezes the figure columns) cannot race
      // with the FK repoint. The submit lock already in `submit()` takes the same row, so
      // whichever arrives first wins; the loser sees the new status and is rejected here.
      const requisition = await this.repo.lockRequisition(tx, requisitionId);
      if (!requisition) throw new NotFoundError('Requisition');
      if (requisition.status !== RequisitionStatus.DRAFT) {
        throw new InvalidRequisitionTransitionError(
          requisition.status as RequisitionStatus,
          'edited',
        );
      }
      if (requisition.requester_id !== actorId) {
        throw new ForbiddenError('Only the requester can attach a supporting document.');
      }

      const stored = await this.files.upload(
        {
          kind: 'SUPPORTING_DOCUMENT',
          contents: file.buffer,
          originalName: file.originalname,
          uploadedBy: actorId,
        },
        tx,
      );

      await this.repo.setSupportingDocumentFileId(requisitionId, stored.id, tx);

      await this.audit.record(
        {
          action: 'requisition.supporting_document_attached',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Attached a supporting document to ${requisition.requisition_no}`,
          metadata: {
            fileId: stored.id,
            originalName: stored.original_name,
            mimeType: stored.mime_type,
            sizeBytes: stored.size_bytes,
          },
        },
        context,
        tx,
      );

      return {
        fileId: stored.id,
        originalName: stored.original_name,
        mimeType: stored.mime_type,
        sizeBytes: stored.size_bytes,
        uploadedAt: stored.created_at.toISOString(),
      };
    });
  }

  /**
   * Drop the supporting document pointer. The `stored_files` row stays — see comment on
   * `attach`.
   */
  async remove(requisitionId: string, actorId: string, context: AuditContext): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const requisition = await this.repo.lockRequisition(tx, requisitionId);
      if (!requisition) throw new NotFoundError('Requisition');
      if (requisition.status !== RequisitionStatus.DRAFT) {
        throw new InvalidRequisitionTransitionError(
          requisition.status as RequisitionStatus,
          'edited',
        );
      }
      if (requisition.requester_id !== actorId) {
        throw new ForbiddenError('Only the requester can remove a supporting document.');
      }
      if (!requisition.supporting_document_file_id) return;

      const previousFileId = requisition.supporting_document_file_id;
      await this.repo.setSupportingDocumentFileId(requisitionId, null, tx);

      await this.audit.record(
        {
          action: 'requisition.supporting_document_removed',
          entityType: 'requisition',
          entityId: requisitionId,
          entityRef: requisition.requisition_no,
          summary: `Removed the supporting document from ${requisition.requisition_no}`,
          metadata: { fileId: previousFileId },
        },
        context,
        tx,
      );
    });
  }

  /**
   * Stream the bytes back. The caller must have authorised (`assertCanRead`) first — this
   * method does no authorisation of its own.
   */
  async readForDownload(requisitionId: string): Promise<{
    contents: Buffer;
    mimeType: string;
    fileName: string;
  }> {
    const row = await this.db
      .selectFrom('requisitions')
      .where('id', '=', requisitionId)
      .select(['supporting_document_file_id'])
      .executeTakeFirst();
    if (!row || !row.supporting_document_file_id) {
      throw new NotFoundError('SupportingDocument');
    }
    const { contents, row: stored } = await this.files.readContents(
      row.supporting_document_file_id,
    );
    return {
      contents,
      mimeType: stored.mime_type,
      fileName: stored.original_name,
    };
  }

  /**
   * Who may open a supporting document.
   *
   * The same predicate as the requisition itself: inventory manager / admin always; the
   * requester because it is their request; any approver assigned to this requisition
   * because someone who sanctioned the spend has a legitimate interest in what they were
   * sold. The approver branch is what makes this a larger surface than the funds-module
   * `assertCanReadFunding` — a supporting document is decision material, not commercial
   * data.
   */
  async assertCanRead(
    requisitionId: string,
    actor: { id: string; roles: readonly Role[] },
  ): Promise<void> {
    if (actor.roles.includes(Role.INVENTORY_MANAGER) || actor.roles.includes(Role.ADMIN)) return;

    const row = await this.db
      .selectFrom('requisitions')
      .leftJoin(
        'requisition_approvals',
        'requisition_approvals.requisition_id',
        'requisitions.id',
      )
      .select(['requisitions.requester_id'])
      .where('requisitions.id', '=', requisitionId)
      .where((eb) =>
        eb.or([
          eb('requisitions.requester_id', '=', actor.id),
          eb('requisition_approvals.assigned_user_id', '=', actor.id),
        ]),
      )
      .limit(1)
      .executeTakeFirst();

    if (!row) {
      throw new ForbiddenError('You cannot view this supporting document.');
    }
  }
}