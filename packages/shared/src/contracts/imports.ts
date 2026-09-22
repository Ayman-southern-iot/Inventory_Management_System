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
 * What kind of problem an `ImportIssue` is, independent of how it is worded.
 *
 * Not an `ErrorCode`. That enum is one code per failed *request*; these are the up-to-several-
 * hundred per-cell items inside one response, which the SPA groups, counts and links to a row.
 * Selecting on prose is how a reworded message silently breaks a filter, and it is why the tests
 * assert on these rather than on the sentences.
 *
 * **Errors and warnings share one enum, and the member says which it is** — `CATEGORY_AMBIGUOUS`
 * is never a warning, `CATEGORY_RENAMED` is never an error. The two arrays that carry them are a
 * convenience for the caller, not the source of that truth. A member whose severity depends on
 * context would be a member that needs splitting in two.
 */
export const ImportIssueCode = {
  /* ------------------------------------------------- the file, before any row is read */
  FILE_EMPTY: 'FILE_EMPTY',
  FILE_NOT_AN_EXPORT: 'FILE_NOT_AN_EXPORT',
  FILE_WRONG_FORMAT_VERSION: 'FILE_WRONG_FORMAT_VERSION',
  FILE_WRONG_SCHEMA_VERSION: 'FILE_WRONG_SCHEMA_VERSION',
  FILE_FOREIGN_DEPLOYMENT: 'FILE_FOREIGN_DEPLOYMENT',
  FILE_MALFORMED_CSV: 'FILE_MALFORMED_CSV',
  FILE_TOO_MANY_ROWS: 'FILE_TOO_MANY_ROWS',
  FILE_NO_PRODUCTS: 'FILE_NO_PRODUCTS',
  COLUMNS_MISSING: 'COLUMNS_MISSING',
  COLUMNS_UNKNOWN: 'COLUMNS_UNKNOWN',
  COLUMNS_DUPLICATED: 'COLUMNS_DUPLICATED',
  COLUMNS_ABSENT: 'COLUMNS_ABSENT',
  ROW_WRONG_WIDTH: 'ROW_WRONG_WIDTH',

  /* ---------------------------------------------------------- one cell, read on its own */
  VALUE_REQUIRED: 'VALUE_REQUIRED',
  VALUE_INVALID: 'VALUE_INVALID',
  VALUE_NOT_A_FLAG: 'VALUE_NOT_A_FLAG',
  ID_MALFORMED: 'ID_MALFORMED',
  QUANTITY_NOT_WHOLE: 'QUANTITY_NOT_WHOLE',
  QUANTITY_NEGATIVE: 'QUANTITY_NEGATIVE',
  QUANTITY_TOO_LARGE: 'QUANTITY_TOO_LARGE',
  LOCATION_INCOMPLETE: 'LOCATION_INCOMPLETE',
  LOCATION_REQUIRED_FOR_QUANTITY: 'LOCATION_REQUIRED_FOR_QUANTITY',
  CATEGORY_PATH_MALFORMED: 'CATEGORY_PATH_MALFORMED',
  CATEGORY_PATH_TOO_DEEP: 'CATEGORY_PATH_TOO_DEEP',

  /* ----------------------------------------------- what the file says about itself (§4.3) */
  PRODUCT_ROWS_DISAGREE: 'PRODUCT_ROWS_DISAGREE',
  CODE_DUPLICATED_IN_FILE: 'CODE_DUPLICATED_IN_FILE',
  NEW_PRODUCT_NEEDS_CODE: 'NEW_PRODUCT_NEEDS_CODE',
  NEW_PRODUCT_CODE_INCONSISTENT: 'NEW_PRODUCT_CODE_INCONSISTENT',

  /* -------------------------------------------- what it says about the catalogue (§4.1) */
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  CODE_BELONGS_TO_ANOTHER_PRODUCT: 'CODE_BELONGS_TO_ANOTHER_PRODUCT',
  NEW_PRODUCT_CODE_TAKEN: 'NEW_PRODUCT_CODE_TAKEN',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  CATEGORY_AMBIGUOUS: 'CATEGORY_AMBIGUOUS',
  CATEGORY_RETIRED: 'CATEGORY_RETIRED',
  SHELF_LABEL_NOT_FOUND: 'SHELF_LABEL_NOT_FOUND',
  SHELF_NOT_FOUND: 'SHELF_NOT_FOUND',
  SHELF_AMBIGUOUS: 'SHELF_AMBIGUOUS',
  SHELF_RETIRED: 'SHELF_RETIRED',

  /* ------------------------------------------------------------------------ domain (§5.3.6) */
  SHELF_REPEATED: 'SHELF_REPEATED',
  BELOW_RESERVED: 'BELOW_RESERVED',
  SHELF_CLEARED_BUT_RESERVED: 'SHELF_CLEARED_BUT_RESERVED',
  CATEGORY_NOT_TRACKABLE: 'CATEGORY_NOT_TRACKABLE',

  /* ------------------------------------------------------ warnings — never block (§5.3.7) */
  CODE_LOOKS_LIKE_A_DATE: 'CODE_LOOKS_LIKE_A_DATE',
  READ_ONLY_IGNORED: 'READ_ONLY_IGNORED',
  READ_ONLY_UNREADABLE: 'READ_ONLY_UNREADABLE',
  CATEGORY_RENAMED: 'CATEGORY_RENAMED',
  CATEGORY_MATCHED_LOOSELY: 'CATEGORY_MATCHED_LOOSELY',
  SHELF_RENAMED: 'SHELF_RENAMED',
  SHELF_CLEARED_BY_OMISSION: 'SHELF_CLEARED_BY_OMISSION',
  PRODUCT_LEFT_WITH_NO_STOCK: 'PRODUCT_LEFT_WITH_NO_STOCK',
  PRODUCTS_RETIRED_BY_OMISSION: 'PRODUCTS_RETIRED_BY_OMISSION',
  RETIRED_WITH_UNITS_ON_LOAN: 'RETIRED_WITH_UNITS_ON_LOAN',
  UNIT_CHANGED_UNDER_STOCK: 'UNIT_CHANGED_UNDER_STOCK',
  /** A new product's name is close to one already in the catalogue (§5.3 stage 7). */
  NAME_NEAR_DUPLICATE: 'NAME_NEAR_DUPLICATE',
  CATEGORY_NEAR_DUPLICATE: 'CATEGORY_NEAR_DUPLICATE',
  /**
   * The near-duplicate check did not run, because the file introduces more new names than
   * `IMPORT_FUZZY_MATCH_MAX_NEW_NAMES`. Said out loud rather than skipped quietly: losing the
   * check on the largest imports is the opposite of what it is for.
   */
  NEAR_DUPLICATE_CHECK_SKIPPED: 'NEAR_DUPLICATE_CHECK_SKIPPED',
} as const;
export type ImportIssueCode = (typeof ImportIssueCode)[keyof typeof ImportIssueCode];

