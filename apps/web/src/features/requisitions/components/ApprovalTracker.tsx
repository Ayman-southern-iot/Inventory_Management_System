import { useState } from 'react';
import { Check, CircleDashed, CircleSlash, Clock, X } from 'lucide-react';
import {
  ApprovalAction,
  ApprovalStage,
  RequisitionStatus,
  type Approval,
  type RequisitionDetail,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';

/**
 * Task 3.6 — the live tracker.
 *
 * Read from the approval rows and the event log, never from the status column alone. A status
 * only holds the latest value, so it cannot express "approved, then withdrawn, then approved
 * again" — which is precisely the case the plan calls out. The event history below is what
 * makes that legible.
 */

type NodeState = 'done' | 'rejected' | 'waiting' | 'notReached' | 'skipped';

const NODE_STYLE: Record<NodeState, { ring: string; icon: typeof Check; label: string }> = {
  done: { ring: 'border-success bg-success-subtle text-success', icon: Check, label: t.requisitions.approvedBy },
  rejected: { ring: 'border-danger bg-danger-subtle text-danger', icon: X, label: t.requisitions.rejectedBy },
  waiting: { ring: 'border-pending bg-pending-subtle text-pending', icon: Clock, label: t.requisitions.awaiting },
  notReached: { ring: 'border-border bg-surface-muted text-ink-subtle', icon: CircleDashed, label: t.requisitions.notReached },
  skipped: { ring: 'border-border bg-surface-muted text-ink-subtle', icon: CircleSlash, label: t.requisitions.skipped },
};

function stateOf(approval: Approval, requisition: RequisitionDetail): NodeState {
  if (approval.action === ApprovalAction.APPROVED) return 'done';
  if (approval.action === ApprovalAction.REJECTED) return 'rejected';

  // A terminal requisition freezes everything that never got its turn.
  if (requisition.status === RequisitionStatus.REJECTED) return 'skipped';
  if (requisition.status === RequisitionStatus.CANCELLED) return 'skipped';

  const isImTurn =
    approval.stage === ApprovalStage.INVENTORY_MANAGER &&
    requisition.status === RequisitionStatus.IM_REVIEW;
  const isApproverTurn =
    approval.stage === ApprovalStage.APPROVER &&
    requisition.status === RequisitionStatus.AWAITING_APPROVAL;

  return isImTurn || isApproverTurn ? 'waiting' : 'notReached';
}

function TrackerNode({
  approval,
  requisition,
}: {
  approval: Approval;
  requisition: RequisitionDetail;
}) {
  const [showReason, setShowReason] = useState(false);
  const state = stateOf(approval, requisition);
  const style = NODE_STYLE[state];
  const Icon = style.icon;

  const title =
    approval.stage === ApprovalStage.INVENTORY_MANAGER
      ? t.requisitions.stage.INVENTORY_MANAGER
      : `${t.requisitions.stage.APPROVER} ${approval.slot}`;

  // "Approved by X on behalf of Y" — the delegate is recorded without displacing the assignee.
  const actedByDelegate =
    approval.actedByUserId !== null && approval.actedByUserId !== approval.assignedUserId;

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full border',
            style.ring,
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="mt-1 w-px flex-1 bg-border last:hidden" aria-hidden />
      </div>

      <div className="pb-6">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-muted">
          {approval.assignedUserName}
          <span className="text-ink-subtle"> · {approval.assignedUserDesignation}</span>
        </p>

        {state === 'done' || state === 'rejected' ? (
          <p className="mt-0.5 text-xs text-ink-subtle">
            {actedByDelegate
              ? `${approval.actedByUserName} ${t.requisitions.onBehalfOf} ${approval.assignedUserName}`
              : style.label}
            {approval.actedAt ? ` · ${new Date(approval.actedAt).toLocaleString()}` : null}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-ink-subtle">{style.label}</p>
        )}

        {/* "See why" reveals the rejection note with the rejector's name and designation. */}
        {state === 'rejected' && approval.note ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 px-0"
              onClick={() => setShowReason((open) => !open)}
              aria-expanded={showReason}
            >
              {t.requisitions.seeWhy}
            </Button>
            {showReason ? (
              <p className="mt-1 rounded-[--radius-control] bg-danger-subtle px-3 py-2 text-xs text-ink">
                {approval.note}
              </p>
            ) : null}
          </>
        ) : null}

        {approval.action === ApprovalAction.WITHDRAWN ? (
          <p className="mt-1 rounded-[--radius-control] bg-pending-subtle px-3 py-2 text-xs text-ink">
            {approval.note}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function ApprovalTracker({ requisition }: { requisition: RequisitionDetail }) {
  // IM first, then approvers by slot — the order the chain is actually walked.
  const ordered = [...requisition.approvals].sort((a, b) => {
    if (a.stage !== b.stage) return a.stage === ApprovalStage.INVENTORY_MANAGER ? -1 : 1;
    return a.slot - b.slot;
  });

  return (
    <div>
      <h2 className="mb-3 text-base font-semibold text-ink">{t.requisitions.trackerHeading}</h2>
      <ol className="flex flex-col">
        {ordered.map((approval) => (
          <TrackerNode key={approval.id} approval={approval} requisition={requisition} />
        ))}
      </ol>
    </div>
  );
}
