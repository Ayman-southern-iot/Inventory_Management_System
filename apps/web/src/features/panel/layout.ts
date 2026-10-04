import { z } from 'zod';
import plan from './layout/drawer-plan-v4.json';

/**
 * The physical drawer layout the lab panel draws.
 *
 * IMS stores rooms, zones and compartments, never where a compartment sits inside a drawer. The
 * grid positions come from the lab's drawer plan (`layout/drawer-plan-v4.json`, copied verbatim
 * from `Lab_Inventory_and_Drawer_Plan_v4.xlsx`), and the two are joined by the address printed on
 * the cell, e.g. `A1-1G-1H` (see `address.ts`). A new plan version is a new file, not an edit.
 *
 * Two row conventions meet here and are easy to cross:
 * - the cell **code** counts rows from the **front** (`1G` is the front row, next to the handle);
 * - the plan's `r`/`r1` count rows from the **back** (1 = back), as the 3D renderer expects.
 * The panel draws the back of the drawer at the top of the screen and the handle at the bottom,
 * so a row counted from the back is already a CSS grid line counted from the top.
 */

const cellSchema = z.object({
  cell: z.string().min(1),
  purpose: z.string(),
  r: z.number().int().min(1),
  r1: z.number().int().min(1),
  c0: z.number().int().min(0),
  c1: z.number().int().min(0),
});

const drawerSchema = z.object({
  code: z.string().min(1),
  pos: z.number().int().min(1),
  name: z.string().min(1),
  /** The colour band on the physical drawer front, as six hex digits without `#`. */
  hex: z.string().regex(/^[0-9a-f]{6}$/i),
  band: z.string(),
  rows: z.number().int().min(1),
  cols: z.number().int().min(1),
  cells: z.array(cellSchema).min(1),
}).superRefine((drawer, ctx) => {
  // A cell outside its drawer would make CSS grid add tracks silently and draw a wrong drawer.
  for (const cell of drawer.cells) {
    const inside =
      cell.r <= cell.r1 && cell.r1 <= drawer.rows && cell.c0 <= cell.c1 && cell.c1 < drawer.cols;
    if (!inside) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Drawer plan: cell ${drawer.code}-${cell.cell} lies outside its ${drawer.rows}×${drawer.cols} grid`,
      });
    }
  }
});

/** Open-shelf zones (lithium box, long-stock rack) have no grid: one cell, no position. */
const shelfSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  cells: z.array(z.object({ cell: z.string().min(1), purpose: z.string() })).min(1),
});

const planSchema = z.object({
  version: z.string(),
  cabinets: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      sub: z.string(),
      drawers: z.array(drawerSchema).min(1),
    }),
  ),
  zones: z.array(shelfSchema),
});

export type DrawerPlan = z.infer<typeof planSchema>;

/** Where a cell sits on the screen, as CSS grid lines (1-based, end exclusive). */
export interface GridArea {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

export interface PanelCell {
  /** As printed inside the drawer, e.g. `1G-1H`. */
  code: string;
  /** Drawer code + cell code, e.g. `A1-1G-1H`. The key IMS is joined on. */
  address: string;
  purpose: string;
  area: GridArea;
}

export interface PanelDrawer {
  code: string;
  name: string;
  /** The drawer front's colour band, `#RRGGBB`. Null for an open shelf, which has none. */
  bandColour: string | null;
  rows: number;
  cols: number;
  cells: PanelCell[];
}

export interface PanelCabinet {
  id: string;
  name: string;
  sub: string;
  drawers: PanelDrawer[];
}

export interface PanelLayout {
  version: string;
  cabinets: PanelCabinet[];
  /** Open shelves outside the cabinets (LB, LR), drawn as one-cell units. */
  shelves: PanelDrawer[];
  /** Every drawer and shelf by code, for a tap on the overview or a drawer-code search. */
  unitByCode: ReadonlyMap<string, PanelDrawer>;
  /** Every cell by address, with the drawer or shelf holding it. */
  cellByAddress: ReadonlyMap<string, { unit: PanelDrawer; cell: PanelCell }>;
}

/** `r`/`r1` count from the back, which is the top of the screen; `c0`/`c1` are 0-based. */
export function gridAreaOf(cell: { r: number; r1: number; c0: number; c1: number }): GridArea {
  return { rowStart: cell.r, rowEnd: cell.r1 + 1, colStart: cell.c0 + 1, colEnd: cell.c1 + 2 };
}

/** The row number a cell code uses (1 = front) for a grid row counted from the back. */
export function frontRowOf(backRow: number, rows: number): number {
  return rows - backRow + 1;
}

export function addressOf(unitCode: string, cellCode: string): string {
  return `${unitCode}-${cellCode}`;
}

export function buildLayout(raw: unknown): PanelLayout {
  const parsed = planSchema.parse(raw);

  const cabinets: PanelCabinet[] = parsed.cabinets.map((cabinet) => ({
    id: cabinet.id,
    name: cabinet.name,
    sub: cabinet.sub,
    drawers: [...cabinet.drawers]
      .sort((a, b) => a.pos - b.pos)
      .map((drawer) => ({
        code: drawer.code,
        name: drawer.name,
        bandColour: `#${drawer.hex}`,
        rows: drawer.rows,
        cols: drawer.cols,
        cells: drawer.cells.map((cell) => ({
          code: cell.cell,
          address: addressOf(drawer.code, cell.cell),
          purpose: cell.purpose,
          area: gridAreaOf(cell),
        })),
      })),
  }));

  const shelves: PanelDrawer[] = parsed.zones.map((zone) => ({
    code: zone.code,
    name: zone.name,
    bandColour: null,
    rows: 1,
    cols: zone.cells.length,
    cells: zone.cells.map((cell, index) => ({
      code: cell.cell,
      address: addressOf(zone.code, cell.cell),
      purpose: cell.purpose,
      area: { rowStart: 1, rowEnd: 2, colStart: index + 1, colEnd: index + 2 },
    })),
  }));

  const unitByCode = new Map<string, PanelDrawer>();
  const cellByAddress = new Map<string, { unit: PanelDrawer; cell: PanelCell }>();
  for (const unit of [...cabinets.flatMap((cabinet) => cabinet.drawers), ...shelves]) {
    if (unitByCode.has(unit.code)) throw new Error(`Drawer plan: duplicate drawer ${unit.code}`);
    unitByCode.set(unit.code, unit);
    for (const cell of unit.cells) {
      if (cellByAddress.has(cell.address)) {
        throw new Error(`Drawer plan: duplicate cell ${cell.address}`);
      }
      cellByAddress.set(cell.address, { unit, cell });
    }
  }

  return { version: parsed.version, cabinets, shelves, unitByCode, cellByAddress };
}

/** Parsed once when the panel chunk loads. A malformed plan fails here, loudly. */
export const panelLayout: PanelLayout = buildLayout(plan);
