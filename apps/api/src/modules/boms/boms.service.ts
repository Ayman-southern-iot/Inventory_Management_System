import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { unlink } from 'node:fs/promises';
import {
  ApprovalStage,
  RequisitionEventType,
  RequisitionStatus,
  Role,
  SettingKey,
  type ApprovalFootprint,
  type Bom,
  type BomCandidate,
  type BomDetail,
  type BomSignedUrlResponse,
  type GenerateBomInput,
  type ListBomsQuery,
  type Paginated,
  type VoidBomInput,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Database } from '../../database/schema';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../common/errors';
import { SettingsService } from '../settings/settings.service';
import { RequisitionsRepository } from '../requisitions/requisitions.repository';
import { PdfRendererService } from '../pdf/pdf-renderer.service';
import { PdfSigningService } from '../pdf/pdf-signing.service';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { BomsRepository } from './boms.repository';
import { renderBomHtml } from './bom-pdf.template';
import {
  BomAlreadyVoidError,
  BomOverBudgetError,
  BomRequisitionAlreadyOnLiveBomError,
  BomRequisitionNotApprovedError,
} from './boms.errors';

/**
 * One cents-level rounding so every comparison agrees. Money is NUMERIC(14,2) in the
 * database — rounding past that is what would make the over-budget check disagree with
 * the BOM row's stored subtotal.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface SourceLine {
  requisitionItemId: string;
  productId: string | null;
  itemName: string;
  quantity: number;
  purpose: string | null;
  projectId: string | null;
}

interface LoadedSource {
  requisitionId: string;
  requisitionNo: string;
  approvedAmount: number;
  requesterName: string;
  departmentName: string | null;
  projectName: string | null;
  reason: string | null;
  lines: SourceLine[];
}

/**
 * BOM generation, snapshot freeze, voiding, and the over-budget bounce path.
 *
 * Two design choices sit at the centre of this service:
 *
 *   1. The approval footprints are captured into `bom_requisitions.approval_snapshot`
 *      at generation, never re-derived. The PDF template (4.3) will read only from
 *      that snapshot, so renaming an approver tomorrow cannot rewrite a BOM Accounts
 *      has already paid against.
 *
 *   2. The over-budget tolerance lives in `BOM_OVER_BUDGET_TOLERANCE_PCT`. Going past
 *      it does not turn the BOM into a payable document — the sources flip back to
 *      `AWAITING_APPROVAL` with `decided_at` cleared, and the BOM row records
 *      `over_budget_bounced = true`. The IM can re-batch after approvers re-decide.
 */
