import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { AppShell } from './AppShell';

/**
 * Exactly one nav item is highlighted, and it is the most specific one.
 *
 * Reported from the screen: opening Categories lit both "Inventory" and "Categories", and
 * Locations did the same. `NavLink` matches by prefix, and `/inventory/categories` starts with
 * `/inventory` — so the section root claimed every page beneath it.
 *
 * The fix is longest-match-wins rather than `end` on the Inventory link: `end` would also stop
 * a product page from lighting anything, and a product detail is reachable from Inventory and
 * nowhere else, so Inventory is the honest answer there. A requisition detail still lights
 * nothing, because no nav item owns it — see AppShell.test.tsx.
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

function imUser(): AuthUser {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'im@ims.local',
    fullName: 'Imran Manager',
    designation: 'Inventory Manager',
    departmentId: null,
    departmentName: null,
    roles: [Role.GENERAL, Role.INVENTORY_MANAGER],
    mustChangePassword: false,
  };
}

function renderAt(path: string) {
  currentUser = imUser();
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path={ROUTES.dashboard} element={<p>home</p>} />
            <Route path={ROUTES.inventory.products} element={<p>inventory</p>} />
            <Route path={ROUTES.inventory.categories} element={<p>categories</p>} />
            <Route path={ROUTES.inventory.locations} element={<p>locations</p>} />
            <Route path={ROUTES.inventory.productPattern} element={<p>product</p>} />
            <Route path={ROUTES.boms.all} element={<p>boms</p>} />
            <Route path={ROUTES.boms.detailPattern} element={<p>bom</p>} />
            <Route path={ROUTES.projects.detailPattern} element={<p>project</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Every nav item currently marked as the page you are on. */
function highlighted(): string[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent?.trim() ?? '');
}

describe('AppShell — which nav item is highlighted', () => {
  it('highlights Categories alone, not the Inventory section above it', () => {
    renderAt(ROUTES.inventory.categories);
    expect(highlighted()).toEqual([t.nav.inventoryCategories]);
  });

  it('highlights Locations alone', () => {
    renderAt(ROUTES.inventory.locations);
    expect(highlighted()).toEqual([t.nav.inventoryLocations]);
  });

  it('highlights Inventory on the stock list itself', () => {
    renderAt(ROUTES.inventory.products);
    expect(highlighted()).toEqual([t.nav.inventoryProducts]);
  });

  it('keeps Inventory highlighted on a product page, which belongs to it', () => {
    renderAt(ROUTES.inventory.product('11111111-1111-4111-8111-111111111111'));
    expect(highlighted()).toEqual([t.nav.inventoryProducts]);
  });

  it('keeps Bills of Materials highlighted on one BOM', () => {
    renderAt(ROUTES.boms.detail('22222222-2222-4222-8222-222222222222'));
    expect(highlighted()).toEqual([t.nav.boms]);
  });

  it('keeps Projects highlighted on one project', () => {
    renderAt(ROUTES.projects.detail('33333333-3333-4333-8333-333333333333'));
    expect(highlighted()).toEqual([t.nav.projects]);
  });

  it('highlights the dashboard only at the root', () => {
    renderAt(ROUTES.dashboard);
    expect(highlighted()).toEqual([t.nav.dashboard]);
  });

  it('never highlights more than one item', () => {
    for (const path of [
      ROUTES.dashboard,
      ROUTES.inventory.products,
      ROUTES.inventory.categories,
      ROUTES.inventory.locations,
      ROUTES.boms.all,
    ]) {
      const { unmount } = renderAt(path);
      expect(highlighted().length).toBe(1);
      unmount();
    }
  });
});
