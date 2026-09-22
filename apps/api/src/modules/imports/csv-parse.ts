/**
 * An RFC 4180 reader, hand-rolled to match the two existing exports rather than pulling a
 * dependency in for eighty lines.
 *
 * It is a generator, and that is the point: the caller stops the moment the row cap is exceeded,
 * so an oversized file is refused in milliseconds instead of after parsing fifty thousand rows.
 * The *file* is still read into memory first — bounded by `IMPORT_MAX_FILE_BYTES`, not by this —
 * so "streaming" here means early exit, not constant memory. If that ceiling is ever raised far
 * enough to matter, the state machine below can be fed in chunks without changing its shape.
 *
 * The cases it exists for are the ones a naive `split(',')` gets wrong, and every one of them
 * arrives in real files: a product description containing a comma, a name containing a quote, an
 * address field containing a newline, and Windows line endings throughout.
 */

export interface CsvRow {
  cells: string[];
  /**
   * The physical line the record began on, 1-based — so it is the row number the person sees in
   * their spreadsheet. A record containing a quoted newline spans several lines and reports the
   * first, which is the one they need to click on.
   */
  line: number;
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvParseError';
  }
}

const QUOTE = '"';
const COMMA = ',';
const CR = '\r';
const LF = '\n';

/**
 * Yields one record at a time.
 *
 * A quote only opens a quoted field at the start of one. `say "hi"` in an unquoted field is
 * therefore read literally rather than rejected — Excel writes it that way and refusing the file
 * over it would be pedantry that costs somebody an afternoon.
 */
export function* parseCsv(text: string): Generator<CsvRow> {
  const length = text.length;
  let index = 0;
  let line = 1;

  while (index < length) {
    const startLine = line;
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    let atFieldStart = true;
    let endOfRecord = false;

    while (index < length && !endOfRecord) {
      const char = text[index]!;

      if (quoted) {
        if (char === QUOTE) {
          // Doubled inside a quoted field means one literal quote.
          if (text[index + 1] === QUOTE) {
            cell += QUOTE;
            index += 2;
            continue;
          }
          quoted = false;
          index += 1;
          continue;
        }
        if (char === LF) line += 1;
        cell += char;
        index += 1;
        continue;
      }

      if (char === QUOTE && atFieldStart) {
        quoted = true;
        atFieldStart = false;
        index += 1;
        continue;
      }

      if (char === COMMA) {
        cells.push(cell);
        cell = '';
        atFieldStart = true;
        index += 1;
        continue;
      }

      if (char === CR || char === LF) {
        // CRLF counts as one terminator, not two empty records.
        index += char === CR && text[index + 1] === LF ? 2 : 1;
        line += 1;
        endOfRecord = true;
        continue;
      }

      cell += char;
      atFieldStart = false;
      index += 1;
    }

    if (quoted) {
      throw new CsvParseError(
        'A quoted value is never closed — check for a stray " in the file.',
        startLine,
      );
    }

    cells.push(cell);
    yield { cells, line: startLine };
  }
}

/**
 * True for a record that is entirely empty.
 *
 * Excel appends these by the dozen when somebody has ever clicked below the data, and they are
 * meaningless rather than malformed — a file rejected for a blank line at the end would be
 * rejected for something the person cannot see.
 */
export function isBlankRow(row: CsvRow): boolean {
  return row.cells.every((cell) => cell.trim() === '');
}
