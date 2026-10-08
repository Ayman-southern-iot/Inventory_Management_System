import { t } from '@/i18n/en';

interface PanelNoticeProps {
  message: string;
  /** Shown for a failure the person can do something about by trying again. */
  onRetry?: () => void;
  isAlert?: boolean;
}

/**
 * The shared `LoadingState`/`ErrorState` are sized for a desk screen. The panel is read from
 * a metre and a half away, so its notices use the panel's type scale instead.
 */
export function PanelNotice({ message, onRetry, isAlert = false }: PanelNoticeProps) {
  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="text-2xl text-ink-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="h-14 rounded-control bg-brand px-6 text-xl font-semibold text-on-brand"
        >
          {t.common.retry}
        </button>
      ) : null}
    </div>
  );
}
