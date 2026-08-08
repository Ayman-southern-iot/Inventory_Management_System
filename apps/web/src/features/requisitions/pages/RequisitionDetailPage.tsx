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
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
      {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

export function RequisitionDetailPage() {
  const { requisitionId = '' } = useParams<{ requisitionId: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const requisition = useRequisition(requisitionId);
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
                <Panel className="p-5">
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
                        <Badge tone="neutral">
                          {t.requisitions.urgencyLabel[detail.urgency]}
                        </Badge>
                        {detail.isOverdue ? (
                          <Badge tone="danger">{t.borrowing.overdue}</Badge>
                        ) : null}
                      </div>

                      <dl className="flex flex-wrap gap-10">
                        <Figure
                          label={t.requisitions.requested}
                          value={(detail.requestedAmount ?? 0).toLocaleString()}
                        />
                        <Figure
                          label={t.requisitions.sanctioned}
                          value={(detail.approvedAmount ?? 0).toLocaleString()}
                          hint={
                            // Until at least one approver has acted, the sanctioned figure is just
                            // a copy of the requested one — say so explicitly so the label "Sanctioned"
                            // doesn't mislead in the same way "Approved" did.
                            detail.approvals.every((a) => a.action !== ApprovalAction.APPROVED)
                              ? t.requisitions.sanctionedHintPending
                              : t.requisitions.sanctionedHintRevised
                          }
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
                        <p className="mt-4 whitespace-pre-wrap text-sm text-ink-muted">
                          {detail.reason}
                        </p>
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
                </Panel>

                <Panel>
                  <Table
                    headers={[
                      t.requisitions.itemName,
                      t.requisitions.quantity,
                      t.requisitions.unitPrice,
                      t.requisitions.lineTotal,
                    ]}
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
                        <td className="px-4 py-2.5 tabular-nums text-ink">{item.quantity}</td>
                        <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                          {item.estimatedUnitPrice.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums font-medium text-ink">
                          {item.estimatedLineTotal.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </Table>
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
