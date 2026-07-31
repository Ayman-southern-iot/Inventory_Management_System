import { Ban, Check, Circle, CircleDot, X } from 'lucide-react';
import {
  RequisitionEventType,
  RequisitionStatus,
  type RequisitionDetail,
} from '@ims/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/en';

type StageState = 'done' | 'current' | 'future' | 'rejected' | 'cancelled';

/**
 * The nine lifecycle stages the tracker renders. Order matters — the tracker is a
 * horizontal stepper that walks left to right.
 *
 * `doneEvent` is the event that, once recorded, marks the stage as complete even if the
 * requisition has since rolled back (e.g. a BOM was generated then voided). The status
 * column tells us what's true *now*; events tell us what *has happened*.
 */
interface Stage {
  key: keyof typeof t.requisitions.lifecycleStages;
  /** Event types whose presence marks this stage done, regardless of current status. */
  doneEvents: RequisitionEventType[];
  /** Statuses that mark this stage as the current one. */
  currentStatuses: RequisitionStatus[];
}

const STAGES: readonly Stage[] = [
  {
    key: 'submitted',
    doneEvents: [RequisitionEventType.SUBMITTED, RequisitionEventType.CREATED],
    currentStatuses: [RequisitionStatus.DRAFT],
  },
  {
    key: 'imReview',
    doneEvents: [RequisitionEventType.IM_APPROVED, RequisitionEventType.FULLY_APPROVED],
    currentStatuses: [RequisitionStatus.IM_REVIEW],
  },
  {
    key: 'approved',
    // Stages where an approver (or the IM, in the sub-threshold case) is acting: the
    // approval is in flight. "Approved" becomes done after FULLY_APPROVED lands.
    doneEvents: [RequisitionEventType.FULLY_APPROVED],
    currentStatuses: [RequisitionStatus.AWAITING_APPROVAL, RequisitionStatus.APPROVED],
  },
  {
    key: 'bom',
    doneEvents: [RequisitionEventType.BOM_GENERATED, RequisitionEventType.BOM_RENDERED],
    currentStatuses: [RequisitionStatus.BOM_GENERATED],
  },
  {
    key: 'accounts',
    doneEvents: [RequisitionEventType.SENT_TO_ACCOUNTS, RequisitionEventType.FUNDS_RECEIVED],
    currentStatuses: [RequisitionStatus.SENT_TO_ACCOUNTS],
  },
  {
    key: 'funded',
    // FUNDS_PARTIAL has no dedicated event — its own status is the only signal.
    doneEvents: [RequisitionEventType.FUNDS_RECEIVED],
    currentStatuses: [RequisitionStatus.FUNDS_PARTIAL, RequisitionStatus.FUNDS_RECEIVED],
  },
  {
    key: 'purchased',
    doneEvents: [RequisitionEventType.PURCHASED],
    currentStatuses: [RequisitionStatus.PURCHASED],
  },
  {
    key: 'verified',
    doneEvents: [RequisitionEventType.PURCHASE_VERIFIED],
    currentStatuses: [RequisitionStatus.PURCHASE_VERIFIED],
  },
  {
    key: 'inStock',
    doneEvents: [RequisitionEventType.STOCKED, RequisitionEventType.CLOSED],
    currentStatuses: [RequisitionStatus.STOCKED, RequisitionStatus.CLOSED],
  },
] as const;

function eventsForStage(requisition: RequisitionDetail, stage: Stage): string | null {
  const matches = requisition.events
    // `eventType` arrives as a loose `string` from the wire schema; cast through the enum
    // since the only writers are backend modules that always emit valid values.
    .filter((e) =>
      (stage.doneEvents as readonly string[]).includes(e.eventType as string),
    )
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const latest = matches[matches.length - 1];
  return latest ? latest.createdAt : null;
}

function stateOfStage(requisition: RequisitionDetail, stage: Stage): StageState {
  // Terminal branches short-circuit the whole row.
  if (requisition.status === RequisitionStatus.REJECTED) return 'rejected';
  if (requisition.status === RequisitionStatus.CANCELLED) return 'cancelled';

  if (stage.currentStatuses.includes(requisition.status)) return 'current';
  if (stage.doneEvents.some((e) => requisition.events.some((ev) => ev.eventType === e))) {
    return 'done';
  }
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
            ? t.requisitions.lifecycleDoneAt.replace('{when}', new Date(completedAt).toLocaleString())
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
            state={stateOfStage(requisition, stage)}
            completedAt={eventsForStage(requisition, stage)}
            isFirst={index === 0}
            isLast={index === STAGES.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}