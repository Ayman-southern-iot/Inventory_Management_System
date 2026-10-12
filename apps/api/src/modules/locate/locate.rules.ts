import { LocateState, type LocateDrawer } from '@ims/shared';

/** A cell, named the way the cabinet is labelled. */
export interface CellAddress {
  /** The cabinet, e.g. `Cabinet B`. */
  room: string;
  /** The drawer, e.g. `B2`. */
  zone: string;
  /** The cell inside the drawer, e.g. `2A-2D`. */
  cell: string;
}

/** One shelf holding the product now, with the units that could be handed out from it. */
export interface StockedCell extends CellAddress {
  available: number;
}

/** What the resolver knows about one requested product. */
export interface ProductWhereabouts {
  /** Every shelf holding it now. Empty once the last unit has left — the placement is deleted. */
  placements: readonly StockedCell[];
  /**
   * The cell its stock most recently left, from the ledger; null when it was never on a shelf.
   * Only consulted when `placements` is empty, which is exactly when a product has run out.
   */
  lastCell: CellAddress | null;
}

/**
 * The drawer-light rules (Phase 13, decided 2026-10-12):
 *
 *  - a cell is **green** when it has any available, **red** when it has none — out of stock, all
 *    on loan, reserved or quarantined;
 *  - a product with no placement falls back to the cell its stock last left, which is red by
 *    definition. That is how "it lives here, none left" can be shown at all: `StockService`
 *    deletes a placement when it reaches zero, so the ledger is the only record of where it was;
 *  - a product never placed anywhere adds nothing;
 *  - one light per drawer, so a drawer is green if **any** of its cells is.
 *
 * Drawers come out in cabinet order, cells sorted, so the same search always produces the same
 * event.
 */
export function toDrawers(products: readonly ProductWhereabouts[]): LocateDrawer[] {
  const drawers = new Map<string, { room: string; zone: string; isGreen: boolean; cells: Set<string> }>();

  for (const product of products) {
    const cells: readonly StockedCell[] =
      product.placements.length > 0
        ? product.placements
        : product.lastCell === null
          ? []
          : [{ ...product.lastCell, available: 0 }];

    for (const cell of cells) {
      const key = JSON.stringify([cell.room, cell.zone]);
      const drawer = drawers.get(key) ?? {
        room: cell.room,
        zone: cell.zone,
        isGreen: false,
        cells: new Set<string>(),
      };
      drawer.isGreen ||= cell.available > 0;
      drawer.cells.add(cell.cell);
      drawers.set(key, drawer);
    }
  }

  return [...drawers.values()]
    .sort((a, b) => compareText(a.room, b.room) || compareText(a.zone, b.zone))
    .map((drawer) => ({
      zone: drawer.zone,
      room: drawer.room,
      state: drawer.isGreen ? LocateState.GREEN : LocateState.RED,
      cells: [...drawer.cells].sort(compareText),
    }));
}

/** Code-point order, not locale order: the event must not depend on the server's locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
