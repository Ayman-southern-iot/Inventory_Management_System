import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, ShieldOff } from 'lucide-react';
import { t } from '@/i18n/en';
import { ApiError } from '@/api/client';
import { Button } from './Button';
import { cn } from '@/lib/cn';

/**
 * The four states every data screen must handle explicitly (rules/30-frontend.md):
 * loading · empty · error (with retry) · loaded. "Empty" is never "loading forever".
 */

export function LoadingState({ label = t.common.loading }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-16 text-ink-muted">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Table-shaped placeholder — less jarring than a spinner when a list is refetching. */
export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label={t.common.loading} className="divide-y divide-border">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 px-4 py-3">
          {Array.from({ length: columns }, (_, colIndex) => (
            <div
              key={colIndex}
              className={cn(
                'h-4 animate-pulse rounded bg-surface-muted',
                colIndex === 0 ? 'w-1/4' : 'flex-1',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title = t.states.emptyTitle,
  body,
  action,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Inbox aria-hidden className="size-8 text-ink-subtle" />
      <p className="text-sm font-medium text-ink">{title}</p>
      {body ? <p className="max-w-sm text-sm text-ink-muted">{body}</p> : null}
      {action}
    </div>
  );
}

/**
 * Maps an error to copy the user can act on. A network failure and a 403 need different
 * words — "try again" is useless advice for a permission problem.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  const isForbidden = apiError?.status === 403;
  const isNetwork = apiError?.code === 'NETWORK';

  const title = isForbidden
    ? t.states.forbiddenTitle
    : isNetwork
      ? t.states.offlineTitle
      : t.states.errorTitle;

  const body = isForbidden
    ? t.states.forbiddenBody
    : isNetwork
      ? t.states.offlineBody
      : (apiError?.message ?? t.states.errorBody);

  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {isForbidden ? (
        <ShieldOff aria-hidden className="size-8 text-danger" />
      ) : (
        <AlertTriangle aria-hidden className="size-8 text-danger" />
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="max-w-sm text-sm text-ink-muted">{body}</p>
      {onRetry && !isForbidden ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t.common.retry}
        </Button>
      ) : null}
    </div>
  );
}

interface QueryBoundaryProps<T> {
  isLoading: boolean;
  error: unknown;
  data: T | undefined;
  isEmpty?: (data: T) => boolean;
  onRetry?: () => void;
  loadingFallback?: ReactNode;
  emptyFallback?: ReactNode;
  children: (data: T) => ReactNode;
}

/**
 * Forces all four states to be handled by construction — a screen cannot forget one, because
 * it cannot reach `children` without passing through the other three.
 */
export function QueryBoundary<T>({
  isLoading,
  error,
  data,
  isEmpty,
  onRetry,
  loadingFallback,
  emptyFallback,
  children,
}: QueryBoundaryProps<T>) {
  if (isLoading) return <>{loadingFallback ?? <LoadingState />}</>;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (data === undefined) return <ErrorState error={null} onRetry={onRetry} />;
  if (isEmpty?.(data)) return <>{emptyFallback ?? <EmptyState />}</>;
  return <>{children(data)}</>;
}
