import { Monitor } from 'lucide-react';
import { t } from '@/i18n/en';
import { DESKTOP_MEDIA, DESKTOP_MIN_WIDTH_PX, useMediaQuery } from '@/lib/useMediaQuery';
import { RoomView } from '../components/RoomView';

/**
 * `/room`: the CTO room in 3D, for PCs. Any signed-in role may open it; it reads only the
 * catalogue, which names nobody (K2). Below 1024 px it says so and loads nothing more — no
 * three.js, no scene. It is never linked from `/panel`, and the kiosk does not load it.
 */
export function RoomPage() {
  const isWide = useMediaQuery(DESKTOP_MEDIA);
  if (isWide) return <RoomView />;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Monitor aria-hidden className="size-8 text-ink-subtle" />
      <h1 className="text-sm font-medium text-ink">{t.room.narrowTitle}</h1>
      <p className="max-w-sm text-sm text-ink-muted">{t.room.narrowBody(DESKTOP_MIN_WIDTH_PX)}</p>
    </div>
  );
}
