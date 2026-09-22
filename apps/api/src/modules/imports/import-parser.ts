import type { ImportIssue } from '@ims/shared';
import {
  IMPORT_COLUMNS,
  IMPORT_FORMAT_VERSION,
  IMPORT_SCHEMA_VERSION,
  parseFingerprint,
  stripBom,
  type Fingerprint,
  type ImportColumn,
} from './import-format';
import { CsvParseError, isBlankRow, parseCsv } from './csv-parse';

/**
 * Turns a CSV into rows this system recognises, or into a list of reasons it could not.
 *
 * Everything here is structural: is this the right kind of file, are the columns the ones we
 * know, is every record the right width. Whether a *value* makes sense — does that product exist,
 * is that shelf real, does that quantity fit under what is reserved — is part D's job, and
 * deliberately not mixed in. A parser that also validated meaning would have to know about the
 * database, and could not be tested without one.
 *
 * It never throws for a bad file. A malformed import is an ordinary outcome that the person who
 * uploaded it has to read and act on, so problems come back as data.
 */

/** One record, keyed by column name, with the spreadsheet line it came from. */
export interface ParsedRow {
  line: number;
  cells: Record<ImportColumn, string>;
}

export interface ParseResult {
  fingerprint: Fingerprint | null;
  rows: ParsedRow[];
  issues: ImportIssue[];
}

export interface ParseOptions {
  /** Refused past this many data rows, checked while reading rather than after. */
  maxRows: number;
  /**
   * The deployment this file must claim to come from, or null to accept any.
   *
   * A restore passes null: the snapshot is this installation's own file by construction, and
   * checking would only fail after a database was moved to a new machine — the moment somebody
   * most needs their backups (plan §4.4).
   */
  expectedDeploymentId: string | null;
}

function issue(line: number, message: string, column: string | null = null): ImportIssue {
  return { row: line, column, value: null, message };
}

export function parseImportCsv(text: string, options: ParseOptions): ParseResult {
  const issues: ImportIssue[] = [];
  const body = stripBom(text);

  if (body.trim() === '') {
    return {
      fingerprint: null,
      rows: [],
      issues: [issue(1, 'The file is empty.')],
    };
  }

  let records: Generator<{ cells: string[]; line: number }>;
  try {
    records = parseCsv(body);
  } catch (error) {
    // Construction cannot throw today, but a future chunked feeder might.
    return { fingerprint: null, rows: [], issues: [toParseIssue(error)] };
  }

  const fingerprintLine = firstLine(body);
  const fingerprint = parseFingerprint(fingerprintLine);

  if (!fingerprint) {
    issues.push(
      issue(
        1,
        'This does not look like a file exported from this system. Export the current products first, edit that file, and import it back.',
      ),
    );
    // Without a fingerprint the rest is guesswork — the columns could be anything.
    return { fingerprint: null, rows: [], issues };
  }

  if (fingerprint.version !== IMPORT_FORMAT_VERSION) {
    issues.push(
      issue(
        1,
        `This file uses format ${fingerprint.version}; this system reads ${IMPORT_FORMAT_VERSION}. Export a fresh copy and redo the changes on it.`,
      ),
    );
  }

  if (fingerprint.schemaVersion !== IMPORT_SCHEMA_VERSION) {
    issues.push(
      issue(
        1,
        `This file was exported by a different version of the system (schema ${fingerprint.schemaVersion}, this one is ${IMPORT_SCHEMA_VERSION}). Export a fresh copy and redo the changes on it.`,
      ),
    );
  }

  if (
    options.expectedDeploymentId !== null &&
    fingerprint.deploymentId !== options.expectedDeploymentId
  ) {
    /*
     * The one that matters most. A file from another installation names product ids that mean
     * nothing here, so every row would be created afresh — several hundred duplicates, and no
     * error anywhere, because each row is individually perfectly valid.
     */
    issues.push(
      issue(
        1,
        'This file was exported from a different installation of this system, so none of its products match. Export from this one instead.',
      ),
    );
  }

  if (issues.length > 0) return { fingerprint, rows: [], issues };

  return readRows(records, fingerprint, options, issues);
}

