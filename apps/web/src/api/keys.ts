import type {
  ListRequisitionsQuery,
  ListBorrowsQuery,
  ListBomsQuery,
  ListDepartmentsQuery,
  ListLedgerQuery,
  ListProductsQuery,
  ListProjectItemsQuery,
  ListUsersQuery,
  ListAuditQuery,
  ListNotificationsQuery,
  ExpenseReportQuery,
} from '@ims/shared';

/**
 * Typed query-key factory. Keys are never written inline (rules/30-frontend.md) so that
 * invalidation stays precise — invalidating everything on every write makes the app feel
 * broken on a slow connection.
 */
export const queryKeys = {
  auth: {
    me: () => ['auth', 'me'] as const,
    demoAccounts: () => ['auth', 'demo-accounts'] as const,
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
    /** Every project in one array. The hook pages through the API to build it. */
    list: () => ['projects', 'list'] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    /** Prefix for one project's item pages, whatever the usage filter. */
    itemsFor: (id: string) => ['projects', 'items', id] as const,
    items: (id: string, query: ListProjectItemsQuery) =>
      ['projects', 'items', id, query] as const,
  },
  requisitions: {
    all: () => ['requisitions'] as const,
    /** Prefix for every list, whatever its filters. */
    lists: () => ['requisitions', 'list'] as const,
    list: (query: ListRequisitionsQuery) => ['requisitions', 'list', query] as const,
    detail: (id: string) => ['requisitions', 'detail', id] as const,
    awaitingCount: () => ['requisitions', 'awaiting-count'] as const,
    approvalPolicy: () => ['requisitions', 'approval-policy'] as const,
  },
  delegations: {
    mine: () => ['delegations', 'mine'] as const,
  },
  boms: {
    all: () => ['boms'] as const,
    /** Prefix for every list, whatever its filters. */
    lists: () => ['boms', 'list'] as const,
    list: (query: ListBomsQuery) => ['boms', 'list', query] as const,
    detail: (id: string) => ['boms', 'detail', id] as const,
    /** The picker that drives the generate page — short cache so the IM does not wait on a
     *  full list refetch while they tick candidates. */
    candidates: () => ['boms', 'candidates'] as const,
    /**
     * The live BOM covering one requisition. The funds panel needs the IM's quantity override
     * to render the record-purchase dialog and submit it. Null when the requisition has no
     * live BOM; the client falls back to wire quantity.
     */
    byRequisition: (requisitionId: string) => ['boms', 'by-requisition', requisitionId] as const,
  },
  auditLog: {
    all: () => ['audit-log'] as const,
    list: (query: ListAuditQuery) => ['audit-log', 'list', query] as const,
    detail: (id: string) => ['audit-log', 'detail', id] as const,
  },
  profile: {
    all: () => ['profile'] as const,
    signature: () => ['profile', 'signature'] as const,
  },
  funds: {
    all: () => ['funds'] as const,
    funding: (requisitionId: string) => ['funds', 'funding', requisitionId] as const,
  },
  dashboard: {
    all: () => ['dashboard'] as const,
    /** The signed-in person's own record. No id in the key: there is only ever one. */
    me: () => ['dashboard', 'me'] as const,
  },
  reports: {
    all: () => ['reports'] as const,
    expenses: (query: ExpenseReportQuery) => ['reports', 'expenses', query] as const,
  },
  notifications: {
    all: () => ['notifications'] as const,
    list: (query: ListNotificationsQuery) => ['notifications', 'list', query] as const,
    /** The badge. Kept out of `list` so marking one read does not refetch the whole feed. */
    unreadCount: () => ['notifications', 'unread-count'] as const,
  },
} as const;
