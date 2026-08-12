import { useMemo, useState } from 'react';
import {
  RequisitionStatus,
  Role,
  type RequisitionDetail,
  type RequisitionFundingSnapshot,
} from '@ims/shared';
import { Badge, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/states';
import { useAuth } from '@/features/auth/auth-context';
import { t } from '@/i18n/en';
import { formatBdt, formatDateTime } from '@/lib/format';
import { useFunding } from '../api';
import { useBomForRequisition } from '@/features/boms/api';
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
   * Live BOM for this requisition, when one exists. The record-purchase dialog needs the
   * IM's quantity override per line (so the label and wire payload reflect what the IM
   * actually planned, not the original requisition quantity). When no live BOM exists,
   * `bomQuantities` is an empty map and the dialog falls back to wire quantity.
   */
  const bom = useBomForRequisition(requisition.id);
  const bomQuantities = useMemo(() => {
    if (!bom.data) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const line of bom.data.lines) map.set(line.requisitionItemId, line.quantity);
    return map;
  }, [bom.data]);

  if (!reached) return null;

  const next = canAct ? nextAction(requisition.status as RequisitionStatus) : null;
  const previous = canAct ? previousAction(requisition.status as RequisitionStatus) : null;

  /**
   * The figure set rendered below. When the requisition's current status has a snapshot row,
   * the figures come from the snapshot (captured at the moment of transition). Otherwise we
   * fall back to the live `funding` data — identical to the pre-pills behaviour. The snapshot
   * lookup is per-status, single most-recent, matching the table's `DISTINCT ON (status)` view.
   */
  const activeSnapshot = latestSnapshotForStatus(
    requisition.fundingSnapshots,
    requisition.status as RequisitionStatus,
  );

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
              {t.funds.back}
            </Button>
          ) : null}
        </div>
      </div>

      <QueryBoundary
        isLoading={funding.isPending}
        error={funding.error}
        data={funding.data}
        onRetry={() => void funding.refetch()}
      >
        {(data) => (
          <div className="flex flex-col gap-5" id="funding-figures">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {/* When a snapshot row exists for the current status, every figure comes from
                  the snapshot. Otherwise we read the live `funding` numbers — pre-pills behaviour. */}
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
        bomQuantities={bomQuantities}
        onClose={() => setAction(null)}
      />
    </Panel>
  );
}

/* ------------------------------------------------------------- the flow */

/**
 * The most recent snapshot for a given status — matches the table's `DISTINCT ON (status)`
 * view (one row per status, the latest). Returns `null` if no snapshot exists for this status;
 * the caller falls back to the live `funding` data.
 */
function latestSnapshotForStatus(
  snapshots: RequisitionFundingSnapshot[],
  status: RequisitionStatus,
): RequisitionFundingSnapshot | null {
  const matches = snapshots.filter((row) => row.status === status);
  if (matches.length === 0) return null;
  // The most recent first — `snapshottedAt` is the wall-clock when the row was written.
  return matches.reduce((latest, current) =>
    current.snapshottedAt > latest.snapshottedAt ? current : latest,
  );
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
