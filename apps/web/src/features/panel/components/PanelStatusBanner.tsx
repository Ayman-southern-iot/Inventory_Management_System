import { WifiOff, AlertTriangle } from 'lucide-react';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';
import { MS_PER_SECOND, PANEL_OFFLINE_RETRY_MS } from '../constants';

interface PanelStatusBannerProps {
  /** The API did not answer: offline, or a proxy answered for it. */
  isUnreachable: boolean;
  /** The last poll failed for any reason. */
  hasError: boolean;
  /** When the counts on screen were read; 0 when nothing has been read yet. */
  dataUpdatedAt: number;
}

/**
 * Says when the screen is no longer live. The counts stay up — a kiosk that blanks itself when
 * the Wi-Fi drops is useless for "where is it", and the shelf positions rarely change — but
 * the person reading them is told how old they are.
 */
export function PanelStatusBanner({ isUnreachable, hasError, dataUpdatedAt }: PanelStatusBannerProps) {
  if (!hasError) return null;
  const since = dataUpdatedAt > 0 ? formatDateTime(new Date(dataUpdatedAt).toISOString()) : null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-pending bg-pending-subtle px-4 py-3 text-xl text-ink"
    >
      {isUnreachable ? (
        <WifiOff aria-hidden className="size-8 shrink-0 text-pending" />
      ) : (
        <AlertTriangle aria-hidden className="size-8 shrink-0 text-pending" />
      )}
      <span>
        {isUnreachable
          ? t.panel.offline(PANEL_OFFLINE_RETRY_MS / MS_PER_SECOND)
          : t.panel.refreshFailed}
        {since === null ? null : ` ${t.panel.offlineShowing(since)}`}
      </span>
    </div>
  );
}
