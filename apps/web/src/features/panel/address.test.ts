import { describe, expect, it } from 'vitest';
import { importSheetRows } from '@/test/panel-import-sheet';
import { layoutAddressOf, unmatchedUnits } from './address';
import { panelLayout } from './layout';

const resolve = (room: string, zone: string, compartment: string) =>
  layoutAddressOf({ room, zone, compartment }, panelLayout);

describe('layoutAddressOf: room pinned, zone name = drawer code (OQ-P2)', () => {
  it('resolves all 150 sheet compartments, entered as the sheet says, one-to-one', () => {
    const rows = importSheetRows();
    expect(rows).toHaveLength(150);

    const resolved = rows.map((row) => resolve(row.room, row.zoneName, row.compartmentCode));
    // Each row lands on the address printed on its own cell...
    expect(resolved).toEqual(rows.map((row) => row.label));
    // ...no two rows land on the same cell...
    expect(new Set(resolved).size).toBe(rows.length);
    // ...and every cell on the plan is claimed by exactly one row.
    expect([...panelLayout.cellByAddress.keys()].sort()).toEqual([...resolved].sort());
  });

  it('does not let a demo room’s zone called A1 shadow the real A1', () => {
    expect(resolve('Demo room', 'A1', '1G-1H')).toBeNull();
    expect(resolve('Cabinet A', 'A1', '1G-1H')).toBe('A1-1G-1H');
  });

  it('matches a drawer only in its own room, not in another room of the plan', () => {
    expect(resolve('Cabinet B', 'A1', '1G-1H')).toBeNull();
    expect(resolve('CTO Room — open shelves', 'LB', '1')).toBe('LB-1');
    expect(resolve('Cabinet A', 'LB', '1')).toBeNull();
  });

  it('ignores case and surrounding space, as the IMS uniqueness indexes do', () => {
    expect(resolve(' cabinet a ', ' a1 ', ' 1g-1h ')).toBe('A1-1G-1H');
  });

  it('does not resolve the descriptive drawer name: the zone must be named by its code', () => {
    const row = importSheetRows()[0]!;
    expect(row.drawerDescription).toBe('A1 · Tools — debug, soldering, test');
    expect(resolve(row.room, row.drawerDescription, row.compartmentCode)).toBeNull();
  });

  it('does not resolve a full address typed into the compartment code', () => {
    expect(resolve('Cabinet A', 'A1', 'A1-1G-1H')).toBeNull();
  });

  it('refuses a zone that is not a drawer code even when the string spells a real address', () => {
    // "A1-1G" + "1H" reads A1-1G-1H. Only zone "A1" in Cabinet A may claim that cell.
    expect(resolve('Cabinet A', 'A1-1G', '1H')).toBeNull();
  });

  it('does not resolve a shelf the plan does not have', () => {
    expect(resolve('Main Store', 'Meta', '1A')).toBeNull();
    expect(resolve('Cabinet A', 'A1', '9Z')).toBeNull();
  });
});

describe('unmatchedUnits', () => {
  it('lists the plan drawers and shelves IMS has no zone for, in plan order', () => {
    const shelves = importSheetRows()
      .filter((row) => !['A2', 'R5', 'LR'].includes(row.zoneName))
      .map((row) => ({ room: row.room, zone: row.zoneName }));
    expect(unmatchedUnits(shelves, panelLayout).map((unit) => unit.code)).toEqual([
      'A2',
      'R5',
      'LR',
    ]);
  });

  it('counts a drawer set up in the wrong room as unmatched', () => {
    const shelves = importSheetRows().map((row) => ({
      room: row.zoneName === 'A1' ? 'Demo room' : row.room,
      zone: row.zoneName,
    }));
    expect(unmatchedUnits(shelves, panelLayout).map((unit) => unit.code)).toEqual(['A1']);
  });

  it('finds nothing missing when every sheet row is in IMS', () => {
    const shelves = importSheetRows().map((row) => ({ room: row.room, zone: row.zoneName }));
    expect(unmatchedUnits(shelves, panelLayout)).toEqual([]);
  });
});
