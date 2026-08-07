import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PAGINATION_DEFAULT_LIMIT, type Notification } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  useNotifications,
  useUnreadCount,
} from '../api';

/** Past this, the exact number stops being useful and starts breaking the layout. */
const BADGE_MAX = 9;

const SEVERITY_DOT: Record<Notification['severity'], string> = {
  info: 'bg-ink-subtle',
  success: 'bg-success',
  warning: 'bg-pending',
  action_required: 'bg-danger',
};

/**
 * The bell in the app header, with an unread count.
 *
 * The badge polls; the list does not. Opening the panel is what fetches the notifications, so an
 * idle tab costs one small count query per interval rather than a page of rows.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const unread = useUnreadCount();
  const markRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllNotificationsRead();
  // `open` gates the query: closed bell, no list request.
  const list = useNotifications({ page: 1, limit: PAGINATION_DEFAULT_LIMIT }, open);

  const count = unread.data?.unread ?? 0;

  // Close on outside click and on Escape — the accessibility floor in rules/30 applies to a
  // popover as much as to a dialog.
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function openNotification(notification: Notification) {
    if (!notification.readAt) markRead.mutate([notification.id]);
    setOpen(false);
    if (notification.link) navigate(notification.link);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={count > 0 ? t.notifications.unreadLabel(count) : t.notifications.open}
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative inline-flex size-9 items-center justify-center rounded-[--radius-control] text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Bell aria-hidden className="size-5" />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-semibold leading-4 text-on-brand"
          >
            {count > BADGE_MAX ? t.notifications.overflow : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t.notifications.title}
          className="absolute right-0 z-50 mt-2 w-88 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[--radius-panel] border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-ink">{t.notifications.title}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={count === 0 || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
              icon={<CheckCheck aria-hidden className="size-4" />}
            >
              {t.notifications.markAllRead}
            </Button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {list.isPending && (
              <p className="px-3 py-6 text-center text-sm text-ink-subtle">{t.common.loading}</p>
            )}

            {list.error && (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-danger">{t.notifications.loadError}</p>
                <Button variant="ghost" size="sm" onClick={() => void list.refetch()}>
                  {t.notifications.retry}
                </Button>
              </div>
            )}

            {list.data?.items.length === 0 && (
              <div className="px-3 py-8 text-center">
                <p className="text-sm font-medium text-ink">{t.notifications.empty}</p>
                <p className="mt-1 text-xs text-ink-subtle">{t.notifications.emptyHint}</p>
              </div>
            )}

            {list.data?.items.map((notification) => (
              <button
                key={notification.id}
                type="button"
                role="menuitem"
                onClick={() => openNotification(notification)}
                className={cn(
                  'flex w-full gap-2.5 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-muted',
                  !notification.readAt && 'bg-surface-muted/60',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    notification.readAt ? 'bg-transparent' : SEVERITY_DOT[notification.severity],
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm',
                      notification.readAt ? 'text-ink-muted' : 'font-medium text-ink',
                    )}
                  >
                    {notification.title}
                  </span>
                  {notification.body && (
                    <span className="mt-0.5 block truncate text-xs text-ink-subtle">
                      {notification.body}
                    </span>
                  )}
                  <span className="mt-0.5 block text-xs text-ink-subtle">
                    {formatDateTime(notification.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
