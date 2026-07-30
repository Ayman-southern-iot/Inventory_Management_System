import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListNotificationsQuery,
  Notification,
  Paginated,
  UnreadCount,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/**
 * How often the badge asks the server whether anything happened.
 *
 * There is no websocket (DECISIONS.md rules one out at this scale), so this interval *is* the
 * latency of the whole notification system. Thirty seconds is the compromise: fast enough that
 * an approver notices within the time it takes to walk back to their desk, slow enough that
 * twelve idle tabs cost the database 24 counts a minute against a partial index.
 *
 * `refetchIntervalInBackground: false` matters more than the number — without it, every tab
 * anyone left open overnight keeps polling until morning.
 */
const UNREAD_POLL_MS = 30_000;

export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: ({ signal }) => api.get<UnreadCount>('/notifications/unread-count', signal),
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    // A stale badge on a tab the user just came back to is the one case worth an extra request.
    refetchOnWindowFocus: true,
  });
}

export function useNotifications(query: ListNotificationsQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<Notification>>(`/notifications${toSearchParams(query)}`, signal),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<UnreadCount>('/notifications/mark-read', { ids }),
    onSuccess: (result) => {
      // The server returns the authoritative count, so write it straight in rather than
      // refetching — the badge must not flicker back to the old number in between.
      queryClient.setQueryData(queryKeys.notifications.unreadCount(), result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UnreadCount>('/notifications/mark-all-read', {}),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.notifications.unreadCount(), result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
    },
  });
}
