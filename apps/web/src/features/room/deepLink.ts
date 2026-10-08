import { type PanelLayout } from '@/features/panel/layout';

/**
 * `/room?cell=B2-2A-2D` opens the room focused on that cell. Built for other screens to link
 * here — the lab panel and the voice unit later — so the parameter is a plain plan address.
 */
export const ROOM_CELL_PARAM = 'cell';

export type RoomTarget =
  | { kind: 'cell'; address: string }
  | { kind: 'none' }
  /** Asked for a cell the plan does not have. Kept, so the screen can say which. */
  | { kind: 'unknown'; value: string };

export function parseRoomTarget(
  params: URLSearchParams,
  layout: Pick<PanelLayout, 'cellByAddress'>,
): RoomTarget {
  const value = (params.get(ROOM_CELL_PARAM) ?? '').trim().toUpperCase();
  if (value === '') return { kind: 'none' };
  return layout.cellByAddress.has(value)
    ? { kind: 'cell', address: value }
    : { kind: 'unknown', value };
}
