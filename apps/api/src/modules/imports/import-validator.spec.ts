import {
  ImportIssueCode,
  isImportWarning,
  type CategoryNode,
  type ImportIssue,
  type Product,
  type Room,
} from '@ims/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportColumn } from './import-format';
import { buildImportLookups, type ImportLookups, type LookupPlacement } from './import-lookups';
import type { ParsedRow } from './import-parser';
import { validateImport } from './import-validator';

/**
 * The semantic half of the importer, against a small fixed world.
 *
 * Every case in `importing_data.md` §12 that validation is responsible for has a test here, named
 * after what goes wrong rather than after its number. The world is built through
 * `buildImportLookups`, so these cover the four bulk-loaded maps as well as the rules that read
 * them — and none of it touches a database, which is why the whole file runs in milliseconds.
 */

/* ------------------------------------------------------------------------ the world */

const LAPTOP = '11111111-1111-4111-8111-000000000001';
const GPU = '11111111-1111-4111-8111-000000000002';
const MOUSE = '11111111-1111-4111-8111-000000000003';

const ELECTRONICS = '22222222-2222-4222-8222-000000000001';
const COMPUTERS = '22222222-2222-4222-8222-000000000002';
const LAPTOPS = '22222222-2222-4222-8222-000000000003';
const SERVICES = '22222222-2222-4222-8222-000000000004';
const RETIRED = '22222222-2222-4222-8222-000000000005';

const SHELF_1A = '33333333-3333-4333-8333-000000000001';
const SHELF_1B = '33333333-3333-4333-8333-000000000002';
const SHELF_9Z = '33333333-3333-4333-8333-000000000003';
const SHELF_OLD = '33333333-3333-4333-8333-000000000004';

function product(
  overrides: Partial<Product> & Pick<Product, 'id' | 'productCode' | 'name'>,
): Product {
  return {
    categoryId: null,
    categoryName: null,
    isTrackable: true,
    unit: 'pcs',
    defaultReturnable: true,
    description: null,
    isActive: true,
    totalQuantity: 0,
    totalReserved: 0,
    totalAvailable: 0,
    totalOnHand: 0,
    totalQuarantined: 0,
    totalInUse: 0,
    totalOwned: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function category(
  overrides: Partial<CategoryNode> & Pick<CategoryNode, 'id' | 'name'>,
): CategoryNode {
  return {
    parentId: null,
    isTrackable: true,
    isActive: true,
    productCount: 0,
    productCountInTree: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    children: [],
    ...overrides,
  };
}

function world(
  overrides: {
    products?: Product[];
    categories?: CategoryNode[];
    rooms?: Room[];
    placements?: LookupPlacement[];
  } = {},
): ImportLookups {
  const laptops = category({
    id: LAPTOPS,
    name: 'Laptops',
    parentId: COMPUTERS,
  });
  const computers = category({
    id: COMPUTERS,
    name: 'Computers',
    parentId: ELECTRONICS,
    children: [laptops],
  });

  const categories: CategoryNode[] = overrides.categories ?? [
    category({ id: ELECTRONICS, name: 'Electronics', children: [computers] }),
    category({ id: SERVICES, name: 'Services', isTrackable: false }),
    category({ id: RETIRED, name: 'Retired', isActive: false }),
  ];

  const rooms: Room[] = overrides.rooms ?? [
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
          compartments: [
            shelf(SHELF_1A, '1A', 'MAI-MET-1A-0001'),
            shelf(SHELF_1B, '1B', 'MAI-MET-1B-0002'),
            { ...shelf(SHELF_9Z, '9Z', 'MAI-MET-9Z-0003'), isActive: false },
          ],
        },
      ],
    },
    {
      id: 'aaaa1111-1111-4111-8111-000000000002',
      name: 'Old Shed',
      isActive: false,
      zones: [
        {
          id: 'bbbb1111-1111-4111-8111-000000000002',
          name: 'Corner',
          roomId: 'aaaa1111-1111-4111-8111-000000000002',
          roomName: 'Old Shed',
          isActive: true,
          compartments: [
            {
              ...shelf(SHELF_OLD, 'X1', 'OLD-COR-X1-0004'),
              zoneId: 'bbbb1111-1111-4111-8111-000000000002',
              zoneName: 'Corner',
              roomId: 'aaaa1111-1111-4111-8111-000000000002',
              roomName: 'Old Shed',
            },
          ],
        },
      ],
    },
  ];

  const products: Product[] = overrides.products ?? [
    product({
      id: LAPTOP,
      productCode: 'LAP-0001',
      name: 'Lenovo ThinkPad T14',
      categoryId: LAPTOPS,
      categoryName: 'Laptops',
      totalOnHand: 7,
      totalQuantity: 7,
      totalOwned: 7,
    }),
    product({
      id: GPU,
      productCode: 'GPU-0001',
      name: 'Nvidia RTX 4000',
      categoryId: ELECTRONICS,
      categoryName: 'Electronics',
      totalOnHand: 3,
      totalQuantity: 3,
      totalReserved: 1,
      totalQuarantined: 1,
      totalOwned: 3,
    }),
  ];

  const placements: LookupPlacement[] = overrides.placements ?? [
    { productId: LAPTOP, compartmentId: SHELF_1A, quantity: 7, reservedQty: 0, quarantinedQty: 0 },
    { productId: GPU, compartmentId: SHELF_1B, quantity: 3, reservedQty: 1, quarantinedQty: 1 },
  ];

  return buildImportLookups({ products, categories, rooms, placements });
}