@Injectable()
export class BomsService {
  private readonly logger = new Logger(BomsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: BomsRepository,
    private readonly settings: SettingsService,
    private readonly requisitions: RequisitionsRepository,
    private readonly pdfRenderer: PdfRendererService,
    private readonly pdfSigning: PdfSigningService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------ generation */

  async generate(
    input: GenerateBomInput,
    actorId: string,
    context: AuditContext,
  ): Promise<BomDetail> {
    await this.assertCanGenerate(actorId);

    const sources = await this.loadAndValidateSources(input);
    const lineIndex = this.indexLinesByRequisition(sources);

    // Every supplied line must map to one of the source requisitions' items.
    for (const line of input.lines) {
      if (!lineIndex.has(line.requisitionItemId)) {
        throw new ValidationFailedError({
          path: `lines.${line.requisitionItemId}`,
          message: 'Line does not belong to any of the supplied requisitions',
        });
      }
    }

    const subtotal = round2(
      input.lines.reduce((sum, line) => {
        const owner = lineIndex.get(line.requisitionItemId)!;
        return sum + line.unitCost * owner.quantity;
      }, 0),
    );
    const approvedTotal = round2(
      sources.reduce((sum, source) => sum + source.approvedAmount, 0),
    );
    const tolerancePct = await this.settings.get(SettingKey.BOM_OVER_BUDGET_TOLERANCE_PCT);
    const ceiling = round2(approvedTotal * (1 + tolerancePct / 100));
    const overBudget = approvedTotal > 0 && subtotal > ceiling;

    const lineCount = input.lines.length;
    const sourceNos = sources.map((source) => source.requisitionNo);

    const result = await this.db.transaction().execute(async (tx: Transaction<Database>) => {
      // Everything above — including the "is it still APPROVED?" check in
      // loadAndValidateSources — was read on a pooled connection outside this transaction. An
      // approver withdrawing in that window would otherwise be erased: the unconditional
      // status write below would stamp BOM_GENERATED over their AWAITING_APPROVAL, and the
      // frozen approval snapshot would carry a signature that had already been retracted, on
      // a PDF that goes to Accounts.
      //
      // Re-read under a lock, ordered by id ascending so two IMs generating overlapping BOMs
      // queue instead of deadlocking (rules/40-database.md).
      const lockedSources = await tx
        .selectFrom('requisitions')
        .select(['id', 'requisition_no', 'status'])
        .where(
          'id',
          'in',
          sources.map((source) => source.requisitionId),
        )
        .orderBy('id')
        .forUpdate()
        .execute();

      if (lockedSources.length !== sources.length) throw new NotFoundError('Requisition');
      for (const locked of lockedSources) {
        if (locked.status !== RequisitionStatus.APPROVED) {
          throw new BomRequisitionNotApprovedError(locked.requisition_no);
        }
      }

      const bomNo = await this.repo.nextBomNo(tx);
      const bom = await this.repo.insertBom(tx, {
        bomNo,
        generatedBy: actorId,
        subtotal,
        overBudgetBounced: overBudget,
      });

      for (const source of sources) {
        const footprints = await this.freezeFootprints(tx, source.requisitionId);
        await this.repo.insertBomRequisitions(tx, {
          bomId: bom.id,
          requisitionId: source.requisitionId,
          approvalSnapshot: footprints,
        });
      }

      // Preserve input order so the same request always renders the same line order —
      // Accounts' workflow depends on lines not shuffling between regenerations. Within
      // equal keys we fall back to the source order captured in `lineIndex`.
      const sortedLines = [...input.lines];
      const bomLineRows = sortedLines.map((line, index) => {
        const owner = lineIndex.get(line.requisitionItemId)!;
        return {
          requisitionItemId: line.requisitionItemId,
          productId: owner.productId,
          itemName: owner.itemName,
          quantity: owner.quantity,
          unitCost: line.unitCost,
          vendor: line.vendor,
          purpose: owner.purpose,
          projectId: owner.projectId,
          sortOrder: index,
        };
      });
      await this.repo.insertBomLines(tx, { bomId: bom.id, lines: bomLineRows });

      if (overBudget) {
        // The IM sees a loud refusal rather than a silently inflated BOM. Sources
        // return to the approver queue; the BOM row stays as a record of the attempt.
        for (const source of sources) {
          await sql`
            UPDATE requisitions
            SET status = ${RequisitionStatus.AWAITING_APPROVAL}::requisition_status,
                decided_at = NULL
            WHERE id = ${source.requisitionId}::uuid
          `.execute(tx);
          await this.requisitions.appendEvent(
            tx,
            source.requisitionId,
            RequisitionEventType.BOM_BOUNCED,
            actorId,
            { bomNo, subtotal, approved: approvedTotal, tolerancePct },
          );
        }
      } else {
        // Approved sources advance to the next lifecycle stage. The freeze-for-history
        // principle says we never re-decide; we just record that the BOM now owns them.
        for (const source of sources) {
          // Predicated on APPROVED even though the row is locked above: the predicate is what
          // makes the intent reviewable, and it costs nothing.
          await sql`
            UPDATE requisitions
            SET status = ${RequisitionStatus.BOM_GENERATED}::requisition_status
            WHERE id = ${source.requisitionId}::uuid
              AND status = ${RequisitionStatus.APPROVED}::requisition_status
          `.execute(tx);
          await this.requisitions.appendEvent(
            tx,
            source.requisitionId,
            RequisitionEventType.BOM_GENERATED,
            actorId,
            { bomNo },
          );
        }
      }

      // Audit inside the transaction: a successful BOM creation cannot lack its audit row.
      // The bounce path records its own action so the admin feed distinguishes "generated"
      // from "rejected at generation" without re-reading the `over_budget_bounced` column.
      if (overBudget) {
        await this.audit.record(
          {
            action: 'bom.over_budget_bounce',
            entityType: 'bom',
            entityId: bom.id,
            entityRef: bomNo,
            summary: `BOM ${bomNo} bounced: subtotal ${subtotal} exceeds approved ${approvedTotal} by more than ${tolerancePct}%`,
            metadata: {
              bomNo,
              subtotal,
              approved: approvedTotal,
              tolerancePct,
              lineCount,
              requisitionNos: sourceNos,
            },
            outcome: 'denied',
          },
          { ...context, actorId, actorName: context.actorName ?? null },
          tx,
        );
      } else {
        await this.audit.record(
          {
            action: 'bom.generate',
            entityType: 'bom',
            entityId: bom.id,
            entityRef: bomNo,
            summary: `Generated BOM ${bomNo}`,
            metadata: {
              bomNo,
              subtotal,
              approved: approvedTotal,
              lineCount,
              requisitionNos: sourceNos,
            },
          },
          { ...context, actorId, actorName: context.actorName ?? null },
          tx,
        );
      }

      return bom.id;
    });

    this.logger.log(
      `BOM ${result} generated by ${actorId}: subtotal=${subtotal}, approved=${approvedTotal}, ` +
        `tolerancePct=${tolerancePct}, overBudget=${overBudget}`,
    );

    if (overBudget) {
      // Surface the bounce through the typed error so callers can branch on it. The
      // BOM row exists (so the IM can find the attempt later) but the source
      // requisitions have already been routed back to the approver queue above.
      throw new BomOverBudgetError({ subtotal, approved: approvedTotal, tolerancePct });
    }

    const detail = await this.repo.findDetail(result);
    if (!detail) throw new NotFoundError('Bom');
    return detail;
  }

  /* ----------------------------------------------------- PDF (task 4.3) */

  /**
   * Render + cache the PDF. Idempotent on second call: returns the cached BOM detail without
   * hitting Chromium again. Bounced BOMs are explicitly rejected — Accounts must not see a
   * document whose sources went back for re-approval.
   *
   * Reads the detail before the render so the HTML reflects the frozen snapshot. The actual
   * render is the only operation that can take seconds; the metadata write at the end is
   * a tiny UPDATE.
   */
  async ensurePdf(id: string, actorId: string, context: AuditContext): Promise<BomDetail> {
    await this.assertCanRender(actorId);

    const detail = await this.repo.findDetail(id);
    if (!detail) throw new NotFoundError('Bom');
    if (detail.overBudgetBounced) {
      // The bounce path 4.2 set up writes a BOM row for audit. Telling the IM "render this"
      // here would emit a PDF for a BOM the sources have already disputed — that is the
      // paper trail we do not want.
      throw new BomOverBudgetError({
        subtotal: detail.subtotal,
        approved: detail.sources.reduce((sum, s) => sum + (s.approvedAmount ?? 0), 0),
        tolerancePct: 0,
      });
    }

    const cached = await this.repo.findPdfPath(id);
    if (cached && cached.pdfPath !== null) {
      // Already rendered. Trust the DB row over the filesystem: a manually-deleted file
      // would surface as a 404 the moment the user clicked Download, not as a re-render
      // here. Re-rendering is the controller's `regenerate` flag (task 4.3 leaves it out).
      return detail;
    }

    const letterheadUri = await this.pdfRenderer.letterheadDataUri();
    const html = renderBomHtml(detail, letterheadUri);
    const buffer = await this.pdfRenderer.render(html);

    // The on-disk path is derived from the BOM number so a re-render overwrites in place.
    const relativePath = `boms/${detail.bomNo}.pdf`;
    await this.pdfRenderer.store(relativePath, buffer);

    // The audit row joins the per-source BOM_RENDERED events in one transaction so a
    // partial render can never leave the audit log talking about a PDF that did not
    // commit. The `setPdfPath` write also rides on `tx` for the same reason.
    await this.db.transaction().execute(async (tx: Transaction<Database>) => {
      await this.repo.setPdfPath(detail.id, relativePath, tx);
      for (const source of detail.sources) {
        await this.requisitions.appendEvent(
          tx,
          source.requisitionId,
          RequisitionEventType.BOM_RENDERED,
          actorId,
          { bomNo: detail.bomNo, pdfPath: relativePath },
        );
      }
      await this.audit.record(
        {
          action: 'bom.render',
          entityType: 'bom',
          entityId: detail.id,
          entityRef: detail.bomNo,
          summary: `Rendered BOM ${detail.bomNo}`,
          metadata: {
            bomNo: detail.bomNo,
            pdfPath: relativePath,
            byteSize: buffer.length,
            sourceCount: detail.sources.length,
            lineCount: detail.lines.length,
            overBudgetBounced: detail.overBudgetBounced,
          },
        },
        { ...context, actorId, actorName: context.actorName ?? detail.generatedByName ?? null },
        tx,
      );
    });

    this.logger.log(
      `BOM ${detail.bomNo} rendered by ${actorId}: ${buffer.length} bytes → ${relativePath}`,
    );

    const after = await this.repo.findDetail(id);
    if (!after) throw new NotFoundError('Bom');
    return after;
  }

  /**
   * Issue a short-lived signed URL bound to this BOM. The URL is **relative** to the API
   * origin — the web app resolves it against its own base URL. Making it relative keeps
   * the response the same shape across dev (Vite proxy) and prod (same-origin behind Caddy).
   */
  async signDownloadUrl(id: string, _actorId: string): Promise<BomSignedUrlResponse> {
    if ((await this.repo.findDetail(id)) === undefined) throw new NotFoundError('Bom');

    const { token, expiresAt, ttlSeconds } = this.pdfSigning.sign(id);
    return {
      url: `/api/v1/boms/${id}/pdf?token=${token}`,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds,
    };
  }

  /**
   * Verify the signed token, confirm the BOM is still downloadable (not voided, has a file),
   * then read the buffer back. The controller turns the buffer into a `Content-Type:
   * application/pdf` response.
   */
  async readPdfForDownload(id: string, token: string): Promise<{ buffer: Buffer; bomNo: string }> {
    // Throws on bad/expired/mismatched BOM. The error is 403 PDF_DOWNLOAD_TOKEN_INVALID.
    this.pdfSigning.verify(token, id);

    const pdf = await this.repo.findPdfPath(id);
    if (!pdf) throw new NotFoundError('Bom');
    if (pdf.isVoid) throw new NotFoundError('Pdf');
    if (pdf.pdfPath === null) throw new NotFoundError('Pdf');

    const exists = this.pdfRenderer.exists(pdf.pdfPath);
    if (!exists) {
      // The row says a PDF exists but the file is gone — manual intervention required.
      this.logger.error(
        `BOM ${id} references missing PDF at ${pdf.pdfPath}; manual recovery needed`,
      );
      throw new NotFoundError('Pdf');
    }

    const buffer = await this.pdfRenderer.read(pdf.pdfPath);
    return { buffer, bomNo: 'bom' };
  }

  private async assertCanRender(actorId: string): Promise<void> {
    const roles = await this.actorRoles(actorId);
    if (!roles.has(Role.INVENTORY_MANAGER) && !roles.has(Role.ADMIN)) {
      throw new ForbiddenError('Only the Inventory Manager or an Admin can render a BOM PDF');
    }
  }

  /* ----------------------------------------------------------------- void */

  async void(
    id: string,
    input: VoidBomInput,
    actorId: string,
    context: AuditContext,
  ): Promise<BomDetail> {
    await this.assertCanVoid(actorId);

    // The unlink runs after commit so a failure to delete the file does not roll back the
    // void, only leaves a log line. Read the path before the transaction begins because
    // pg's `clearPdfPath` happens inside `tx`, while the filesystem unlink happens outside
    // it (a missing file should never abort a void).
    const existingPath = await this.repo.findPdfPath(id);

    // The `findDetail` reader goes through the pool, not the transaction — reading it
    // inside `tx.execute(...)` would attach to a different connection and miss the
    // uncommitted `is_void = true` we just wrote. So commit, then read.
    // Every write goes through the `tx` so the trigger-driven `boms_propagate_void`
    // cascade and the source-requisition replay stay on one connection — handing off to
    // a second pool connection partway through is what held the connection past the
    // 30s `idle_in_transaction_session_timeout` and killed the suite.
    await this.db.transaction().execute(async (tx: Transaction<Database>) => {
      // `FOR UPDATE`: the is_void guard is a check-then-act. Two admins voiding at once (or one
      // double-click — this route takes no Idempotency-Key) would both read is_void = false,
      // and the second write would overwrite the first one's reason and voided_by and emit a
      // duplicate BOM_VOIDED event per source requisition.
      const existing = await tx
        .selectFrom('boms')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) throw new NotFoundError('Bom');
      if (existing.is_void) throw new BomAlreadyVoidError(existing.bom_no);

      await this.repo.setVoid(tx, id, { voidReason: input.reason, voidedBy: actorId });
      // Clear the cached PDF path inline on `tx` so the column write participates in the
      // same transaction as `is_void`. The trigger `boms_propagate_void` then mirrors
      // both columns onto `bom_requisitions`.
      await tx
        .updateTable('boms')
        .set({ pdf_path: null, pdf_generated_at: null })
        .where('id', '=', id)
        .execute();

      // The trigger `boms_propagate_void` mirrors `is_void` onto every row in
      // `bom_requisitions`. Read those rows back so we can free the requisitions.
      const sourceIds = await tx
        .selectFrom('bom_requisitions')
        .select('requisition_id')
        .where('bom_id', '=', id)
        .execute();

      for (const source of sourceIds) {
        // Sources go back to APPROVED: the original approval decision stands. Voiding
        // the BOM does not erase the requisition, so `decided_at` stays as the
        // approvers set it. The unique partial index lets these be re-batched.
        await sql`
          UPDATE requisitions
          SET status = ${RequisitionStatus.APPROVED}::requisition_status
          WHERE id = ${source.requisition_id}::uuid
        `.execute(tx);
        await this.requisitions.appendEvent(
          tx,
          source.requisition_id,
          RequisitionEventType.BOM_VOIDED,
          actorId,
          { bomNo: existing.bom_no, reason: input.reason },
        );
      }

      // Audit inside the transaction: a void that does not write its audit row did not
      // really happen from the admin's perspective. The source count tells the admin how
      // many requisitions the void freed.
      await this.audit.record(
        {
          action: 'bom.void',
          entityType: 'bom',
          entityId: id,
          entityRef: existing.bom_no,
          summary: `Voided BOM ${existing.bom_no}`,
          metadata: {
            bomNo: existing.bom_no,
            reason: input.reason,
            sourceCount: sourceIds.length,
            overBudgetBounced: existing.over_budget_bounced,
          },
        },
        { ...context, actorId, actorName: context.actorName ?? null },
        tx,
      );
    });

    if (existingPath && existingPath.pdfPath !== null) {
      // Best-effort: a failed unlink does not undo the void. The row no longer references
      // the file; an orphan on disk is a cleanup job, not a correctness problem.
      await unlink(this.pdfRenderer.absolutePathFor(existingPath.pdfPath)).catch((error: unknown) => {
        this.logger.warn(
          `Failed to unlink PDF for voided BOM ${id} at ${existingPath.pdfPath}: ${String(error)}`,
        );
      });
    }

    const detail = await this.repo.findDetail(id);
    if (!detail) throw new NotFoundError('Bom');
    return detail;
  }

