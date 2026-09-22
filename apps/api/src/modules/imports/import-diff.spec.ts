import { describe, expect, it } from 'vitest';
import { buildImportDiff } from './import-diff';
import type { ImportLookups } from './import-lookups';
import type { ImportPlan, PlannedProduct, PlannedShelf } from './import-validator';
import { buildImportLookups } from './import-lookups';
import type { CategoryNode, Product, Room } from '@ims/shared';

/**
 * The numbers on the confirm screen.
 *
 * One property matters more than the rest and most of this file is about it: **a file that
 * changes nothing must count nothing**. Everything else here is a single change made in
 * isolation, so that each number can be shown to move on its own and only its own.
 */

const LAPTOP = '11111111-1111-4111-8111-000000000001';
const ELECTRONICS = '22222222-2222-4222-8222-000000000001';
const SENSORS = '22222222-2222-4222-8222-000000000009';
const SHELF_A = '33333333-3333-4333-8333-000000000001';
const SHELF_B = '33333333-3333-4333-8333-000000000002';

function lookups(overrides: Partial<Product> = {}): ImportLookups {
  const products: Product[] = [
    {
      id: LAPTOP,
      productCode: 'LAP-0001',
      name: 'Lenovo ThinkPad T14',
      categoryId: ELECTRONICS,
      categoryName: 'Electronics',
      isTrackable: true,
      unit: 'pcs',
      defaultReturnable: true,
      description: 'A laptop',
      isActive: true,
      totalQuantity: 7,
      totalReserved: 0,
      totalAvailable: 7,
      totalOnHand: 7,
      totalQuarantined: 0,
      totalInUse: 0,
      totalOwned: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  ];

  const categories: CategoryNode[] = [
    {
      id: ELECTRONICS,
      name: 'Electronics',
      parentId: null,
      isTrackable: true,
      isActive: true,
      productCount: 1,
      productCountInTree: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      children: [],
    },
    {
      id: SENSORS,
      name: 'Sensors',
      parentId: null,
      isTrackable: true,
      isActive: true,
      productCount: 0,
      productCountInTree: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      children: [],
    },
  ];

  const rooms: Room[] = [
    {
      id: 'aaaa1111-1111-4111-8111-000000000001',
      name: 'Main Store',
      isActive: true,
      zones: [
        {
          id: 'bbbb1111-1111-4111-8111-000000000001',
          name: 'Meta',
          roomId: 'aaaa1111-1111-4111-8111-000000000001',
          roomName: 'Main Store',
          isActive: true,
          compartments: [SHELF_A, SHELF_B].map((id, index) => ({
            id,
            zoneId: 'bbbb1111-1111-4111-8111-000000000001',
            zoneName: 'Meta',
            roomId: 'aaaa1111-1111-4111-8111-000000000001',
            roomName: 'Main Store',
            code: index === 0 ? '1A' : '1B',
            storageId: index === 0 ? 'MAI-MET-1A-0001' : 'MAI-MET-1B-0002',
            isActive: true,
            placementCount: 0,
          })),
        },
      ],
    },
  ];

  return buildImportLookups({
    products,
    categories,
    rooms,
    placements: [
      { productId: LAPTOP, compartmentId: SHELF_A, quantity: 7, reservedQty: 0, quarantinedQty: 0 },
    ],
  });
}

function shelf(overrides: Partial<PlannedShelf> = {}): PlannedShelf {
  return {
    compartmentId: SHELF_A,
    storageId: 'MAI-MET-1A-0001',
    location: 'Main Store / Meta / 1A',
    currentOnHand: 7,
    targetOnHand: 7,
    line: 3,
    ...overrides,
  };
}

/** The ThinkPad exactly as it is stored: a plan built from this changes nothing. */
function unchanged(overrides: Partial<PlannedProduct> = {}): PlannedProduct {
  return {
    productId: LAPTOP,
    productCode: 'LAP-0001',
    name: 'Lenovo ThinkPad T14',
    description: 'A laptop',
    unit: 'pcs',
    defaultReturnable: true,
    isActive: true,
    categoryId: ELECTRONICS,
    newCategoryIndex: null,
    shelves: [shelf()],
    lines: [3],
    ...overrides,
  };
}

function plan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    products: [unchanged()],
    categoriesToCreate: [],
    deactivations: [],
    ...overrides,
  };
}

const diff = (p: ImportPlan = plan()) => buildImportDiff(p, lookups(), []);

