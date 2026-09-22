import {
  ImportIssueCode,
  createProductSchema,
  formatLocation,
  nameSchema,
  positiveQuantitySchema,
  productCodeSchema,
  type ImportIssue,
} from '@ims/shared';
import { z } from 'zod';
import { CATEGORY_PATH_SEPARATOR, type ImportColumn } from './import-format';
import {
  categoryKey,
  locationKey,
  lookupKey,
  shelfKey,
  type ImportLookups,
  type LookupCategory,
  type LookupCompartment,
  type LookupProduct,
} from './import-lookups';
import type { ParsedRow } from './import-parser';

/**
 * Turns parsed rows into what the import is going to do, or into every reason it cannot
 * (`importing_data.md` §5.3).
 *
 * Six stages, and **each collects all of its failures before stopping**. Fixing a five-thousand
 * row file one error per round trip is what makes people abandon an importer. Stages do stop each
 * other, though: there is no point resolving a category reference in a row whose quantity is the
 * word "seven", and the cascade of nonsense that produces buries the error that mattered.
 *
 * Pure, and deliberately so. Everything the database knows arrives as `ImportLookups`, four
 * queries loaded once (§11.1), which is why this can be tested exhaustively without one.
 */

/** Mirrors the trigger added in migration 0035. */
const MAX_CATEGORY_DEPTH = 3;

/** Codes Excel has turned into a date on the way through — plan C23. */
const DATE_LIKE_CODE = /^(\d{1,2}[-/][A-Za-z]{3}([-/]\d{2,4})?|\d{4}-\d{2}-\d{2})$/;

export interface PlannedShelf {
  compartmentId: string;
  storageId: string;
  /** `Main Store / Meta / 1A`, for the diff and for error messages. */
  location: string;
  currentOnHand: number;
  targetOnHand: number;
  /** Null when the file does not mention this shelf and it is therefore being cleared (§4.5). */
  line: number | null;
}

/** A category the file asks for that does not exist yet (I8). Parent-first within the array. */
export interface PlannedCategory {
  /** Root-first, as it will be written. */
  path: string[];
  /** The existing category it hangs under, or null for a new root. */
  parentId: string | null;
  /** Index into `ImportPlan.categoriesToCreate` when the parent is itself new. */
  parentIndex: number | null;
}

export interface PlannedProduct {
  /** Null means create. */
  productId: string | null;
  /** Null on a new product means generate one (migration 0036). */
  productCode: string | null;
  name: string;
  description: string | null;
  unit: string;
  defaultReturnable: boolean;
  isActive: boolean;
  categoryId: string | null;
  /** Index into `ImportPlan.categoriesToCreate` when the category does not exist yet. */
  newCategoryIndex: number | null;
  shelves: PlannedShelf[];
  /** Every file line that contributed to this product, for the report. */
  lines: number[];
}

export interface PlannedDeactivation {
  productId: string;
  name: string;
  onHand: number;
  /** Still out on loan. The reason this one is called out in the preview (C31). */
  inUse: number;
}

export interface ImportPlan {
  products: PlannedProduct[];
  categoriesToCreate: PlannedCategory[];
  deactivations: PlannedDeactivation[];
}

