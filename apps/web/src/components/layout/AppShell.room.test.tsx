import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { AppShell } from './AppShell';

/**
 * The 3D room view is for every role, but only on a PC: its link shows at 1024 px and wider, and
 * nowhere narrower, where `/room` could only say "use a PC". jsdom has no `matchMedia`, so each
 * test sets the viewport width it means and the mock answers `min-width` queries against it.
 *
 * AppShell.groups.test.tsx pins the sidebar order with no width at all, which is the narrow
 * sidebar; it is left as it is (the lead, 2026-10-09). The PC sidebar's order is pinned here.
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

function signedInAs(roles: Role[]) {
  currentUser = {
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

/** The PC the menu is checked on, and a screen just under the 1024 px line. */
const PC_WIDTH_PX = 1366;
const NARROW_WIDTH_PX = 1000;

/** A viewport `widthPx` wide: `(min-width: Npx)` matches when N ≤ the width. */
function atWidth(widthPx: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query);
    return {
      matches: minWidth !== null && Number(minWidth[1]) <= widthPx,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
}

function renderShell() {
  render(
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

const navOrder = () =>
  screen
    .getAllByRole('link')
    .map((link) => link.textContent?.trim() ?? '')
    .filter(Boolean);

describe('AppShell: the room view link', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['general', [Role.GENERAL]],
    ['approver', [Role.GENERAL, Role.APPROVER]],
    ['inventory manager', [Role.GENERAL, Role.INVENTORY_MANAGER]],
    ['administrator', [Role.ADMIN]],
  ])('shows it to a %s at 1366 px, right after Inventory', (_name, roles) => {
    signedInAs(roles);
    atWidth(PC_WIDTH_PX);
    renderShell();

    expect(screen.getByRole('link', { name: t.nav.room })).toHaveAttribute('href', ROUTES.room);
    const order = navOrder();
    expect(order[order.indexOf(t.nav.inventoryProducts) + 1]).toBe(t.nav.room);
  });

  it('gives the inventory manager the full sidebar in order on a PC, the room view included', () => {
    signedInAs([Role.GENERAL, Role.INVENTORY_MANAGER]);
    atWidth(PC_WIDTH_PX);
    renderShell();

    expect(navOrder()).toEqual([
      t.nav.dashboard,
      t.nav.projects,
      t.nav.myRequisitions,
      t.nav.myBorrowings,
      t.nav.approvals,
      t.nav.inventoryProducts,
      t.nav.room,
      t.nav.inventoryCategories,
      t.nav.inventoryLocations,
      t.nav.inventoryImports,
      t.nav.boms,
      t.nav.borrowing,
      t.nav.allRequisitions,
      t.nav.expenses,
    ]);
  });

  it('hides it below 1024 px', () => {
    signedInAs([Role.GENERAL, Role.INVENTORY_MANAGER]);
    atWidth(NARROW_WIDTH_PX);
    renderShell();

    expect(screen.queryByRole('link', { name: t.nav.room })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.nav.inventoryProducts })).toBeInTheDocument();
  });
});
