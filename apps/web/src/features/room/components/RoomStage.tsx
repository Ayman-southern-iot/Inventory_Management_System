import { lazy, Suspense } from 'react';
import { importOrReloadOnce, sessionReloadGuard } from '@/lib/import-or-reload';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/states';
import { t } from '@/i18n/en';
import type { RoomCanvasProps } from './RoomCanvas';

/** sessionStorage flag: the 3D chunk failed to load and the page reloaded once for it. */
const CANVAS_CHUNK_RELOAD_FLAG = 'ims.room-canvas.chunk-reloaded';

// three.js lives in this chunk only: a narrow screen, which never mounts the stage, never loads it.
// A tab left open across a deploy asks for a chunk that is gone; reload once rather than crash.
const RoomCanvas = lazy(() =>
  importOrReloadOnce(() => import('./RoomCanvas'), sessionReloadGuard(CANVAS_CHUNK_RELOAD_FLAG)),
);

interface RoomStageProps extends Omit<RoomCanvasProps, 'model'> {
  model: RoomCanvasProps['model'] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}

/** The 3D area: loading, failed with a retry, or the room. */
export function RoomStage({ model, isPending, isError, onRetry, ...canvas }: RoomStageProps) {
  if (isError) {
    return (
      <div
        role="alert"
        className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <AlertTriangle aria-hidden className="size-8 text-danger" />
        <p className="text-sm font-medium text-ink">{t.room.sceneFailed}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t.common.retry}
        </Button>
      </div>
    );
  }
  const loading = <LoadingState label={t.room.loadingScene} />;
  if (isPending || model === undefined) return loading;
  return (
    <Suspense fallback={loading}>
      <RoomCanvas model={model} {...canvas} />
    </Suspense>
  );
}
