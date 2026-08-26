import { Ban, Check, Circle, CircleDot, X } from 'lucide-react';
import {
  RequisitionEventType,
  RequisitionStatus,
  type RequisitionDetail,
} from '@ims/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';

type StageState = 'done' | 'current' | 'future' | 'rejected' | 'cancelled';

/**
 * The nine lifecycle stages the tracker renders. Order matters — the tracker is a
 * horizontal stepper that walks left to right.
 *
 * `timestampEvents` supplies the "done at" tooltip only. It decides nothing about which chip is
 * lit; see `currentStageIndex` for why.
 */
interface Stage {
  key: keyof typeof t.requisitions.lifecycleStages;
  /** Events whose latest occurrence dates this stage. Presentation only. */
  timestampEvents: RequisitionEventType[];
}

const STAGES: readonly Stage[] = [
  {
    key: 'submitted',
    timestampEvents: [RequisitionEventType.SUBMITTED, RequisitionEventType.CREATED],
  },
  {
    key: 'imReview',
    timestampEvents: [RequisitionEventType.IM_APPROVED, RequisitionEventType.FULLY_APPROVED],
  },
  { key: 'approved', timestampEvents: [RequisitionEventType.FULLY_APPROVED] },
  {
    key: 'bom',
    timestampEvents: [RequisitionEventType.BOM_GENERATED, RequisitionEventType.BOM_RENDERED],
  },
  { key: 'accounts', timestampEvents: [RequisitionEventType.SENT_TO_ACCOUNTS] },
  { key: 'funded', timestampEvents: [RequisitionEventType.FUNDS_RECEIVED] },
  { key: 'purchased', timestampEvents: [RequisitionEventType.PURCHASED] },
  { key: 'verified', timestampEvents: [RequisitionEventType.PURCHASE_VERIFIED] },
  {
    key: 'inStock',
    timestampEvents: [
      RequisitionEventType.STOCKED,
      RequisitionEventType.BORROWED_OUT,
      RequisitionEventType.CLOSED,
    ],
  },
] as const;

/** Past the last stage: everything is done and nothing is in progress. */
const ALL_DONE = STAGES.length;

/**
 * Which stage is *in progress* for a given status. Everything before it is done, everything
 * after it is still to come.
 *
 * Derived from the status alone, deliberately. The tracker used to ask "has this stage's event
 * fired?" and check the status first, which got two things wrong:
 *
 *  - **A finished stage stayed amber.** `approved` claimed `APPROVED` as one of its "current"
 *    statuses and that check ran before the event check, so a fully approved requisition showed
 *    Approved as pending until a BOM was generated. Same at `FUNDS_RECEIVED`, `PURCHASED` and
 *    `PURCHASE_VERIFIED` — the stage that had just completed was lit instead of the next one
 *    waiting on someone. Ayman, 2026-08-26: "if IM approves then it should be pending in next
 *    stage not current stage."
 *  - **It could not go backwards.** `requisition_events` is append-only, so a stage marked done
 *    by its event stayed done after a BOM was voided or a purchase reversed. Phase 08 makes most
 *    of this chain reversible, which turns that from a cosmetic wrinkle into the tracker
 *    contradicting the status badge next to it.
 *
 * The status is the one thing that always describes the present, so it is the only input.
 */
function currentStageIndex(status: RequisitionStatus): number {
  switch (status) {
    case RequisitionStatus.DRAFT:
      return 0;
    case RequisitionStatus.IM_REVIEW:
      return 1;
    case RequisitionStatus.AWAITING_APPROVAL:
      return 2;
    case RequisitionStatus.APPROVED:
      return 3;
    case RequisitionStatus.BOM_GENERATED:
      return 4;
    // Sent, and now waiting on Accounts to release the money. A partial receipt has not
    // finished the funding stage, so both statuses sit on it.
    case RequisitionStatus.SENT_TO_ACCOUNTS:
    case RequisitionStatus.FUNDS_PARTIAL:
      return 5;
    case RequisitionStatus.FUNDS_RECEIVED:
      return 6;
    case RequisitionStatus.PURCHASED:
      return 7;
    case RequisitionStatus.PURCHASE_VERIFIED:
      return 8;
    case RequisitionStatus.STOCKED:
    case RequisitionStatus.CLOSED:
      return ALL_DONE;
    // Terminal — `stateOfStage` short-circuits before it asks, so the value is never read.
    case RequisitionStatus.REJECTED:
    case RequisitionStatus.CANCELLED:
      return ALL_DONE;
  }
}

