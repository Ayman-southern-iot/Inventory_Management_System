import { addressOf, type PanelDrawer, type PanelLayout } from './layout';

/**
 * Joins an IMS location to a cell on the drawer plan (OQ-P2, Arif 2026-10-05):
 *
 *     room  = the drawer's room on the plan             "Cabinet A", "CTO Room — open shelves"
 *     zone  = exactly the drawer code                   "A1"
 *     code  = the cell code as printed in the drawer    "1G-1H"
 *     address = <zone name>-<compartment code>          "A1-1G-1H"
 *
 * IMS zones have a name and no code (and no description field), so the zone's name *is* the
 * drawer code; the drawer's descriptive name lives on the plan. Pinning the room as well is what
 * makes this one-to-one: zone names are unique only within a room
 * (`storage_zones_room_name_key`, migration 0033), so a demo room's "A1" must not shadow the
 * real one. Each drawer matches only in its own room — the room names come from the plan file,
 * never from this code. Rooms, zones within a room and codes within a zone are all unique
 * trimmed and case-insensitively, which is why this compares the same way.
 */

const normalise = (text: string) => text.trim().toUpperCase();

/** The plan drawer or shelf an IMS zone stands for, or undefined if it stands for none. */
function unitOf(
  shelf: { room: string; zone: string },
  layout: Pick<PanelLayout, 'unitByCode'>,
): PanelDrawer | undefined {
  const unit = layout.unitByCode.get(normalise(shelf.zone));
  return unit !== undefined && normalise(unit.room) === normalise(shelf.room) ? unit : undefined;
}

export function layoutAddressOf(
  location: { room: string; zone: string; compartment: string },
  layout: Pick<PanelLayout, 'unitByCode' | 'cellByAddress'>,
): string | null {
  const unit = unitOf(location, layout);
  if (unit === undefined) return null;
  const address = addressOf(unit.code, normalise(location.compartment));
  return layout.cellByAddress.has(address) ? address : null;
}

/**
 * Plan drawers and shelves with no matching zone among IMS's shelves, in plan order. Their parts
 * cannot be put on the map, and the panel says so rather than showing an empty drawer.
 */
export function unmatchedUnits(
  shelves: ReadonlyArray<{ room: string; zone: string }>,
  layout: Pick<PanelLayout, 'unitByCode'>,
): PanelDrawer[] {
  const matched = new Set<string>();
  for (const shelf of shelves) {
    const unit = unitOf(shelf, layout);
    if (unit !== undefined) matched.add(unit.code);
  }
  return [...layout.unitByCode.values()].filter((unit) => !matched.has(unit.code));
}
