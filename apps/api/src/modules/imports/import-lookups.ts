import type { CategoryNode, Product, Room } from '@ims/shared';
import { CATEGORY_PATH_SEPARATOR } from './import-format';

/**
 * Everything validation needs to resolve a file, loaded once (`importing_data.md` §11.1).
 *
 * The naive importer asks the database five questions per row — does this product exist, does
 * this category, does this shelf — which at five thousand rows is twenty-five thousand round
 * trips before a single write. Four queries instead, turned into maps here, and validation
 * becomes O(rows) in memory.
 *
 * **Every key is `lower(btrim(...))`, exactly what the unique indexes use.** Not a stylistic
 * choice: a map keyed more loosely than the index would match two rows the database considers
 * distinct, and a map keyed more tightly would create a duplicate the index then rejects halfway
 * through the transaction. `Power  Tools` and `Power Tools` are two different categories to
 * Postgres, so they are two different categories here, and the near-duplicate warning is what
 * tells the person about it.
 */

/** `lower(btrim(x))` — the expression `products_code_key` and the sibling-name indexes use. */
export function lookupKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Unit separator: no product name, category or shelf code contains one. */
const KEY_SEPARATOR = '\u001f';

export function categoryKey(path: readonly string[]): string {
  return path.map(lookupKey).join(KEY_SEPARATOR);
}

export function locationKey(room: string, zone: string, compartment: string): string {
  return [room, zone, compartment].map(lookupKey).join(KEY_SEPARATOR);
}

export interface LookupProduct {
  id: string;
  productCode: string;
  name: string;
  categoryId: string | null;
  /** False only when the product's category is untrackable; uncategorised is trackable (OQ-F). */
  isTrackable: boolean;
  unit: string;
  /** Carried so the diff can tell a description-only edit from no edit at all. */
  description: string | null;
  defaultReturnable: boolean;
  isActive: boolean;
  onHand: number;
  /** Out on loan. Cannot be imported (§2.1); read to warn before a deactivation. */
  inUse: number;
}

export interface LookupCategory {
  id: string;
  /** Root-first, as stored — the file's spelling may differ in case. */
  path: string[];
  parentId: string | null;
  isTrackable: boolean;
  isActive: boolean;
}

export interface LookupCompartment {
  id: string;
  storageId: string;
  roomName: string;
  zoneName: string;
  code: string;
  /** All three levels active. A live shelf inside a retired room is not a place to put stock. */
  isActive: boolean;
  /** Which level is retired, so the error can say so rather than "inactive". */
  inactiveLevel: 'room' | 'zone' | 'compartment' | null;
}

export interface LookupPlacement {
  productId: string;
  compartmentId: string;
  quantity: number;
  reservedQty: number;
  quarantinedQty: number;
}

export interface ImportLookups {
  products: LookupProduct[];
  productById: Map<string, LookupProduct>;
  productByCode: Map<string, LookupProduct>;
  categoryById: Map<string, LookupCategory>;
  categoryByPath: Map<string, LookupCategory>;
  /**
   * **Only the categories whose own name contains a `/`**, keyed by the whole joined path as the
   * export writes it, lowercased.
   *
   * `category_path` joins names with ` / ` and the parser splits on `/`, so a category actually
   * named `Servo Drivers / ESCs` comes back as two steps and its path reads one level deeper than
   * it is. The seeded catalogue has ten such names (`Arduino / AVR`, `Motion / IMU`,
   * `Potentiometers / Trimmers`, …), and the symptom was that **the importer refused its own
   * unedited export** with `CATEGORY_PATH_TOO_DEEP`.
   *
   * Deliberately not every category: an unambiguous path must keep resolving exactly as before,
   * including its case-difference warning. Only a path that is ambiguous by construction consults
   * this, and only because splitting it cannot be right.
   */
  categoryByJoinedPath: Map<string, LookupCategory>;
  compartmentById: Map<string, LookupCompartment>;
  compartmentByStorageId: Map<string, LookupCompartment>;
  compartmentByLocation: Map<string, LookupCompartment>;
  /** Keyed `productId + US + compartmentId` — what a shelf currently holds. */
  placementByShelf: Map<string, LookupPlacement>;
  placementsByProduct: Map<string, LookupPlacement[]>;
}

