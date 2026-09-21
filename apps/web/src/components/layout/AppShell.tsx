import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowRightLeft,
  Box,
  Boxes,
  ChevronDown,
  ClipboardList,
  Files,
  Folder,
  History,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ListTree,
  LogOut,
  MapPin,
  Menu,
  Receipt,
  Repeat,
  Settings2,
  Stamp,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Role } from '@ims/shared';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/Button';
import { UserIdentity } from '@/components/UserIdentity';
import { ROUTES } from '@/routes/paths';
import { AwaitingApprovalBadge, PendingBorrowBadge } from './NavBadge';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  /** Undefined means every authenticated user sees it. */
  roles?: Role[];
  /** Rendered at the end of the row — the approver's pending count. */
  badge?: boolean;
  /** Rendered alongside the label — the IM/Admin's pending borrow count. */
  borrowBadge?: boolean;
}

interface NavGroup {
  label: string | null;
  roles?: Role[];
  items: NavItem[];
}

/**
 * Which nav item counts as "the page you are on" — the longest one that matches.
 *
 * `NavLink` marks itself active by prefix, so `/inventory` claimed `/inventory/categories` and
 * both lit up at once. Ranking the matches and taking the most specific fixes that without
 * putting `end` on the Inventory link, which would have gone too far the other way: a product
 * page is reachable from Inventory and nowhere else, so Inventory is the right answer there.
 *
 * A path that no item owns — a requisition detail, say — matches nothing and lights nothing.
 * That is deliberate; see the note on the detail-page test in AppShell.test.tsx.
 */
function activePathFor(pathname: string, candidates: string[]): string | null {
  const matched = candidates.filter((to) =>
    // The dashboard is `/`, a prefix of literally everything, so it only ever matches exactly.
    to === ROUTES.dashboard ? pathname === to : pathname === to || pathname.startsWith(to + '/'),
  );
  return matched.sort((a, b) => b.length - a.length)[0] ?? null;
}

const IM = [Role.INVENTORY_MANAGER, Role.ADMIN];
const SIGNS_OFF = [Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN];

/**
 * Grouped by whose work it is, not by which module built it: what is mine, what is the store's,
 * what is the money's.
 *
 * Roles sit on the **items**, not the groups. `Inventory` is the reason — browsing stock is
 * everyone's (it is step one of borrowing), so it cannot live behind an IM-only group even
 * though it reads as part of the store. A group with no visible items is dropped at render.
 *
 * The paired icons are deliberate: `My borrowings` / `Borrowing` and `My requisitions` /
 * `All requisitions` each use a related-but-different glyph, so the personal view and the
 * everyone view are told apart before the label is read.
 */
const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { label: t.nav.dashboard, to: ROUTES.dashboard, icon: LayoutDashboard },
      { label: t.nav.projects, to: ROUTES.projects.all, icon: Folder },
    ],
  },
  {
    label: t.nav.groupMyWork,
    items: [
      { label: t.nav.myRequisitions, to: ROUTES.requisitions.mine, icon: ClipboardList },
      { label: t.nav.myBorrowings, to: ROUTES.borrowing.mine, icon: ArrowRightLeft },
      {
        label: t.nav.approvals,
        to: ROUTES.requisitions.approvals,
        icon: Stamp,
        badge: true,
        roles: SIGNS_OFF,
      },
    ],
  },
  {
    label: t.nav.inventory,
    items: [
      // No roles: browsing stock is everyone's, and it is where a borrow starts.
      { label: t.nav.inventoryProducts, to: ROUTES.inventory.products, icon: Box },
      { label: t.nav.inventoryCategories, to: ROUTES.inventory.categories, icon: LayoutGrid, roles: IM },
      { label: t.nav.inventoryLocations, to: ROUTES.inventory.locations, icon: MapPin, roles: IM },
      { label: t.nav.boms, to: ROUTES.boms.all, icon: ListTree, roles: IM },
      {
        label: t.nav.borrowing,
        to: ROUTES.borrowing.all,
        icon: Repeat,
        borrowBadge: true,
        roles: IM,
      },
      { label: t.nav.allRequisitions, to: ROUTES.requisitions.all, icon: Files, roles: IM },
    ],
  },
  {
    label: t.nav.groupFinance,
    items: [
      // Approvers see it too: the shape of the spend they are sanctioning is their business.
      { label: t.nav.expenses, to: ROUTES.reports.expenses, icon: Receipt, roles: SIGNS_OFF },
    ],
  },
  {
    label: t.nav.admin,
    roles: [Role.ADMIN],
    items: [
      { label: t.nav.adminUsers, to: ROUTES.admin.users, icon: Users },
      { label: t.nav.adminDepartments, to: ROUTES.admin.departments, icon: Boxes },
      { label: t.nav.adminSettings, to: ROUTES.admin.settings, icon: Settings2 },
      { label: t.nav.adminAuditLog, to: ROUTES.admin.auditLog, icon: History },
      { label: t.nav.adminApiKeys, to: ROUTES.admin.apiKeys, icon: KeyRound },
    ],
  },
];

