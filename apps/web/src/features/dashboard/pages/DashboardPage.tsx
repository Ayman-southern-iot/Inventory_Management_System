import { Badge, PageHeader, Panel } from '@/components/ui/primitives';
import { t } from '@/i18n/en';
import { useAuth } from '@/features/auth/auth-context';

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <>
      <PageHeader title={t.dashboard.title} />

      <Panel className="p-5">
        <p className="text-sm text-ink-muted">{t.dashboard.welcome}</p>
        <p className="mt-0.5 text-lg font-semibold text-ink">{user.fullName}</p>

        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
              {t.dashboard.designation}
            </dt>
            <dd className="mt-0.5 text-sm text-ink">{user.designation}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
              {t.dashboard.department}
            </dt>
            <dd className="mt-0.5 text-sm text-ink">{user.departmentName ?? t.common.none}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
              {t.dashboard.yourRoles}
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <Badge key={role} tone="info">
                  {t.roles[role]}
                </Badge>
              ))}
            </dd>
          </div>
        </dl>
      </Panel>

      <p className="mt-4 text-sm text-ink-subtle">{t.dashboard.phaseNotice}</p>
    </>
  );
}
