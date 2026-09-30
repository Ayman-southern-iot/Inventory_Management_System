import { AlertTriangle, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';

interface ApiKeysAvailabilityProps {
  /** `usage.keysDisabledInDemo`: production running demo accounts refuses every key. */
  isDisabledInDemo: boolean;
  /** The usage document failed to load, so the page cannot know whether issuing is allowed. */
  loadError: unknown;
  onRetry: () => void;
}

/**
 * Why a key cannot be issued right now, when that is the case — and nothing otherwise.
 *
 * Demo mode is a standing fact about the deployment, not a failure, so it reads as a notice.
 * A usage document that did not load is a failure, so it offers a retry: until it loads, the
 * page does not know the demo flag or the write-key ceiling, and the issue button stays off.
 */
export function ApiKeysAvailability({
  isDisabledInDemo,
  loadError,
  onRetry,
}: ApiKeysAvailabilityProps) {
  if (loadError) {
    return (
      <div
        role="alert"
        className="mb-4 flex items-center justify-between gap-3 rounded-[--radius-control] bg-danger-subtle px-4 py-3 text-sm text-danger"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          {t.apiKeys.settingsUnavailable}
        </span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t.common.retry}
        </Button>
      </div>
    );
  }

  if (!isDisabledInDemo) return null;

  return (
    <section
      role="status"
      aria-label={t.apiKeys.demoDisabledTitle}
      className="mb-4 flex items-start gap-3 rounded-[--radius-control] bg-pending-subtle px-4 py-3 text-sm text-ink"
    >
      <ShieldOff aria-hidden className="mt-0.5 size-4 shrink-0 text-pending" />
      <div>
        <p className="font-medium">{t.apiKeys.demoDisabledTitle}</p>
        <p className="mt-0.5 text-ink-muted">{t.apiKeys.demoDisabledBody}</p>
      </div>
    </section>
  );
}
