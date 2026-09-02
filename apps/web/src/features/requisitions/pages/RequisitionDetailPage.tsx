import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Send, Undo2 } from 'lucide-react';
import {
  ApprovalAction,
  ApprovalStage,
  RequisitionStatus,
  WITHDRAWABLE_STATUSES,
  type Approval,
  type RequisitionDetail as Detail,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Badge, PageHeader, Panel, Table } from '@/components/ui/primitives';
import { QueryBoundary } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { ROUTES } from '@/routes/paths';
import { useAuth } from '@/features/auth/auth-context';
import { DecisionCard } from '../components/DecisionCard';
import { ApprovalTracker } from '../components/ApprovalTracker';
import { LifecycleTracker } from '../components/LifecycleTracker';
import { RequisitionFacts } from '../components/RequisitionFacts';
import { FundsPanel } from '@/features/funds/components/FundsPanel';
import { ReasonDialog } from '@/components/ui/ReasonDialog';
import { DecisionDialog } from '../components/DecisionDialog';
import {
  useCancelRequisition,
  useRequisition,
  useSubmitRequisition,
  useWithdrawApproval,
} from '../api';

const STATUS_TONE: Partial<Record<RequisitionStatus, 'neutral' | 'success' | 'pending' | 'danger' | 'info'>> = {
  [RequisitionStatus.DRAFT]: 'neutral',
  [RequisitionStatus.IM_REVIEW]: 'pending',
  [RequisitionStatus.AWAITING_APPROVAL]: 'pending',
  [RequisitionStatus.APPROVED]: 'success',
  [RequisitionStatus.REJECTED]: 'danger',
  [RequisitionStatus.CANCELLED]: 'neutral',
};

/**
 * One line of the totals block: label on the left, amount on the right.
 *
 * A bill is read down the right-hand edge, so the amounts share a column and the labels never
 * push them out of alignment. `emphasis` is the figure the requisition actually comes to.
 */
function TotalRow({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string | null;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <div className="min-w-0">
        <dt
          className={
            emphasis
              ? 'text-sm font-semibold text-ink'
              : 'text-sm text-ink-muted'
          }
        >
          {label}
        </dt>
        {hint ? <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p> : null}
      </div>
      <dd
        className={
          emphasis
            ? 'shrink-0 text-lg font-semibold tabular-nums text-ink'
            : 'shrink-0 text-sm font-medium tabular-nums text-ink'
        }
      >
        {value}
      </dd>
    </div>
  );
}

