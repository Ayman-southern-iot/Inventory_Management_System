import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS,
  IMPORT_SCHEMA_VERSION,
  UTF8_BOM,
  buildFingerprint,
  type ImportColumn,
} from './import-format';
import { parseImportCsv } from './import-parser';

/**
 * The structural half of the importer: is this the right kind of file, are the columns the ones
 * we know, is every record the right width.
 *
 * Whether a *value* makes sense is part D's job. Keeping the two apart is what lets this run in
 * fourteen milliseconds without a database, and it is why the assertions below are all about
 * shape rather than meaning.
 */

const DEPLOYMENT = '11111111-1111-4111-8111-111111111111';

function fingerprint(overrides: Partial<{ schema: string; origin: string }> = {}): string {
  const line = buildFingerprint({
    exportedAt: new Date('2026-09-22T10:00:00.000Z'),
    schemaVersion: overrides.schema ?? IMPORT_SCHEMA_VERSION,
    deploymentId: overrides.origin ?? DEPLOYMENT,
  });
  return line;
}

/** A complete, valid row — individual tests override the cells they care about. */
function row(overrides: Partial<Record<ImportColumn, string>> = {}): string {
  const values: Record<ImportColumn, string> = {
    product_id: '22222222-2222-4222-8222-222222222222',
    product_code: 'LAP-0001',
    product_name: 'Lenovo ThinkPad T14',
    description: '',
    unit: 'pcs',
    category_id: '',
    category_path: '',
    default_returnable: 'yes',
    status: 'Active',
    storage_id: 'MAI-MET-1A-0002',
    room: 'Main Store',
    zone: 'Meta',
    compartment: '1A',
    on_hand: '7',
    reserved: '0',
    quarantined: '0',
    available: '7',
    in_use_total: '0',
    owned_total: '7',
    ...overrides,
  };
  return IMPORT_COLUMNS.map((column) => values[column]).join(',');
}

function file(body: string[], fp: string = fingerprint()): string {
  return [fp, IMPORT_COLUMNS.join(','), ...body].join('\r\n');
}

const parse = (text: string, expectedDeploymentId: string | null = DEPLOYMENT) =>
  parseImportCsv(text, { maxRows: 100, expectedDeploymentId });

const messages = (text: string, deployment: string | null = DEPLOYMENT) =>
  parse(text, deployment).issues.map((i) => i.message);