export interface RawLookups {
  products: Product[];
  categories: CategoryNode[];
  rooms: Room[];
  placements: LookupPlacement[];
}

export function shelfKey(productId: string, compartmentId: string): string {
  return `${productId}${KEY_SEPARATOR}${compartmentId}`;
}

export function buildImportLookups(raw: RawLookups): ImportLookups {
  const categoryById = new Map<string, LookupCategory>();
  const categoryByPath = new Map<string, LookupCategory>();
  const categoryByJoinedPath = new Map<string, LookupCategory>();

  const walkCategory = (node: CategoryNode, ancestors: string[]): void => {
    const path = [...ancestors, node.name];
    const entry: LookupCategory = {
      id: node.id,
      path,
      parentId: node.parentId,
      isTrackable: node.isTrackable,
      isActive: node.isActive,
    };
    categoryById.set(node.id, entry);
    categoryByPath.set(categoryKey(path), entry);
    if (path.some((segment) => segment.includes('/'))) {
      // First one wins. Two categories can only collide here if the catalogue already contains
      // the same path spelled two ways, which the sibling-name unique index makes very unlikely
      // and which is an existing ambiguity rather than one this map introduces.
      const joined = lookupKey(path.join(CATEGORY_PATH_SEPARATOR));
      if (!categoryByJoinedPath.has(joined)) categoryByJoinedPath.set(joined, entry);
    }
    for (const child of node.children) walkCategory(child, path);
  };
  for (const node of raw.categories) walkCategory(node, []);

  const products: LookupProduct[] = raw.products.map((product) => ({
    id: product.id,
    productCode: product.productCode,
    name: product.name,
    categoryId: product.categoryId,
    isTrackable: product.isTrackable,
    unit: product.unit,
    description: product.description,
    defaultReturnable: product.defaultReturnable,
    isActive: product.isActive,
    onHand: product.totalOnHand,
    inUse: product.totalInUse,
  }));

  const productById = new Map(products.map((product) => [product.id, product]));
  const productByCode = new Map(
    products
      .filter((product) => product.productCode.trim() !== '')
      .map((product) => [lookupKey(product.productCode), product]),
  );

  const compartmentById = new Map<string, LookupCompartment>();
  const compartmentByStorageId = new Map<string, LookupCompartment>();
  const compartmentByLocation = new Map<string, LookupCompartment>();

  for (const room of raw.rooms) {
    for (const zone of room.zones) {
      for (const compartment of zone.compartments) {
        const inactiveLevel = !room.isActive
          ? 'room'
          : !zone.isActive
            ? 'zone'
            : !compartment.isActive
              ? 'compartment'
              : null;
        const entry: LookupCompartment = {
          id: compartment.id,
          storageId: compartment.storageId,
          roomName: room.name,
          zoneName: zone.name,
          code: compartment.code,
          isActive: inactiveLevel === null,
          inactiveLevel,
        };
        compartmentById.set(entry.id, entry);
        compartmentByStorageId.set(lookupKey(entry.storageId), entry);
        compartmentByLocation.set(locationKey(room.name, zone.name, compartment.code), entry);
      }
    }
  }

  const placementByShelf = new Map<string, LookupPlacement>();
  const placementsByProduct = new Map<string, LookupPlacement[]>();
  for (const placement of raw.placements) {
    placementByShelf.set(shelfKey(placement.productId, placement.compartmentId), placement);
    const list = placementsByProduct.get(placement.productId) ?? [];
    list.push(placement);
    placementsByProduct.set(placement.productId, list);
  }

  return {
    products,
    productById,
    productByCode,
    categoryById,
    categoryByPath,
    categoryByJoinedPath,
    compartmentById,
    compartmentByStorageId,
    compartmentByLocation,
    placementByShelf,
    placementsByProduct,
  };
}
