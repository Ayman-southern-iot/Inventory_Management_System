import { useEffect, useState, type RefObject } from 'react';
import { useSearchParams } from 'react-router-dom';
import { panelLayout } from '@/features/panel/layout';
import type { RoomSelection } from '../model';
import { parseRoomTarget, ROOM_CELL_PARAM } from '../deepLink';

/**
 * What `/room` has selected. A cell lives in the address bar (`?cell=`), so it survives a reload
 * and can be linked to; a drawer chosen without a cell is local state. Every deliberate choice
 * also bumps `flightRequest`, so choosing what is already selected flies the camera back to it.
 */
export function useRoomSelection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [drawerCode, setDrawerCode] = useState<string | null>(null);
  const [flightRequest, setFlightRequest] = useState(0);
  const fly = () => setFlightRequest((count) => count + 1);

  const target = parseRoomTarget(searchParams, panelLayout);
  const selection: RoomSelection =
    target.kind !== 'none'
      ? target
      : drawerCode === null
        ? null
        : { kind: 'drawer', code: drawerCode };

  const setCellParam = (address: string | null) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (address === null) next.delete(ROOM_CELL_PARAM);
        else next.set(ROOM_CELL_PARAM, address);
        return next;
      },
      { replace: true },
    );

  const clearSelection = () => {
    setDrawerCode(null);
    setCellParam(null);
  };
  return {
    selection,
    flightRequest,
    selectCell: (address: string) => {
      setDrawerCode(null);
      setCellParam(address);
      fly();
    },
    selectDrawer: (code: string) => {
      setDrawerCode(code);
      setCellParam(null);
      fly();
    },
    clearSelection,
    /** Back to the whole room, even when nothing was selected and the user had orbited away. */
    resetView: () => {
      clearSelection();
      fly();
    },
  };
}

const isTyping = () => {
  const element = document.activeElement;
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
};

/** `/` jumps to the search box; Escape outside it clears the selection (inside it, the box's own). */
export function useRoomShortcuts(search: RefObject<HTMLInputElement>, clearSelection: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping()) return;
      if (event.key === '/') {
        event.preventDefault();
        search.current?.focus();
      } else if (event.key === 'Escape') {
        clearSelection();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
}