function readRows(
  records: Generator<{ cells: string[]; line: number }>,
  fingerprint: Fingerprint,
  options: ParseOptions,
  issues: ImportIssue[],
): ParseResult {
  const rows: ParsedRow[] = [];
  let header: string[] | null = null;
  let indexByColumn: Map<ImportColumn, number> | null = null;

  try {
    for (const record of records) {
      // The fingerprint is its own line and is not a CSV record we care about.
      if (record.line === 1) continue;

      if (header === null) {
        header = record.cells.map((cell) => cell.trim());
        const headerIssues = checkHeader(header, record.line);
        if (headerIssues.length > 0) return { fingerprint, rows: [], issues: headerIssues };
        indexByColumn = new Map(
          IMPORT_COLUMNS.map((column) => [column, header!.indexOf(column)] as const),
        );
        continue;
      }

      // Excel appends these whenever anybody has clicked below the data.
      if (isBlankRow(record)) continue;

      if (rows.length >= options.maxRows) {
        issues.push(
          issue(
            record.line,
            `This file has more than ${options.maxRows} rows, which is the most one import can take. Split it, or ask an administrator to raise the limit.`,
          ),
        );
        // Stopped here rather than after reading the rest — the point of the generator.
        return { fingerprint, rows: [], issues };
      }

      if (record.cells.length !== header.length) {
        issues.push(
          issue(
            record.line,
            `This row has ${record.cells.length} values but the file has ${header.length} columns. A comma inside a value needs the value wrapped in quotes.`,
          ),
        );
        continue;
      }

      const cells = {} as Record<ImportColumn, string>;
      for (const column of IMPORT_COLUMNS) {
        cells[column] = (record.cells[indexByColumn!.get(column)!] ?? '').trim();
      }
      rows.push({ line: record.line, cells });
    }
  } catch (error) {
    issues.push(toParseIssue(error));
    return { fingerprint, rows: [], issues };
  }

  if (header === null) {
    issues.push(issue(1, 'The file has no column headings.'));
    return { fingerprint, rows: [], issues };
  }

  if (rows.length === 0 && issues.length === 0) {
    /*
     * Headings and nothing else. Under reconcile semantics this reads as "no product should
     * exist" and would deactivate the entire catalogue — a correct reading of the file and a
     * catastrophe, so it is refused outright (plan C37).
     */
    issues.push(
      issue(
        2,
        'The file has column headings but no products. Importing it would deactivate every product in the system, so it has been refused.',
      ),
    );
  }

  return { fingerprint, rows, issues };
}

function checkHeader(header: string[], line: number): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const known = new Set<string>(IMPORT_COLUMNS);

  const missing = IMPORT_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    issues.push(issue(line, `These columns are missing: ${missing.join(', ')}.`));
  }

  const unknown = header.filter((column) => !known.has(column));
  if (unknown.length > 0) {
    /*
     * An error, not a warning. An unexpected column is far more likely to be the wrong file than
     * a helpful addition, and accepting it silently means importing whatever it happens to be.
     */
    issues.push(
      issue(line, `These columns are not recognised: ${unknown.join(', ')}.`),
    );
  }

  const duplicates = header.filter((column, index) => header.indexOf(column) !== index);
  if (duplicates.length > 0) {
    issues.push(
      issue(line, `These columns appear more than once: ${[...new Set(duplicates)].join(', ')}.`),
    );
  }

  return issues;
}

function firstLine(text: string): string {
  const end = text.search(/\r\n|\r|\n/);
  return end === -1 ? text : text.slice(0, end);
}

function toParseIssue(error: unknown): ImportIssue {
  if (error instanceof CsvParseError) return issue(error.line, error.message);
  return issue(1, 'The file could not be read as a CSV.');
}
