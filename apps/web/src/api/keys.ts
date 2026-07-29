import type {
  ListRequisitionsQuery,
  ListBorrowsQuery,
  ListDepartmentsQuery,
  ListLedgerQuery,
  ListProductsQuery,
  ListUsersQuery,
} from '@ims/shared';

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
  categories: {
    all: () => ['categories'] as const,
    tree: () => ['categories', 'tree'] as const,
  },
  products: {
    all: () => ['products'] as const,
    /** Prefix for every product list, whatever its filters — invalidated when totals change. */
    lists: () => ['products', 'list'] as const,
    list: (query: ListProductsQuery) => ['products', 'list', query] as const,
    /** One product's card. A move touches this and nothing else. */
    detail: (id: string) => ['products', 'detail', id] as const,
  },
  locations: {
    all: () => ['locations'] as const,
    zones: () => ['locations', 'zones'] as const,
  },
  ledger: {
    all: () => ['ledger'] as const,
    list: (query: ListLedgerQuery) => ['ledger', 'list', query] as const,
  },
  borrows: {
    all: () => ['borrows'] as const,
    list: (query: ListBorrowsQuery) => ['borrows', 'list', query] as const,
    pendingCount: () => ['borrows', 'pending-count'] as const,
  },
  projects: {
    all: () => ['projects'] as const,
  },
  requisitions: {
    all: () => ['requisitions'] as const,
    /** Prefix for every list, whatever its filters. */
    lists: () => ['requisitions', 'list'] as const,
    list: (query: ListRequisitionsQuery) => ['requisitions', 'list', query] as const,
    detail: (id: string) => ['requisitions', 'detail', id] as const,
    awaitingCount: () => ['requisitions', 'awaiting-count'] as const,
  },
  delegations: {
    mine: () => ['delegations', 'mine'] as const,
  },
} as const;
