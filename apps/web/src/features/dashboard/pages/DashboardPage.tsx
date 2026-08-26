import { Badge, PageHeader, Panel } from '@/components/ui/primitives';
import { QueryBoundary } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { formatBdt } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-context';
import { usePersonalRecord } from '../api';
import { Figure, RecordBlock } from '../components/RecordBlock';

/**
 * The signed-in person's own record.
 *
 * Ayman, 2026-08-26: "in dashboard there should be each person's all records". Own figures only
 * — there is no user parameter on the endpoint and no way to ask about anybody else, so nothing
 * on this screen goes near the permission model.
 *
 * Three blocks, in the order somebody actually asks the questions: what have I asked for, what am
 * I holding, and what has it cost.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const record = usePersonalRecord();

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

      <section className="mt-4">
        <h2 className="text-lg font-semibold text-ink">{t.dashboard.yourRecord}</h2>
        <p className="mt-0.5 text-sm text-ink-muted">{t.dashboard.yourRecordHint}</p>

        <QueryBoundary
          isLoading={record.isPending}
          error={record.error}
          data={record.data}
          onRetry={() => void record.refetch()}
        >
          {(data) => (
            <div className="mt-4 flex flex-col gap-4">
              <RecordBlock
                title={t.dashboard.requisitionsHeading}
                isEmpty={data.requisitions.raised === 0 && data.requisitions.drafts === 0}
              >
                <Figure label={t.dashboard.raised} value={data.requisitions.raised} />
                <Figure label={t.dashboard.approvedCount} value={data.requisitions.approved} />
                <Figure
                  label={t.dashboard.rejectedCount}
                  value={data.requisitions.rejected}
                  tone="danger"
                />
                <Figure label={t.dashboard.inFlight} value={data.requisitions.inFlight} />
                <Figure label={t.dashboard.draftsCount} value={data.requisitions.drafts} />
                <Figure label={t.dashboard.cancelledCount} value={data.requisitions.cancelled} />
              </RecordBlock>

              <RecordBlock
                title={t.dashboard.borrowingHeading}
                isEmpty={data.borrowing.borrowed === 0}
              >
                <Figure label={t.dashboard.borrowedCount} value={data.borrowing.borrowed} />
                <Figure label={t.dashboard.returnedCount} value={data.borrowing.returned} />
                <Figure
                  label={t.dashboard.stillOut}
                  value={data.borrowing.stillOut}
                  tone="warning"
                />
                {/* Units rather than requests — see the contract. The suffix says so on the tile,
                    because "3" next to "Returned damaged" would otherwise read as three borrowings. */}
                <Figure
                  label={t.dashboard.partiallyDamagedUnits}
                  value={data.borrowing.partiallyDamagedUnits}
                  suffix={t.dashboard.unitsSuffix}
                  tone="warning"
                />
                <Figure
                  label={t.dashboard.damagedUnits}
                  value={data.borrowing.damagedUnits}
                  suffix={t.dashboard.unitsSuffix}
                  tone="danger"
                />
                <Figure
                  label={t.dashboard.notWorkingUnits}
                  value={data.borrowing.notWorkingUnits}
                  suffix={t.dashboard.unitsSuffix}
                  tone="danger"
                />
              </RecordBlock>

              {/* Requested and approved sit beside spent so the figure has a scale: 40,000 spent
                  means something different against 45,000 approved than against 400,000. */}
              <RecordBlock
                title={t.dashboard.spendHeading}
                hint={t.dashboard.spendHint}
                isEmpty={data.requisitions.raised === 0}
              >
                <Figure label={t.dashboard.spendRequested} value={formatBdt(data.spend.requested)} />
                <Figure label={t.dashboard.spendApproved} value={formatBdt(data.spend.approved)} />
                <Figure label={t.dashboard.spendSpent} value={formatBdt(data.spend.spent)} />
              </RecordBlock>
            </div>
          )}
        </QueryBoundary>
      </section>
    </>
  );
}
