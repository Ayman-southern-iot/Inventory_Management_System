import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * CSV product import (`importing_data.md`).
 *
 * The file is the desired state of the catalogue, so an import reconciles rather than appends:
 * rows create or update, and a product the file never mentions is deactivated. Nothing is written
 * until a human approves a diff, and the state it replaced is snapshotted first so the whole
 * thing can be put back.
 *
 * Part A ships the vocabulary only — the table, the states, the errors. The pipeline that moves a
 * job between these states arrives in parts C–K.
 */

/**
 * Where a run has got to.
 *
 * `AWAITING_CONFIRMATION` is the human gate and the reason this is a state machine rather than a
 * boolean: validation and apply are separate requests, minutes apart, and the job has to survive
 * in between. `APPLYING` is the only state that locks other users out.
 */
export const ImportJobStatus = {
  VALIDATING: 'VALIDATING',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  APPLYING: 'APPLYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type ImportJobStatus = (typeof ImportJobStatus)[keyof typeof ImportJobStatus];

export const importJobStatusSchema = z.nativeEnum(ImportJobStatus);

/** The three states that hold the one-live-job slot. Mirrors the partial index in 0038. */
export const LIVE_IMPORT_STATUSES: readonly ImportJobStatus[] = [
  ImportJobStatus.VALIDATING,
  ImportJobStatus.AWAITING_CONFIRMATION,
  ImportJobStatus.APPLYING,
];

export const importJobKindSchema = z.literal('products');

/**
 * One problem with one cell, as the validation report lists them.
 *
 * Every failure carries its row and column so the report can be read next to the spreadsheet,
 * and so it can be handed back as a CSV. A validator that says "the file is invalid" and stops
 * at the first error is a validator people give up on.
 */
export const importIssueSchema = z.object({
  /** 1-based, counting the header as row 1, so it matches what the spreadsheet shows. */
  row: z.number().int().positive(),
  /** Absent for a whole-file problem such as a bad fingerprint. */
  column: z.string().nullable(),
  value: z.string().nullable(),
  message: z.string(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

/** What an import is about to do, shown before anything is written. */
export const importDiffSchema = z.object({
  productsCreated: z.number().int().nonnegative(),
  productsUpdated: z.number().int().nonnegative(),
  productsDeactivated: z.number().int().nonnegative(),
  categoriesCreated: z.array(z.string()),
  shelvesChanged: z.number().int().nonnegative(),
  unitsAdded: z.number().int().nonnegative(),
  unitsRemoved: z.number().int().nonnegative(),
  /** Never blocking. The ones worth reading before approving — see plan §5.4. */
  warnings: z.array(importIssueSchema),
});
export type ImportDiff = z.infer<typeof importDiffSchema>;

export const importJobSchema = z.object({
  id: uuidSchema,
  status: importJobStatusSchema,
  fileName: z.string(),
  totalRows: z.number().int().nonnegative().nullable(),
  processedRows: z.number().int().nonnegative(),
  /** 0–100. Null until the row count is known. */
  percent: z.number().int().min(0).max(100).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  estimatedFinishAt: z.string().nullable(),
  /** Populated once validation has run; the diff while awaiting confirmation. */
  errors: z.array(importIssueSchema),
  diff: importDiffSchema.nullable(),
  /** False once an admin has deleted the backup to reclaim the bytes. */
  canRestore: z.boolean(),
  /** Set when this job is itself a rollback of an earlier one. */
  restoredFromJobId: uuidSchema.nullable(),
  createdById: uuidSchema,
  createdByName: z.string(),
  createdAt: z.string(),
});
export type ImportJob = z.infer<typeof importJobSchema>;

/**
 * What every other user is told while an import is applying.
 *
 * Deliberately says almost nothing: an outsider to the import needs to know that the system is
 * busy and roughly when it will not be. The padded estimate comes from
 * `IMPORT_LOCKOUT_PADDING_MINUTES` — better to say ten minutes and take five.
 */
export const importLockStatusSchema = z.object({
  isLocked: z.boolean(),
  estimatedFinishAt: z.string().nullable(),
});
export type ImportLockStatus = z.infer<typeof importLockStatusSchema>;
