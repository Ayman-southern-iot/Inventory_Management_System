import { describe, expect, it } from 'vitest';
import { importSheetRows } from '@/test/panel-import-sheet';
import { layoutAddressOf } from './address';
import { panelLayout } from './layout';

const resolve = (zone: string, compartment: string) =>
  layoutAddressOf({ zone, compartment }, panelLayout);

describe('layoutAddressOf: address = <zone name>-<compartment code> (OQ-P2)', () => {
  it('resolves all 150 sheet compartments, entered as zone = drawer code, one-to-one', () => {
    const rows = importSheetRows();
    expect(rows).toHaveLength(150);

    const resolved = rows.map((row) => resolve(row.zoneCode, row.compartmentCode));
    // Each row lands on the address printed on its own cell...
    expect(resolved).toEqual(rows.map((row) => row.label));
    // ...no two rows land on the same cell...
    expect(new Set(resolved).size).toBe(rows.length);
    // ...and every cell on the plan is claimed by exactly one row.
    expect([...panelLayout.cellByAddress.keys()].sort()).toEqual([...resolved].sort());
  });

  it('ignores case and surrounding space, as the IMS uniqueness indexes do', () => {
    expect(resolve(' a1 ', ' 1g-1h ')).toBe('A1-1G-1H');
    expect(resolve('lb', '1')).toBe('LB-1');
  });

  it('does not resolve the sheet’s descriptive zone name: the zone must be named by its code', () => {
    const row = importSheetRows()[0]!;
    expect(row.zoneName).not.toBe(row.zoneCode);
    expect(resolve(row.zoneName, row.compartmentCode)).toBeNull();
  });

  it('does not resolve a full address typed into the compartment code', () => {
    expect(resolve('Cabinet A', 'A1-1G-1H')).toBeNull();
    expect(resolve('A1', 'A1-1G-1H')).toBeNull();
  });

  it('refuses a zone that is not a drawer code even when the string spells a real address', () => {
    // "A1-1G" + "1H" reads A1-1G-1H. Only zone "A1" may claim that cell.
    expect(resolve('A1-1G', '1H')).toBeNull();
  });

  it('does not resolve a shelf the plan does not have', () => {
    expect(resolve('Main Store', '1A')).toBeNull();
    expect(resolve('A1', '9Z')).toBeNull();
  });
});