export const importIssueCodeSchema = z.nativeEnum(ImportIssueCode);

/**
 * The members that never block an import.
 *
 * Severity belongs to the code, not to the array an issue arrives in — so the report CSV, the
 * preview and anything else that receives a flat list can style and group without being handed a
 * second field, and without a hardcoded list of its own. A spec asserts that the validator never
 * puts one of these in `errors`, nor anything else in `warnings`: a member whose severity
 * depended on context would be a member that needed splitting in two, and this is what catches
 * it the day somebody reuses one.
 */
export const IMPORT_WARNING_CODES: readonly ImportIssueCode[] = [
  ImportIssueCode.CODE_LOOKS_LIKE_A_DATE,
  ImportIssueCode.READ_ONLY_IGNORED,
  ImportIssueCode.READ_ONLY_UNREADABLE,
  ImportIssueCode.CATEGORY_RENAMED,
  ImportIssueCode.CATEGORY_MATCHED_LOOSELY,
  ImportIssueCode.SHELF_RENAMED,
  ImportIssueCode.SHELF_CLEARED_BY_OMISSION,
  ImportIssueCode.PRODUCT_LEFT_WITH_NO_STOCK,
  ImportIssueCode.PRODUCTS_RETIRED_BY_OMISSION,
  ImportIssueCode.RETIRED_WITH_UNITS_ON_LOAN,
  ImportIssueCode.UNIT_CHANGED_UNDER_STOCK,
  ImportIssueCode.NAME_NEAR_DUPLICATE,
  ImportIssueCode.CATEGORY_NEAR_DUPLICATE,
  ImportIssueCode.NEAR_DUPLICATE_CHECK_SKIPPED,
];

export function isImportWarning(code: ImportIssueCode): boolean {
  return IMPORT_WARNING_CODES.includes(code);
}

/**
 * One problem with one cell, as the validation report lists them.
 *
 * Every failure carries its row and column so the report can be read next to the spreadsheet,
 * and so it can be handed back as a CSV. A validator that says "the file is invalid" and stops
 * at the first error is a validator people give up on.
 */
export const importIssueSchema = z.object({
  /** What kind of problem this is. The message may be reworded; this may not. */
  code: importIssueCodeSchema,
  /**
   * The physical line in the file, 1-based — so it is the row number the person sees in their
   * spreadsheet and can click straight to. Line 1 is the fingerprint, line 2 the headings, and
   * data begins at line 3. A record containing a quoted newline spans several lines and reports
   * the first.
   */
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
