/** Route paths in one place, so a rename is one edit and never a broken string literal. */
export const ROUTES = {
  login: '/login',
  changePassword: '/account/password',
  dashboard: '/',
  admin: {
    users: '/admin/users',
    departments: '/admin/departments',
    settings: '/admin/settings',
  },
} as const;
