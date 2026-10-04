import { addressOf, type PanelLayout } from './layout';

/**
 * Joins an IMS location to a cell on the drawer plan. One rule (OQ-P2, Arif 2026-10-05):
 *
 *     address = <zone name>-<compartment code>        e.g. zone "A1" + compartment "1G-1H"
 *
 * IMS zones have a name and no code, so the zone is named exactly the plan's drawer code ("A1",
 * "LB"), and the compartment carries the cell code as printed in the drawer ("1G-1H", "1").
 *
 * The zone name has to be a drawer code on the plan, not merely produce a known address: zone
 * "A1-1G" with compartment "1H" also spells `A1-1G-1H`, and without that check two shelves could
 * claim one cell. With it, the join is one-to-one: zone names are unique (`storage_zones_name_key`)
 * and so is a code within a zone (`storage_compartments_zone_code_key`), both compared trimmed and
 * case-insensitively — which is why this compares the same way.
 */
export function layoutAddressOf(
  location: { zone: string; compartment: string },
  layout: Pick<PanelLayout, 'unitByCode' | 'cellByAddress'>,
): string | null {
  const unit = location.zone.trim().toUpperCase();
  if (!layout.unitByCode.has(unit)) return null;
  const address = addressOf(unit, location.compartment.trim().toUpperCase());
  return layout.cellByAddress.has(address) ? address : null;
}