  /* ---------------------------------------------------------------- reads */

  /** Approved requisitions not already on a live BOM, with their lines pre-filled. */
  async candidates(): Promise<BomCandidate[]> {
    return this.repo.candidatesForBom();
  }

  async list(query: ListBomsQuery): Promise<Paginated<Bom>> {
    return this.repo.list(query);
  }

  async requireDetail(id: string): Promise<BomDetail> {
    const detail = await this.repo.findDetail(id);
    if (!detail) throw new NotFoundError('Bom');
    return detail;
  }

  /* ----------------------------------------------------------- helpers */

  private async assertCanGenerate(actorId: string): Promise<void> {
    const roles = await this.actorRoles(actorId);
    if (!roles.has(Role.INVENTORY_MANAGER) && !roles.has(Role.ADMIN)) {
      throw new ForbiddenError('Only the Inventory Manager or an Admin can generate a BOM');
    }
  }

  private async assertCanVoid(actorId: string): Promise<void> {
    const roles = await this.actorRoles(actorId);
    if (!roles.has(Role.INVENTORY_MANAGER) && !roles.has(Role.ADMIN)) {
      throw new ForbiddenError('Only the Inventory Manager or an Admin can void a BOM');
    }
  }

  /**
   * Loads every source requisition once and verifies each is in `APPROVED`. Anything
   * else (drafts still pending review, rejected ones) is rejected up-front so the
   * transaction never has to undo half a batch.
   */
  private async loadAndValidateSources(input: GenerateBomInput): Promise<LoadedSource[]> {
    const sources = await this.db
      .selectFrom('requisitions')
      .innerJoin('users as requester', 'requester.id', 'requisitions.requester_id')
      .leftJoin('departments', 'departments.id', 'requisitions.department_id')
      .leftJoin('projects', 'projects.id', 'requisitions.project_id')
      .where('requisitions.id', 'in', input.requisitionIds)
      .select([
        'requisitions.id',
        'requisitions.requisition_no',
        'requisitions.status',
        'requisitions.approved_amount',
        'requester.full_name as requester_name',
        'departments.name as department_name',
        'projects.name as project_name',
        'requisitions.reason',
      ])
      .execute();

    if (sources.length !== input.requisitionIds.length) {
      throw new ValidationFailedError({
        path: 'requisitionIds',
        message: 'One or more requisitions do not exist',
      });
    }

    // Pre-flight the live-BOM occupancy so a failing request gets a 409 with the
    // offending requisition number rather than a PostgreSQL unique-violation that the
    // filter would surface as a generic 500.
    const liveOccupiers = await this.db
      .selectFrom('bom_requisitions')
      .innerJoin('requisitions', 'requisitions.id', 'bom_requisitions.requisition_id')
      .where('bom_requisitions.requisition_id', 'in', input.requisitionIds)
      .where('bom_requisitions.is_void', '=', false)
      .select(['bom_requisitions.requisition_id', 'requisitions.requisition_no'])
      .execute();
    if (liveOccupiers.length > 0) {
      throw new BomRequisitionAlreadyOnLiveBomError(liveOccupiers[0]!.requisition_no);
    }

    for (const source of sources) {
      if (source.status !== RequisitionStatus.APPROVED) {
        throw new BomRequisitionNotApprovedError(source.requisition_no);
      }
    }

    const lineRows = await this.db
      .selectFrom('requisition_items')
      .where('requisition_items.requisition_id', 'in', input.requisitionIds)
      .select([
        'requisition_items.id as requisition_item_id',
        'requisition_items.requisition_id',
        'requisition_items.product_id',
        'requisition_items.item_name',
        'requisition_items.quantity',
      ])
      .execute();
    const linesByRequisition = new Map<string, SourceLine[]>();
    for (const row of lineRows) {
      const source = sources.find((entry) => entry.id === row.requisition_id)!;
      const list = linesByRequisition.get(row.requisition_id) ?? [];
      list.push({
        requisitionItemId: row.requisition_item_id,
        productId: row.product_id,
        itemName: row.item_name,
        quantity: row.quantity,
        // The requisition's reason travels with the source. It is the closest thing to a
        // per-line purpose until a future task grows per-line metadata.
        purpose: source.reason,
        projectId: null,
      });
      linesByRequisition.set(row.requisition_id, list);
    }

    return sources.map((source) => ({
      requisitionId: source.id,
      requisitionNo: source.requisition_no,
      approvedAmount: source.approved_amount === null ? 0 : Number(source.approved_amount),
      requesterName: source.requester_name,
      departmentName: source.department_name,
      projectName: source.project_name,
      reason: source.reason,
      lines: linesByRequisition.get(source.id) ?? [],
    }));
  }

