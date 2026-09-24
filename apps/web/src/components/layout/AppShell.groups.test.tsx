import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { AppShell } from './AppShell';

/**
 * The sidebar groups by whose work it is, and the role checks sit on the items rather than the
 * groups.
 *
 * That is the risky half. `Inventory` reads as part of the store but is everyone's — it is
 * step one of borrowing — so an IM-only Inventory group would quietly cut every general user
 * off from the catalogue. The Finance case is the mirror: a general user reaches nothing in it,
 * so the group must disappear rather than render an empty heading.
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

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The nav in reading order, so a reordering is visible in the diff rather than inferred. */
function navOrder(): string[] {
  return screen
    .getAllByRole('link')
    .map((link) => link.textContent?.trim() ?? '')
    .filter(Boolean);
}

describe('AppShell groups', () => {
  it('still lets a general user reach the inventory', () => {
    currentUser = userWithRoles([Role.GENERAL]);
    renderShell();

    expect(screen.getByRole('link', { name: t.nav.inventoryProducts })).toHaveAttribute(
      'href',
      ROUTES.inventory.products,
    );
    // ...but none of the manager's half of that same group.
    expect(screen.queryByRole('link', { name: t.nav.inventoryCategories })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t.nav.allRequisitions })).not.toBeInTheDocument();
  });

  it('drops a group heading when the user reaches nothing under it', () => {
    currentUser = userWithRoles([Role.GENERAL]);
    renderShell();

    expect(screen.queryByText(t.nav.groupFinance)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t.nav.expenses })).not.toBeInTheDocument();
    // My work survives: two of its three items are everyone's.
    expect(screen.getByText(t.nav.groupMyWork)).toBeInTheDocument();
  });

  it('gives the inventory manager the full sidebar in order', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.INVENTORY_MANAGER]);
    renderShell();

    expect(navOrder()).toEqual([
      t.nav.dashboard,
      t.nav.projects,
      t.nav.myRequisitions,
      t.nav.myBorrowings,
      t.nav.approvals,
      t.nav.inventoryProducts,
      t.nav.inventoryCategories,
      t.nav.inventoryLocations,
      t.nav.inventoryImports,
      t.nav.boms,
      t.nav.borrowing,
      t.nav.allRequisitions,
      t.nav.expenses,
    ]);
  });

  it('names the three group headings', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.INVENTORY_MANAGER]);
    renderShell();

    // Scoped to the heading element: "Inventory" is deliberately both the group name and the
    // label of the catalogue link inside it, so an unscoped query matches twice.
    const heading = { selector: 'p' };
    expect(screen.getByText(t.nav.groupMyWork, heading)).toBeInTheDocument();
    expect(screen.getByText(t.nav.inventory, heading)).toBeInTheDocument();
    expect(screen.getByText(t.nav.groupFinance, heading)).toBeInTheDocument();
  });
});
