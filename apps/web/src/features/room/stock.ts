import { type CatalogueProduct } from '@ims/shared';
import { layoutAddressOf } from '@/features/panel/address';
import { type PanelLayout } from '@/features/panel/layout';

/** One product on one cell, as the side list shows it. Quantities only; never who has any. */
export interface RoomStockRow {
  key: string;
  productId: string;
  name: string;
  code: string;
  /** The plan address, e.g. `B2-2A-2D`. */
  address: string;
  /** The printed shelf label, e.g. `CAB-B2-2A2D-0104`: what someone reads off the cell. */
  storageId: string;
  quantity: number;
  available: number;
}

export interface RoomStock {
  /** Every plan cell IMS has stock records for, with what is in it, by part name. */
  byAddress: ReadonlyMap<string, RoomStockRow[]>;
  /** Cells holding at least one unit: drawn solid when their drawer is open. */
  stockedAddresses: ReadonlySet<string>;
  /** Product lines on hand per drawer or open shelf: the count on the drawer front. */
  partsByDrawer: ReadonlyMap<string, number>;
  /** Shelves in IMS that are on no plan cell (another room, or a zone not named by its code). */
  unmatchedShelves: number;
}

/**
 * The catalogue joined to the plan, cell by cell. The join is the panel's (`layoutAddressOf`,
 * OQ-P2: room + zone name + compartment code), so `/room` and `/panel` can never disagree about
 * where a part is. Kept apart from the panel's search index because the side list here also
 * shows the storage ID, which the panel's rows do not carry.
 */
export function buildRoomStock(products: CatalogueProduct[], layout: PanelLayout): RoomStock {
  const byAddress = new Map<string, RoomStockRow[]>();
  const unmatched = new Set<string>();

  for (const product of products) {
    for (const location of product.locations) {
      const address = layoutAddressOf(location, layout);
      if (address === null) {
        unmatched.add(location.compartmentId);
        continue;
      }
      const rows = byAddress.get(address) ?? [];
      rows.push({
        key: `${product.id}:${location.compartmentId}`,
        productId: product.id,
        name: product.name,
        code: product.code,
        address,
        storageId: location.storageId,
        quantity: location.quantity,
        available: location.available,
      });
      byAddress.set(address, rows);
    }
  }

  const stockedAddresses = new Set<string>();
  const partsByDrawer = new Map<string, number>();
  for (const [address, rows] of byAddress) {
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const onHand = rows.filter((row) => row.quantity > 0).length;
    if (onHand === 0) continue;
    stockedAddresses.add(address);
    const drawerCode = layout.cellByAddress.get(address)?.unit.code;
    if (drawerCode !== undefined) {
      partsByDrawer.set(drawerCode, (partsByDrawer.get(drawerCode) ?? 0) + onHand);
    }
  }
  return { byAddress, stockedAddresses, partsByDrawer, unmatchedShelves: unmatched.size };
}
