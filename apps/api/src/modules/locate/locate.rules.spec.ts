import { LocateState } from '@ims/shared';
import { describe, expect, it } from 'vitest';
import { toDrawers, type CellAddress, type StockedCell } from './locate.rules';

const B2 = { room: 'Cabinet B', zone: 'B2' };
const cell = (where: { room: string; zone: string }, code: string, available: number): StockedCell => ({
  ...where,
  cell: code,
  available,
});
const address = (where: { room: string; zone: string }, code: string): CellAddress => ({
  ...where,
  cell: code,
});

describe('toDrawers — the drawer-light colour rules', () => {
  it('lights a drawer green when the cell has some available', () => {
    expect(toDrawers([{ placements: [cell(B2, '2A-2D', 3)], lastCell: null }])).toEqual([
      { zone: 'B2', room: 'Cabinet B', state: LocateState.GREEN, cells: ['2A-2D'] },
    ]);
  });

  it('lights it red when the product is on the shelf but none is available', () => {
    // All on loan, reserved or quarantined: the placement exists, available is 0.
    expect(toDrawers([{ placements: [cell(B2, '2A-2D', 0)], lastCell: null }])).toEqual([
      { zone: 'B2', room: 'Cabinet B', state: LocateState.RED, cells: ['2A-2D'] },
    ]);
  });

  it('falls back to the cell the stock last left, in red, once the placement is gone', () => {
    expect(toDrawers([{ placements: [], lastCell: address(B2, '2G') }])).toEqual([
      { zone: 'B2', room: 'Cabinet B', state: LocateState.RED, cells: ['2G'] },
    ]);
  });

  it('ignores the last cell while the product still has a shelf', () => {
    const drawers = toDrawers([
      { placements: [cell({ room: 'Cabinet A', zone: 'A4' }, '1A', 6)], lastCell: address(B2, '2G') },
    ]);
    expect(drawers.map((drawer) => drawer.zone)).toEqual(['A4']);
  });

  it('adds nothing for a product that was never on a shelf', () => {
    expect(toDrawers([{ placements: [], lastCell: null }])).toEqual([]);
  });

  it('keeps one light per drawer, and green beats red inside it', () => {
    const drawers = toDrawers([
      { placements: [cell(B2, '2G', 0)], lastCell: null },
      { placements: [cell(B2, '2A-2D', 4)], lastCell: null },
    ]);
    expect(drawers).toEqual([
      { zone: 'B2', room: 'Cabinet B', state: LocateState.GREEN, cells: ['2A-2D', '2G'] },
    ]);
  });

  it('stays red when every cell in the drawer is empty', () => {
    const drawers = toDrawers([
      { placements: [cell(B2, '2G', 0)], lastCell: null },
      { placements: [], lastCell: address(B2, '2E-2F') },
    ]);
    expect(drawers).toEqual([
      { zone: 'B2', room: 'Cabinet B', state: LocateState.RED, cells: ['2E-2F', '2G'] },
    ]);
  });

  it('separates a drawer code that repeats in another cabinet', () => {
    const drawers = toDrawers([
      { placements: [cell({ room: 'Cabinet B', zone: 'X1' }, '1A', 1)], lastCell: null },
      { placements: [cell({ room: 'Cabinet A', zone: 'X1' }, '1A', 0)], lastCell: null },
    ]);
    expect(drawers.map((drawer) => [drawer.room, drawer.state])).toEqual([
      ['Cabinet A', LocateState.RED],
      ['Cabinet B', LocateState.GREEN],
    ]);
  });

  it('lists a cell once even when two products share it, in cabinet order', () => {
    const drawers = toDrawers([
      { placements: [cell({ room: 'Cabinet B', zone: 'B4' }, '1C', 2)], lastCell: null },
      { placements: [cell({ room: 'Cabinet A', zone: 'A2' }, '1B', 2)], lastCell: null },
      { placements: [cell({ room: 'Cabinet A', zone: 'A2' }, '1B', 5)], lastCell: null },
    ]);
    expect(drawers.map((drawer) => [drawer.zone, drawer.cells])).toEqual([
      ['A2', ['1B']],
      ['B4', ['1C']],
    ]);
  });

  /** K2: the event carries drawers, cells and a colour — the shape admits nothing else. */
  it('emits only zone, room, state and cells for each drawer', () => {
    const [drawer] = toDrawers([{ placements: [cell(B2, '2A-2D', 1)], lastCell: null }]);
    expect(Object.keys(drawer ?? {}).sort()).toEqual(['cells', 'room', 'state', 'zone']);
  });
});
