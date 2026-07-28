import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Boxes,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { Role } from '@ims/shared';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { ROUTES } from '@/routes/paths';

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  /** Undefined means every authenticated user sees it. */
  roles?: Role[];
}

interface NavGroup {
  label: string | null;
  roles?: Role[];
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ label: t.nav.dashboard, to: ROUTES.dashboard, icon: LayoutDashboard }],
  },
  {
    label: t.nav.admin,
    roles: [Role.ADMIN],
    items: [
      { label: t.nav.adminUsers, to: ROUTES.admin.users, icon: Users },
      { label: t.nav.adminDepartments, to: ROUTES.admin.departments, icon: Boxes },
      { label: t.nav.adminSettings, to: ROUTES.admin.settings, icon: Settings2 },
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
      NAV.filter((group) => !group.roles || hasRole(...group.roles)).map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.roles || hasRole(...item.roles)),
      })),
    [hasRole],
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
            <ShieldCheck aria-hidden className="size-5 text-brand" />
            {t.app.shortName}
          </span>

          <div className="ml-auto relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-[--radius-control] px-2 py-1.5 text-sm hover:bg-surface-muted"
            >
              <span className="hidden text-ink sm:inline">{user.fullName}</span>
              <ChevronDown aria-hidden className="size-4 text-ink-subtle" />
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 mt-1 w-64 rounded-[--radius-panel] border border-border bg-surface p-3 shadow-[--shadow-overlay]"
              >
                <p className="text-sm font-medium text-ink">{user.fullName}</p>
                <p className="text-xs text-ink-muted">{user.email}</p>
                <p className="mt-1 text-xs text-ink-subtle">{user.designation}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <Badge key={role} tone="info">
                      {t.roles[role]}
                    </Badge>
                  ))}
                </div>
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
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === ROUTES.dashboard}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-[--radius-control] px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-brand-subtle font-medium text-brand'
                        : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                    )
                  }
                >
                  <item.icon aria-hidden className="size-4" />
                  {item.label}
                </NavLink>
              ))}
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