export interface ValidationResult {
  /** Null whenever there are errors: there is nothing to preview and nothing to apply. */
  plan: ImportPlan | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

export function validateImport(rows: ParsedRow[], lookups: ImportLookups): ValidationResult {
  const warnings: ImportIssue[] = [];

  // 2 — nulls. The brief's first check, and its own stage so that a file full of blanks reports
  // blanks rather than a hundred type errors derived from them.
  const nullErrors = rows.flatMap(checkRequired);
  if (nullErrors.length > 0) return { plan: null, errors: nullErrors, warnings };

  // 3 — types and ranges.
  const typeErrors: ImportIssue[] = [];
  const typed = rows.map((row) => readRow(row, typeErrors, warnings));
  if (typeErrors.length > 0) return { plan: null, errors: typeErrors, warnings };

  // 4 — internal consistency: what this file says about itself.
  const grouped = groupRows(typed);
  if (grouped.errors.length > 0) return { plan: null, errors: grouped.errors, warnings };

  // 5 — referential: what it says about the catalogue.
  const resolved = resolveGroups(grouped.groups, lookups, warnings);
  if (resolved.errors.length > 0) return { plan: null, errors: resolved.errors, warnings };

  // 6 — domain, and the plan that falls out of it.
  const planned = buildPlan(resolved.groups, resolved.categoriesToCreate, lookups, warnings);
  if (planned.errors.length > 0) return { plan: null, errors: planned.errors, warnings };

  return { plan: planned.plan, errors: [], warnings };
}

/* ------------------------------------------------------------------ stage 2: nulls */

const REQUIRED_COLUMNS: readonly ImportColumn[] = [
  'product_name',
  'unit',
  'default_returnable',
  'status',
];

function checkRequired(row: ParsedRow): ImportIssue[] {
  const issues: ImportIssue[] = [];

  for (const column of REQUIRED_COLUMNS) {
    if (row.cells[column] === '') {
      issues.push(
        issue(
          ImportIssueCode.VALUE_REQUIRED,
          row.line,
          column,
          '',
          `"${column}" is empty and must have a value.`,
        ),
      );
    }
  }

  const parts = (['room', 'zone', 'compartment'] as const).filter(
    (column) => row.cells[column] !== '',
  );

  if (parts.length > 0 && parts.length < 3) {
    issues.push(
      issue(
        ImportIssueCode.LOCATION_INCOMPLETE,
        row.line,
        'room',
        locationText(row),
        'A location needs all three of room, zone and compartment. Fill in the missing part, or clear all three and leave the quantity at zero.',
      ),
    );
  }

  /*
   * Plan I3, Ayman's decision: a blank location is allowed only when there is nothing to put
   * there. A catalogue entry with no shelf yet is an ordinary state; a quantity with no shelf is
   * stock in a place nobody can be sent to.
   */
  if (parts.length === 0 && row.cells.storage_id === '' && !isBlankOrZero(row.cells.on_hand)) {
    issues.push(
      issue(
        ImportIssueCode.LOCATION_REQUIRED_FOR_QUANTITY,
        row.line,
        'room',
        row.cells.on_hand,
        `This row has ${row.cells.on_hand} units but no location. Fill in room, zone and compartment, or set the quantity to 0.`,
      ),
    );
  }

  return issues;
}

/** Deliberately lenient: anything that is not recognisably zero counts as stock for I3's rule. */
function isBlankOrZero(value: string): boolean {
  if (value.trim() === '') return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

/* --------------------------------------------------- stage 3: types, ranges, shapes */

interface TypedRow {
  line: number;
  productId: string | null;
  productCode: string | null;
  name: string;
  description: string | null;
  unit: string;
  categoryId: string | null;
  /** Empty when the file leaves the path blank. */
  categoryPath: string[];
  defaultReturnable: boolean;
  isActive: boolean;
  storageId: string | null;
  room: string | null;
  zone: string | null;
  compartment: string | null;
  onHand: number;
  /** As typed. Compared against reality to warn that editing them achieved nothing (I9). */
  stated: { reserved: number | null; quarantined: number | null; inUse: number | null };
}

const uuid = z.string().uuid();

function readRow(row: ParsedRow, errors: ImportIssue[], warnings: ImportIssue[]): TypedRow {
  const cell = (column: ImportColumn): string => row.cells[column];
  const fail = (code: ImportIssueCode, column: ImportColumn, message: string): void => {
    errors.push(issue(code, row.line, column, cell(column), message));
  };

  const text = (column: ImportColumn, schema: z.ZodTypeAny): string | null => {
    const value = cell(column);
    if (value === '') return null;
    const result = schema.safeParse(value);
    if (!result.success) {
      fail(ImportIssueCode.VALUE_INVALID, column, `"${column}" ${describe(result.error)}.`);
      return null;
    }
    return typeof result.data === 'string' ? result.data : value;
  };

  const id = (column: ImportColumn): string | null => {
    const value = cell(column);
    if (value === '') return null;
    if (!uuid.safeParse(value).success) {
      fail(
        ImportIssueCode.ID_MALFORMED,
        column,
        `"${value}" is not an id this system could have written. Leave it blank for a new product, or paste the value from a fresh export.`,
      );
      return null;
    }
    return value;
  };

  const number_ = (column: ImportColumn, readOnly: boolean): number | null => {
    const value = cell(column);
    if (value === '') return 0; // The brief: a blank counting value is zero, never an error.
    const parsed = Number(value.replace(/,/g, ''));

    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      if (readOnly) {
        // It is ignored on import either way, so refusing the file over it would be pedantry.
        warnings.push(
          issue(
            ImportIssueCode.READ_ONLY_UNREADABLE,
            row.line,
            column,
            value,
            `"${column}" is not a whole number. It is ignored on import, so nothing was changed by it.`,
          ),
        );
        return null;
      }
      fail(
        ImportIssueCode.QUANTITY_NOT_WHOLE,
        column,
        `"${value}" is not a whole number of units.`,
      );
      return null;
    }

    if (parsed < 0) {
      if (readOnly) return null;
      fail(ImportIssueCode.QUANTITY_NEGATIVE, column, 'A quantity cannot be negative.');
      return null;
    }

    if (!readOnly && parsed > 0 && !positiveQuantitySchema.safeParse(parsed).success) {
      fail(
        ImportIssueCode.QUANTITY_TOO_LARGE,
        column,
        `A quantity above ${positiveQuantitySchema.maxValue} is not a quantity, it is a typo.`,
      );
      return null;
    }

    return parsed;
  };

  const flag = (column: ImportColumn, yes: string, no: string): boolean => {
    const value = cell(column).toLowerCase();
    if (value === yes.toLowerCase()) return true;
    if (value === no.toLowerCase()) return false;
    fail(
      ImportIssueCode.VALUE_NOT_A_FLAG,
      column,
      `"${cell(column)}" is not a value for "${column}". Write ${yes} or ${no}.`,
    );
    return false;
  };

  const categoryPath = readCategoryPath(row, errors);
  const code = text('product_code', productCodeSchema);

  if (code !== null && DATE_LIKE_CODE.test(code)) {
    // Excel does this on open, before anybody has typed anything (C23).
    warnings.push(
      issue(
        ImportIssueCode.CODE_LOOKS_LIKE_A_DATE,
        row.line,
        'product_code',
        code,
        `"${code}" looks like a date. Excel rewrites codes such as 1-2 when it opens a file; check this is the code you meant.`,
      ),
    );
  }

  return {
    line: row.line,
    productId: id('product_id'),
    productCode: code,
    name: collapse(text('product_name', nameSchema) ?? ''),
    description: text('description', createProductSchema.shape.description),
    unit: text('unit', createProductSchema.shape.unit) ?? '',
    categoryId: id('category_id'),
    categoryPath,
    defaultReturnable: flag('default_returnable', 'yes', 'no'),
    isActive: flag('status', 'Active', 'Inactive'),
    storageId: cell('storage_id') === '' ? null : cell('storage_id'),
    room: cell('room') === '' ? null : cell('room'),
    zone: cell('zone') === '' ? null : cell('zone'),
    compartment: cell('compartment') === '' ? null : cell('compartment'),
    onHand: number_('on_hand', false) ?? 0,
    stated: {
      reserved: number_('reserved', true),
      quarantined: number_('quarantined', true),
      inUse: number_('in_use_total', true),
    },
  };
}

function readCategoryPath(row: ParsedRow, errors: ImportIssue[]): string[] {
  const raw = row.cells.category_path;
  if (raw === '') return [];

  const segments = raw.split('/').map((segment) => collapse(segment));

  if (segments.some((segment) => segment === '')) {
    errors.push(
      issue(
        ImportIssueCode.CATEGORY_PATH_MALFORMED,
        row.line,
        'category_path',
        raw,
        'A category path has an empty step in it. Write it as Electronics / Computers / Laptops.',
      ),
    );
    return [];
  }

  if (segments.length > MAX_CATEGORY_DEPTH) {
    // The trigger in 0035 would refuse this mid-transaction; refusing it here is the same
    // answer with the row number attached.
    errors.push(
      issue(
        ImportIssueCode.CATEGORY_PATH_TOO_DEEP,
        row.line,
        'category_path',
        raw,
        `Categories go ${MAX_CATEGORY_DEPTH} levels deep at most (category > subcategory > type); this path has ${segments.length}.`,
      ),
    );
    return [];
  }

  for (const segment of segments) {
    const result = nameSchema.safeParse(segment);
    if (!result.success) {
      errors.push(
        issue(
          ImportIssueCode.VALUE_INVALID,
          row.line,
          'category_path',
          segment,
          `The category "${segment}" ${describe(result.error)}.`,
        ),
      );
      return [];
    }
  }

  return segments;
}

/* ------------------------------------------------- stage 4: what the file says about itself */

interface RowGroup {
  /** From the file. Null means the rows describe a product that does not exist yet. */
  productId: string | null;
  productCode: string | null;
  rows: TypedRow[];
}

interface Grouped {
  groups: RowGroup[];
  errors: ImportIssue[];
}

function groupRows(rows: TypedRow[]): Grouped {
  const errors: ImportIssue[] = [];
  const byId = new Map<string, TypedRow[]>();
  const byCode = new Map<string, TypedRow[]>();
  const byName = new Map<string, TypedRow[]>();

  for (const row of rows) {
    if (row.productId !== null) push(byId, row.productId, row);
    else if (row.productCode !== null) push(byCode, lookupKey(row.productCode), row);
    else push(byName, lookupKey(row.name), row);
  }

  const groups: RowGroup[] = [];

  for (const [productId, rowsForId] of byId) {
    groups.push({ productId, productCode: rowsForId[0]!.productCode, rows: rowsForId });
  }

  for (const [, rowsForCode] of byCode) {
    groups.push({ productId: null, productCode: rowsForCode[0]!.productCode, rows: rowsForCode });
  }

  for (const [, rowsForName] of byName) {
    if (rowsForName.length > 1) {
      /*
       * §4.3. Two rows for a product that does not exist yet, sharing only a name: the importer
       * cannot tell one product on two shelves from two products that happen to be called the
       * same thing. Matching on the name would do both wrong — splitting a product on a typo,
       * merging two genuinely different SKUs — so the file has to say which it meant.
       */
      for (const row of rowsForName) {
        errors.push(
          issue(
            ImportIssueCode.NEW_PRODUCT_NEEDS_CODE,
            row.line,
            'product_code',
            row.name,
            `${rowsForName.length} rows describe a new product called "${row.name}" on different shelves, with no product code to say they are the same product. Give every one of them the same product_code, or set the product_id if this product already exists. Rows: ${rowsForName.map((r) => r.line).join(', ')}.`,
          ),
        );
      }
      continue;
    }
    groups.push({ productId: null, productCode: null, rows: rowsForName });
  }

  for (const group of groups) errors.push(...checkGroupAgrees(group));
  errors.push(...checkCodesAreUnique(groups));
  errors.push(...checkNewProductsAreDistinct(groups));

  return { groups, errors: sortIssues(errors) };
}

/** Every row of one product repeats its product columns; they had better say the same thing. */
function checkGroupAgrees(group: RowGroup): ImportIssue[] {
  const [first, ...rest] = group.rows;
  if (!first || rest.length === 0) return [];

  const fields: { column: ImportColumn; read: (row: TypedRow) => string }[] = [
    { column: 'product_name', read: (row) => row.name },
    { column: 'product_code', read: (row) => row.productCode ?? '' },
    { column: 'unit', read: (row) => row.unit },
    { column: 'description', read: (row) => row.description ?? '' },
    { column: 'category_id', read: (row) => row.categoryId ?? '' },
    { column: 'category_path', read: (row) => row.categoryPath.join(CATEGORY_PATH_SEPARATOR) },
    { column: 'default_returnable', read: (row) => String(row.defaultReturnable) },
    { column: 'status', read: (row) => String(row.isActive) },
  ];

  const issues: ImportIssue[] = [];
  for (const field of fields) {
    const values = new Set(group.rows.map((row) => lookupKey(field.read(row))));
    if (values.size <= 1) continue;
    for (const row of group.rows) {
      issues.push(
        issue(
          ImportIssueCode.PRODUCT_ROWS_DISAGREE,
          row.line,
          field.column,
          field.read(row),
          `The rows for this product disagree about "${field.column}". Every row of one product repeats its details, so they all have to match. Rows: ${group.rows.map((r) => r.line).join(', ')}.`,
        ),
      );
    }
  }
  return issues;
}

function checkCodesAreUnique(groups: RowGroup[]): ImportIssue[] {
  const byCode = new Map<string, RowGroup[]>();
  for (const group of groups) {
    if (group.productCode === null) continue;
    push(byCode, lookupKey(group.productCode), group);
  }

  const issues: ImportIssue[] = [];
  for (const [, sharing] of byCode) {
    if (sharing.length === 1) continue;
    const lines = sharing
      .flatMap((group) => group.rows.map((row) => row.line))
      .sort((a, b) => a - b);
    for (const group of sharing) {
      for (const row of group.rows) {
        issues.push(
          issue(
            ImportIssueCode.CODE_DUPLICATED_IN_FILE,
            row.line,
            'product_code',
            row.productCode,
            `Two different products in this file share the product code "${row.productCode}". A code identifies one product. Rows: ${lines.join(', ')}.`,
          ),
        );
      }
    }
  }
  return issues;
}

/**
 * The other half of §4.3: a new product whose rows do not all carry its code.
 *
 * Grouping is per row — id, else code, else name — so a product code typed on one row and
 * forgotten on the next lands the two rows in different buckets, and each looks like a perfectly
 * good lone new product. The result is two products created, half the intended stock on each,
 * and no error anywhere. That is exactly the failure §4.3 exists to prevent, reached by a subtler
 * path than leaving the code off every row, and it is what editing a spreadsheet actually
 * produces: you type a value once and do not repeat it down the column.
 *
 * Two new products genuinely sharing a name is allowed and stays allowed — different SKUs from
 * different factories is not hypothetical — but only when **each** carries its own code, because
 * that is the file saying so rather than the importer guessing.
 */
function checkNewProductsAreDistinct(groups: RowGroup[]): ImportIssue[] {
  const byName = new Map<string, RowGroup[]>();
  for (const group of groups) {
    // An existing product's identity is settled by its id; names are not unique and never were.
    if (group.productId !== null) continue;
    push(byName, lookupKey(group.rows[0]!.name), group);
  }

  const issues: ImportIssue[] = [];
  for (const [, sharing] of byName) {
    if (sharing.length < 2) continue;
    if (sharing.every((group) => group.productCode !== null)) continue;

    const lines = sharing
      .flatMap((group) => group.rows.map((row) => row.line))
      .sort((a, b) => a - b);

    for (const group of sharing) {
      for (const row of group.rows) {
        issues.push(
          issue(
            ImportIssueCode.NEW_PRODUCT_CODE_INCONSISTENT,
            row.line,
            'product_code',
            row.productCode,
            `Rows ${lines.join(', ')} look like one new product called "${row.name}" on several shelves, but only some of them carry a product_code. Give every row of one product the same code, or, if these really are different products, give each one its own code.`,
          ),
        );
      }
    }
  }
  return issues;
}

/* ------------------------------------------- stage 5: what the file says about the catalogue */

interface ResolvedShelf {
  line: number;
  compartment: LookupCompartment;
  onHand: number;
  stated: TypedRow['stated'];
}

interface ResolvedGroup {
  group: RowGroup;
  existing: LookupProduct | null;
  categoryId: string | null;
  newCategoryIndex: number | null;
  shelves: ResolvedShelf[];
}

interface Resolved {
  groups: ResolvedGroup[];
  categoriesToCreate: PlannedCategory[];
  errors: ImportIssue[];
}

function resolveGroups(
  groups: RowGroup[],
  lookups: ImportLookups,
  warnings: ImportIssue[],
): Resolved {
  const errors: ImportIssue[] = [];
  const planner = createCategoryPlanner(lookups);
  const resolved: ResolvedGroup[] = [];

  for (const group of groups) {
    const first = group.rows[0]!;
    const existing = resolveProduct(group, lookups, errors);

    const category = resolveCategory(first, lookups, planner, errors, warnings);

    const shelves: ResolvedShelf[] = [];
    for (const row of group.rows) {
      const compartment = resolveLocation(row, lookups, errors, warnings);
      if (compartment === null) continue;
      shelves.push({ line: row.line, compartment, onHand: row.onHand, stated: row.stated });
    }

    resolved.push({
      group,
      existing,
      categoryId: category.categoryId,
      newCategoryIndex: category.newCategoryIndex,
      shelves,
    });
  }

  return { groups: resolved, categoriesToCreate: planner.planned, errors: sortIssues(errors) };
}

function resolveProduct(
  group: RowGroup,
  lookups: ImportLookups,
  errors: ImportIssue[],
): LookupProduct | null {
  const byCode = group.productCode
    ? lookups.productByCode.get(lookupKey(group.productCode))
    : undefined;

  if (group.productId !== null) {
    const existing = lookups.productById.get(group.productId);
    if (!existing) {
      /*
       * C29. Treating it as new would duplicate a product every time somebody imported a stale
       * export, and the duplicate would carry the stale id in its file for ever after.
       */
      for (const row of group.rows) {
        errors.push(
          issue(
            ImportIssueCode.PRODUCT_NOT_FOUND,
            row.line,
            'product_id',
            group.productId,
            'No product in this system has this id. It may come from an older export, or from a different installation. Clear the column to create a new product, or export a fresh file.',
          ),
        );
      }
      return null;
    }

    if (byCode && byCode.id !== existing.id) {
      // C2, reported here rather than as a unique violation from the middle of the transaction.
      for (const row of group.rows) {
        errors.push(
          issue(
            ImportIssueCode.CODE_BELONGS_TO_ANOTHER_PRODUCT,
            row.line,
            'product_code',
            group.productCode,
            `The product code "${group.productCode}" already belongs to "${byCode.name}". Two products cannot share a code.`,
          ),
        );
      }
    }

    return existing;
  }

  if (byCode) {
    /*
     * A blank id says "create", the code says "this already exists". Rather than guess, the file
     * is refused: creating would hit the unique index mid-apply, and quietly updating the
     * existing product would let a mistyped code overwrite an unrelated product's name, unit and
     * category with nobody ever seeing it happen.
     */
    for (const row of group.rows) {
      errors.push(
        issue(
          ImportIssueCode.NEW_PRODUCT_CODE_TAKEN,
          row.line,
          'product_code',
          group.productCode,
          `The product code "${group.productCode}" already belongs to "${byCode.name}", but this row has no product_id, so it asks to create a second product with it. To update that product, put its product_id in this row; to create a new one, give it a different code.`,
        ),
      );
    }
    return null;
  }

  return null;
}

interface CategoryPlanner {
  planned: PlannedCategory[];
  ensure(path: string[]): number;
}

function createCategoryPlanner(lookups: ImportLookups): CategoryPlanner {
  const planned: PlannedCategory[] = [];
  const indexByKey = new Map<string, number>();

  return {
    planned,
    ensure(path: string[]): number {
      // Deepest existing ancestor first: `A / B / C` where `A / B` exists creates only `C`.
      let parentId: string | null = null;
      let parentIndex: number | null = null;
      let start = 0;

      for (let depth = path.length - 1; depth >= 1; depth -= 1) {
        const ancestor = lookups.categoryByPath.get(categoryKey(path.slice(0, depth)));
        if (ancestor) {
          parentId = ancestor.id;
          start = depth;
          break;
        }
      }

      for (let depth = start; depth < path.length; depth += 1) {
        const prefix = path.slice(0, depth + 1);
        const key = categoryKey(prefix);
        const already = indexByKey.get(key);
        if (already !== undefined) {
          // C9: two rows asking for the same new category create it once.
          parentIndex = already;
          parentId = null;
          continue;
        }
        planned.push({ path: prefix, parentId, parentIndex });
        parentIndex = planned.length - 1;
        parentId = null;
        indexByKey.set(key, parentIndex);
      }

      return parentIndex!;
    },
  };
}

function resolveCategory(
  row: TypedRow,
  lookups: ImportLookups,
  planner: CategoryPlanner,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): { categoryId: string | null; newCategoryIndex: number | null } {
  const none = { categoryId: null, newCategoryIndex: null };
  const byId = row.categoryId ? lookups.categoryById.get(row.categoryId) : undefined;
  const byPath =
    row.categoryPath.length > 0
      ? lookups.categoryByPath.get(categoryKey(row.categoryPath))
      : undefined;

  if (row.categoryId !== null && !byId) {
    errors.push(
      issue(
        ImportIssueCode.CATEGORY_NOT_FOUND,
        row.line,
        'category_id',
        row.categoryId,
        'No category in this system has this id. Clear the column and leave the path, and the category will be matched by name or created.',
      ),
    );
    return none;
  }

  if (byId && byPath && byId.id !== byPath.id) {
    // §4.1, C11. The file says two different things; picking one would be a coin toss.
    errors.push(
      issue(
        ImportIssueCode.CATEGORY_AMBIGUOUS,
        row.line,
        'category_path',
        row.categoryPath.join(CATEGORY_PATH_SEPARATOR),
        `This row's category_id is "${byId.path.join(CATEGORY_PATH_SEPARATOR)}" but its category_path is a different category. Clear whichever one is wrong.`,
      ),
    );
    return none;
  }

  if (byId && !byPath && row.categoryPath.length > 0) {
    // §4.1, C12: the id wins, because the id is what cannot be renamed.
    warnings.push(
      issue(
        ImportIssueCode.CATEGORY_RENAMED,
        row.line,
        'category_path',
        row.categoryPath.join(CATEGORY_PATH_SEPARATOR),
        `This category has been renamed to "${byId.path.join(CATEGORY_PATH_SEPARATOR)}" since this file was exported. The row was matched by its id, and the new name is being kept.`,
      ),
    );
  }

  const existing = byId ?? byPath;
  if (existing) {
    if (!existing.isActive) {
      // C8. Reactivating a retired category is a decision somebody makes on purpose.
      errors.push(
        issue(
          ImportIssueCode.CATEGORY_RETIRED,
          row.line,
          'category_path',
          existing.path.join(CATEGORY_PATH_SEPARATOR),
          `The category "${existing.path.join(CATEGORY_PATH_SEPARATOR)}" is retired. Reactivate it in the categories screen first, or file this product somewhere else.`,
        ),
      );
      return none;
    }
    if (byPath && spellingDiffers(row.categoryPath, existing.path)) {
      // C10: matched by the rule the unique index uses, which is not case-sensitive.
      warnings.push(
        issue(
          ImportIssueCode.CATEGORY_MATCHED_LOOSELY,
          row.line,
          'category_path',
          row.categoryPath.join(CATEGORY_PATH_SEPARATOR),
          `Matched the existing category "${existing.path.join(CATEGORY_PATH_SEPARATOR)}". No second category was created, and the existing spelling was kept.`,
        ),
      );
    }
    return { categoryId: existing.id, newCategoryIndex: null };
  }

  if (row.categoryPath.length === 0) return none;

  // I8: the file may create a category. The blank the brief allows is here — a product with no
  // category at all is a supported state, so neither column is required.
  return { categoryId: null, newCategoryIndex: planner.ensure(row.categoryPath) };
}

function resolveLocation(
  row: TypedRow,
  lookups: ImportLookups,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): LookupCompartment | null {
  const hasPath = row.room !== null && row.zone !== null && row.compartment !== null;
  const byStorageId = row.storageId
    ? lookups.compartmentByStorageId.get(lookupKey(row.storageId))
    : undefined;
  const byPath = hasPath
    ? lookups.compartmentByLocation.get(locationKey(row.room!, row.zone!, row.compartment!))
    : undefined;

  if (row.storageId !== null && !byStorageId && !byPath) {
    errors.push(
      issue(
        ImportIssueCode.SHELF_LABEL_NOT_FOUND,
        row.line,
        'storage_id',
        row.storageId,
        `No shelf in this system carries the label "${row.storageId}". Shelf labels are printed and cannot be changed by an import; clear the column to match the shelf by room, zone and compartment instead.`,
      ),
    );
    return null;
  }

  if (byStorageId && byPath && byStorageId.id !== byPath.id) {
    // §4.1, C34.
    errors.push(
      issue(
        ImportIssueCode.SHELF_AMBIGUOUS,
        row.line,
        'storage_id',
        row.storageId,
        `The shelf label "${row.storageId}" is ${describeLocation(byStorageId)}, but this row's room, zone and compartment name a different shelf. Clear whichever one is wrong.`,
      ),
    );
    return null;
  }

  if (byStorageId && !byPath && hasPath) {
    // §4.1, C35. The label is on the physical shelf; the name in the file is a memory of it.
    warnings.push(
      issue(
        ImportIssueCode.SHELF_RENAMED,
        row.line,
        'room',
        locationTextOf(row),
        `This location has been renamed to ${describeLocation(byStorageId)} since this file was exported. The row was matched by its shelf label "${byStorageId.storageId}".`,
      ),
    );
  }

  const compartment = byStorageId ?? byPath;

  if (!compartment) {
    if (!hasPath) return null; // No location at all: allowed, and stage 2 checked the quantity.
    // C13. Locations are never created by an import — the shelf has to exist in the building.
    errors.push(
      issue(
        ImportIssueCode.SHELF_NOT_FOUND,
        row.line,
        'room',
        locationTextOf(row),
        `There is no shelf at ${locationTextOf(row)}. Locations are not created by an import; add the room, zone or compartment on the Locations screen first.`,
      ),
    );
    return null;
  }

  if (!compartment.isActive) {
    // C14. `StockService.adjust` does not check this, so nothing downstream would catch it.
    errors.push(
      issue(
        ImportIssueCode.SHELF_RETIRED,
        row.line,
        'room',
        locationTextOf(row),
        `${describeLocation(compartment)} is retired (its ${compartment.inactiveLevel} is not active). Reactivate it on the Locations screen, or put this stock somewhere else.`,
      ),
    );
    return null;
  }

  return compartment;
}

/* ------------------------------------------------------- stage 6: domain, and the plan */

interface Planned {
  plan: ImportPlan;
  errors: ImportIssue[];
}

function buildPlan(
  groups: ResolvedGroup[],
  categoriesToCreate: PlannedCategory[],
  lookups: ImportLookups,
  warnings: ImportIssue[],
): Planned {
  const errors: ImportIssue[] = [];
  const products: PlannedProduct[] = [];
  const mentioned = new Set<string>();

  for (const resolved of groups) {
    const first = resolved.group.rows[0]!;
    const existing = resolved.existing;
    if (existing) mentioned.add(existing.id);

    const shelves = planShelves(resolved, lookups, errors, warnings);
    checkTrackable(resolved, shelves, lookups, errors);
    warnAboutProduct(resolved, shelves, warnings);

    products.push({
      productId: existing?.id ?? null,
      productCode: first.productCode,
      name: first.name,
      description: first.description,
      unit: first.unit,
      defaultReturnable: first.defaultReturnable,
      isActive: first.isActive,
      categoryId: resolved.categoryId,
      newCategoryIndex: resolved.newCategoryIndex,
      shelves,
      lines: resolved.group.rows.map((row) => row.line),
    });
  }

  const deactivations: PlannedDeactivation[] = [];
  for (const product of lookups.products) {
    if (!product.isActive || mentioned.has(product.id)) continue;
    /*
     * I1: the file is the desired state, so a product it never mentions is retired. Its stock is
     * left where it is — deactivating a catalogue entry is reversible, and zeroing shelves the
     * file never spoke about would destroy stock on the strength of an omission.
     */
    deactivations.push({
      productId: product.id,
      name: product.name,
      onHand: product.onHand,
      inUse: product.inUse,
    });
  }

  if (deactivations.length > 0) {
    warnings.push(
      issue(
        ImportIssueCode.PRODUCTS_RETIRED_BY_OMISSION,
        2,
        null,
        null,
        `${deactivations.length} product${deactivations.length === 1 ? '' : 's'} in the catalogue ${deactivations.length === 1 ? 'is' : 'are'} not in this file and will be retired: ${listNames(deactivations.map((d) => d.name))}.`,
      ),
    );
  }

  for (const deactivation of deactivations) {
    if (deactivation.inUse > 0) {
      // C31.
      warnings.push(
        issue(
          ImportIssueCode.RETIRED_WITH_UNITS_ON_LOAN,
          2,
          null,
          deactivation.name,
          `"${deactivation.name}" is being retired but still has ${deactivation.inUse} unit${deactivation.inUse === 1 ? '' : 's'} out on loan.`,
        ),
      );
    }
  }

  return {
    plan: { products, categoriesToCreate, deactivations },
    errors: sortIssues(errors),
  };
}

function planShelves(
  resolved: ResolvedGroup,
  lookups: ImportLookups,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): PlannedShelf[] {
  const shelves: PlannedShelf[] = [];
  const seen = new Map<string, ResolvedShelf>();

  for (const shelf of resolved.shelves) {
    const already = seen.get(shelf.compartment.id);
    if (already) {
      // C6, and `UNIQUE (product_id, compartment_id)` would refuse it anyway. Two spellings of
      // the same shelf are still the same shelf, which is why this is checked after resolution.
      errors.push(
        issue(
          ImportIssueCode.SHELF_REPEATED,
          shelf.line,
          'storage_id',
          shelf.compartment.storageId,
          `This product is on ${describeLocation(shelf.compartment)} twice in this file (rows ${already.line} and ${shelf.line}). Put the total on one row.`,
        ),
      );
      continue;
    }
    seen.set(shelf.compartment.id, shelf);

    const current = resolved.existing
      ? lookups.placementByShelf.get(shelfKey(resolved.existing.id, shelf.compartment.id))
      : undefined;

    const held = (current?.reservedQty ?? 0) + (current?.quarantinedQty ?? 0);
    if (shelf.onHand < held) {
      // C20. Reserved and quarantined units are physically on the shelf; a count below them is
      // not a count, and `adjust` would leave available negative.
      errors.push(
        issue(
          ImportIssueCode.BELOW_RESERVED,
          shelf.line,
          'on_hand',
          String(shelf.onHand),
          `${describeLocation(shelf.compartment)} holds ${held} unit${held === 1 ? '' : 's'} that are reserved or quarantined, so its count cannot go below ${held}. Release the reservation first, or count ${held} or more.`,
        ),
      );
    }

    warnAboutReadOnly(shelf, current, warnings);

    shelves.push({
      compartmentId: shelf.compartment.id,
      storageId: shelf.compartment.storageId,
      location: describeLocation(shelf.compartment),
      currentOnHand: current?.quantity ?? 0,
      targetOnHand: shelf.onHand,
      line: shelf.line,
    });
  }

  if (!resolved.existing) return shelves;

  /*
   * §4.5, the dangerous case. A product's shelf rows in the file are the complete list of where
   * it is, so a shelf the file does not mention is emptied. That is how you legitimately clear a
   * shelf, and it is also how somebody destroys their stock by tidying a spreadsheet — which is
   * what the confirm step and the warning below are for.
   */
  for (const placement of lookups.placementsByProduct.get(resolved.existing.id) ?? []) {
    if (seen.has(placement.compartmentId)) continue;
    const compartment = lookups.compartmentById.get(placement.compartmentId);
    if (!compartment) continue;

    const held = placement.reservedQty + placement.quarantinedQty;
    if (held > 0) {
      errors.push(
        issue(
          ImportIssueCode.SHELF_CLEARED_BUT_RESERVED,
          resolved.group.rows[0]!.line,
          null,
          null,
          `"${resolved.group.rows[0]!.name}" has no row for ${describeLocation(compartment)}, which would empty that shelf — but ${held} of its units are reserved or quarantined. Add a row for that shelf with a count of ${held} or more.`,
        ),
      );
      continue;
    }

    if (placement.quantity > 0) {
      warnings.push(
        issue(
          ImportIssueCode.SHELF_CLEARED_BY_OMISSION,
          resolved.group.rows[0]!.line,
          null,
          null,
          `${placement.quantity} unit${placement.quantity === 1 ? '' : 's'} of "${resolved.group.rows[0]!.name}" at ${describeLocation(compartment)} will be removed: this file has no row for that shelf.`,
        ),
      );
    }

    shelves.push({
      compartmentId: placement.compartmentId,
      storageId: compartment.storageId,
      location: describeLocation(compartment),
      currentOnHand: placement.quantity,
      targetOnHand: 0,
      line: null,
    });
  }

  return shelves;
}

function checkTrackable(
  resolved: ResolvedGroup,
  shelves: PlannedShelf[],
  lookups: ImportLookups,
  errors: ImportIssue[],
): void {
  const units = shelves.reduce((total, shelf) => total + shelf.targetOnHand, 0);
  if (units === 0) return;

  // A category the file is creating is trackable; an uncategorised product is trackable (OQ-F).
  const category: LookupCategory | undefined = resolved.categoryId
    ? lookups.categoryById.get(resolved.categoryId)
    : undefined;
  if (!category || category.isTrackable) return;

  // C27. requirements §11: an untracked category holds catalogue entries, not stock.
  for (const row of resolved.group.rows) {
    if (row.onHand === 0) continue;
    errors.push(
      issue(
        ImportIssueCode.CATEGORY_NOT_TRACKABLE,
        row.line,
        'on_hand',
        String(row.onHand),
        `"${category.path.join(CATEGORY_PATH_SEPARATOR)}" is an untracked category, which holds catalogue entries but no stock. Move this product to a tracked category, or set the quantity to 0.`,
      ),
    );
  }
}

function warnAboutProduct(
  resolved: ResolvedGroup,
  shelves: PlannedShelf[],
  warnings: ImportIssue[],
): void {
  const existing = resolved.existing;
  if (!existing) return;
  const first = resolved.group.rows[0]!;

  if (lookupKey(existing.unit) !== lookupKey(first.unit) && existing.onHand > 0) {
    // C30. Not an error — the IM may be correcting a wrong unit — but the number on every shelf
    // now means something else, and nobody recounted.
    warnings.push(
      issue(
        ImportIssueCode.UNIT_CHANGED_UNDER_STOCK,
        first.line,
        'unit',
        first.unit,
        `"${existing.name}" is changing from ${existing.unit} to ${first.unit} while holding ${existing.onHand} units. The counts on its shelves now mean ${first.unit}.`,
      ),
    );
  }

  if (existing.isActive && !first.isActive && existing.inUse > 0) {
    // C31.
    warnings.push(
      issue(
        ImportIssueCode.RETIRED_WITH_UNITS_ON_LOAN,
        first.line,
        'status',
        'Inactive',
        `"${existing.name}" is being retired but still has ${existing.inUse} unit${existing.inUse === 1 ? '' : 's'} out on loan.`,
      ),
    );
  }

  const losingEverything =
    existing.onHand > 0 && shelves.every((shelf) => shelf.targetOnHand === 0);
  if (losingEverything) {
    // §4.5 again, at product level: the prominent one for the preview.
    warnings.push(
      issue(
        ImportIssueCode.PRODUCT_LEFT_WITH_NO_STOCK,
        first.line,
        'on_hand',
        '0',
        `"${existing.name}" will have no stock anywhere after this import; it holds ${existing.onHand} units now.`,
      ),
    );
  }
}

/**
 * I9: silently discarding somebody's typing is worse than telling them it was ignored.
 *
 * Only `reserved` and `quarantined` are compared. The other three read-only columns
 * (`available`, `in_use_total`, `owned_total`) are all derived from `on_hand`, which the person
 * was invited to edit — so a mismatch there is the expected consequence of a legitimate edit
 * rather than a sign of one. Warning about it would fire on every changed row and teach people
 * to ignore the warnings that matter.
 */
function warnAboutReadOnly(
  shelf: ResolvedShelf,
  current: { reservedQty: number; quarantinedQty: number } | undefined,
  warnings: ImportIssue[],
): void {
  const compare: { column: ImportColumn; stated: number | null; actual: number }[] = [
    { column: 'reserved', stated: shelf.stated.reserved, actual: current?.reservedQty ?? 0 },
    {
      column: 'quarantined',
      stated: shelf.stated.quarantined,
      actual: current?.quarantinedQty ?? 0,
    },
  ];

  for (const field of compare) {
    if (field.stated === null || field.stated === field.actual) continue;
    warnings.push(
      issue(
        ImportIssueCode.READ_ONLY_IGNORED,
        shelf.line,
        field.column,
        String(field.stated),
        `"${field.column}" is ${field.actual} on this shelf and cannot be set from a file. The value in the file was ignored; nothing changed.`,
      ),
    );
  }
}

/* --------------------------------------------------------------------------- helpers */

function issue(
  code: ImportIssueCode,
  row: number,
  column: string | null,
  value: string | null,
  message: string,
): ImportIssue {
  return { code, row, column, value, message };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/** Row order, so the report reads down the spreadsheet rather than in stage order. */
function sortIssues(issues: ImportIssue[]): ImportIssue[] {
  return [...issues].sort((a, b) => a.row - b.row);
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function spellingDiffers(fromFile: string[], stored: string[]): boolean {
  return fromFile.join('\u001f') !== stored.join('\u001f');
}

function describeLocation(compartment: LookupCompartment): string {
  return formatLocation({
    roomName: compartment.roomName,
    zoneName: compartment.zoneName,
    compartmentCode: compartment.code,
  });
}

function locationText(row: ParsedRow): string {
  return formatLocation({
    roomName: row.cells.room,
    zoneName: row.cells.zone,
    compartmentCode: row.cells.compartment,
  });
}

function locationTextOf(row: TypedRow): string {
  return formatLocation({
    roomName: row.room,
    zoneName: row.zone,
    compartmentCode: row.compartment,
  });
}

function listNames(names: string[]): string {
  const shown = names
    .slice(0, 5)
    .map((name) => `"${name}"`)
    .join(', ');
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

/** Zod's own message, in the voice of the rest of these. */
function describe(error: z.ZodError): string {
  const first = error.issues[0]!;
  if (first.code === 'too_big' && typeof first.maximum === 'number') {
    return `is longer than ${first.maximum} characters`;
  }
  if (first.code === 'too_small') return 'is empty';
  return first.message.toLowerCase();
}