export function AppShell() {
  const { user, signOut, hasRole } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Navigation is filtered by role, so a user is never shown a door they cannot open
  // (plan 0.8: logging in as each role shows only that role's navigation).
  const groups = useMemo(
    () =>
      NAV.filter((group) => !group.roles || hasRole(...group.roles))
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.roles || hasRole(...item.roles)),
        }))
        // Roles live on the items now, so a group can empty out — a general user reaches none
        // of Finance. Without this it would render a heading with nothing under it.
        .filter((group) => group.items.length > 0),
    [hasRole],
  );

  const { pathname } = useLocation();
  const activePath = useMemo(
    () => activePathFor(pathname, groups.flatMap((group) => group.items.map((item) => item.to))),
    [pathname, groups],
  );

  if (!user) return null;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <button
            type="button"
            className="text-ink-muted hover:text-ink md:hidden"
            aria-label={t.nav.dashboard}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>

          <span className="flex items-center gap-2 font-semibold tracking-tight text-ink">
            <img
              src="/southern-iot-logo.png"
              alt={t.app.name}
              className="h-6 w-auto"
            />
            {t.app.shortName}
          </span>

          <div className="ml-auto">
            <NotificationBell />
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-[--radius-control] px-2 py-1.5 text-sm hover:bg-surface-muted"
            >
              <span className="sr-only sm:hidden">{user.fullName}</span>
              <span className="hidden text-ink sm:inline">{user.fullName}</span>
              <ChevronDown aria-hidden className="size-4 text-ink-subtle" />
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 mt-1 w-64 rounded-[--radius-panel] border border-border bg-surface p-3 shadow-[--shadow-overlay]"
              >
                <UserIdentity user={user} />
                {/* A forced password change pins the user to the change-password screen
                    (ProtectedRoute), so the link would only bounce them back — hide it. */}
                {!user.mustChangePassword && (
                  // Closes the menu on navigate, or it hangs over the page it just opened.
                  <NavLink
                    to={ROUTES.account.profile}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="mt-3 flex items-center gap-2 rounded-[--radius-control] px-2 py-1.5 text-sm text-ink hover:bg-surface-muted"
                  >
                    <UserRound aria-hidden className="size-4 text-ink-subtle" />
                    {t.nav.account}
                  </NavLink>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  icon={<LogOut aria-hidden className="size-4" />}
                  onClick={() => void signOut()}
                >
                  {t.auth.signOut}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <nav
          aria-label={t.app.shortName}
          className={cn(
            'w-56 shrink-0 flex-col gap-5',
            mobileNavOpen ? 'flex' : 'hidden md:flex',
          )}
        >
          {groups.map((group) => (
            <div key={group.label ?? 'root'} className="flex flex-col gap-1">
              {group.label ? (
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {group.label}
                </p>
              ) : null}
              {group.items.map((item) => {
                // Plain `Link`, because `NavLink` would compute its own prefix match alongside
                // this one and the two would disagree on exactly the pages this fixes.
                const isActive = item.to === activePath;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setMobileNavOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[--radius-control] px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-brand-subtle font-medium text-brand'
                        : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                    )}
                  >
                    <item.icon aria-hidden className="size-4" />
                    {item.label}
                    {item.badge ? <AwaitingApprovalBadge /> : null}
                    {item.borrowBadge ? <PendingBorrowBadge /> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
