import { addressOf, type PanelLayout } from './layout';

/**
 * Joins an IMS location to a cell on the drawer plan. One rule (OQ-P2, Arif 2026-10-05):
 *
 *     address = <zone name>-<compartment code>        e.g. zone "A1" + compartment "1G-1H"
 *
 * IMS zones have a name and no code, so the zone is named exactly the plan's drawer code ("A1",
 * "LB"), and the compartment carries the cell code as printed in the drawer ("1G-1H", "1").
 *
 * Two things keep the join one-to-one:
 * - the zone name has to be a drawer code on the plan, not merely spell a known address: zone
 *   "A1-1G" with compartment "1H" also reads `A1-1G-1H`;
 * - a drawer code used as a zone name in **two rooms** joins nothing at all. Zone names are unique
 *   only within a room (`storage_zones_room_name_key`, migration 0033), so "Main Store / A1" and
 *   "Cabinet A / A1" can both exist, and drawing either in drawer A1 could send someone to the
 *   wrong building. Whether the room should be pinned too is the lead's call (OQ-P2).
 * Within one zone a code is unique (`storage_compartments_zone_code_key`). All three indexes
 * compare trimmed and case-insensitively, which is why this does too.
 */

const normalise = (text: string) => text.trim().toUpperCase();

/** Drawer codes on the plan that more than one room uses as a zone name. */
export function ambiguousUnits(
  shelves: ReadonlyArray<{ room: string; zone: string }>,
  layout: Pick<PanelLayout, 'unitByCode'>,
): Set<string> {
  const roomsByUnit = new Map<string, Set<string>>();
  for (const shelf of shelves) {
    const unit = normalise(shelf.zone);
    if (!layout.unitByCode.has(unit)) continue;
    const rooms = roomsByUnit.get(unit) ?? new Set<string>();
    rooms.add(normalise(shelf.room));
    roomsByUnit.set(unit, rooms);
  }
  return new Set([...roomsByUnit].filter(([, rooms]) => rooms.size > 1).map(([unit]) => unit));
}

export function layoutAddressOf(
  location: { zone: string; compartment: string },
  layout: Pick<PanelLayout, 'unitByCode' | 'cellByAddress'>,
  ambiguous: ReadonlySet<string> = new Set(),
): string | null {
  const unit = normalise(location.zone);
  if (!layout.unitByCode.has(unit) || ambiguous.has(unit)) return null;
  const address = addressOf(unit, normalise(location.compartment));
  return layout.cellByAddress.has(address) ? address : null;
}
