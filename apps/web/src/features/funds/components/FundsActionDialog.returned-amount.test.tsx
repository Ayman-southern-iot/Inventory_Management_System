import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// The dialog only needs its mutation hooks stubbed: nothing here exercises the network,
// and a live react-query client would drag the whole provider tree in for one input's value.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSendToAccounts: vi.fn(),
    useRecordReceipt: vi.fn(),
    useRecordPurchase: vi.fn(),
    useVerifyPurchase: vi.fn(),
    useUnverifyPurchase: vi.fn(),
    // Phase 08 added three reversal hooks to this dialog. They go through useQueryClient like
    // the rest, so leaving them live would need the provider this file deliberately avoids.
    useUndoSendToAccounts: vi.fn(),
    useVoidReceipt: vi.fn(),
    useVoidPurchase: vi.fn(),
    useAttachInvoice: vi.fn(),
  };
});

const NOW = '2026-08-12T12:00:00.000Z';

function funding(overrides: Partial<RequisitionFunding> = {}): RequisitionFunding {
  return {
    requisitionId: 'req-1',
    requestedAmount: 4178,
    approvedAmount: 3000,
    funded: 3000,
    spent: 2500,
    transportation: 200,
    spentInclTransportation: 2700,
    returned: 0,
    netFunded: 3000,
    outstanding: 0,
    unspent: 300,
    allowsPartialFunding: false,
    isFullyFunded: true,
    receipts: [],
    purchases: [],
    returns: [],
    ...overrides,
  };
}

function detail(): RequisitionDetail {
  return {
    id: 'req-1',
    requisitionNo: 'REQ-000018',
    requesterId: 'requester',
    requesterName: 'Gina General',
    departmentId: null,
    departmentName: null,
    projectId: null,
    projectName: null,
    urgency: RequisitionUrgency.NORMAL,
    approvalDeadline: null,
    reason: null,
    requestedAmount: 4178,
    provisionalAmount: 4178,
    approvedAmount: 3000,
    requiredApproverCount: 1,
    thresholdAtSubmit: 2500,
    status: RequisitionStatus.PURCHASED,
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
    transportationCost: 200,
    transportationDescription: 'Van hire',
    requiresRevisionTag: false,
    revisedAfterSendBack: false,
    fundingSnapshots: [],
  };
}

function renderVerifyDialog(fundingProp: RequisitionFunding | null) {
  const verify = vi.fn().mockResolvedValue({});

  const idle = { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false };
  vi.mocked(fundsApi.useSendToAccounts).mockReturnValue(
    idle as unknown as ReturnType<typeof fundsApi.useSendToAccounts>,
  );
  vi.mocked(fundsApi.useRecordReceipt).mockReturnValue(
    idle as unknown as ReturnType<typeof fundsApi.useRecordReceipt>,
  );
  vi.mocked(fundsApi.useRecordPurchase).mockReturnValue(
    idle as unknown as ReturnType<typeof fundsApi.useRecordPurchase>,
  );
  vi.mocked(fundsApi.useUnverifyPurchase).mockReturnValue(
    idle as unknown as ReturnType<typeof fundsApi.useUnverifyPurchase>,
  );
  vi.mocked(fundsApi.useUndoSendToAccounts).mockReturnValue(
    idle as unknown as ReturnType<typeof fundsApi.useUndoSendToAccounts>,
  );
  vi.mocked(fundsApi.useVoidReceipt).mockReturnValue(
    idle as unknown as ReturnType<typeof fundsApi.useVoidReceipt>,
  );
  vi.mocked(fundsApi.useVoidPurchase).mockReturnValue(
    idle as unknown as ReturnType<typeof fundsApi.useVoidPurchase>,
  );
  vi.mocked(fundsApi.useAttachInvoice).mockReturnValue(
    idle as unknown as ReturnType<typeof fundsApi.useAttachInvoice>,
  );
  vi.mocked(fundsApi.useVerifyPurchase).mockReturnValue({
    mutateAsync: verify,
    isPending: false,
  } as unknown as ReturnType<typeof fundsApi.useVerifyPurchase>);

  render(
    <ToastProvider>
      <FundsActionDialog
        action="verify"
        requisition={detail()}
        funding={fundingProp}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  );

  return { verify };
}

/**
 * QA round 1, item 5c. The dialog printed the unspent balance one line above a field that
 * was hard-defaulted to '0', so the IM read "Unspent: BDT 300" and then typed 300 by hand —
 * and the one time they forgot, the money silently stayed out of Accounts' books.
 */
describe('FundsActionDialog — verify: returned amount default', () => {
  it('defaults the returned amount to the unspent balance, not zero', () => {
    renderVerifyDialog(funding({ unspent: 300 }));

    expect(screen.getByRole('spinbutton', { name: t.funds.returnedAmount })).toHaveValue(300);
  });

  it('defaults to zero when nothing is unspent', () => {
    renderVerifyDialog(funding({ unspent: 0 }));

    expect(screen.getByRole('spinbutton', { name: t.funds.returnedAmount })).toHaveValue(0);
  });

  it('submits the unspent balance when the IM does not touch the field', async () => {
    const user = userEvent.setup();
    const { verify } = renderVerifyDialog(funding({ unspent: 300 }));

    // The note is mandatory server-side whenever money goes back, and the prefill is what
    // makes that the default path — so the happy path types one.
    await user.type(screen.getByRole('textbox', { name: t.funds.returnNote }), 'Bought under budget');
    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(verify).toHaveBeenCalledWith({
      returnedAmount: 300,
      returnNote: 'Bought under budget',
    });
  });
});