export function RequisitionDetailPage() {
  const { requisitionId = '' } = useParams<{ requisitionId: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const requisition = useRequisition(requisitionId);
  const detailData = requisition.data;


  /**
   * Three states, not two (D-021). The old condition picked "an approver revised this" whenever
   * any approver had acted, so an approval that left the amount untouched still claimed a
   * revision — on a financial record. A revision is the amounts *differing*; an approval that
   * changed nothing needs no caption at all.
   */
  /**
   * The approved figure, and whether there is one to show at all.
   *
   * `approved_amount` is seeded with the requested figure at submit so the BOM has a number to
   * print, which meant the screen showed a concrete "Sanctioned 20,000" while the requisition
   * was still sitting in somebody's queue (UX-5). Nobody had approved anything. The column keeps
   * its seed — the BOM still needs it — but the screen now waits for an approver to actually
   * decide before it will name a figure approved.
   *
   * The predicate is an approver having APPROVED, not the status reaching APPROVED: above the
   * threshold the first of two approvals is a real decision on the amount, and if that approver
   * revised it down, the revised figure is the honest thing to show while the second is pending.
   */
  /**
   * What the goods come to, before getting them here.
   *
   * Taken as (requested − carriage) rather than by re-adding the line totals: `requested` is
   * the figure submit froze and the one the approvers are judging, so deriving from it keeps
   * the three lines of the totals block arithmetically consistent with each other even if an
   * item is edited afterwards.
   */
  const itemsSubtotal = useMemo(() => {
    const total = detailData?.requestedAmount ?? detailData?.provisionalAmount ?? 0;
    return Math.round((total - (detailData?.transportationCost ?? 0)) * 100) / 100;
  }, [detailData]);

  const approved = useMemo(() => {
    if (!detailData) return { value: t.common.none, hint: undefined as string | undefined };
    const decided = detailData.approvals.some((a) => a.action === ApprovalAction.APPROVED);
    if (!decided || detailData.approvedAmount === null) {
      return { value: t.common.none, hint: undefined };
    }
    const revised =
      detailData.requestedAmount !== null &&
      detailData.approvedAmount !== detailData.requestedAmount;
    return {
      value: detailData.approvedAmount.toLocaleString(),
      hint: revised ? t.requisitions.approvedAmountHintRevised : undefined,
    };
  }, [detailData]);

  /**
   * QA-034: one line of one unit cannot be part-bought, so there is no lower amount that still
   * buys it. The approve dialog hides its revise control for these rather than offering a figure
   * the BOM stage could never spend.
   */
  const isAdjustable = useMemo(() => {
    const items = detailData?.items ?? [];
    if (items.length === 0) return false;
    return items.length > 1 || (items[0]?.quantity ?? 0) > 1;
  }, [detailData]);
  const submit = useSubmitRequisition();
  const cancel = useCancelRequisition();
  const withdraw = useWithdrawApproval();

  const [deciding, setDeciding] = useState<{ approval: Approval; approve: boolean } | null>(null);
  /** The approval whose decision is being taken back, or null. */
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  /** The approval this viewer can act on right now, if any. */
  const actionable = useMemo(() => {
    if (!requisition.data || !user) return undefined;
    const detail = requisition.data;
    return detail.approvals.find(
      (approval) =>
        approval.assignedUserId === user.id &&
        // Both PENDING and WITHDRAWN are decidable again: withdrawing exists precisely so the
        // approver can think again and then act. The backend already accepts either
        // (requisitions.service.ts `decide` -> `claimApproval`).
        (approval.action === ApprovalAction.PENDING ||
          approval.action === ApprovalAction.WITHDRAWN) &&
        ((approval.stage === ApprovalStage.INVENTORY_MANAGER &&
          detail.status === RequisitionStatus.IM_REVIEW) ||
          (approval.stage === ApprovalStage.APPROVER &&
            detail.status === RequisitionStatus.AWAITING_APPROVAL)),
    );
  }, [requisition.data, user]);

  /** An approval this viewer already decided and may still take back. */
  const withdrawable = useMemo(() => {
    if (!requisition.data || !user) return undefined;
    const detail = requisition.data;
    // IM rejections land the requisition on IM_REVIEW when withdrawn; approver decisions
    // (approval or rejection) return it to AWAITING_APPROVAL.
    //
    // Taken from the shared list rather than restated here. This condition had been written
    // out by hand and omitted REJECTED, so a rejection could not be taken back from the
    // screen — while the API had allowed exactly that since withdraw shipped, and its own
    // comment says so. The two drifted because they were two lists.
    const canWithdraw = WITHDRAWABLE_STATUSES.includes(detail.status as RequisitionStatus);
    if (!canWithdraw) return undefined;
    return detail.approvals.find(
      (approval) =>
        approval.assignedUserId === user.id &&
        // Both APPROVED and REJECTED are revocable: withdrawing exists precisely so the
        // approver can think again and re-decide.
        (approval.action === ApprovalAction.APPROVED ||
          approval.action === ApprovalAction.REJECTED),
    );
  }, [requisition.data, user]);

  async function act(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      toast.success(message);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const isOwner = (detail: Detail) => detail.requesterId === user?.id;

  return (
    <>
      <Link
        to={ROUTES.requisitions.mine}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.requisitions.title}
      </Link>

      <QueryBoundary
        isLoading={requisition.isPending}
        error={requisition.error}
        data={requisition.data}
        onRetry={() => void requisition.refetch()}
      >
        {(detail) => (
          <>
            <PageHeader
              title={detail.requisitionNo}
              // A missing project is not a gap to hide: it means personal development
              // (Ayman's ruling, 2026-08-26), so it is always named.
              subtitle={`${detail.requesterName}${detail.departmentName ? ` · ${detail.departmentName}` : ''} · ${detail.projectName ?? t.requisitions.noProject}`}
              action={
                <div className="flex flex-wrap gap-2">
                  {detail.status === RequisitionStatus.DRAFT && isOwner(detail) ? (
                    <>
                      <Button
                        variant="secondary"
                        icon={<Pencil aria-hidden className="size-4" />}
                        onClick={() => navigate(ROUTES.requisitions.edit(detail.id))}
                      >
                        {t.common.edit}
                      </Button>
                      <Button
                        icon={<Send aria-hidden className="size-4" />}
                        isLoading={submit.isPending}
                        onClick={() =>
                          void act(
                            () => submit.mutateAsync({ id: detail.id }),
                            t.requisitions.submitted,
                          )
                        }
                      >
                        {t.requisitions.submit}
                      </Button>
                    </>
                  ) : null}

                  {isOwner(detail) &&
                  (detail.status === RequisitionStatus.DRAFT ||
                    detail.status === RequisitionStatus.IM_REVIEW) ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(
                          () => cancel.mutateAsync({ id: detail.id }),
                          t.requisitions.cancelledToast,
                        )
                      }
                    >
                      {t.requisitions.cancelRequest}
                    </Button>
                  ) : null}


                  {!actionable && withdrawable ? (
                    <Button
                      variant="secondary"
                      icon={<Undo2 aria-hidden className="size-4" />}
                      onClick={() => setWithdrawing(withdrawable.id)}
                    >
                      {t.requisitions.withdraw}
                    </Button>
                  ) : null}
                </div>
              }
            />

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="flex flex-col gap-6 lg:col-span-2">
                {/* Status box + (optional) supporting-document card on the right. When no
                    document is attached, the card column collapses and the status content
                    fills the full width. */}
                <Panel className="p-5">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[detail.status] ?? 'info'}>
                      {t.requisitions.status[detail.status]}
                    </Badge>
                    {/* Send-back tag — derived from the events log on the server. Stays on the
                        DRAFT pill until the requester re-submits, at which point the badge flips
                        to "Revised" so the IM knows a fresh chain is in play. */}
                    {detail.requiresRevisionTag ? (
                      <Badge tone="pending" title={t.requisitions.statusTags.draftForReviseHint}>
                        {t.requisitions.statusTags.draftForRevise}
                      </Badge>
                    ) : null}
                    {detail.revisedAfterSendBack ? (
                      <Badge tone="info" title={t.requisitions.statusTags.draftRevisedHint}>
                        {t.requisitions.statusTags.draftRevised}
                      </Badge>
                    ) : null}
                    <Badge tone="neutral">{t.requisitions.urgencyLabel[detail.urgency]}</Badge>
                    {detail.isOverdue ? (
                      <Badge tone="danger">{t.borrowing.overdue}</Badge>
                    ) : null}
                  </div>

                  {/* Who / what / when — including the reason and the attachment, which used to
                      sit outside this block and made the card read as three things competing for
                      one space rather than one summary. */}
                  <RequisitionFacts detail={detail} />
                </Panel>

                <Panel className="p-5">
                  <h2 className="mb-3 text-sm font-semibold text-ink">
                    {t.requisitions.lineItemsHeading}
                  </h2>
                    <Table
                      headers={[
                        t.requisitions.itemName,
                        t.requisitions.quantity,
                        t.requisitions.unitPrice,
                        t.requisitions.lineTotal,
                      ]}
                      // Right-align the numeric columns. Item name stays start-aligned so the
                      // text anchors to the row data on the left.
                      headerAligns={['start', 'end', 'end', 'end']}
                    >
                      {detail.items.map((item) => (
                        <tr key={item.id}>
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-ink">{item.itemName}</p>
                            {item.inStockQtyAtSubmit !== null && item.inStockQtyAtSubmit > 0 ? (
                              <p className="text-xs text-success">
                                {t.requisitions.inStockHint.replace(
                                  '{n}',
                                  String(item.inStockQtyAtSubmit),
                                )}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                            {item.quantity.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                            {item.estimatedUnitPrice.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                            {item.estimatedLineTotal.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </Table>


                  {/* The totals, as the approving-view template stacks them: each line under
                      the table it belongs to, the payable figure last and heaviest. They used to
                      sit above the table as three loose figures competing with the summary. */}
                  <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
                    <TotalRow
                      label={t.requisitions.itemsSubtotalLabel}
                      value={itemsSubtotal.toLocaleString()}
                    />
                    {detail.transportationCost !== null && detail.transportationCost > 0 ? (
                      <TotalRow
                        label={t.requisitions.transportation.detailHeading}
                        // The description belongs beside the amount it explains, not in a block
                        // of its own — the approver is asking "what is this 500 for".
                        hint={detail.transportationDescription}
                        value={detail.transportationCost.toLocaleString()}
                      />
                    ) : null}
                    <TotalRow
                      label={t.requisitions.requested}
                      hint={
                        detail.requestedAmount === null
                          ? t.requisitions.requestedHintDraft
                          : undefined
                      }
                      value={(detail.requestedAmount ?? detail.provisionalAmount).toLocaleString()}
                      emphasis
                    />
                    {/* An em dash until an approver has actually decided — see the `approved`
                        memo. 0 is a figure; the absence of one has to look like an absence. */}
                    <TotalRow
                      label={t.requisitions.approvedAmount}
                      hint={approved.hint}
                      value={approved.value}
                    />
                  </dl>
                </Panel>

                {/* Last in the left column, so the decision reads as the conclusion of what
                    is above it. Shown only to the person actually being asked. */}
                {actionable ? (
                  <DecisionCard
                    approval={actionable}
                    requestedAmount={detail.requestedAmount}
                    isAdjustable={isAdjustable}
                    onReject={() => setDeciding({ approval: actionable, approve: false })}
                  />
                ) : null}
              </div>

              <Panel className="p-5">
                {/* The count explains the chain listed under it, so it is handed to the tracker
                    and rendered beneath its heading rather than floating above it. */}
                <ApprovalTracker
                  requisition={detail}
                  hint={
                    detail.requiredApproverCount === null
                      ? undefined
                      : t.requisitions.approverCountHint
                          .replace('{n}', String(detail.requiredApproverCount))
                          .replace(
                            '{threshold}',
                            (detail.thresholdAtSubmit ?? 0).toLocaleString(),
                          )
                  }
                />
              </Panel>
            </div>


            {/* Full horizontal lifecycle tracker — sits above the funds panel because money
                is only meaningful once the requisition has been approved. */}
            <Panel className="p-5">
              <LifecycleTracker requisition={detail} />
            </Panel>

            {/* Renders itself only once a BOM exists — before that there is no money story. */}
            <FundsPanel requisition={detail} />

            <ReasonDialog
              open={withdrawing !== null}
              title={t.requisitions.withdrawTitle}
              description={t.requisitions.withdrawExplain}
              label={t.requisitions.withdrawReason}
              confirmLabel={t.requisitions.withdraw}
              isPending={withdraw.isPending}
              onClose={() => setWithdrawing(null)}
              onConfirm={(reason) => {
                const approvalId = withdrawing;
                if (!approvalId) return;
                setWithdrawing(null);
                void act(
                  () => withdraw.mutateAsync({ approvalId, input: { reason } }),
                  t.requisitions.withdrawnToast,
                );
              }}
            />

            <DecisionDialog
              deciding={deciding}
              requestedAmount={detail.requestedAmount}
              isAdjustable={isAdjustable}
              onClose={() => setDeciding(null)}
            />
          </>
        )}
      </QueryBoundary>
    </>
  );
}
