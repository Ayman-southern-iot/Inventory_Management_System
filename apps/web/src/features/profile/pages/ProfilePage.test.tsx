import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ProfilePage } from './ProfilePage';

let currentUser: AuthUser | null = null;

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    user: currentUser,
    hasRole: (...roles: Role[]) => roles.some((role) => currentUser?.roles.includes(role)),
  }),
}));

// What is under test is whether the panel is mounted, not what it fetches.
vi.mock('@/features/profile/api', () => ({
  useMySignature: () => ({ data: { signature: null }, isPending: false }),
  useUploadSignature: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSignature: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

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

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  it('shows the signature panel to an inventory manager', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.INVENTORY_MANAGER]);
    renderPage();
    expect(screen.getByRole('heading', { name: t.signature.title })).toBeInTheDocument();
  });

  it('shows the signature panel to an approver', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.APPROVER]);
    renderPage();
    expect(screen.getByRole('heading', { name: t.signature.title })).toBeInTheDocument();
  });

  it('hides the signature panel from a general user', () => {
    currentUser = userWithRoles([Role.GENERAL]);
    renderPage();
    // Positive assertion first, so this cannot pass because the page rendered nothing at all.
    expect(screen.getByRole('heading', { name: t.nav.account })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t.signature.title })).not.toBeInTheDocument();
  });

  it('offers the way to change password to everyone', () => {
    currentUser = userWithRoles([Role.GENERAL]);
    renderPage();
    expect(screen.getByRole('link', { name: t.account.changePassword })).toBeInTheDocument();
  });

  it('renders nothing when there is no user rather than crashing', () => {
    currentUser = null;
    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });
});