function shelf(id: string, code: string, storageId: string) {
  return {
    id,
    zoneId: 'bbbb1111-1111-4111-8111-000000000001',
    zoneName: 'Meta',
    roomId: 'aaaa1111-1111-4111-8111-000000000001',
    roomName: 'Main Store',
    code,
    storageId,
    isActive: true,
    placementCount: 0,
  };
}

/* -------------------------------------------------------------------------- the rows */

let nextLine = 3;

/** The ThinkPad exactly as the export writes it: importing it back changes nothing. */
function row(overrides: Partial<Record<ImportColumn, string>> = {}): ParsedRow {
  const cells: Record<ImportColumn, string> = {
    product_id: LAPTOP,
    product_code: 'LAP-0001',
    product_name: 'Lenovo ThinkPad T14',
    description: '',
    unit: 'pcs',
    category_id: LAPTOPS,
    category_path: 'Electronics / Computers / Laptops',
    default_returnable: 'yes',
    status: 'Active',
    storage_id: 'MAI-MET-1A-0001',
    room: 'Main Store',
    zone: 'Meta',
    compartment: '1A',
    on_hand: '7',
    reserved: '0',
    quarantined: '0',
    available: '7',
    in_use_total: '0',
    owned_total: '7',
    ...overrides,
  };
  return { line: nextLine++, cells };
}

/** The GPU as exported — needed whenever a case must not trip the deactivation sweep. */
function gpuRow(overrides: Partial<Record<ImportColumn, string>> = {}): ParsedRow {
  return row({
    product_id: GPU,
    product_code: 'GPU-0001',
    product_name: 'Nvidia RTX 4000',
    category_id: ELECTRONICS,
    category_path: 'Electronics',
    storage_id: 'MAI-MET-1B-0002',
    compartment: '1B',
    on_hand: '3',
    reserved: '1',
    quarantined: '1',
    available: '1',
    owned_total: '3',
    ...overrides,
  });
}

/** A row for a product that does not exist yet. */
function newRow(overrides: Partial<Record<ImportColumn, string>> = {}): ParsedRow {
  return row({
    product_id: '',
    product_code: '',
    product_name: 'Anker USB-C Hub',
    category_id: '',
    category_path: 'Electronics',
    on_hand: '2',
    available: '2',
    owned_total: '2',
    ...overrides,
  });
}

const messages = (issues: ImportIssue[]) => issues.map((i) => i.message).join('\n');

/**
 * What these tests assert on. The code is the contract; the sentence beside it is not, and a
 * spec that pins the wording turns every rewording into a red suite. A message assertion
 * survives below only where what it says *is* the behaviour — that it names every row involved,
 * or which level of a location is retired.
 */
const codes = (issues: ImportIssue[]) => issues.map((i) => i.code);

/** Every fixture row together, so a case can add one row without retiring the rest. */
const everything = () => [row(), gpuRow()];

