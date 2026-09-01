import { Badge, PageHeader, Panel } from '@/components/ui/primitives';
import { QueryBoundary } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { formatBdt } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-context';
import { usePersonalRecord } from '../api';
import { AmountRow, Figure, Group, RecordBlock } from '../components/RecordBlock';

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
            // Three across on a wide screen, as the design has them, stacking on a narrow one.
            // `items-start` so a short card does not stretch to match the tallest one.
            <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
              {/* Two questions, not six loose numbers: what is still moving, and what has
                  finished. The subtotal each group answers is what makes them scannable. */}
              <RecordBlock
                title={t.dashboard.requisitionsHeading}
                hint={t.dashboard.requisitionsHint.replace(
                  '{n}',
                  String(data.requisitions.raised),
                )}
                grouped
                isEmpty={data.requisitions.raised === 0 && data.requisitions.drafts === 0}
              >
                <Group title={t.dashboard.groupInMotion}>
                  <Figure label={t.dashboard.raised} value={data.requisitions.raised} />
                  <Figure label={t.dashboard.inFlight} value={data.requisitions.inFlight} />
                  <Figure label={t.dashboard.draftsCount} value={data.requisitions.drafts} />
                </Group>
                <Group title={t.dashboard.groupSettled}>
                  <Figure label={t.dashboard.approvedCount} value={data.requisitions.approved} />
                  <Figure
                    label={t.dashboard.rejectedCount}
                    value={data.requisitions.rejected}
                    tone="danger"
                  />
                  <Figure label={t.dashboard.cancelledCount} value={data.requisitions.cancelled} />
                </Group>
              </RecordBlock>

              <RecordBlock
                title={t.dashboard.borrowingHeading}
                hint={t.dashboard.borrowingHint.replace(
                  '{n}',
                  String(data.borrowing.borrowed),
                )}
                grouped
                isEmpty={data.borrowing.borrowed === 0}
              >
                <Group title={t.dashboard.groupWhereTheyAre}>
                  <Figure label={t.dashboard.borrowedCount} value={data.borrowing.borrowed} />
                  <Figure
                    label={t.dashboard.stillOut}
                    value={data.borrowing.stillOut}
                    tone="warning"
                  />
                  <Figure label={t.dashboard.returnedCount} value={data.borrowing.returned} />
                </Group>
                {/* Units, not requests: three of five cables back damaged is three. */}
                <Group title={t.dashboard.groupHowTheyCameBack}>
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
                </Group>
              </RecordBlock>

              {/*
                Four figures, each saying what it is in full.

                It used to show a derived "Actually spent" with its two halves underneath, which
                meant the card carried a total and its own components and left the reader working
                out which was which. Purchasing and transportation add up to what left the
                company; anybody who wants that sum can do it, and nobody has to decode a label
                to get there.
              */}
              <RecordBlock
                title={t.dashboard.spendHeading}
                hint={t.dashboard.spendHint}
                asList
                isEmpty={data.requisitions.raised === 0}
              >
                <AmountRow
                  label={t.dashboard.spendRequested}
                  value={formatBdt(data.spend.requested)}
                />
                <AmountRow
                  label={t.dashboard.spendApproved}
                  value={formatBdt(data.spend.approved)}
                />
                <AmountRow
                  label={t.dashboard.spendPurchased}
                  value={formatBdt(data.spend.purchased)}
                />
                <AmountRow
                  label={t.dashboard.spendTransportation}
                  value={formatBdt(data.spend.transportation)}
                />
              </RecordBlock>
            </div>
          )}
        </QueryBoundary>
      </section>
    </>
  );
}
