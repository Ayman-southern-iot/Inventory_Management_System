import { type CatalogueLocation, type CatalogueProduct } from '@ims/shared';
import { ambiguousUnits, layoutAddressOf } from './address';
import { type PanelDrawer, type PanelLayout } from './layout';

/** One product on one shelf: a search answer, or a line in a cell's contents. */
export interface StockRow {
  key: string;
  productId: string;
  name: string;
  code: string;
  /** The plan address, or null when IMS has the shelf but the plan does not. */
  address: string | null;
  /** IMS's own label for the shelf, shown when there is no plan address. */
  imsLabel: string;
  quantity: number;
  available: number;
}

export interface PanelIndex {
  rows: StockRow[];
  /** Products the catalogue knows but no shelf holds: an answer too ("not on a shelf"). */
  unshelved: StockRow[];
  rowsByAddress: ReadonlyMap<string, StockRow[]>;
}

export interface SearchResult {
  drawers: PanelDrawer[];
  rows: StockRow[];
  /** Rows that matched beyond `limit`. */
  hiddenCount: number;
}

/** By part name; within one part, the shelves on the plan before the ones the map cannot show. */
const byName = (a: StockRow, b: StockRow) =>
  a.name.localeCompare(b.name) ||
  Number(a.address === null) - Number(b.address === null) ||
  (a.address ?? a.imsLabel).localeCompare(b.address ?? b.imsLabel);

/**
 * `shelves` is every shelf IMS has (the catalogue's flat `locations`), empty ones included: a
 * drawer code two rooms share is ambiguous whether or not both hold stock today.
 */
export function buildIndex(
  products: CatalogueProduct[],
  layout: PanelLayout,
  shelves: readonly CatalogueLocation[] = [],
): PanelIndex {
  const ambiguous = ambiguousUnits(
    [...shelves, ...products.flatMap((product) => product.locations)],
    layout,
  );
  const rows: StockRow[] = [];
  const unshelved: StockRow[] = [];

  for (const product of products) {
    const base = { productId: product.id, name: product.name, code: product.code };
    if (product.locations.length === 0) {
      unshelved.push({ ...base, key: product.id, address: null, imsLabel: '', quantity: 0, available: 0 });
      continue;
    }
    for (const location of product.locations) {
      rows.push({
        ...base,
        key: `${product.id}:${location.compartmentId}`,
        address: layoutAddressOf(location, layout, ambiguous),
        imsLabel: location.label,
        quantity: location.quantity,
        available: location.available,
      });
    }
  }
  rows.sort(byName);
  unshelved.sort(byName);

  const rowsByAddress = new Map<string, StockRow[]>();
  for (const row of rows) {
    if (row.address === null) continue;
    const list = rowsByAddress.get(row.address) ?? [];
    list.push(row);
    rowsByAddress.set(row.address, list);
  }
  return { rows, unshelved, rowsByAddress };
}

/**
 * The same match the product list's server search makes — `name ILIKE '%q%' OR product_code
 * ILIKE '%q%'` (products.repository.ts) — so a part found on a PC is found here. A query that is
 * a drawer code or the start of an address ("A3", "A1-1G") also finds that drawer and what it
 * holds, which is what the empty state invites people to type.
 */
export function searchPanel(
  index: PanelIndex,
  layout: PanelLayout,
  query: string,
  limit: number,
): SearchResult {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { drawers: [], rows: [], hiddenCount: 0 };
  const upper = needle.toUpperCase();

  const drawers = [...layout.unitByCode.values()].filter(
    (unit) => unit.code === upper || upper.startsWith(`${unit.code}-`),
  );
  // "A1" is a drawer, so it must not also match A10; once a hyphen is typed, "A1-1" is the start
  // of an address and matches as typed, so results do not blink out mid-segment.
  const isAddressStart = (address: string) =>
    upper.includes('-') ? address.startsWith(upper) : address.startsWith(`${upper}-`);
  const matches = (row: StockRow) =>
    row.name.toLowerCase().includes(needle) ||
    row.code.toLowerCase().includes(needle) ||
    (row.address !== null && (row.address === upper || isAddressStart(row.address)));

  // Placed rows first: the panel's question is "where", and a shelf is the answer to it.
  const all = [...index.rows.filter(matches), ...index.unshelved.filter(matches)];
  return { drawers, rows: all.slice(0, limit), hiddenCount: Math.max(0, all.length - limit) };
}
