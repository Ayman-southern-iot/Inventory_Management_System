import type { Placement } from '@ims/shared';
import type { StockService } from './stock.service';

/**
 * The row shape `StockService.placementsForProduct` returns, derived from the method rather than
 * restated — a column added to that projection cannot silently drift away from this mapper.
 */
export type PlacementView = Awaited<ReturnType<StockService['placementsForProduct']>>[number];

export function toPlacement(row: PlacementView): Placement {
  return {
    id: row.id,
    compartmentId: row.compartment_id,
    compartmentCode: row.compartment_code,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    quantity: row.quantity,
    reservedQty: row.reserved_qty,
    /**
     * Physically present (counted in `quantity`) but excluded from `available`. See migration
     * 0019; the CHECK constraint is the real guarantee, this is the running total.
     */
    quarantinedQty: row.quarantined_qty ?? 0,
    // Derived, never stored: a persisted `available` column can disagree with its own inputs.
    availableQty:
      row.quantity - row.reserved_qty - (row.quarantined_qty ?? 0),
    version: row.version,
  };
}
