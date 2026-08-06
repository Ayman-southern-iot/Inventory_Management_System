import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { App } from '@/App';

/**
 * Proves the join `App.tsx` makes between the header's "My account" link and `ProfilePage`.
 * `AppShell.test.tsx` only checks the link's href, and `ProfilePage.test.tsx` only checks the
 * component renders in isolation — neither would catch the route itself going missing, which
 * would silently land the user on the catch-all "not found" screen instead.
 */
vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: currentUser,
      isRestoring: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshUser: vi.fn(),
      adoptSession: vi.fn(),
      hasRole: (...roles: Role[]) => roles.some((role) => currentUser?.roles.includes(role)),
    }),
  };
});

// What is under test is the route join, not the signature panel's data fetching.
vi.mock('@/features/profile/api', () => ({
  useMySignature: () => ({ data: { signature: null }, isPending: false }),
  useUploadSignature: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSignature: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

let currentUser: AuthUser | null = null;

function userWithRoles(roles: Role[]): AuthUser {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'person@ims.local',
    fullName: 'Test Person',
    designation: 'Engineer',
    departmentId: null,
    departmentName: null,
    roles,
    mustChangePassword: false,
  };
}

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('the account route', () => {
  it('renders ProfilePage at ROUTES.account.profile', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.INVENTORY_MANAGER]);
    window.history.pushState({}, '', ROUTES.account.profile);

    render(<App />);

    expect(screen.getByRole('heading', { name: t.nav.account })).toBeInTheDocument();
  });
});
