import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n/en';
import { FIRST_FLIGHT_MS, REDUCED_MOTION_MEDIA } from '../constants';
import type { RoomModel, RoomPick } from '../model';
import { RoomScene } from '../scene/RoomScene';

export interface RoomCanvasProps {
  model: RoomModel;
  /** What is selected: the drawer or cell to open and fly to, or null for the whole room. */
  focus: RoomPick | null;
  /**
   * Bumped by every deliberate choice (a search pick, a click, Reset view), so choosing what is
   * already selected still flies back to it after the user has orbited away.
   */
  flightRequest: number;
  stockedAddresses: ReadonlySet<string>;
  partsByDrawer: ReadonlyMap<string, number>;
  onPick: (pick: RoomPick) => void;
  onReady: () => void;
}

const hasWebgl = () => document.createElement('canvas').getContext('webgl2') !== null;

const focusKey = (focus: RoomPick | null) =>
  focus === null ? '' : focus.kind === 'cell' ? `cell:${focus.address}` : `drawer:${focus.code}`;

/**
 * Hosts one `RoomScene` for as long as it is mounted. Its own chunk, loaded only on a wide screen,
 * so three.js never reaches a narrow one. The canvas is created here rather than rendered: a
 * disposed scene gives its WebGL context back, and a canvas whose context was given back cannot
 * get another, which StrictMode's mount–unmount–mount would otherwise trip over.
 */
export default function RoomCanvas({
  model,
  focus,
  flightRequest,
  stockedAddresses,
  partsByDrawer,
  onPick,
  onReady,
}: RoomCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RoomScene | null>(null);
  const isFirstFlight = useRef(true);
  const callbacks = useRef({ onPick, onReady });
  callbacks.current = { onPick, onReady };
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (host === null || overlay === null) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'block size-full';
    host.prepend(canvas);
    try {
      sceneRef.current = new RoomScene({
        canvas,
        overlay,
        themeSource: host,
        model,
        reducedMotion: matchMedia(REDUCED_MOTION_MEDIA).matches,
        onPick: (pick) => callbacks.current.onPick(pick),
        onFirstFrame: () => callbacks.current.onReady(),
      });
    } catch (error) {
      // Either no WebGL (disabled, a blocklisted GPU, a remote desktop without it) or a scene file
      // that decoded badly. Say which, so the advice fits; the cause goes to the console.
      console.error('The 3D room could not start', error);
      setFailure(hasWebgl() ? t.room.sceneFailed : t.room.noWebgl);
    }
    isFirstFlight.current = true;
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, [model]);

  useEffect(() => {
    sceneRef.current?.setStock(stockedAddresses, partsByDrawer);
  }, [model, stockedAddresses, partsByDrawer]);

  const key = focusKey(focus);
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return;
    scene.focusOn(focus, isFirstFlight.current ? FIRST_FLIGHT_MS : undefined);
    isFirstFlight.current = false;
    // Keyed on `key`, not `focus`: the object is new on every render, the selection is not.
  }, [model, key, flightRequest]);

  if (failure !== null) {
    return (
      <p role="alert" className="p-6 text-sm text-ink-muted">
        {failure}
      </p>
    );
  }
  return (
    <div ref={hostRef} role="img" aria-label={t.room.canvasLabel} className="relative size-full">
      <div
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      />
    </div>
  );
}
