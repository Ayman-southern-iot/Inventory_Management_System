import { describe, expect, it } from 'vitest';
import { type CatalogueProduct } from '@ims/shared';
import { panelLayout } from './layout';
import { buildIndex, searchPanel } from './search';

function product(
  id: string,
  name: string,
  code: string,
  locations: Array<{ room?: string; zone: string; compartment: string; quantity: number }>,
): CatalogueProduct {
  return {
    id,
    code,
    name,
    description: null,
    unit: 'pcs',
    category: null,
    stock: { total: 0, available: 0, inUse: 0 },
    locations: locations.map((location, index) => ({
      compartmentId: `${id}-c${index}`,
      label: `${location.room ?? 'Cabinet A'} / ${location.zone} / ${location.compartment}`,
      room: location.room ?? 'Cabinet A',
      zone: location.zone,
      compartment: location.compartment,
      storageId: `LAB-${index}`,
      quantity: location.quantity,
      available: location.quantity,
    })),
  };
}

const products = [
  product('p1', 'ST-Link V3 MINIE', 'TL-0001', [{ zone: 'A1', compartment: '1G-1H', quantity: 2 }]),
  product('p2', 'USB-TTL CH343', 'TL-0002', [
    { zone: 'A1', compartment: '1G-1H', quantity: 4 },
    { room: 'Main Store', zone: 'Meta', compartment: 'Bin 7', quantity: 1 },
  ]),
  product('p3', 'M3 socket-head screws', 'FA-0100', [
    { zone: 'A3', compartment: '1A', quantity: 350 },
  ]),
  product('p4', 'Spare ESP32-S3', 'MC-0042', []),
];
const index = buildIndex(products, panelLayout);
const search = (query: string, limit = 40) => searchPanel(index, panelLayout, query, limit);

describe('searchPanel', () => {
  it('finds a part by a piece of its name, any case, and says where it is', () => {
    const result = search('st-link');
    expect(result.rows.map((row) => [row.name, row.address, row.quantity])).toEqual([
      ['ST-Link V3 MINIE', 'A1-1G-1H', 2],
    ]);
  });

  it('finds a part by its product code', () => {
    expect(search('fa-0100').rows.map((row) => row.address)).toEqual(['A3-1A']);
  });

  it('lists every shelf a part is on, the ones on the plan first', () => {
    const rows = search('CH343').rows;
    expect(rows.map((row) => row.address)).toEqual(['A1-1G-1H', null]);
    expect(rows[1]!.imsLabel).toBe('Main Store / Meta / Bin 7');
  });

  it('answers a drawer code with the drawer and everything filed in it', () => {
    const result = search('a1');
    expect(result.drawers.map((drawer) => drawer.code)).toEqual(['A1']);
    expect(result.rows.map((row) => row.productId).sort()).toEqual(['p1', 'p2']);
  });

  it('answers the start of an address with that drawer and that cell', () => {
    const result = search('A1-1G');
    expect(result.drawers.map((drawer) => drawer.code)).toEqual(['A1']);
    expect(result.rows.map((row) => row.address)).toEqual(['A1-1G-1H', 'A1-1G-1H']);
  });

  it('still answers for a part that is on no shelf', () => {
    const rows = search('ESP32').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.address).toBeNull();
    expect(rows[0]!.imsLabel).toBe('');
  });

  it('returns nothing for a blank query and for a query nothing matches', () => {
    expect(search('   ')).toEqual({ drawers: [], rows: [], hiddenCount: 0 });
    expect(search('zzzz').rows).toEqual([]);
  });

  it('stops at the limit and counts what it left out', () => {
    const result = search('-', 2);
    expect(result.rows).toHaveLength(2);
    expect(result.hiddenCount).toBe(3);
  });
});

describe('searchPanel, partial addresses', () => {
  it('keeps answering while an address is typed through its hyphen, as "A1-1" and "A1-1G"', () => {
    expect(search('A1-1').rows.map((row) => row.address)).toEqual(['A1-1G-1H', 'A1-1G-1H']);
    expect(search('A1-1').drawers.map((drawer) => drawer.code)).toEqual(['A1']);
  });
});

describe('buildIndex', () => {
  it('keeps a demo room’s "A1" off the real drawer A1, and still draws the real one', () => {
    const demo = product('p9', 'Demo PSU', 'PS-0009', [
      { room: 'Demo room', zone: 'A1', compartment: '1A-1B', quantity: 1 },
    ]);
    const index = buildIndex([...products, demo], panelLayout);
    expect(index.rows.find((row) => row.productId === 'p9')!.address).toBeNull();
    expect(index.rowsByAddress.get('A1-1A-1B')).toBeUndefined();
    expect(index.rows.find((row) => row.productId === 'p1')!.address).toBe('A1-1G-1H');
  });

  it('groups the rows by plan address for the cell list', () => {
    expect(index.rowsByAddress.get('A1-1G-1H')!.map((row) => row.name)).toEqual([
      'ST-Link V3 MINIE',
      'USB-TTL CH343',
    ]);
  });
});