  private indexLinesByRequisition(sources: LoadedSource[]): Map<string, SourceLine> {
    const map = new Map<string, SourceLine>();
    for (const source of sources) {
      for (const line of source.lines) {
        map.set(line.requisitionItemId, line);
      }
    }
    return map;
  }

  /**
   * Captures the approval chain at generation. Joins `users` once for the assignee's
   * name + designation, and again for the actor (delegate) when one was recorded.
   * The shape is `ApprovalFootprint[]` from the shared contract.
   */
  private async freezeFootprints(
    /**
     * The generating transaction. Reading this on the pool instead meant the snapshot that is
     * frozen forever came from a *different* connection — outside the transaction's snapshot
     * and outside the `FOR UPDATE` taken on the source requisitions — so the approval rows
     * could still shift underneath it. It also held a second pool connection per source.
     */
    tx: Transaction<Database>,
    requisitionId: string,
  ): Promise<ApprovalFootprint[]> {
    const rows = await tx
      .selectFrom('requisition_approvals')
      .innerJoin('users as assignee', 'assignee.id', 'requisition_approvals.assigned_user_id')
      .leftJoin('users as actor', 'actor.id', 'requisition_approvals.acted_by_user_id')
      .where('requisition_approvals.requisition_id', '=', requisitionId)
      .select([
        'requisition_approvals.stage',
        'requisition_approvals.slot',
        'assignee.full_name as assignee_name',
        'assignee.designation as assignee_designation',
        'actor.full_name as actor_name',
        'requisition_approvals.acted_at',
      ])
      // The order the live tracker walks the chain: IM stage first, approvers in slot order.
      .orderBy('requisition_approvals.stage')
      .orderBy('requisition_approvals.slot')
      .execute();

    return rows.map((row) => ({
      stage: row.stage,
      slot: row.stage === ApprovalStage.APPROVER ? row.slot : null,
      name: row.assignee_name,
      designation: row.assignee_designation,
      actedAt: row.acted_at ? row.acted_at.toISOString() : null,
      onBehalfOf: row.actor_name,
    }));
  }

  private async actorRoles(actorId: string): Promise<Set<Role>> {
    const rows = await this.db
      .selectFrom('user_roles')
      .where('user_id', '=', actorId)
      .select('role')
      .execute();
    return new Set(rows.map((row) => row.role));
  }
}
