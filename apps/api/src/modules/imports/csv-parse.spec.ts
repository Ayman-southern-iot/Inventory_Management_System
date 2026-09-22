import { describe, expect, it } from 'vitest';
import { CsvParseError, isBlankRow, parseCsv } from './csv-parse';

/**
 * The reader for the round-trip file.
 *
 * Every case here is one a `split(',')` gets wrong and a real spreadsheet produces. They are not
 * hypothetical: a description with a comma, a name with a quote in it, Windows line endings, and
 * the trailing blank rows Excel leaves behind the moment anybody clicks below the data.
 */
const rows = (text: string) => [...parseCsv(text)];
const cells = (text: string) => rows(text).map((row) => row.cells);

describe('parseCsv', () => {
  describe('the ordinary shape', () => {
    it('reads plain comma-separated values', () => {
      expect(cells('a,b,c')).toEqual([['a', 'b', 'c']]);
    });

    it('reads several records', () => {
      expect(cells('a,b\nc,d')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('keeps empty fields rather than dropping them', () => {
      // Position is meaning in a CSV — a dropped empty shifts every column after it.
      expect(cells('a,,c')).toEqual([['a', '', 'c']]);
      expect(cells(',,')).toEqual([['', '', '']]);
    });

    it('reads a final record with no trailing newline', () => {
      expect(cells('a,b\nc,d')).toHaveLength(2);
    });

    it('does not invent a record after a trailing newline', () => {
      expect(cells('a,b\n')).toEqual([['a', 'b']]);
    });
  });

  describe('line endings', () => {
    it('reads CRLF, which is what Excel on Windows writes', () => {
      expect(cells('a,b\r\nc,d\r\n')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('reads a bare LF', () => {
      expect(cells('a,b\nc,d\n')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('reads a bare CR', () => {
      expect(cells('a,b\rc,d')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    /** The bug this guards: treating CRLF as two terminators and emitting a blank between rows. */
    it('treats CRLF as one terminator, not two', () => {
      expect(rows('a\r\nb')).toHaveLength(2);
    });
  });

  describe('quoting', () => {
    it('keeps a comma inside a quoted field', () => {
      expect(cells('"Cable, USB-C",2')).toEqual([['Cable, USB-C', '2']]);
    });

    it('reads a doubled quote as one literal quote', () => {
      expect(cells('"He said ""hi""",2')).toEqual([['He said "hi"', '2']]);
    });

    it('keeps a newline inside a quoted field', () => {
      expect(cells('"line one\nline two",2')).toEqual([['line one\nline two', '2']]);
    });

    it('keeps CRLF inside a quoted field', () => {
      expect(cells('"line one\r\nline two",2')).toEqual([['line one\r\nline two', '2']]);
    });

    it('reads an empty quoted field', () => {
      expect(cells('"",b')).toEqual([['', 'b']]);
    });

    /**
     * Excel writes this and refusing the file over it would be pedantry. A quote only opens a
     * quoted field at the *start* of one; anywhere else it is just a character.
     */
    it('reads a quote in the middle of an unquoted field literally', () => {
      expect(cells('12" monitor,2')).toEqual([['12" monitor', '2']]);
    });

    it('refuses a quote that is never closed', () => {
      expect(() => rows('a,"unterminated\nb,c')).toThrow(CsvParseError);
      expect(() => rows('a,"unterminated')).toThrow(/never closed/);
    });
  });

  describe('line numbers', () => {
    it('reports the physical line each record began on', () => {
      expect(rows('a\r\nb\r\nc').map((row) => row.line)).toEqual([1, 2, 3]);
    });

    /**
     * A record spanning lines reports the line it started on — the one the person needs to click
     * in their spreadsheet, not the one the parser happened to finish on.
     */
    it('reports the first line of a record that spans several', () => {
      const parsed = rows('a,"two\nlines"\nnext,row');
      expect(parsed[0]!.line).toBe(1);
      expect(parsed[1]!.line).toBe(3);
    });
  });

  describe('blank rows', () => {
    /** Excel appends these whenever somebody has clicked below the data. */
    it('recognises a row of nothing', () => {
      expect(rows('\n').every(isBlankRow)).toBe(true);
      expect(isBlankRow({ cells: ['', '  ', ''], line: 1 })).toBe(true);
    });

    it('does not mistake a row with content for a blank one', () => {
      expect(isBlankRow({ cells: ['', 'x'], line: 1 })).toBe(false);
    });
  });

  describe('as a generator', () => {
    /**
     * The reason this is a generator: the caller stops at the row cap, so an oversized file
     * costs milliseconds rather than a full parse it was going to reject anyway.
     */
    it('stops as soon as the caller stops asking', () => {
      const enormous = Array.from({ length: 10_000 }, (_, i) => `row-${i},x`).join('\r\n');
      const taken: string[][] = [];
      for (const row of parseCsv(enormous)) {
        taken.push(row.cells);
        if (taken.length === 3) break;
      }
      expect(taken).toHaveLength(3);
      expect(taken[2]![0]).toBe('row-2');
    });

    it('yields nothing for an empty string', () => {
      expect(rows('')).toEqual([]);
    });
  });
});