function eventsForStage(requisition: RequisitionDetail, stage: Stage): string | null {
  const matches = requisition.events
    // `eventType` arrives as a loose `string` from the wire schema; cast through the enum
    // since the only writers are backend modules that always emit valid values.
    .filter((e) => (stage.timestampEvents as readonly string[]).includes(e.eventType as string))
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const latest = matches[matches.length - 1];
  return latest ? latest.createdAt : null;
}

function stateOfStage(requisition: RequisitionDetail, index: number): StageState {
  // Terminal branches short-circuit the whole row.
  if (requisition.status === RequisitionStatus.REJECTED) return 'rejected';
  if (requisition.status === RequisitionStatus.CANCELLED) return 'cancelled';

  const current = currentStageIndex(requisition.status);
  if (index < current) return 'done';
  if (index === current) return 'current';
  return 'future';
}

const STATE_STYLE: Record<StageState, { ring: string; icon: typeof Check; tone: string }> = {
  done: {
    ring: 'border-success bg-success-subtle text-success',
    icon: Check,
    tone: 'text-success',
  },
  current: {
    ring: 'border-pending bg-pending-subtle text-pending',
    icon: CircleDot,
    tone: 'text-pending',
  },
  future: {
    ring: 'border-border bg-surface-muted text-ink-subtle',
    icon: Circle,
    tone: 'text-ink-subtle',
  },
  rejected: {
    ring: 'border-danger bg-danger-subtle text-danger',
    icon: X,
    tone: 'text-danger',
  },
  cancelled: {
    ring: 'border-border bg-surface-muted text-ink-subtle',
    icon: Ban,
    tone: 'text-ink-subtle',
  },
};

function StageCell({
  stage,
  state,
  completedAt,
  isFirst,
  isLast,
}: {
  stage: Stage;
  state: StageState;
  completedAt: string | null;
  isFirst: boolean;
  isLast: boolean;
}) {
  const style = STATE_STYLE[state];
  const Icon = style.icon;
  const label = t.requisitions.lifecycleStages[stage.key];

  return (
    <li className="relative flex min-w-0 flex-1 flex-col items-center">
      {/* Connector line — runs from this cell's left to the previous cell's center. On the
          first cell, no left connector; on the last, the right edge just trails off. */}
      {!isFirst ? (
        <span
          aria-hidden
          className={cn(
            'absolute left-0 right-1/2 top-4 h-px translate-x-[-50%]',
            state === 'done' || state === 'current' ? 'bg-success/60' : 'bg-border',
          )}
        />
      ) : null}
      {!isLast ? (
        <span
          aria-hidden
          className={cn(
            'absolute left-1/2 right-0 top-4 h-px translate-x-[50%]',
            state === 'done' ? 'bg-success/60' : 'bg-border',
          )}
        />
      ) : null}

      <span
        className={cn(
          'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border',
          style.ring,
        )}
        aria-current={state === 'current' ? 'step' : undefined}
        title={
          state === 'done' && completedAt
            ? t.requisitions.lifecycleDoneAt.replace('{when}', formatDateTime(completedAt))
            : label
        }
      >
        <Icon aria-hidden className="size-4" />
      </span>
      <span
        className={cn(
          'mt-1.5 text-center text-[11px] font-medium leading-tight',
          state === 'future' ? 'text-ink-subtle' : 'text-ink',
        )}
      >
        {label}
      </span>
    </li>
  );
}

export function LifecycleTracker({ requisition }: { requisition: RequisitionDetail }) {
  // For rejected/cancelled requisitions we still walk the stages but render the row in its
  // terminal styling; the connector colour logic above handles the visual.
  return (
    <div>
      <h2 className="mb-3 text-base font-semibold text-ink">{t.requisitions.lifecycleHeading}</h2>
      <ol
        className={cn(
          'flex w-full items-start gap-0',
          requisition.status === RequisitionStatus.REJECTED && 'opacity-90',
        )}
        aria-label={t.requisitions.lifecycleHeading}
      >
        {STAGES.map((stage, index) => (
          <StageCell
            key={stage.key}
            stage={stage}
            state={stateOfStage(requisition, index)}
            completedAt={eventsForStage(requisition, stage)}
            isFirst={index === 0}
            isLast={index === STAGES.length - 1}
          />
        ))}
      </ol>

      {/* The full event timeline belongs with the lifecycle (which is the chronological
          view), not the per-approval chain. Collapsed by default — most readers don't need
          it, and the lifecycle chips already show the same timestamps on hover. */}
      {requisition.events.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink">
            {t.requisitions.history}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 border-l border-border pl-4">
            {requisition.events.map((event) => (
              <li key={event.id} className="text-xs text-ink-muted">
                <span className="font-medium text-ink">{event.eventType.replace(/_/g, ' ')}</span>
                {event.actorName ? ` · ${event.actorName}` : null}
                <span className="text-ink-subtle">
                  {' '}
                  · {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}