import type { ListDepartmentsQuery, ListUsersQuery } from '@ims/shared';

/**
 * Typed query-key factory. Keys are never written inline (rules/30-frontend.md) so that
 * invalidation stays precise — invalidating everything on every write makes the app feel
 * broken on a slow connection.
 */
export const queryKeys = {
  auth: {
    me: () => ['auth', 'me'] as const,
  },
  users: {
    all: () => ['users'] as const,
    list: (query: ListUsersQuery) => ['users', 'list', query] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
  departments: {
    all: () => ['departments'] as const,
    list: (query: ListDepartmentsQuery) => ['departments', 'list', query] as const,
  },
  settings: {
    all: () => ['settings'] as const,
    list: () => ['settings', 'list'] as const,
    approverSlots: () => ['settings', 'approver-slots'] as const,
  },
} as const;
