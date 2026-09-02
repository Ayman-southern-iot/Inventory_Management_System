import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RequisitionStatus,
  RequisitionUrgency,
  type RequisitionDetail,
  type RequisitionFunding,
} from '@ims/shared';
import { ToastProvider } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import * as fundsApi from '../api';
import { FundsActionDialog } from './FundsActionDialog';

/**
 * Instalments are switched off for this release (Ayman, 2026-09-02).
 *
 * The rule lives on the server, so the interesting question here is not "does it refuse" — it is
 * whether the dialog stops *offering* the thing that would be refused. An amount field with
 * exactly one acceptable value is a trap: every other number the IM can type round-trips to a 409.
 *
 * So the dialog states the figure instead. These tests pin both directions, because the flag is
 * the whole point of shipping it as a flag: when partial funding comes back, the field must come
 * back with it and this file should go red if it does not.
 */
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSendToAccounts: vi.fn(),
    useRecordReceipt: vi.fn(),
    useRecordPurchase: vi.fn(),
    useVerifyPurchase: vi.fn(),
    useUnverifyPurchase: vi.fn(),
    useUndoSendToAccounts: vi.fn(),
    useVoidReceipt: vi.fn(),
    useVoidPurchase: vi.fn(),
    useAttachInvoice: vi.fn(),
  };
});

const NOW = '2026-09-02T12:00:00.000Z';

function funding(overrides: Partial<RequisitionFunding> = {}): RequisitionFunding {
  return {
    requisitionId: 'req-1',
    requestedAmount: 18_000,
    approvedAmount: 18_000,
    funded: 0,
    spent: 0,
    transportation: 0,
    spentInclTransportation: 0,
    returned: 0,
    netFunded: 0,
    outstanding: 18_000,
    unspent: 0,
    allowsPartialFunding: false,
    isFullyFunded: false,
    receipts: [],
    purchases: [],
    returns: [],
    ...overrides,
  };
}

function detail(): RequisitionDetail {
  return {
    id: 'req-1',
    requisitionNo: 'REQ-000001-GINA',
    requesterId: 'requester',
    requesterName: 'Gina General',
    departmentId: null,
    departmentName: null,
    projectId: null,
    projectName: null,
    urgency: RequisitionUrgency.NORMAL,
    approvalDeadline: null,
    reason: null,
    requestedAmount: 18_000,
    provisionalAmount: 18_000,
    approvedAmount: 18_000,
    requiredApproverCount: 2,
    thresholdAtSubmit: 15_000,
    status: RequisitionStatus.SENT_TO_ACCOUNTS,
    submittedAt: NOW,
    decidedAt: NOW,
    isOverdue: false,
    createdAt: NOW,
    updatedAt: NOW,
    items: [],
    approvals: [],
    events: [],
    supportingDocument: null,
    supportingDocumentUrl: null,
    transportationCost: null,
    transportationDescription: null,
    requiresRevisionTag: false,
    revisedAfterSendBack: false,
    fundingSnapshots: [],
  };
}

function stubHooks() {
  const idle = (mutateAsync: unknown) =>
    ({ mutateAsync, isPending: false }) as unknown as ReturnType<typeof fundsApi.useRecordReceipt>;
  vi.mocked(fundsApi.useSendToAccounts).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useRecordReceipt).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useRecordPurchase).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useVerifyPurchase).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useUnverifyPurchase).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useAttachInvoice).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useUndoSendToAccounts).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useVoidReceipt).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useVoidPurchase).mockReturnValue(idle(vi.fn()) as never);
}

function renderReceiptDialog(fundingData: RequisitionFunding) {
  stubHooks();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <FundsActionDialog
          action="receipt"
          requisition={detail()}
          funding={fundingData}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('recording money received, with instalments switched off', () => {
  it('offers no amount field, because only one amount is acceptable', () => {
    renderReceiptDialog(funding());

    expect(screen.queryByRole('spinbutton', { name: new RegExp(t.funds.amount) })).toBeNull();
  });

  it('states the outstanding figure instead', () => {
    renderReceiptDialog(funding());

    expect(screen.getByText('18,000')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t.funds.fullAmountOnly))).toBeInTheDocument();
  });

  it('says why, so the IM does not go looking for the field', () => {
    renderReceiptDialog(funding());

    expect(screen.getByText(new RegExp(t.funds.fullAmountOnlyHint))).toBeInTheDocument();
  });

  /**
   * The flag is the reason this shipped as a flag rather than a deletion. If it is ever flipped
   * back on, the field has to return — otherwise the feature is on in the API and unreachable in
   * the UI, which is the worst of both.
   */
  it('brings the field back when instalments are allowed again', () => {
    renderReceiptDialog(funding({ allowsPartialFunding: true }));

    expect(screen.getByRole('spinbutton', { name: new RegExp(t.funds.amount) })).toBeInTheDocument();
  });

  /**
   * A part-funded requisition is still reachable by *reversal* — void one of several receipts and
   * the balance reopens. The dialog must handle that, and it is the case where the stated figure
   * is a partial balance rather than the full approved amount.
   */
  it('states the remaining balance, not the approved total, after a reversal reopened it', () => {
    renderReceiptDialog(funding({ funded: 10_000, outstanding: 8_000 }));

    expect(screen.getByText('8,000')).toBeInTheDocument();
    expect(screen.queryByText('18,000')).toBeNull();
  });

  /**
   * Nothing outstanding means nothing to state. Showing a bare "0" the IM cannot act on is worse
   * than leaving the ordinary field, which at least explains itself.
   */
  it('keeps the ordinary field when there is nothing left owing', () => {
    renderReceiptDialog(funding({ funded: 18_000, outstanding: 0, isFullyFunded: true }));

    expect(screen.getByRole('spinbutton', { name: new RegExp(t.funds.amount) })).toBeInTheDocument();
  });
});