describe('validateImport', () => {
  // Line numbers restart per test, so an expectation naming row 3 means the first data row.
  beforeEach(() => {
    nextLine = 3;
  });

  describe("nulls — the brief's first check", () => {
    it('names the row and the column of an empty value', () => {
      const result = validateImport([row({ product_name: '' }), gpuRow()], world());

      expect(result.plan).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.column).toBe('product_name');
      expect(result.errors[0]!.row).toBe(3);
      expect(codes(result.errors)).toContain(ImportIssueCode.VALUE_REQUIRED);
    });

    it('collects every empty value rather than stopping at the first', () => {
      const result = validateImport([row({ product_name: '', unit: '', status: '' })], world());
      expect(result.errors.map((i) => i.column)).toEqual(['product_name', 'unit', 'status']);
    });

    /** Ayman's decision #1: a blank location is allowed only when there is nothing to put there. */
    it('refuses a quantity with no location', () => {
      const result = validateImport(
        [row({ storage_id: '', room: '', zone: '', compartment: '', on_hand: '4' })],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.LOCATION_REQUIRED_FOR_QUANTITY);
    });

    it('allows a blank location when the quantity is zero', () => {
      const result = validateImport(
        [row({ storage_id: '', room: '', zone: '', compartment: '', on_hand: '0' }), gpuRow()],
        world(),
      );
      expect(result.errors).toEqual([]);
    });

    it('allows a blank location when the quantity is blank too', () => {
      const result = validateImport(
        [row({ storage_id: '', room: '', zone: '', compartment: '', on_hand: '' }), gpuRow()],
        world(),
      );
      expect(result.errors).toEqual([]);
    });

    it('refuses half a location', () => {
      const result = validateImport([row({ zone: '' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.LOCATION_INCOMPLETE);
      expect(result.errors[0]!.message).toMatch(/needs all three of room, zone and compartment/);
    });

    it('does not treat a blank description as a problem', () => {
      // Ayman's decision #2.
      const result = validateImport([row({ description: '' }), gpuRow()], world());
      expect(result.errors).toEqual([]);
    });
  });

  describe('types and ranges', () => {
    it('reads a blank counting value as zero', () => {
      const result = validateImport(
        [row({ on_hand: '', reserved: '', in_use_total: '' }), gpuRow()],
        world(),
      );
      expect(result.errors).toEqual([]);
      expect(result.plan!.products[0]!.shelves[0]!.targetOnHand).toBe(0);
    });

    it('refuses a negative quantity', () => {
      const result = validateImport([row({ on_hand: '-2' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.QUANTITY_NEGATIVE);
    });

    it('refuses a fractional quantity', () => {
      const result = validateImport([row({ on_hand: '2.5' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.QUANTITY_NOT_WHOLE);
    });

    it('refuses a quantity that is obviously a typo', () => {
      const result = validateImport([row({ on_hand: '99999999' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.QUANTITY_TOO_LARGE);
    });

    /** It is ignored on import either way, so refusing the file over it would be pedantry. */
    it('warns rather than fails on an unreadable read-only column', () => {
      const result = validateImport([row({ reserved: 'seven' }), gpuRow()], world());
      expect(result.errors).toEqual([]);
      expect(codes(result.warnings)).toContain(ImportIssueCode.READ_ONLY_UNREADABLE);
    });

    it('refuses a value that is neither yes nor no', () => {
      const result = validateImport([row({ default_returnable: 'maybe' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.VALUE_NOT_A_FLAG);
    });

    it('accepts yes and no in any case', () => {
      const result = validateImport(
        [row({ default_returnable: 'YES', status: 'inactive' }), gpuRow()],
        world(),
      );
      expect(result.errors).toEqual([]);
      expect(result.plan!.products[0]!.isActive).toBe(false);
    });

    it('refuses a product id that is not an id', () => {
      const result = validateImport([row({ product_id: 'LAP-0001' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.ID_MALFORMED);
    });

    it('refuses a category four levels deep', () => {
      const result = validateImport(
        [row({ category_id: '', category_path: 'A / B / C / D' })],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.CATEGORY_PATH_TOO_DEEP);
    });

    it('refuses a category path with a gap in it', () => {
      const result = validateImport([row({ category_id: '', category_path: 'A //  C' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.CATEGORY_PATH_MALFORMED);
    });

    it('refuses a name longer than the column allows', () => {
      const result = validateImport([row({ product_name: 'x'.repeat(200) })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.VALUE_INVALID);
    });

    /** Excel rewrites these on open, before anybody has typed anything. */
    it('warns about a product code that looks like a date', () => {
      const result = validateImport([row({ product_code: '2-Jan' }), gpuRow()], world());
      expect(codes(result.warnings)).toContain(ImportIssueCode.CODE_LOOKS_LIKE_A_DATE);
    });
  });

  describe('what the file says about itself', () => {
    it('refuses two products sharing a code', () => {
      const result = validateImport([row(), gpuRow({ product_code: 'LAP-0001' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.CODE_DUPLICATED_IN_FILE);
      expect(result.errors).toHaveLength(2);
    });

    it('refuses rows of one product that disagree about its name', () => {
      const result = validateImport(
        [
          row(),
          row({
            product_name: 'Lenovo ThinkPad T15',
            storage_id: 'MAI-MET-1B-0002',
            compartment: '1B',
          }),
          gpuRow(),
        ],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.PRODUCT_ROWS_DISAGREE);
    });

    it('is not fooled into a disagreement by a difference of case', () => {
      const result = validateImport(
        [
          row(),
          row({
            product_name: 'LENOVO THINKPAD T14',
            storage_id: 'MAI-MET-1B-0002',
            compartment: '1B',
            on_hand: '0',
          }),
          gpuRow(),
        ],
        world(),
      );
      expect(result.errors).toEqual([]);
    });

    /**
     * §4.3. Name-matching would split a product in two on a typo and merge two genuinely
     * different SKUs that happen to share a name, so the file has to say which it meant.
     */
    it('refuses a new product on two shelves with no code to join the rows', () => {
      const result = validateImport(
        [newRow(), newRow({ storage_id: 'MAI-MET-1B-0002', compartment: '1B' }), ...everything()],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.NEW_PRODUCT_NEEDS_CODE);
      expect(messages(result.errors)).toMatch(
        /with no product code to say they are the same product/,
      );
      expect(result.errors).toHaveLength(2);
    });

    it('allows a new product on one shelf with no code', () => {
      const result = validateImport([newRow(), ...everything()], world());
      expect(result.errors).toEqual([]);
      expect(
        result.plan!.products.some((p) => p.productId === null && p.productCode === null),
      ).toBe(true);
    });

    it('joins a new product across two shelves by its code', () => {
      const result = validateImport(
        [
          newRow({ product_code: 'HUB-9001' }),
          newRow({ product_code: 'HUB-9001', storage_id: 'MAI-MET-1B-0002', compartment: '1B' }),
          ...everything(),
        ],
        world(),
      );

      expect(result.errors).toEqual([]);
      const created = result.plan!.products.find((p) => p.productCode === 'HUB-9001')!;
      expect(created.productId).toBeNull();
      expect(created.shelves).toHaveLength(2);
    });

    /**
     * The subtle half of §4.3: the code typed on one row and forgotten on the other, which is
     * what editing a spreadsheet actually produces. Grouping is per row, so the coded row and
     * the blank one land in different buckets and each looks like a perfectly good lone new
     * product — two products created, half the stock each, and no error anywhere.
     */
    it('refuses a new product whose rows do not all carry its code', () => {
      const result = validateImport(
        [
          newRow({ product_code: 'HUB-9001' }),
          newRow({ storage_id: 'MAI-MET-1B-0002', compartment: '1B' }),
          ...everything(),
        ],
        world(),
      );

      expect(result.plan).toBeNull();
      expect(codes(result.errors)).toContain(ImportIssueCode.NEW_PRODUCT_CODE_INCONSISTENT);
      expect(messages(result.errors)).toMatch(/only some of them carry a product_code/);
    });

    /** Different SKUs from different factories sharing a name is not hypothetical (§4.3). */
    it('allows two new products with one name when each carries its own code', () => {
      const result = validateImport(
        [
          newRow({ product_code: 'HUB-A' }),
          newRow({ product_code: 'HUB-B', storage_id: 'MAI-MET-1B-0002', compartment: '1B' }),
          ...everything(),
        ],
        world(),
      );

      expect(result.errors).toEqual([]);
      expect(result.plan!.products.filter((p) => p.name === 'Anker USB-C Hub')).toHaveLength(2);
    });
  });

  describe('what the file says about the catalogue', () => {
    it('refuses a product id this system has never issued', () => {
      const stale = '99999999-9999-4999-8999-999999999999';
      const result = validateImport([row({ product_id: stale })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.PRODUCT_NOT_FOUND);
    });

    it('refuses a code that already belongs to another product', () => {
      // The GPU's own row is left out on purpose: this is the collision with what is *in the
      // database*, not the collision between two rows, which stage 4 catches earlier.
      const result = validateImport([row({ product_code: 'GPU-0001' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.CODE_BELONGS_TO_ANOTHER_PRODUCT);
      expect(messages(result.errors)).toMatch(/already belongs to "Nvidia RTX 4000"/);
    });

    /** Creating would hit the unique index mid-apply; updating would overwrite silently. */
    it('refuses a new product whose code is already taken', () => {
      const result = validateImport([newRow({ product_code: 'LAP-0001' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.NEW_PRODUCT_CODE_TAKEN);
    });

    it('refuses a row whose category id and path are different categories', () => {
      const result = validateImport([row({ category_path: 'Electronics' }), gpuRow()], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.CATEGORY_AMBIGUOUS);
    });

    /** §4.1: the id wins, because the id is what cannot be renamed. */
    it('matches by id and warns when the category has been renamed since the export', () => {
      const result = validateImport(
        [row({ category_path: 'Electronics / Computers / Portables' }), gpuRow()],
        world(),
      );
      expect(result.errors).toEqual([]);
      expect(codes(result.warnings)).toContain(ImportIssueCode.CATEGORY_RENAMED);
      expect(messages(result.warnings)).toMatch(
        /has been renamed to "Electronics \/ Computers \/ Laptops"/,
      );
      expect(result.plan!.products[0]!.categoryId).toBe(LAPTOPS);
    });

    it('re-points a product by clearing the id and writing a different path', () => {
      const result = validateImport(
        [row({ category_id: '', category_path: 'Electronics' }), gpuRow()],
        world(),
      );
      expect(result.errors).toEqual([]);
      expect(result.plan!.products[0]!.categoryId).toBe(ELECTRONICS);
    });

    it('creates the categories a path asks for, deepest last', () => {
      const result = validateImport(
        [row({ category_id: '', category_path: 'Electronics / Sensors / Lidar' }), gpuRow()],
        world(),
      );

      expect(result.errors).toEqual([]);
      expect(result.plan!.categoriesToCreate.map((c) => c.path.join(' / '))).toEqual([
        'Electronics / Sensors',
        'Electronics / Sensors / Lidar',
      ]);
      // Only the new part is created — Electronics already exists and is reused as the parent.
      expect(result.plan!.categoriesToCreate[0]!.parentId).toBe(ELECTRONICS);
      expect(result.plan!.categoriesToCreate[1]!.parentIndex).toBe(0);
      expect(result.plan!.products[0]!.newCategoryIndex).toBe(1);
    });

    it('creates a category asked for twice only once', () => {
      const result = validateImport(
        [
          row({ category_id: '', category_path: 'Electronics / Sensors' }),
          gpuRow({ category_id: '', category_path: 'Electronics / Sensors' }),
        ],
        world(),
      );
      expect(result.plan!.categoriesToCreate).toHaveLength(1);
      expect(result.plan!.products[0]!.newCategoryIndex).toBe(0);
      expect(result.plan!.products[1]!.newCategoryIndex).toBe(0);
    });

    /** The unique index is on `lower(btrim(name))`, so this would be refused by the database. */
    it('reuses a category that differs only in case, and says so', () => {
      const result = validateImport(
        [row({ category_id: '', category_path: 'ELECTRONICS' }), gpuRow()],
        world(),
      );
      expect(result.plan!.categoriesToCreate).toEqual([]);
      expect(result.plan!.products[0]!.categoryId).toBe(ELECTRONICS);
      expect(codes(result.warnings)).toContain(ImportIssueCode.CATEGORY_MATCHED_LOOSELY);
    });

    it('refuses to file a product into a retired category', () => {
      const result = validateImport(
        [row({ category_id: RETIRED, category_path: 'Retired' })],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.CATEGORY_RETIRED);
    });

    it('refuses a shelf that does not exist', () => {
      const result = validateImport(
        [row({ storage_id: '', room: 'Main Store', zone: 'Meta', compartment: '4Q' })],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.SHELF_NOT_FOUND);
    });

    it('refuses a retired shelf', () => {
      const result = validateImport(
        [row({ storage_id: 'MAI-MET-9Z-0003', compartment: '9Z' })],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.SHELF_RETIRED);
      expect(result.errors[0]!.message).toMatch(/retired \(its compartment is not active\)/);
    });

    /** A live shelf inside a retired room is not a place anybody can be sent to. */
    it('refuses a shelf whose room is retired, and says which level', () => {
      const result = validateImport(
        [
          row({
            storage_id: 'OLD-COR-X1-0004',
            room: 'Old Shed',
            zone: 'Corner',
            compartment: 'X1',
          }),
        ],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.SHELF_RETIRED);
      expect(result.errors[0]!.message).toMatch(/retired \(its room is not active\)/);
    });

    it('refuses a row whose shelf label and location are different shelves', () => {
      const result = validateImport([row({ compartment: '1B' }), gpuRow()], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.SHELF_AMBIGUOUS);
    });

    /** The label is on the physical shelf; the name in the file is a memory of it. */
    it('matches by shelf label and warns when the location has been renamed', () => {
      const result = validateImport([row({ zone: 'Mezzanine' }), gpuRow()], world());
      expect(result.errors).toEqual([]);
      expect(codes(result.warnings)).toContain(ImportIssueCode.SHELF_RENAMED);
      expect(messages(result.warnings)).toMatch(/renamed to Main Store \/ Meta \/ 1A/);
    });

    it('refuses a shelf label this system never printed', () => {
      const result = validateImport(
        [row({ storage_id: 'XXX-YYY-1A-9999', room: '', zone: '', compartment: '', on_hand: '0' })],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.SHELF_LABEL_NOT_FOUND);
    });

    it('matches by room, zone and compartment when the label is blank', () => {
      const result = validateImport([row({ storage_id: '' }), gpuRow()], world());
      expect(result.errors).toEqual([]);
      expect(result.plan!.products[0]!.shelves[0]!.compartmentId).toBe(SHELF_1A);
    });
  });

  describe('domain', () => {
    it('refuses a count below what is reserved and quarantined on that shelf', () => {
      const result = validateImport([row(), gpuRow({ on_hand: '1' })], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.BELOW_RESERVED);
      expect(messages(result.errors)).toMatch(/holds 2 units that are reserved or quarantined/);
    });

    it('allows a count equal to what is held', () => {
      const result = validateImport([row(), gpuRow({ on_hand: '2' })], world());
      expect(result.errors).toEqual([]);
    });

    it('refuses stock in an untracked category', () => {
      const result = validateImport(
        [row({ category_id: SERVICES, category_path: 'Services' }), gpuRow()],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.CATEGORY_NOT_TRACKABLE);
    });

    it('allows a catalogue entry in an untracked category with no stock', () => {
      const result = validateImport(
        [
          row({
            category_id: SERVICES,
            category_path: 'Services',
            storage_id: '',
            room: '',
            zone: '',
            compartment: '',
            on_hand: '0',
          }),
          gpuRow(),
        ],
        world(),
      );
      expect(result.errors).toEqual([]);
    });

    it('refuses the same product on the same shelf twice', () => {
      const result = validateImport([row(), row({ on_hand: '3' }), gpuRow()], world());
      expect(codes(result.errors)).toContain(ImportIssueCode.SHELF_REPEATED);
    });

    /** Two spellings of one shelf are still one shelf, which is why this runs after resolution. */
    it('catches the same shelf reached by label and by name', () => {
      const result = validateImport(
        [row(), row({ storage_id: '', on_hand: '3' }), gpuRow()],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.SHELF_REPEATED);
    });
  });

  describe('the plan', () => {
    it('re-importing an unedited export changes nothing', () => {
      const result = validateImport(everything(), world());

      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.plan!.categoriesToCreate).toEqual([]);
      expect(result.plan!.deactivations).toEqual([]);
      expect(result.plan!.products).toHaveLength(2);
      for (const planned of result.plan!.products) {
        expect(planned.productId).not.toBeNull();
        for (const shelf of planned.shelves) {
          expect(shelf.targetOnHand).toBe(shelf.currentOnHand);
        }
      }
    });

    it('plans a new product with its shelf', () => {
      const result = validateImport(
        [newRow({ product_code: 'HUB-9001' }), ...everything()],
        world(),
      );
      const created = result.plan!.products.find((p) => p.productCode === 'HUB-9001')!;

      expect(created.productId).toBeNull();
      expect(created.name).toBe('Anker USB-C Hub');
      expect(created.categoryId).toBe(ELECTRONICS);
      expect(created.shelves).toEqual([
        expect.objectContaining({ compartmentId: SHELF_1A, currentOnHand: 0, targetOnHand: 2 }),
      ]);
    });

    it('carries the change to an existing product', () => {
      const result = validateImport([row({ on_hand: '9', unit: 'box' }), gpuRow()], world());
      const planned = result.plan!.products[0]!;

      expect(planned.productId).toBe(LAPTOP);
      expect(planned.unit).toBe('box');
      expect(planned.shelves[0]).toMatchObject({ currentOnHand: 7, targetOnHand: 9 });
    });

    /**
     * §4.5, the dangerous case. A product's shelf rows are the complete list of where it is, so a
     * shelf the file does not mention is emptied — legitimate, destructive, and warned about.
     */
    it('empties a shelf the file does not mention, prominently', () => {
      const result = validateImport(
        [row({ storage_id: 'MAI-MET-1B-0002', compartment: '1B', on_hand: '7' }), gpuRow()],
        world(),
      );

      expect(result.errors).toEqual([]);
      const planned = result.plan!.products[0]!;
      expect(planned.shelves).toHaveLength(2);
      expect(planned.shelves.find((s) => s.compartmentId === SHELF_1A)).toMatchObject({
        currentOnHand: 7,
        targetOnHand: 0,
        line: null,
      });
      expect(codes(result.warnings)).toContain(ImportIssueCode.SHELF_CLEARED_BY_OMISSION);
      expect(messages(result.warnings)).toMatch(
        /7 units of "Lenovo ThinkPad T14" at Main Store \/ Meta \/ 1A will be removed/,
      );
    });

    it('refuses to empty a shelf holding reserved units by omitting it', () => {
      const result = validateImport(
        [row(), gpuRow({ storage_id: 'MAI-MET-1A-0001', compartment: '1A', on_hand: '0' })],
        world(),
      );
      expect(codes(result.errors)).toContain(ImportIssueCode.SHELF_CLEARED_BUT_RESERVED);
      expect(messages(result.errors)).toMatch(
        /would empty that shelf — but 2 of its units are reserved/,
      );
    });

    it('warns when a product ends up with no stock anywhere', () => {
      const result = validateImport([row({ on_hand: '0' }), gpuRow()], world());
      expect(codes(result.warnings)).toContain(ImportIssueCode.PRODUCT_LEFT_WITH_NO_STOCK);
    });

    /** I1: the file is the desired state, so a product it never mentions is retired. */
    it('retires a product the file does not mention', () => {
      const result = validateImport([row()], world());

      expect(result.errors).toEqual([]);
      expect(result.plan!.deactivations).toEqual([
        { productId: GPU, name: 'Nvidia RTX 4000', onHand: 3, inUse: 0 },
      ]);
      expect(codes(result.warnings)).toContain(ImportIssueCode.PRODUCTS_RETIRED_BY_OMISSION);
    });

    it('does not retire a product that is already retired', () => {
      const lookups = world({
        products: [
          product({ id: MOUSE, productCode: 'MOU-0001', name: 'Old Mouse', isActive: false }),
          product({
            id: LAPTOP,
            productCode: 'LAP-0001',
            name: 'Lenovo ThinkPad T14',
            categoryId: LAPTOPS,
            totalOnHand: 7,
          }),
        ],
        placements: [
          {
            productId: LAPTOP,
            compartmentId: SHELF_1A,
            quantity: 7,
            reservedQty: 0,
            quarantinedQty: 0,
          },
        ],
      });

      const result = validateImport([row()], lookups);
      expect(result.plan!.deactivations).toEqual([]);
    });

    it('warns when a product being retired still has units on loan', () => {
      const lookups = world({
        products: [
          product({
            id: LAPTOP,
            productCode: 'LAP-0001',
            name: 'Lenovo ThinkPad T14',
            categoryId: LAPTOPS,
            totalOnHand: 7,
            totalInUse: 4,
          }),
        ],
        placements: [
          {
            productId: LAPTOP,
            compartmentId: SHELF_1A,
            quantity: 7,
            reservedQty: 0,
            quarantinedQty: 0,
          },
        ],
      });

      const result = validateImport([row({ status: 'Inactive' })], lookups);
      expect(codes(result.warnings)).toContain(ImportIssueCode.RETIRED_WITH_UNITS_ON_LOAN);
      expect(messages(result.warnings)).toMatch(/still has 4 units out on loan/);
    });

    it('warns when the unit changes under stock that is already counted', () => {
      const result = validateImport([row({ unit: 'box' }), gpuRow()], world());
      expect(codes(result.warnings)).toContain(ImportIssueCode.UNIT_CHANGED_UNDER_STOCK);
      expect(messages(result.warnings)).toMatch(/changing from pcs to box while holding 7 units/);
    });

    it('warns that an edited read-only column did nothing', () => {
      const result = validateImport([row(), gpuRow({ reserved: '0' })], world());
      expect(codes(result.warnings)).toContain(ImportIssueCode.READ_ONLY_IGNORED);
    });

    /** Derived from `on_hand`, which the person was invited to edit. Warning here is noise. */
    it('says nothing about available and owned_total when on_hand changes', () => {
      const result = validateImport([row({ on_hand: '9' }), gpuRow()], world());
      expect(messages(result.warnings)).not.toMatch(/available|owned_total/);
    });
  });

  describe('the report', () => {
    it('lists its errors in file order', () => {
      const result = validateImport(
        [
          row({ on_hand: '-1' }),
          gpuRow({ on_hand: 'x' }),
          row({ product_id: GPU, on_hand: '2.5' }),
        ],
        world(),
      );
      const rowsReported = result.errors.map((i) => i.row);
      expect([...rowsReported].sort((a, b) => a - b)).toEqual(rowsReported);
    });

    it('carries the offending value so the report can be read next to the file', () => {
      const result = validateImport([row({ on_hand: '-1' })], world());
      expect(result.errors[0]).toMatchObject({ column: 'on_hand', value: '-1' });
    });

    /**
     * The check that `ImportIssueCode` actually generalises to warnings rather than having been
     * shaped around the error cases it was extracted from.
     *
     * Severity is a property of the member, so a code may never appear on both sides. Every file
     * below is one that produces issues; between them they exercise most of the enum, and the
     * day somebody reuses an error code for a warning — or the reverse — this is what says so
     * rather than a preview screen quietly rendering a blocking problem as advice.
     */
    it('never puts a warning code among the errors, or an error code among the warnings', () => {
      /** A world where the ThinkPad has units out on loan — the only case needing its own. */
      const onLoan = () =>
        world({
          products: [
            product({
              id: LAPTOP,
              productCode: 'LAP-0001',
              name: 'Lenovo ThinkPad T14',
              categoryId: LAPTOPS,
              totalOnHand: 7,
              totalInUse: 4,
            }),
          ],
          placements: [
            {
              productId: LAPTOP,
              compartmentId: SHELF_1A,
              quantity: 7,
              reservedQty: 0,
              quarantinedQty: 0,
            },
          ],
        });

      const files: { rows: ParsedRow[]; lookups?: ImportLookups }[] = [
        { rows: [row({ on_hand: '-1' })] },
        { rows: [row({ product_name: '' })] },
        { rows: [row({ compartment: '1B' }), gpuRow()] },
        { rows: [row({ category_path: 'Electronics' }), gpuRow()] },
        { rows: [row({ unit: 'box', on_hand: '0', reserved: '4' }), gpuRow()] },
        { rows: [row({ zone: 'Mezzanine', product_code: '2-Jan' }), gpuRow()] },
        { rows: [row({ category_id: '', category_path: 'ELECTRONICS' }), gpuRow()] },
        { rows: [row({ status: 'Inactive' })] },
        {
          rows: [
            newRow(),
            newRow({ storage_id: 'MAI-MET-1B-0002', compartment: '1B' }),
            ...everything(),
          ],
        },
        { rows: [row({ product_id: '99999999-9999-4999-8999-999999999999' })] },
        { rows: [newRow({ product_code: 'LAP-0001' })] },
        { rows: [row({ category_id: RETIRED, category_path: '' })] },
        { rows: [row({ storage_id: '', compartment: '4Q' })] },
        { rows: [row(), row({ on_hand: '3' }), gpuRow()] },
        { rows: [row(), gpuRow({ on_hand: '1' })] },
        { rows: [row({ category_id: SERVICES, category_path: 'Services' }), gpuRow()] },
        { rows: [row({ default_returnable: 'maybe', on_hand: '2.5' })] },
        { rows: [row({ category_id: '11111111-1111-4111-8111-00000000000e' })] },
        { rows: [row({ category_id: '', category_path: 'A //  C' })] },
        { rows: [row({ category_id: '', category_path: 'A / B / C / D' })] },
        { rows: [row({ category_path: 'Electronics / Computers / Portables' }), gpuRow()] },
        { rows: [row({ product_code: 'GPU-0001' })] },
        { rows: [row(), gpuRow({ product_code: 'LAP-0001' })] },
        { rows: [row({ product_id: 'LAP-0001' })] },
        { rows: [row({ zone: '' })] },
        {
          rows: [row({ storage_id: '', room: '', zone: '', compartment: '', on_hand: '4' })],
        },
        {
          rows: [
            newRow({ product_code: 'HUB-9001' }),
            newRow({ storage_id: 'MAI-MET-1B-0002', compartment: '1B' }),
            ...everything(),
          ],
        },
        {
          rows: [
            row(),
            row({
              product_name: 'Lenovo ThinkPad T15',
              storage_id: 'MAI-MET-1B-0002',
              compartment: '1B',
            }),
            gpuRow(),
          ],
        },
        { rows: [row({ on_hand: '99999999' })] },
        { rows: [row({ reserved: 'seven' }), gpuRow()] },
        { rows: [row({ status: 'Inactive' })], lookups: onLoan() },
        {
          rows: [row(), gpuRow({ storage_id: 'MAI-MET-1A-0001', compartment: '1A', on_hand: '0' })],
        },
        {
          rows: [
            row({ storage_id: 'MAI-MET-1B-0002', compartment: '1B', on_hand: '7' }),
            gpuRow(),
          ],
        },
        {
          rows: [
            row({
              storage_id: 'XXX-YYY-1A-9999',
              room: '',
              zone: '',
              compartment: '',
              on_hand: '0',
            }),
          ],
        },
        { rows: [row({ storage_id: 'MAI-MET-9Z-0003', compartment: '9Z' })] },
        { rows: [row({ product_name: 'x'.repeat(200) })] },
      ];

      const seen = new Set<ImportIssueCode>();
      for (const { rows, lookups } of files) {
        const result = validateImport(rows, lookups ?? world());
        for (const error of result.errors) {
          seen.add(error.code);
          expect({ code: error.code, isWarning: isImportWarning(error.code) }).toEqual({
            code: error.code,
            isWarning: false,
          });
        }
        for (const warning of result.warnings) {
          seen.add(warning.code);
          expect({ code: warning.code, isWarning: isImportWarning(warning.code) }).toEqual({
            code: warning.code,
            isWarning: true,
          });
        }
      }

      /*
       * Guards the guard, as a ratchet rather than a floor.
       *
       * A numeric minimum is the wrong instrument: it passes for ever at whatever coverage the
       * battery happened to reach, and every member added after it goes unexercised while the
       * test stays green. Instead the *uncovered* members are listed explicitly, so adding a
       * code turns this red until somebody either puts it through the battery or writes it down
       * here with a reason. The list is meant to shrink.
       */
      const uncovered = Object.values(ImportIssueCode)
        .filter((code) => !seen.has(code))
        .sort();
      expect(uncovered).toEqual(NOT_EXERCISED_HERE);
    });
  });
});

/**
 * Members the severity battery above does not reach, and why.
 *
 * Structural codes belong to the parser and are covered in `import-parser.spec.ts`; the rest are
 * produced outside `validateImport`. Everything else must be exercised, which is what keeps the
 * severity partition honest as the enum grows.
 */
const NOT_EXERCISED_HERE: ImportIssueCode[] = [
  // Produced by the parser, before any row reaches this module.
  ImportIssueCode.COLUMNS_ABSENT,
  ImportIssueCode.COLUMNS_DUPLICATED,
  ImportIssueCode.COLUMNS_MISSING,
  ImportIssueCode.COLUMNS_UNKNOWN,
  ImportIssueCode.FILE_EMPTY,
  ImportIssueCode.FILE_FOREIGN_DEPLOYMENT,
  ImportIssueCode.FILE_MALFORMED_CSV,
  ImportIssueCode.FILE_NOT_AN_EXPORT,
  ImportIssueCode.FILE_NO_PRODUCTS,
  ImportIssueCode.FILE_TOO_MANY_ROWS,
  ImportIssueCode.FILE_WRONG_FORMAT_VERSION,
  ImportIssueCode.FILE_WRONG_SCHEMA_VERSION,
  ImportIssueCode.ROW_WRONG_WIDTH,
  // Produced by ImportValidationService, which needs a database: the near-duplicate pass.
  // Their side of the partition is asserted in `import-validation.int-spec.ts`.
  ImportIssueCode.NAME_NEAR_DUPLICATE,
  ImportIssueCode.CATEGORY_NEAR_DUPLICATE,
  ImportIssueCode.NEAR_DUPLICATE_CHECK_SKIPPED,
].sort();
