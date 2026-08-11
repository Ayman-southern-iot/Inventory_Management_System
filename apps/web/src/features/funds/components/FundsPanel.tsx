import { useState } from 'react';
import {
  RequisitionStatus,
  Role,
  type RequisitionDetail,
  type RequisitionFundingSnapshot,
} from '@ims/shared';
import { Badge, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/auth-context';
import { t } from '@/i18n/en';
import { formatBdt, formatDateTime } from '@/lib/format';
import { SNAPSHOT_STAGES } from '@/features/requisitions/components/LifecycleTracker';
import { useFunding } from '../api';
import { FundsActionDialog, type FundsAction } from './FundsActionDialog';
import { InvoiceRow } from './InvoiceRow';

/**
 * The Inventory Manager's view of a requisition's money, and the one action that is available
 * next.
 *
 * Deliberately **one** action button rather than every endpoint laid out at once. The lifecycle is
 * strictly ordered and the server refuses anything out of turn, so showing six buttons of which
 * five return 409 would be teaching the user to expect errors. The status decides what is offered.
 */
export function FundsPanel({ requisition }: { requisition: RequisitionDetail }) {
  const { hasRole } = useAuth();
  const canAct = hasRole(Role.INVENTORY_MANAGER, Role.ADMIN);
  const [action, setAction] = useState<FundsAction | null>(null);

  // The panel is meaningless before a BOM exists — there is no money story yet.
  const reached = REACHED_MONEY_STAGE.includes(requisition.status as RequisitionStatus);
  const funding = useFunding(requisition.id, reached);

  /**
   * Which snapshot pill is currently selected. The default mirrors today's behaviour:
   * the figure row reads from the live `funding` endpoint, which by definition is the
   * *current* state of the requisition's money tables. If the current requisition
   * status is one of the snapshot stages, we pre-select that pill so on first paint
   * the user sees exactly the same numbers they would have seen before this change.
   *
   * Reassigning `setSelectedStageKey(null)` would reset to the live funding view; the
   * pill that maps to the current requisition status gets re-selected automatically.
   */
  const currentStageKey = currentSnapshotStageKey(requisition.status as RequisitionStatus);
  const [selectedStageKey, setSelectedStageKey] = useState<
    (typeof SNAPSHOT_STAGES)[number]['key'] | null
  >(currentStageKey);

  if (!reached) return null;

  const next = canAct ? nextAction(requisition.status as RequisitionStatus) : null;
  const previous = canAct ? previousAction(requisition.status as RequisitionStatus) : null;

  /**
   * The figure set rendered below. When a pill is selected and that pill has a
   * snapshot row, the figures come from the snapshot (captured at the moment of
   * transition). Otherwise we fall back to the live `funding` data, which matches
   * the pre-pills behaviour exactly. Disabled pills (no row yet) cannot be clicked,
   * so this fallback only triggers on page load for old requisitions predating the
   * migration.
   */
  const activeSnapshot =
    selectedStageKey === null
      ? null
      : requisition.fundingSnapshots.find((row) =>
          (SNAPSHOT_STAGES.find((stage) => stage.key === selectedStageKey)?.statuses ?? []).includes(
            row.status,
          ),
        ) ?? null;

  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{t.funds.title}</h2>
          <p className="text-sm text-ink-muted">{t.funds.subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {next ? (
            <Button onClick={() => setAction(next)}>{ACTION_LABEL[next]}</Button>
          ) : (
            <Badge tone="success">{t.funds.done}</Badge>
          )}
          {previous ? (
            <Button variant="ghost" onClick={() => setAction(previous)}>
              {ACTION_LABEL[previous]}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Stage selector — one pill per forward-progress stage. A pill is enabled iff
          `fundingSnapshots` carries a row for that stage's status(es); the pill's
          label matches the Lifecycle stepper's stage names for visual continuity.
          REJECTED / CANCELLED / rewind-only statuses are not in SNAPSHOT_STAGES so
          they never appear here. */}
      <div
        className="mb-2 flex flex-wrap gap-2"
        role="tablist"
        aria-label={t.funds.snapshotStageLabel}
      >
        {SNAPSHOT_STAGES.map((stage) => {
          const enabled = hasSnapshot(requisition.fundingSnapshots, stage);
          const isSelected = selectedStageKey === stage.key;
          const pillLabel = t.requisitions.lifecycleStages[stage.key];
          // Tooltip on disabled pills explains *why* — the user shouldn't have to guess
          // whether "no data" means "future" or "pre-migration".
          const pillTitle = enabled
            ? pillLabel
            : t.funds.snapshotStageDisabledHint.replace(SNAPSHOT_STAGE_PLACEHOLDER, pillLabel);
          return (
            <button
              key={stage.key}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls="funding-figures"
              disabled={!enabled}
              onClick={() => {
                if (!enabled) return;
                setSelectedStageKey(stage.key);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                !enabled && 'cursor-not-allowed border-border bg-surface-muted text-ink-subtle opacity-60',
                enabled &&
                  !isSelected &&
                  'border-border bg-surface text-ink-muted hover:border-ink-muted hover:text-ink',
                enabled &&
                  isSelected &&
                  'border-info bg-info-subtle text-info',
              )}
              title={pillTitle}
            >
              {pillLabel}
            </button>
          );
        })}
      </div>

      {/* Contextual line below the pills — explains which figures the user is looking at.
          Live view (no pill, or default mount with current pill) doesn't show this — the
          numbers ARE today's numbers, so the caption would be noise. */}
      {selectedStageKey !== null && activeSnapshot ? (
        <p className="mb-4 text-xs text-ink-subtle">
          {t.funds.snapshotStageSuffix.replace(
            SNAPSHOT_STAGE_PLACEHOLDER,
            t.requisitions.lifecycleStages[selectedStageKey],
          )}
        </p>
      ) : (
        <div className="mb-4" aria-hidden />
      )}

      <QueryBoundary
        isLoading={funding.isPending}
        error={funding.error}
        data={funding.data}
        onRetry={() => void funding.refetch()}
      >
        {(data) => (
          <div className="flex flex-col gap-5" id="funding-figures" role="tabpanel">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {/* When a pill is selected and the snapshot row exists, every figure comes
                  from the snapshot. When the snapshot is missing (no pill selected, or
                  the pill is disabled), we read the live `funding` numbers — identical
                  to today's behaviour. */}
              <Figure
                label={t.funds.approved}
                value={activeSnapshot ? activeSnapshot.approvedAmount : data.approvedAmount}
              />
              <Figure
                label={t.funds.funded}
                value={activeSnapshot ? activeSnapshot.funded : data.funded}
              />
              <Figure
                label={t.funds.spent}
                value={activeSnapshot ? activeSnapshot.spent : data.spent}
              />
              <Figure
                label={t.funds.transportation}
                value={activeSnapshot ? activeSnapshot.transportation : data.transportation}
              />
              <Figure
                label={t.funds.returned}
                value={activeSnapshot ? activeSnapshot.returnedToAccounts : data.returned}
              />
              {/* The one figure that answers "can I still hand money back?". */}
              <Figure
                label={t.funds.unspent}
                value={activeSnapshot ? activeSnapshot.unspent : data.unspent}
                emphasis
              />
            </dl>

            {/* When viewing a historical snapshot, the rows below (receipts / purchases /
                returns) still show the *current* lists — those aren't tied to a stage, and
                omitting them would confuse anyone cross-referencing a receipt timestamp
                against the figures above. The pill only filters the aggregate numbers. */}

            {data.receipts.length > 0 && (
              <Section title={t.funds.receipts}>
                {data.receipts.map((receipt) => (
                  <li key={receipt.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span className="text-ink">
                      {formatBdt(receipt.amount)}
                      {receipt.reference ? ` · ${receipt.reference}` : ''}
                    </span>
                    <span className="text-xs text-ink-subtle">
                      {formatDateTime(receipt.receivedAt)}
                    </span>
                  </li>
                ))}
              </Section>
            )}

            <Section title={t.funds.purchases}>
              {data.purchases.length === 0 ? (
                <li className="py-1.5 text-ink-subtle">{t.funds.noPurchases}</li>
              ) : (
                data.purchases.map((purchase) => (
                  <InvoiceRow
                    key={purchase.id}
                    requisitionId={requisition.id}
                    purchase={purchase}
                    canAct={canAct}
                  />
                ))
              )}
            </Section>

            {data.returns.length > 0 && (
              <Section title={t.funds.returns}>
                {data.returns.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span className="text-ink">
                      {formatBdt(entry.amount)} · {entry.note}
                    </span>
                    <span className="text-xs text-ink-subtle">
                      {formatDateTime(entry.returnedAt)}
                    </span>
                  </li>
                ))}
              </Section>
            )}
          </div>
        )}
      </QueryBoundary>

      <FundsActionDialog
        action={action}
        requisition={requisition}
        funding={funding.data ?? null}
        onClose={() => setAction(null)}
      />
    </Panel>
  );
}

/* ------------------------------------------------------------- the flow */

/** Placeholder token in the disabled-pill tooltip i18n string. Hoisted to a constant
 *  because `{` inside JSX text confuses the parser; substitute via `.replace()`. */
const SNAPSHOT_STAGE_PLACEHOLDER = '{stage}';

/**
 * The lifecycle stage key whose pill should be pre-selected when the panel mounts.
 * Maps the requisition's current status to one of `SNAPSHOT_STAGES`. Returns null if
 * the requisition's status is past the panel's horizon (pre-BOM) — caller falls back
 * to the live funding view.
 */
function currentSnapshotStageKey(
  status: RequisitionStatus,
): (typeof SNAPSHOT_STAGES)[number]['key'] | null {
  const match = SNAPSHOT_STAGES.find((stage) => stage.statuses.includes(status));
  return match?.key ?? null;
}

/**
 * True iff `fundingSnapshots` carries at least one row whose `status` belongs to this
 * lifecycle stage. The pill is enabled when this returns true; otherwise it is grayed
 * out and cannot be clicked. Rewind-only statuses never appear in `SNAPSHOT_STAGES`
 * (and so never appear here), so they never become pills.
 */
function hasSnapshot(
  snapshots: RequisitionFundingSnapshot[],
  stage: (typeof SNAPSHOT_STAGES)[number],
): boolean {
  return snapshots.some((row) => stage.statuses.includes(row.status));
}

/** Statuses at or past BOM generation — before that there is no money story to tell. */
const REACHED_MONEY_STAGE: RequisitionStatus[] = [
  RequisitionStatus.BOM_GENERATED,
  RequisitionStatus.SENT_TO_ACCOUNTS,
  RequisitionStatus.FUNDS_PARTIAL,
  RequisitionStatus.FUNDS_RECEIVED,
  RequisitionStatus.PURCHASED,
  RequisitionStatus.PURCHASE_VERIFIED,
  RequisitionStatus.STOCKED,
  RequisitionStatus.CLOSED,
];

const ACTION_LABEL: Record<FundsAction, string> = {
  'send-to-accounts': t.funds.sendToAccounts,
  receipt: t.funds.recordReceipt,
  purchase: t.funds.recordPurchase,
  verify: t.funds.verifyPurchase,
  unverify: t.funds.unverifyPurchase,
  stock: t.funds.receiveToStock,
};

/**
 * What the IM can do from here. One step, matching the server's state machine exactly — if these
 * two ever disagree the user gets a button that 409s, which is worse than no button.
 */
function nextAction(status: RequisitionStatus): FundsAction | null {
  switch (status) {
    case RequisitionStatus.BOM_GENERATED:
      return 'send-to-accounts';
    case RequisitionStatus.SENT_TO_ACCOUNTS:
    case RequisitionStatus.FUNDS_PARTIAL:
      return 'receipt';
    case RequisitionStatus.FUNDS_RECEIVED:
      return 'purchase';
    case RequisitionStatus.PURCHASED:
      return 'verify';
    case RequisitionStatus.PURCHASE_VERIFIED:
      return 'stock';
    default:
      return null;
  }
}

/**
 * The "Back" button. Only one step back — at PURCHASE_VERIFIED we let the IM return to PURCHASED
 * so they can re-record. The server refuses if any money has been returned to Accounts, so this
 * never silently rewinds a refund.
 */
function previousAction(status: RequisitionStatus): FundsAction | null {
  if (status === RequisitionStatus.PURCHASE_VERIFIED) return 'unverify';
  return null;
}

/* ------------------------------------------------------------ fragments */

function Figure({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number | null;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd
        className={
          emphasis
            ? 'text-base font-semibold tabular-nums text-ink'
            : 'text-base tabular-nums text-ink'
        }
      >
        {value === null ? t.common.none : formatBdt(value)}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </h3>
      <ul className="divide-y divide-border text-sm">{children}</ul>
    </div>
  );
}