describe('parseImportCsv', () => {
  describe('a good file', () => {
    it('reads its rows', () => {
      const result = parse(file([row(), row({ product_code: 'GPU-0001' })]));

      expect(result.issues).toEqual([]);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]!.cells.product_name).toBe('Lenovo ThinkPad T14');
      expect(result.rows[1]!.cells.product_code).toBe('GPU-0001');
    });

    it('tolerates the byte-order mark the export writes', () => {
      const result = parse(`${UTF8_BOM}${file([row()])}`);
      expect(result.issues).toEqual([]);
      expect(result.rows).toHaveLength(1);
    });

    /** Excel appends these whenever anybody has clicked below the data. */
    it('ignores trailing blank rows', () => {
      const result = parse(`${file([row()])}\r\n\r\n\r\n`);
      expect(result.issues).toEqual([]);
      expect(result.rows).toHaveLength(1);
    });

    it('trims surrounding whitespace from every value', () => {
      const result = parse(file([row({ product_name: '  Spaced Out  ' })]));
      expect(result.rows[0]!.cells.product_name).toBe('Spaced Out');
    });

    it('reports the spreadsheet line each row came from', () => {
      const result = parse(file([row(), row()]));
      // Line 1 is the fingerprint, line 2 the headings, so data starts at 3.
      expect(result.rows.map((r) => r.line)).toEqual([3, 4]);
    });

    it('reads a value containing a comma when it is quoted', () => {
      const result = parse(file([row({ description: '"Long, with a comma"' })]));
      expect(result.issues).toEqual([]);
      expect(result.rows[0]!.cells.description).toBe('Long, with a comma');
    });
  });

  describe('the fingerprint', () => {
    it('refuses a file that has none', () => {
      const text = [IMPORT_COLUMNS.join(','), row()].join('\r\n');
      expect(messages(text)[0]).toMatch(/does not look like a file exported from this system/);
    });

    it('refuses a file written by a different schema', () => {
      expect(messages(file([row()], fingerprint({ schema: '0099' })))[0]).toMatch(
        /different version of the system/,
      );
    });

    /**
     * The one that matters most. Every row of a foreign file is individually valid, so nothing
     * else would catch it — the import would simply create several hundred duplicates.
     */
    it('refuses a file exported from another installation', () => {
      const foreign = fingerprint({ origin: '99999999-9999-4999-8999-999999999999' });
      expect(messages(file([row()], foreign))[0]).toMatch(/different installation/);
    });

    /** A restore passes null: the snapshot is this installation's own file by construction. */
    it('accepts any origin when the caller does not care', () => {
      const foreign = fingerprint({ origin: '99999999-9999-4999-8999-999999999999' });
      const result = parse(file([row()], foreign), null);
      expect(result.issues).toEqual([]);
      expect(result.rows).toHaveLength(1);
    });

    it('stops at the fingerprint rather than guessing at the columns', () => {
      const result = parse('not a fingerprint\r\nnot,headers\r\n1,2');
      expect(result.rows).toEqual([]);
      expect(result.issues).toHaveLength(1);
    });
  });

  describe('the headings', () => {
    it('refuses a file missing a column', () => {
      const short = IMPORT_COLUMNS.filter((c) => c !== 'unit').join(',');
      const text = [fingerprint(), short, '1'].join('\r\n');
      expect(messages(text)[0]).toMatch(/missing: unit/);
    });

    /** Far more likely the wrong file than a helpful addition, so it is an error. */
    it('refuses an unrecognised column', () => {
      const extra = `${IMPORT_COLUMNS.join(',')},supplier_notes`;
      const text = [fingerprint(), extra, `${row()},x`].join('\r\n');
      expect(messages(text)[0]).toMatch(/not recognised: supplier_notes/);
    });

    it('refuses a column that appears twice', () => {
      const dupe = `${IMPORT_COLUMNS.join(',')},unit`;
      const text = [fingerprint(), dupe, `${row()},pcs`].join('\r\n');
      expect(messages(text).some((m) => /more than once: unit/.test(m))).toBe(true);
    });

    /**
     * Order is how the exporter writes them, but the parser reads by name — so a person who
     * reorders columns in a spreadsheet is not punished for it.
     */
    it('accepts the columns in any order', () => {
      const reversed = [...IMPORT_COLUMNS].reverse();
      const values = Object.fromEntries(
        IMPORT_COLUMNS.map((c, i) => [c, row().split(',')[i]!]),
      ) as Record<ImportColumn, string>;
      const text = [
        fingerprint(),
        reversed.join(','),
        reversed.map((c) => values[c]).join(','),
      ].join('\r\n');

      const result = parse(text);
      expect(result.issues).toEqual([]);
      expect(result.rows[0]!.cells.product_name).toBe('Lenovo ThinkPad T14');
      expect(result.rows[0]!.cells.unit).toBe('pcs');
    });
  });

  describe('malformed rows', () => {
    it('names a row with the wrong number of values, and keeps reading', () => {
      const result = parse(file([row(), 'too,few', row()]));

      expect(result.rows).toHaveLength(2);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.row).toBe(4);
      expect(result.issues[0]!.message).toMatch(/needs the value wrapped in quotes/);
    });

    it('reports an unterminated quote against the line it started on', () => {
      const result = parse(file([row({ description: '"never closed' })]));
      expect(result.issues[0]!.message).toMatch(/never closed/);
      expect(result.issues[0]!.row).toBe(3);
    });
  });

  describe('refusals that protect the catalogue', () => {
    /**
     * Headings and no rows reads, under reconcile semantics, as "no product should exist" — a
     * correct reading of the file and a catastrophe.
     */
    it('refuses a file with headings and no products', () => {
      expect(messages(file([]))[0]).toMatch(/would deactivate every product/);
    });

    it('refuses an entirely empty file', () => {
      expect(messages('')[0]).toMatch(/file is empty/);
      expect(messages('   \r\n  ')[0]).toMatch(/file is empty/);
    });

    /** Checked while reading, so an oversized file costs milliseconds, not a full parse. */
    it('refuses more rows than the cap allows', () => {
      const many = Array.from({ length: 5 }, () => row());
      const result = parseImportCsv(file(many), {
        maxRows: 3,
        expectedDeploymentId: DEPLOYMENT,
      });

      expect(result.rows).toEqual([]);
      expect(result.issues[0]!.message).toMatch(/more than 3 rows/);
    });

    it('accepts exactly the cap', () => {
      const many = Array.from({ length: 3 }, () => row());
      const result = parseImportCsv(file(many), {
        maxRows: 3,
        expectedDeploymentId: DEPLOYMENT,
      });

      expect(result.issues).toEqual([]);
      expect(result.rows).toHaveLength(3);
    });
  });
});
