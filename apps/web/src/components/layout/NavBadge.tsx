import { Role } from '@ims/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useAwaitingCount } from '@/features/requisitions/api';

/**
 * The approver's pending count (tasks 3.7, 3.8).
 *
 * Polled rather than pushed for now — the websocket arrives with the notification work, and
 * a count that is at most a minute stale is honest about what it is. `refetchInterval` keeps
 * it moving without the user reloading, which is the acceptance criterion's intent even if
 * the transport is not yet a socket.
 */
export function AwaitingApprovalBadge() {
  const { hasRole } = useAuth();
  const canApprove = hasRole(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN);
  const awaiting = useAwaitingCount(canApprove);

  const count = awaiting.data?.count ?? 0;
  if (!canApprove || count === 0) return null;

  return (
    <span
      // Announced, because for an approver this number is the point of the page.
      aria-label={`${count} awaiting your approval`}
      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-xs font-semibold text-on-brand"
    >
      {count}
    </span>
  );
}
