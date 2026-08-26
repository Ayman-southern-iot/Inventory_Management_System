import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Pencil, Send, Undo2, X } from 'lucide-react';
import {
  ApprovalAction,
  ApprovalStage,
  RequisitionStatus,
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
import { ApprovalTracker } from '../components/ApprovalTracker';
import { LifecycleTracker } from '../components/LifecycleTracker';
import { SupportingDocumentCard } from '../components/SupportingDocumentCard';
import { FundsPanel } from '@/features/funds/components/FundsPanel';
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

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    // Numeric figures right-align to match the items-table Line Total below — visual
    // // consistency across the card.
    <div className="min-w-[8rem] text-right">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p> : null}
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
   * What the requested figure will be when submit freezes it: the server's own line totals plus
   * transportation, which is exactly what `RequisitionsService.submit` adds up. Only rendered
   * while `requestedAmount` is null (D-016).
   */
  const provisionalTotal = useMemo(
    () =>
      (detailData?.items ?? []).reduce((sum, item) => sum + item.estimatedLineTotal, 0) +
      (detailData?.transportationCost ?? 0),
    [detailData],
  );

  /**
   * Three states, not two (D-021). The old condition picked "an approver revised this" whenever
   * any approver had acted, so an approval that left the amount untouched still claimed a
   * revision — on a financial record. A revision is the amounts *differing*; an approval that
   * changed nothing needs no caption at all.
   */
  const sanctionedHint = useMemo(() => {
    if (!detailData) return undefined;
    if (detailData.approvedAmount === null) return undefined;
    if (detailData.approvals.every((a) => a.action !== ApprovalAction.APPROVED)) {
      return t.requisitions.sanctionedHintPending;
    }
    return detailData.requestedAmount !== null &&
      detailData.approvedAmount !== detailData.requestedAmount
      ? t.requisitions.sanctionedHintRevised
      : undefined;
  }, [detailData]);
  const submit = useSubmitRequisition();
  const cancel = useCancelRequisition();
  const withdraw = useWithdrawApproval();

  const [deciding, setDeciding] = useState<{ approval: Approval; approve: boolean } | null>(null);

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
    const canWithdraw =
      detail.status === RequisitionStatus.IM_REVIEW ||
      detail.status === RequisitionStatus.AWAITING_APPROVAL ||
      detail.status === RequisitionStatus.APPROVED;
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
              subtitle={`${detail.requesterName}${detail.departmentName ? ` · ${detail.departmentName}` : ''}${detail.projectName ? ` · ${detail.projectName}` : ''}`}
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

                  {actionable ? (
                    <>
                      <Button
                        variant="secondary"
                        icon={<X aria-hidden className="size-4 text-danger" />}
                        onClick={() => setDeciding({ approval: actionable, approve: false })}
                      >
                        {t.requisitions.reject}
                      </Button>
                      <Button
                        icon={<Check aria-hidden className="size-4" />}
                        onClick={() => setDeciding({ approval: actionable, approve: true })}
                      >
                        {t.requisitions.approve}
                      </Button>
                    </>
                  ) : null}

                  {!actionable && withdrawable ? (
                    <Button
                      variant="secondary"
                      icon={<Undo2 aria-hidden className="size-4" />}
                      onClick={() => {
                        const reason = window.prompt(t.requisitions.withdrawReason);
                        if (!reason) return;
                        void act(
                          () =>
                            withdraw.mutateAsync({
                              approvalId: withdrawable.id,
                              input: { reason },
                            }),
                          t.requisitions.withdrawnToast,
                        );
                      }}
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
                <Panel>
                  {/* Top zone: status pills, figures, note, supporting document. */}
                  <div className="p-5">
                    <div
                      className={`flex flex-col gap-5 ${
                        detail.supportingDocument ? 'md:flex-row md:items-start' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                          <Badge tone={STATUS_TONE[detail.status] ?? 'info'}>
                            {t.requisitions.status[detail.status]}
                          </Badge>
                          {/* Send-back tag — derived from the events log on the server. Stays
                              on the DRAFT pill until the requester re-submits, at which point
                              the badge flips to "Revised" so the IM knows a fresh chain is in
                              play. */}
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
                          <Badge tone="neutral">
                            {t.requisitions.urgencyLabel[detail.urgency]}
                          </Badge>
                          {detail.isOverdue ? (
                            <Badge tone="danger">{t.borrowing.overdue}</Badge>
                          ) : null}
                        </div>

                        <dl className="flex flex-wrap justify-end gap-x-10 gap-y-3 sm:justify-start">
                          <Figure
                            label={t.requisitions.requested}
                            // `requestedAmount` is null until submit freezes it. `?? 0` put a hard
                            // REQUESTED 0 directly above a line-item table totalling the real
                            // amount (D-016). Before it is frozen, show the sum of those same
                            // lines — the line totals come from the server, so this is the
                            // addition submit does, not a second implementation of the
                            // arithmetic — and label it provisional. Once frozen, the stored
                            // figure wins: an item edited later must not move what the approvers
                            // were shown.
                            value={(detail.requestedAmount ?? provisionalTotal).toLocaleString()}
                            hint={
                              detail.requestedAmount === null
                                ? t.requisitions.requestedHintDraft
                                : undefined
                            }
                          />
                          <Figure
                            label={t.requisitions.sanctioned}
                            // Nothing is sanctioned before submit, and 0 is a figure — an em dash
                            // is the absence of one.
                            value={
                              detail.approvedAmount === null
                                ? t.common.none
                                : detail.approvedAmount.toLocaleString()
                            }
                            hint={sanctionedHint}
                          />
                          {detail.requiredApproverCount !== null ? (
                            <Figure
                              label={t.requisitions.approverCount}
                              value={String(detail.requiredApproverCount)}
                              // Shows *why* it needed that many, even after the setting has moved on.
                              hint={`${t.requisitions.thresholdNote}: ${(detail.thresholdAtSubmit ?? 0).toLocaleString()}`}
                            />
                          ) : null}
                        </dl>

                        {detail.reason ? (
                          <div className="mt-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                              {t.requisitions.reason}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                              {detail.reason}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {detail.supportingDocument ? (
                        <div className="flex shrink-0 justify-center md:justify-end">
                          <SupportingDocumentCard
                            document={detail.supportingDocument}
                            url={detail.supportingDocumentUrl}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Internal divider separates the stats zone from the items table so they
                      read as one card without two outlines. The "Line items" heading gives
                      the table a label that connects it to the figures above. */}
                  <div className="border-t border-border px-5 py-4">
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
                  </div>

                  {/* Transportation breakdown — only when the requester added one. The
                      amount is already part of the REQUESTED figure above; this zone
                      breaks it down so the approver can see what they were paying for.
                      Description is always present when the row exists (DB enforces
                      both-or-neither). */}
                  {detail.transportationCost !== null && detail.transportationCost > 0 ? (
                    <div className="border-t border-border px-5 py-4">
                      <div className="flex items-baseline justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {t.requisitions.transportation.detailHeading}
                          </p>
                          {detail.transportationDescription ? (
                            <div className="mt-1">
                              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                                {t.requisitions.transportationDescriptionLabel}
                              </p>
                              <p className="mt-0.5 text-sm text-ink-muted">
                                {detail.transportationDescription}
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <p className="text-right text-lg font-semibold tabular-nums text-ink">
                          {(detail.transportationCost ?? 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </Panel>
              </div>

              <Panel className="p-5">
                <ApprovalTracker requisition={detail} />
              </Panel>
            </div>

            {/* Full horizontal lifecycle tracker — sits above the funds panel because money
                is only meaningful once the requisition has been approved. */}
            <Panel className="p-5">
              <LifecycleTracker requisition={detail} />
            </Panel>

            {/* Renders itself only once a BOM exists — before that there is no money story. */}
            <FundsPanel requisition={detail} />

            <DecisionDialog
              deciding={deciding}
              requestedAmount={detail.requestedAmount}
              onClose={() => setDeciding(null)}
            />
          </>
        )}
      </QueryBoundary>
    </>
  );
}
