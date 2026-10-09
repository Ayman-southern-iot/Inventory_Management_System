import { describe, expect, it } from 'vitest';
import { importSheetRows } from '@/test/panel-import-sheet';
import { frontRowOf, panelLayout } from '@/features/panel/layout';
import scene from './assets/scene-v4.json';
import { buildRoomModel, RoomModelError, sceneFocusOf, type RoomCell } from './model';
import { parseSceneAsset, type SceneAsset } from './scene/asset';

const asset = parseSceneAsset(scene);
const model = buildRoomModel(asset, panelLayout);

const centre = (cell: RoomCell) => cell.min.map((low, axis) => (low + cell.max[axis]!) / 2);
const dot = (a: number[], b: readonly number[]) =>
  a.reduce((sum, value, i) => sum + value * b[i]!, 0);
/** The row a cell code names: `1A-1B` → 1, `3C` → 3. */
const codeRow = (code: string) => Number(/^\d+/.exec(code)?.[0]);

describe('room model: the 3D scene and the drawer plan describe the same cells', () => {
  it('has 148 drawer cells, which with LB and LR are exactly the 150 rows of the import sheet', () => {
    const drawerCells = [...model.cellByAddress.keys()];
    const shelfCells = model.shelves.flatMap((shelf) => shelf.cells.map((cell) => cell.address));
    const sheet = importSheetRows().map((row) => `${row.zoneName}-${row.compartmentCode}`);

    expect(drawerCells).toHaveLength(148);
    expect([...shelfCells].sort()).toEqual(['LB-1', 'LR-1']);
    expect(sheet).toHaveLength(150);
    expect(new Set(sheet).size).toBe(150);
    // Both directions: every scene cell is a sheet row, and every sheet row is a scene cell.
    expect([...drawerCells, ...shelfCells].sort()).toEqual([...sheet].sort());
  });

  it('draws all fifteen drawers of the plan, A1–A5, B1–B5 and R1–R5', () => {
    expect(model.drawers.map((drawer) => drawer.code)).toEqual(
      ['A', 'B', 'R'].flatMap((cabinet) => [1, 2, 3, 4, 5].map((n) => `${cabinet}${n}`)),
    );
  });

  it('refuses a scene that has lost a cell the plan has', () => {
    const broken = structuredClone(asset) as SceneAsset;
    broken.cabinets[0]!.drawers[0]!.cells.pop();
    expect(() => buildRoomModel(broken, panelLayout)).toThrow(RoomModelError);
  });

  it('refuses a scene with a drawer the plan does not have', () => {
    const broken = structuredClone(asset) as SceneAsset;
    broken.cabinets[0]!.drawers[0]!.code = 'Z9';
    expect(() => buildRoomModel(broken, panelLayout)).toThrow(RoomModelError);
  });

  it('refuses a scene built for another version of the plan', () => {
    const broken = { ...structuredClone(asset), plan: 'v3' } as SceneAsset;
    expect(() => buildRoomModel(broken, panelLayout)).toThrow(RoomModelError);
  });
});

describe('room model: a cell code counts rows from the front, the plan grid from the back', () => {
  it('gives every cell the code row the plan grid implies (row 1 = front)', () => {
    for (const drawer of model.drawers) {
      for (const cell of drawer.cells) {
        const area = panelLayout.cellByAddress.get(cell.address)!.cell.area;
        // The cell's front-most grid row (counted from the back) is the row its code names.
        expect(codeRow(cell.code), cell.address).toBe(
          frontRowOf(area.rowEnd - 1, drawer.unit.rows),
        );
      }
    }
  });

  it('puts the front row (1A…) nearest the drawer handle in every drawer', () => {
    for (const drawer of model.drawers) {
      const towardHandle = (cell: RoomCell) => dot(centre(cell), drawer.front);
      const front = drawer.cells.filter((cell) => codeRow(cell.code) === 1).map(towardHandle);
      const behind = drawer.cells.filter((cell) => codeRow(cell.code) > 1).map(towardHandle);
      expect(front.length, drawer.code).toBeGreaterThan(0);
      expect(Math.min(...front), drawer.code).toBeGreaterThan(Math.max(...behind));
    }
  });
});

describe('sceneFocusOf: where the 3D view looks for a selection', () => {
  it('flies to a drawer cell and to a drawer', () => {
    expect(sceneFocusOf({ kind: 'cell', address: 'B2-2A-2D' }, model)).toEqual({
      kind: 'cell',
      address: 'B2-2A-2D',
    });
    expect(sceneFocusOf({ kind: 'drawer', code: 'B2' }, model)).toEqual({
      kind: 'drawer',
      code: 'B2',
    });
  });

  it('shows the whole room for an open-shelf cell, which the 3D model does not have', () => {
    expect(sceneFocusOf({ kind: 'cell', address: 'LB-1' }, model)).toBeNull();
  });

  it('shows the whole room for no selection, an unknown cell, or before the scene has loaded', () => {
    expect(sceneFocusOf(null, model)).toBeNull();
    expect(sceneFocusOf({ kind: 'unknown', value: 'B2-9Z' }, model)).toBeNull();
    expect(sceneFocusOf({ kind: 'cell', address: 'B2-2A-2D' }, undefined)).toBeNull();
  });
});
