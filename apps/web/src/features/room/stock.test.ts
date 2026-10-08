import { describe, expect, it } from 'vitest';
import { type CatalogueProduct, type CatalogueStockAt } from '@ims/shared';
import { panelLayout } from '@/features/panel/layout';
import { buildRoomStock } from './stock';

let sequence = 0;
const uuid = () => `00000000-0000-4000-8000-${String((sequence += 1)).padStart(12, '0')}`;

function shelf(
  room: string,
  zone: string,
  compartment: string,
  quantity: number,
  available = quantity,
): CatalogueStockAt {
  return {
    compartmentId: uuid(),
    label: `${room} / ${zone} / ${compartment}`,
    room,
    zone,
    compartment,
    storageId: `CAB-${zone}-${compartment.replace('-', '')}-${String(sequence).padStart(4, '0')}`,
    quantity,
    available,
  };
}

function product(name: string, code: string, locations: CatalogueStockAt[]): CatalogueProduct {
  const total = locations.reduce((sum, at) => sum + at.quantity, 0);
  return {
    id: uuid(),
    code,
    name,
    description: null,
    unit: 'pcs',
    category: null,
    stock: { total, available: total, inUse: 0 },
    locations,
  };
}

describe('buildRoomStock: catalogue shelves joined to drawer-plan cells', () => {
  it('lists a product under its cell with quantity, available, plan code and storage ID', () => {
    const at = shelf('Cabinet B', 'B2', '2A-2D', 14, 11);
    const servo = product('STS3215 serial bus servo', 'CTO-ELECTRICAL-0001', [at]);

    const stock = buildRoomStock([servo], panelLayout);

    expect(stock.byAddress.get('B2-2A-2D')).toEqual([
      {
        key: `${servo.id}:${at.compartmentId}`,
        productId: servo.id,
        name: 'STS3215 serial bus servo',
        code: 'CTO-ELECTRICAL-0001',
        address: 'B2-2A-2D',
        storageId: at.storageId,
        quantity: 14,
        available: 11,
      },
    ]);
  });

  it('counts the parts in each drawer across its cells, for the badge on the drawer front', () => {
    const products = [
      product('ESP32-S3 DevKitC', 'P-1', [shelf('Cabinet A', 'A2', '1A', 5)]),
      product('Pico 2', 'P-2', [shelf('Cabinet A', 'A2', '1C', 5)]),
      product('NUCLEO-F401RE', 'P-3', [shelf('Cabinet A', 'A2', '1B', 2)]),
      product('N20 gear motor', 'P-4', [shelf('Cabinet B', 'B2', '2G', 6)]),
    ];

    const stock = buildRoomStock(products, panelLayout);

    expect(stock.partsByDrawer.get('A2')).toBe(3);
    expect(stock.partsByDrawer.get('B2')).toBe(1);
    expect(stock.partsByDrawer.has('A1')).toBe(false);
  });

  it('marks a cell stocked only while something in it is on hand', () => {
    const products = [
      product('Held part', 'P-5', [shelf('Cabinet A', 'A1', '1G-1H', 2)]),
      product('Used up', 'P-6', [shelf('Cabinet A', 'A3', '1A', 0)]),
    ];

    const stock = buildRoomStock(products, panelLayout);

    expect([...stock.stockedAddresses]).toEqual(['A1-1G-1H']);
    // The badge agrees with the trays: a drawer whose records are all used up shows no count.
    expect(stock.partsByDrawer.get('A1')).toBe(1);
    expect(stock.partsByDrawer.has('A3')).toBe(false);
  });

  it('keeps an open-shelf product (LB) though the 3D model has no shelf to light', () => {
    const cells = product('LiPo 3S 2200', 'P-7', [shelf('CTO Room — open shelves', 'LB', '1', 3)]);

    const stock = buildRoomStock([cells], panelLayout);

    expect(stock.byAddress.get('LB-1')?.map((row) => row.name)).toEqual(['LiPo 3S 2200']);
    expect(stock.partsByDrawer.get('LB')).toBe(1);
  });

  it('counts shelves the plan does not have instead of placing them on a cell', () => {
    const products = [
      // A demo room's "A1" must not land in Cabinet A's A1 (OQ-P2: the room is pinned).
      product('Demo cable', 'P-8', [shelf('Demo room', 'A1', '1G-1H', 4)]),
      product('Never received', 'P-9', []),
    ];

    const stock = buildRoomStock(products, panelLayout);

    expect(stock.byAddress.size).toBe(0);
    expect(stock.unmatchedShelves).toBe(1);
  });

  it('counts an unplanned shelf once, however many products sit on it', () => {
    const demo = shelf('Demo room', 'A1', '1G-1H', 4);
    const products = [
      product('Demo cable', 'P-10', [demo]),
      product('Demo adapter', 'P-11', [{ ...demo, quantity: 2, available: 2 }]),
    ];

    expect(buildRoomStock(products, panelLayout).unmatchedShelves).toBe(1);
  });
});
