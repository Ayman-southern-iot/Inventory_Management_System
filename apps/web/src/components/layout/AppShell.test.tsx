import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { AppShell } from './AppShell';

/**
 * Plan 0.8 acceptance criterion: logging in as each role shows only that role's navigation.
 * The provider is stubbed rather than driven through a real login, because what is under
 * test is the filtering, not the auth flow.
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
      hasRole: (...roles: Role[]) => roles.some((role) => currentUser?.roles.includes(role)),
    }),
  };
});

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

function renderShell(at = '/') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>content</p>} />
            <Route path={ROUTES.requisitions.detailPattern} element={<p>detail</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell navigation', () => {
  it('hides the whole Administration group from a general user', () => {
    currentUser = userWithRoles([Role.GENERAL]);
    renderShell();

    expect(screen.getByRole('link', { name: t.nav.dashboard })).toBeInTheDocument();
    expect(screen.queryByText(t.nav.admin)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t.nav.adminUsers })).not.toBeInTheDocument();
  });

  it.each([[Role.APPROVER], [Role.INVENTORY_MANAGER]])(
    'hides Administration from a %s who is not also an admin',
    (role) => {
      currentUser = userWithRoles([Role.GENERAL, role]);
      renderShell();
      expect(screen.queryByRole('link', { name: t.nav.adminSettings })).not.toBeInTheDocument();
    },
  );

  it('shows every admin link to an admin', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.ADMIN]);
    renderShell();

    expect(screen.getByRole('link', { name: t.nav.adminUsers })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.nav.adminDepartments })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.nav.adminSettings })).toBeInTheDocument();
  });

  // The project hub is shared context: a general user borrowing for a project has as much
  // business seeing what it holds as the IM does, so it sits in the unroled nav group.
  it.each([[Role.GENERAL], [Role.APPROVER], [Role.INVENTORY_MANAGER], [Role.ADMIN]])(
    'shows the project hub to a %s',
    (role) => {
      currentUser = userWithRoles([Role.GENERAL, role]);
      renderShell();

      expect(screen.getByRole('link', { name: t.nav.projects })).toHaveAttribute(
        'href',
        ROUTES.projects.all,
      );
    },
  );

  it('renders nothing when there is no user rather than crashing', () => {
    currentUser = null;
    const { container } = renderShell();
    expect(container).toBeEmptyDOMElement();
  });

  it('offers My account in the user menu', async () => {
    currentUser = userWithRoles([Role.GENERAL]);
    const user = userEvent.setup();
    renderShell();

    // `css: false` in vitest.config.ts means jsdom never applies the `hidden`/`sr-only`
    // breakpoint classes, so both the mobile and desktop name spans are "visible" to the
    // accessible-name algorithm here — a substring match is the width-independent way to find it.
    await user.click(screen.getByRole('button', { name: /Test Person/ }));

    const link = screen.getByRole('menuitem', { name: t.nav.account });
    expect(link).toHaveAttribute('href', ROUTES.account.profile);
  });

  /**
   * Reported by the PM: opening a requisition to approve it lit up "My requisitions" and left
   * Approvals dark. NavLink matches by prefix unless `end` is set, and `end` is set only for
   * the dashboard — so the old `/requisitions` route for the personal list prefix-matched every
   * `/requisitions/:id` detail page. Moving the list to `/my-requisitions` (matching
   * `/my-borrowings`) removes the collision instead of bolting `end` onto one link.
   *
   * No nav item is active on a detail page now, which is correct: a requisition detail is
   * reachable from three different lists and the shell cannot know which one you came from.
   */
  it('marks no nav item active on a requisition detail page', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.APPROVER]);
    renderShell('/requisitions/11111111-1111-1111-1111-111111111111');

    expect(screen.getByRole('link', { name: t.nav.myRequisitions })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: t.nav.approvals })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
