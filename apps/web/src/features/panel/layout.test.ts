import { describe, expect, it } from 'vitest';
import { importSheetRows } from '@/test/panel-import-sheet';
import { buildLayout, frontRowOf, gridAreaOf, panelLayout } from './layout';

/** The `Label / QR text` column: the address printed on each cell. */
const sheetLabels = importSheetRows().map((row) => row.label);

describe('drawer plan v4 against the IMS Import sheet', () => {
  it('reads all 150 rows of the sheet, each with a label', () => {
    expect(sheetLabels).toHaveLength(150);
    expect(sheetLabels.every((label) => label.trim() !== '')).toBe(true);
  });

  it('has a cell on the plan for every compartment label in the sheet', () => {
    const missing = sheetLabels.filter((label) => !panelLayout.cellByAddress.has(label));
    expect(missing).toEqual([]);
  });

  it('has a row in the sheet for every cell on the plan', () => {
    const inSheet = new Set(sheetLabels);
    const extra = [...panelLayout.cellByAddress.keys()].filter((address) => !inSheet.has(address));
    expect(extra).toEqual([]);
    expect(panelLayout.cellByAddress.size).toBe(sheetLabels.length);
  });
});

describe('row orientation', () => {
  it('draws the front-row cell 1A at the bottom of the drawer, next to the handle', () => {
    const drawer = panelLayout.unitByCode.get('A1')!;
    const frontLeft = drawer.cells.find((cell) => cell.code.startsWith('1A'))!;
    // The bottom grid line of a drawer with `rows` rows is rows + 1.
    expect(frontLeft.area.rowEnd).toBe(drawer.rows + 1);
    expect(frontLeft.area.colStart).toBe(1);
  });

  it('draws a back-row cell at the top', () => {
    const drawer = panelLayout.unitByCode.get('A1')!;
    const backRow = drawer.cells.find((cell) => cell.code.startsWith(`${drawer.rows}`))!;
    expect(backRow.area.rowStart).toBe(1);
  });

  it('agrees with every cell code on the plan: row from the front, column letter from the left', () => {
    const disagreements: string[] = [];
    for (const cabinet of panelLayout.cabinets) {
      for (const drawer of cabinet.drawers) {
        for (const cell of drawer.cells) {
          // "2A-2B" → corners (front row 2, column A) and (front row 2, column B).
          const corners = [...cell.code.matchAll(/(\d+)([A-Z])/g)].map((m) => ({
            frontRow: Number(m[1]),
            column: m[2]!.charCodeAt(0) - 'A'.charCodeAt(0) + 1,
          }));
          const drawnRows = [cell.area.rowStart, cell.area.rowEnd - 1].map((row) =>
            frontRowOf(row, drawer.rows),
          );
          const drawnColumns = [cell.area.colStart, cell.area.colEnd - 1];
          const sameSpan = (a: number[], b: number[]) =>
            Math.min(...a) === Math.min(...b) && Math.max(...a) === Math.max(...b);
          if (
            !sameSpan(
              drawnRows,
              corners.map((corner) => corner.frontRow),
            ) ||
            !sameSpan(
              drawnColumns,
              corners.map((corner) => corner.column),
            )
          ) {
            disagreements.push(cell.address);
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('maps the plan rows counted from the back onto grid lines counted from the top', () => {
    expect(gridAreaOf({ r: 4, r1: 4, c0: 6, c1: 7 })).toEqual({
      rowStart: 4,
      rowEnd: 5,
      colStart: 7,
      colEnd: 9,
    });
    expect(frontRowOf(4, 4)).toBe(1);
    expect(frontRowOf(1, 4)).toBe(4);
  });
});

describe('buildLayout', () => {
  const minimal = {
    version: 't',
    cabinets: [
      {
        id: 'A',
        name: 'Cabinet A',
        sub: '',
        drawers: [
          {
            code: 'A1',
            pos: 1,
            name: 'Tools',
            hex: 'f79646',
            band: 'Orange',
            rows: 1,
            cols: 1,
            cells: [{ cell: '1A', purpose: '', r: 1, r1: 1, c0: 0, c1: 0 }],
          },
        ],
      },
    ],
    zones: [],
  };

  it('turns the drawer band into a CSS colour', () => {
    expect(buildLayout(minimal).unitByCode.get('A1')!.bandColour).toBe('#f79646');
  });

  it('refuses a band that is not six hex digits rather than painting it', () => {
    const bad = structuredClone(minimal);
    bad.cabinets[0]!.drawers[0]!.hex = 'orange';
    expect(() => buildLayout(bad)).toThrow();
  });

  it('refuses a cell that runs off its drawer rather than growing the grid', () => {
    const past = structuredClone(minimal);
    past.cabinets[0]!.drawers[0]!.cells[0]!.c1 = 1;
    expect(() => buildLayout(past)).toThrow(/A1/);
    const backwards = structuredClone(minimal);
    backwards.cabinets[0]!.drawers[0]!.rows = 2;
    backwards.cabinets[0]!.drawers[0]!.cells[0]!.r = 2;
    expect(() => buildLayout(backwards)).toThrow(/A1/);
  });

  it('refuses two cells with one address', () => {
    const twice = structuredClone(minimal);
    twice.cabinets[0]!.drawers[0]!.cells.push({
      cell: '1A',
      purpose: '',
      r: 1,
      r1: 1,
      c0: 0,
      c1: 0,
    });
    expect(() => buildLayout(twice)).toThrow(/duplicate cell A1-1A/);
  });
});
