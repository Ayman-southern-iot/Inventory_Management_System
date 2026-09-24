import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { ImportIssueCode, ImportJobStatus, type ImportIssue, type ImportJob } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import type { Transaction } from 'kysely';
import type { Database } from '../../database/schema';
import {
  ConflictError,
  ImportFileChangedError,
  ImportValidationFailedError,
  NotFoundError,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { CategoriesService } from '../categories/categories.service';
import { FilesService } from '../files/files.service';
import { ProductsService } from '../products/products.service';
import { StockService } from '../stock/stock.service';
import { ImportJobsRepository, type ImportJobRow } from './import-jobs.repository';
import { toContract } from './import-jobs.service';
import { ImportValidationService } from './import-validation.service';
import { ProductExportService } from './product-export.service';
import { deltaFromLocked, staleAgainstLocked } from './import-apply-checks';
import { ImportLockService } from './import-lock.service';
import { stripBom } from './import-format';
import type { ImportPlan } from './import-validator';

type Tx = Transaction<Database>;

/**
 * Applying an approved import (`importing_data.md` §5.5).
 *
 * **The order is the design, and it is not the order it was first drafted in.** Snapshot before
 * the transaction, because a snapshot is file I/O and §3.5 forbids that inside one. Lock every
 * affected placement in one deadlock-free order. Re-check the domain against the *locked* rows,
 * not against what the preview said minutes ago. Then write, in one transaction, so a
 * half-applied file is not a state this system can reach (I7).
 *
 * **Steps 3–10 do no non-database work.** No file read, no parse, no network. Everything the
 * writes need was resolved into a plan before the transaction opened, because
 * `idle_in_transaction_session_timeout` is 30 s and a transaction that stops to read a file is
 * an idle one.
 */

/**
 * How long a statement waits for a lock before giving up.
 *
 * Not business policy, so it is a constant rather than a setting: it exists so an import that
 * collides with a long-running write fails in seconds with a clear error, instead of sitting on
 * the pool until `statement_timeout` kills it at sixty.
 */
const LOCK_TIMEOUT = '5s';

/**
 * How often the persisted heartbeat and progress row are written during an apply, as a fraction
 * of the timeout that judges them. A quarter leaves three missed writes of slack before anything
 * concludes the import is dead.
 */
const BEATS_PER_TIMEOUT = 4;

@Injectable()
export class ImportApplyService {
  private readonly logger = new Logger(ImportApplyService.name);

  /** Throttles the persisted progress write. Per-process, and only one apply runs at a time. */
  private lastReportAt = 0;

  constructor(
    private readonly repo: ImportJobsRepository,
    private readonly validation: ImportValidationService,
    private readonly files: FilesService,
    private readonly exporter: ProductExportService,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly lock: ImportLockService,
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The human gate closing. Returns as soon as the job is safely `APPLYING`; the work continues.
   *
   * Fire-and-forget by §11.4: the request that starts an apply cannot wait three minutes for a
   * response, so the endpoint answers 202 with the job id and the progress endpoint (part J)
   * carries the rest. `completed` is that work, exposed so a test can await the actual condition
   * rather than sleep — the controller ignores it deliberately.
   */
  async confirm(
    jobId: string,
    actor: { id: string },
    auditContext: AuditContext,
  ): Promise<{ job: ImportJob; completed: Promise<void> }> {
    const row = await this.repo.findById(jobId);
    if (!row) throw new NotFoundError('Import');
    if (row.status !== ImportJobStatus.AWAITING_CONFIRMATION) {
      throw new ConflictError(
        `This import is ${row.status.toLowerCase().replace(/_/g, ' ')}, so there is nothing to confirm.`,
      );
    }
    if (!row.file_id) throw new ConflictError('This import no longer has its file.');

    const { contents } = await this.files.readContents(row.file_id);

    /*
     * §5.4's last line. The bytes on disk are rehashed and compared to what the upload recorded,
     * so a job cannot be applied against a file that changed underneath it — the diff a human
     * approved has to be the diff that gets written.
     */
    const sha256 = createHash('sha256').update(contents).digest('hex');
    if (sha256 !== row.file_sha256) throw new ImportFileChangedError();

    /*
     * Re-validated here rather than replayed from the upload, and deliberately **outside** the
     * transaction. Minutes have passed: a borrow may have landed, a category may have been
     * retired. Re-resolving now is both the plan the writes need in memory (§5.5's no-I/O rule)
     * and the cheap synchronous re-check §5.5 names as the next lever — it turns a stale job
     * into an instant rejection instead of a three-minute transaction that fails at the end.
     */
    const outcome = await this.validation.validate(stripBom(contents.toString('utf8')));

    if (outcome.errors.length > 0 || !outcome.plan) {
      await this.repo.update(jobId, {
        status: ImportJobStatus.FAILED,
        report: { errors: outcome.errors, warnings: outcome.warnings, diff: outcome.diff },
        finishedAt: new Date(),
      });
      throw new ImportValidationFailedError(outcome.errors);
    }

    /*
     * The status flip is its own committed write, before the apply transaction opens — and
     * small on purpose.
     *
     * It has to be visible to other requests, which rules out doing it inside the transaction.
     * Doing it there would also be worse on a crash: the rollback would take the flip with it,
     * so the job would silently return to `AWAITING_CONFIRMATION` with no record an attempt was
     * ever made. This way a crash leaves a job stuck in `APPLYING` with a stale heartbeat, which
     * is exactly the case the heartbeat guard exists to find and fail cleanly (part I).
     */
    await this.repo.update(jobId, {
      status: ImportJobStatus.APPLYING,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      totalRows: outcome.rowCount,
    });

    const completed = this.run(jobId, outcome.plan, actor, auditContext).catch((error: unknown) => {
      // Nothing is awaiting this in production, so a throw here would be an unhandled rejection.
      this.logger.error(`Import ${jobId} failed: ${String(error)}`);
    });

    return { job: await this.require(jobId), completed };
  }

  private async run(
    jobId: string,
    plan: ImportPlan,
    actor: { id: string },
    auditContext: AuditContext,
  ): Promise<void> {
    /*
     * 1 — the lockout, and it is first for a reason that only holds if it *is* first.
     *
     * Everything below assumes nothing else is writing. In particular the snapshot: it is a
     * faithful pre-image of what is about to be overwritten precisely because no write can land
     * between it and the transaction (§16.5). Take it before the lock and the rollback file is
     * quietly wrong about anything that slipped in.
     */
    this.lock.engage(jobId, this.estimatedFinish());
    await this.lock.beat(jobId);

    const snapshotId = await this.takeSnapshot(jobId);
    // C38: a backup you cannot take is a reason to stop, not continue. `takeSnapshot` has
    // already failed the job; the lock still has to come off, or nobody can do anything.
    if (!snapshotId) {
      await this.lock.release(jobId, null);
      return;
    }

    try {
      await this.lock.beat(jobId);
      await this.db.transaction().execute(async (tx) => {
        await sql`SET LOCAL lock_timeout = ${sql.lit(LOCK_TIMEOUT)}`.execute(tx);
        await this.applyWithin(tx, plan, actor, auditContext, jobId);
      });
    } catch (error) {
      await this.fail(jobId, toIssue(error));
      await this.lock.release(jobId, null);
      return;
    }

    await this.repo.update(jobId, {
      status: ImportJobStatus.COMPLETED,
      finishedAt: new Date(),
      processedRows: countShelves(plan),
    });
    // Last, and unconditionally: every path out of this function goes through `release`.
    await this.lock.release(jobId, null);
  }

  /** Steps 4–10, and nothing in here touches anything but the database. */
  private async applyWithin(
    tx: Tx,
    plan: ImportPlan,
    actor: { id: string },
    auditContext: AuditContext,
    jobId: string,
  ): Promise<void> {
    const shelves = plan.products.flatMap((product) =>
      product.productId === null
        ? []
        : product.shelves
            .filter((shelf) => shelf.targetOnHand !== shelf.currentOnHand)
            .map((shelf) => ({
              productId: product.productId!,
              compartmentId: shelf.compartmentId,
              creating: shelf.targetOnHand > shelf.currentOnHand,
            })),
    );

    // 4 — every lock, one order (see StockService.lockPlacementsForImport for why not one query).
    const locked = await this.stock.lockPlacementsForImport(tx, shelves);

    // 5 — the domain, against the locked rows rather than against what the preview said.
    const stale = staleAgainstLocked(plan, locked);
    if (stale.length > 0) throw new StaleImportError(stale);

    let changed = 0;

    // 6 — categories, parents first, so a child's parent id exists when it is inserted.
    const createdCategoryIds: string[] = [];
    for (const planned of plan.categoriesToCreate) {
      const parentId =
        planned.parentIndex === null ? planned.parentId : createdCategoryIds[planned.parentIndex]!;
      createdCategoryIds.push(
        await this.categories.createForImport(tx, {
          name: planned.path[planned.path.length - 1]!,
          parentId,
        }),
      );
    }

    // 7 and 8 — the products, and the shelves under each.
    for (const product of plan.products) {
      const categoryId =
        product.newCategoryIndex === null
          ? product.categoryId
          : createdCategoryIds[product.newCategoryIndex]!;

      const productId =
        product.productId ??
        (await this.products.createForImport(tx, {
          productCode: product.productCode ?? undefined,
          name: product.name,
          categoryId,
          unit: product.unit,
          defaultReturnable: product.defaultReturnable,
          description: product.description,
        }));

      if (product.productId !== null) {
        await this.products.updateForImport(tx, productId, {
          name: product.name,
          categoryId,
          unit: product.unit,
          defaultReturnable: product.defaultReturnable,
          description: product.description,
          isActive: product.isActive,
          ...(product.productCode === null ? {} : { productCode: product.productCode }),
        });
      }

      /*
       * The delta comes from the **locked** quantity, never from the plan's `currentOnHand`.
       * That number is what the preview showed a human minutes ago; applying a delta computed
       * from it would move the shelf by the wrong amount the moment anything else touched it,
       * which is the exact bug rules/40-database.md exists to prevent.
       */
      const adjustments = product.shelves
        .map((shelf) => ({
          productId,
          compartmentId: shelf.compartmentId,
          delta: deltaFromLocked(productId, shelf, locked),
          reason: `CSV import ${jobId}`,
        }))
        // C28: `adjust` throws on a zero delta, and rightly.
        .filter((adjustment) => adjustment.delta !== 0);

      /*
       * One call per product rather than one per shelf, so `assertProductIsTrackable` runs once
       * for this product instead of once per shelf it touches (§11.2, part H). Same writes, same
       * order, one ledger row each — `StockService` is still the only thing writing stock. No
       * audit row per adjustment (I10); the single `import.apply` row below carries the decision.
       */
      await this.stock.adjustBatch(tx, adjustments, { performedBy: actor.id }, async () => {
        /*
         * Progress, on two clocks. The in-memory touch is free and is what stops the lockout
         * guard mistaking a long apply for a dead one. The persisted write is throttled and goes
         * out on a **different connection** to `tx` — a row written inside the transaction is
         * invisible until commit, which is exactly when progress stops mattering (§5.5).
         *
         * Per shelf, not per batch: a product spread over many shelves must not go quiet for the
         * whole batch, or the heartbeat is back to being a race against the ceiling.
         */
        this.lock.touch();
        changed += 1;
        await this.reportProgress(jobId, changed);
      });
    }

    // 9 — what the file never mentioned (I1).
    for (const deactivation of plan.deactivations) {
      await this.products.updateForImport(tx, deactivation.productId, { isActive: false });
    }

    // 10 — one row for the human action, not one per thing it touched.
    await this.audit.record(
      {
        action: 'import.apply',
        entityType: 'import_job',
        entityId: jobId,
        summary: `Applied CSV import ${jobId}`,
        metadata: {
          jobId,
          productsCreated: plan.products.filter((p) => p.productId === null).length,
          productsDeactivated: plan.deactivations.length,
          categoriesCreated: plan.categoriesToCreate.length,
          shelvesChanged: countShelves(plan),
        },
      },
      auditContext,
      tx,
    );
  }

  /**
   * §5.5 step 2 and C38. Outside the transaction, because it is file I/O.
   *
   * A failure here stops the import rather than continuing without a backup: this is the only
   * thing standing between "overwrite everything" and an unrecoverable mistake, and an import
   * that quietly proceeded without one would be worst exactly when it mattered.
   */
  private async takeSnapshot(jobId: string): Promise<string | null> {
    try {
      const csv = await this.exporter.toCsv();
      const stored = await this.files.upload({
        kind: 'PRODUCT_SNAPSHOT',
        contents: Buffer.from(csv, 'utf8'),
        originalName: `snapshot-${jobId}.csv`,
        uploadedBy: (await this.require(jobId)).createdById,
      });
      await this.repo.update(jobId, { snapshotFileId: stored.id });
      return stored.id;
    } catch (error) {
      this.logger.error(`Import ${jobId}: snapshot failed, not applying: ${String(error)}`);
      await this.fail(jobId, {
        code: ImportIssueCode.SNAPSHOT_FAILED,
        row: 1,
        column: null,
        value: null,
        message:
          'The backup of the current inventory could not be written, so nothing was imported. A backup that cannot be taken is a reason to stop, not to continue.',
      });
      return null;
    }
  }

  private async fail(jobId: string, issue: ImportIssue): Promise<void> {
    const row = await this.repo.findById(jobId);
    const report = row?.report ?? { errors: [], warnings: [], diff: null };
    await this.repo.update(jobId, {
      status: ImportJobStatus.FAILED,
      report: { ...report, errors: [issue] },
      finishedAt: new Date(),
    });
  }

  /**
   * Writes `processed_rows` and the heartbeat, at most once per heartbeat-quarter.
   *
   * Throttled rather than per-shelf because a write per changed shelf is precisely the cost I10
   * removed from this loop, and progress does not need that resolution — the ring in front of a
   * human updates a few times a second at best.
   */
  private async reportProgress(jobId: string, processedRows: number): Promise<void> {
    const interval = (this.config.imports.heartbeatTimeoutSeconds * 1000) / BEATS_PER_TIMEOUT;
    if (Date.now() - this.lastReportAt < interval) return;
    this.lastReportAt = Date.now();
    await this.repo.update(jobId, { processedRows, heartbeatAt: new Date() });
  }

  /** The padded estimate the 503 carries. Padding only, until the benchmark gives a rate. */
  private estimatedFinish(): Date {
    return new Date(Date.now() + this.config.imports.lockoutPaddingMinutes * 60 * 1000);
  }

  private async require(jobId: string): Promise<ImportJob> {
    const job = await this.jobFrom(jobId);
    if (!job) throw new NotFoundError('Import');
    return job;
  }

  private async jobFrom(jobId: string): Promise<ImportJob | null> {
    const row = await this.repo.findById(jobId);
    return row ? toContract(row, this.config) : null;
  }
}

/** A domain check that passed at preview and fails under lock. Rare, and cheap to hit. */
export class StaleImportError extends Error {
  constructor(readonly issues: ImportIssue[]) {
    super(issues[0]?.message ?? 'The catalogue changed while this import was waiting.');
  }
}

/**
 * What everybody else is told the import will finish by — the honest guess plus the padding
 * from `IMPORT_LOCKOUT_PADDING_MINUTES`. Better to say ten minutes and take five (the brief).
 */
function countShelves(plan: ImportPlan): number {
  return plan.products.reduce(
    (total, product) =>
      total + product.shelves.filter((s) => s.targetOnHand !== s.currentOnHand).length,
    0,
  );
}

function toIssue(error: unknown): ImportIssue {
  if (error instanceof StaleImportError) return error.issues[0]!;
  return {
    code: ImportIssueCode.APPLY_FAILED,
    row: 1,
    column: null,
    value: null,
    message: `The import could not be applied and nothing was changed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

/** Kept for the row shape, since the repository owns the mapping. */
export type { ImportJobRow };
