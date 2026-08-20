/** Route paths in one place, so a rename is one edit and never a broken string literal. */
export const ROUTES = {
  login: '/login',
  changePassword: '/account/password',
  dashboard: '/',
  inventory: {
    products: '/inventory',
    categories: '/inventory/categories',
    locations: '/inventory/locations',
    /** The pattern the router matches; `product()` builds the link. */
    productPattern: '/inventory/:productId',
    product: (productId: string) => `/inventory/${productId}`,
  },
  borrowing: {
    all: '/borrowing',
    mine: '/my-borrowings',
  },
  reports: {
    expenses: '/expenses',
  },
  boms: {
    all: '/boms',
    new: '/boms/new',
    /** The router pattern; the helper below builds links. */
    detailPattern: '/boms/:bomId',
    detail: (id: string) => '/boms/' + id,
  },
  requisitions: {
    /**
     * Deliberately not '/requisitions': that prefix-matches every '/requisitions/:id' detail
     * page, and NavLink marks active by prefix unless `end` is set. The personal list lighting
     * up while an approver reads someone else's requisition was a reported bug. Mirrors
     * `borrowing.mine` ('/my-borrowings'), which already had it right.
     */
    mine: '/my-requisitions',
    approvals: '/approvals',
    all: '/all-requisitions',
    new: '/requisitions/new',
    /** The router pattern; the helpers below build links. */
    detailPattern: '/requisitions/:requisitionId',
    editPattern: '/requisitions/:requisitionId/edit',
    detail: (id: string) => '/requisitions/' + id,
    edit: (id: string) => '/requisitions/' + id + '/edit',
  },
  projects: {
    all: '/projects',
    /** The router pattern; the helper below builds links. */
    detailPattern: '/projects/:projectId',
    detail: (id: string) => '/projects/' + id,
  },
  admin: {
    users: '/admin/users',
    departments: '/admin/departments',
    settings: '/admin/settings',
    auditLog: '/admin/audit-log',
  },
  /** Per-user settings. `changePassword` stays top-level: ProtectedRoute redirects to it. */
  account: {
    profile: '/account/profile',
  },
} as const;