describe('buildImportDiff', () => {
  /**
   * I11 and C46. The preview's only job is to be read, and a preview that reports forty updates
   * for a file that changes nothing is one people learn to click past.
   */
  it('counts nothing for a file that changes nothing', () => {
    expect(diff()).toEqual({
      productsCreated: 0,
      productsUpdated: 0,
      productsDeactivated: 0,
      productsRenamed: 0,
      productsRecategorised: 0,
      categoriesCreated: [],
      shelvesChanged: 0,
      unitsAdded: 0,
      unitsRemoved: 0,
      warnings: [],
    });
  });

  describe('one change at a time', () => {
    it('counts a new product', () => {
      const created = unchanged({ productId: null, productCode: null, lines: [4] });
      expect(diff(plan({ products: [unchanged(), created] }))).toMatchObject({
        productsCreated: 1,
        productsUpdated: 0,
      });
    });

    it('counts a rename, and counts it as an update too', () => {
      const renamed = unchanged({ name: 'Lenovo ThinkPad T14 Gen 3' });
      expect(diff(plan({ products: [renamed] }))).toMatchObject({
        productsUpdated: 1,
        productsRenamed: 1,
      });
    });

    it('does not call a difference of case a rename', () => {
      const shouted = unchanged({ name: 'LENOVO THINKPAD T14' });
      expect(diff(plan({ products: [shouted] }))).toMatchObject({
        productsUpdated: 0,
        productsRenamed: 0,
      });
    });

    it('counts a move to another existing category', () => {
      const moved = unchanged({ categoryId: SENSORS });
      expect(diff(plan({ products: [moved] }))).toMatchObject({
        productsUpdated: 1,
        productsRecategorised: 1,
      });
    });

    /**
     * The case comparing two id fields gets wrong: a product being filed for the first time into
     * a category this same import is creating reads null on both sides.
     */
    it('counts a move into a category this import is creating', () => {
      const filed = unchanged({ categoryId: null, newCategoryIndex: 0 });
      const result = diff(
        plan({
          products: [filed],
          categoriesToCreate: [
            { path: ['Sensors', 'Lidar'], parentId: SENSORS, parentIndex: null },
          ],
        }),
      );

      expect(result).toMatchObject({
        productsUpdated: 1,
        productsRecategorised: 1,
        categoriesCreated: ['Sensors / Lidar'],
      });
    });

    it('counts an edit to the description alone', () => {
      const edited = unchanged({ description: 'A laptop, 14 inch' });
      expect(diff(plan({ products: [edited] }))).toMatchObject({ productsUpdated: 1 });
    });

    it('counts an edit to the borrow default alone', () => {
      const edited = unchanged({ defaultReturnable: false });
      expect(diff(plan({ products: [edited] }))).toMatchObject({ productsUpdated: 1 });
    });

    it('counts a unit change', () => {
      expect(diff(plan({ products: [unchanged({ unit: 'box' })] }))).toMatchObject({
        productsUpdated: 1,
      });
    });

    it('counts a product retired by its own row', () => {
      expect(diff(plan({ products: [unchanged({ isActive: false })] }))).toMatchObject({
        productsUpdated: 1,
        productsDeactivated: 1,
      });
    });

    /** A row marked Inactive and a product left out of the file are one number to the reader. */
    it('counts a product retired by omission in the same total', () => {
      const result = diff(
        plan({
          products: [unchanged({ isActive: false })],
          deactivations: [{ productId: 'x', name: 'Old Mouse', onHand: 0, inUse: 0 }],
        }),
      );
      expect(result.productsDeactivated).toBe(2);
    });
  });

  describe('the units', () => {
    it('counts what arrives and what leaves separately', () => {
      const moved = unchanged({
        shelves: [
          shelf({ targetOnHand: 2 }),
          shelf({ compartmentId: SHELF_B, currentOnHand: 0, targetOnHand: 9, line: 4 }),
        ],
      });

      expect(diff(plan({ products: [moved] }))).toMatchObject({
        shelvesChanged: 2,
        unitsAdded: 9,
        unitsRemoved: 5,
      });
    });

    /** C28: `adjust` throws on a zero delta, so a shelf that matches is not a changed shelf. */
    it('ignores a shelf whose count already matches', () => {
      const partly = unchanged({
        shelves: [
          shelf(),
          shelf({ compartmentId: SHELF_B, currentOnHand: 0, targetOnHand: 3, line: 4 }),
        ],
      });

      expect(diff(plan({ products: [partly] }))).toMatchObject({
        shelvesChanged: 1,
        unitsAdded: 3,
        unitsRemoved: 0,
      });
    });

    it('counts a shelf emptied by omission', () => {
      const cleared = unchanged({
        shelves: [shelf({ targetOnHand: 0, line: null })],
      });

      expect(diff(plan({ products: [cleared] }))).toMatchObject({
        shelvesChanged: 1,
        unitsRemoved: 7,
        productsUpdated: 1,
      });
    });
  });

  it('carries the warnings through untouched, since they are what is read hardest', () => {
    const warnings = [
      {
        code: 'SHELF_CLEARED_BY_OMISSION' as const,
        row: 3,
        column: null,
        value: null,
        message: 'x',
      },
    ];
    expect(buildImportDiff(plan(), lookups(), warnings).warnings).toEqual(warnings);
  });
});
