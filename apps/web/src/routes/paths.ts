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
  admin: {
    users: '/admin/users',
    departments: '/admin/departments',
    settings: '/admin/settings',
  },
} as const;
