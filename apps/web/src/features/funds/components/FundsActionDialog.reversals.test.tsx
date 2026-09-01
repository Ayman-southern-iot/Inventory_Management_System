import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { FundsActionDialog, type FundsAction } from './FundsActionDialog';

/**
 * The Back button's dialog.
 *
 * Two things matter here and neither is "the button submits". A void is destructive-looking and
 * irreversible in the IM's head, so:
 *
 *  - it must **name the entry** it is about to undo. "Back" above a list of three receipts does
 *    not say which one disappears, and the wrong instalment is a silent money error.
 *  - it must **have a reason** before it can be sent. The schema requires one, so a Save that
 *    round-trips to a 400 is a worse version of a disabled button.
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

const NOW = '2026-08-12T12:00:00.000Z';

function funding(overrides: Partial<RequisitionFunding> = {}): RequisitionFunding {
  return {
    requisitionId: 'req-1',
    requestedAmount: 6000,
    approvedAmount: 6000,
    funded: 6000,
    spent: 0,
    transportation: 0,
    spentInclTransportation: 0,
    returned: 0,
    netFunded: 6000,
    outstanding: 0,
    unspent: 6000,
    isFullyFunded: true,
    receipts: [],
    purchases: [],
    returns: [],
    ...overrides,
  };
}

function receipt(id: string, amount: number, receivedAt: string) {
  return {
    id,
    requisitionId: 'req-1',
    amount,
    receivedAt,
    reference: null,
    note: null,
    recordedByName: 'Ina Manager',
    createdAt: receivedAt,
  };
}

function purchase(id: string, vendor: string, totalAmount: number) {
  return {
    id,
    requisitionId: 'req-1',
    vendor,
    invoiceNo: null,
    purchasedAt: NOW,
    totalAmount,
    // The carriage recorded with this delivery (migration 0029).
    transportationCost: 0,
    note: null,
    recordedByName: 'Ina Manager',
    createdAt: NOW,
    hasInvoice: false,
    invoiceUploadedAt: null,
    lines: [],
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
    requestedAmount: 6000,
    provisionalAmount: 6000,
    approvedAmount: 6000,
    requiredApproverCount: 1,
    thresholdAtSubmit: 2500,
    status: RequisitionStatus.FUNDS_RECEIVED,
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

/** Every mutation hook stubbed; the returned spies are what the assertions read. */
function stubHooks() {
  const spies = {
    undoSend: vi.fn().mockResolvedValue({}),
    voidReceipt: vi.fn().mockResolvedValue({}),
    voidPurchase: vi.fn().mockResolvedValue({}),
  };
  const idle = (mutateAsync: unknown) =>
    ({ mutateAsync, isPending: false }) as unknown as ReturnType<typeof fundsApi.useVoidReceipt>;

  vi.mocked(fundsApi.useSendToAccounts).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useRecordReceipt).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useRecordPurchase).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useVerifyPurchase).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useUnverifyPurchase).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useAttachInvoice).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useUndoSendToAccounts).mockReturnValue(idle(spies.undoSend) as never);
  vi.mocked(fundsApi.useVoidReceipt).mockReturnValue(idle(spies.voidReceipt) as never);
  vi.mocked(fundsApi.useVoidPurchase).mockReturnValue(idle(spies.voidPurchase) as never);
  return spies;
}

function renderDialog(action: FundsAction, fundingData: RequisitionFunding) {
  const spies = stubHooks();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <FundsActionDialog
          action={action}
          requisition={detail()}
          funding={fundingData}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return spies;
}

const saveButton = () => screen.getByRole('button', { name: t.common.save });

describe('the Back dialog', () => {
  it('will not send a reversal until a reason is given', async () => {
    const user = userEvent.setup();
    renderDialog('void-receipt', funding({ receipts: [receipt('r-1', 6000, NOW)] }));

    expect(saveButton()).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: t.funds.voidReceiptReason }), 'Accounts reversed it');
    expect(saveButton()).toBeEnabled();
  });

  /**
   * The instalment case. Three receipts, and the one that goes is the newest — so the hint has to
   * say which, or the IM is guessing.
   */
  it('names the amount and date of the receipt it will void', () => {
    renderDialog(
      'void-receipt',
      funding({
        receipts: [
          receipt('r-1', 2000, '2026-08-01T10:00:00.000Z'),
          receipt('r-2', 4000, '2026-08-10T10:00:00.000Z'),
        ],
      }),
    );

    // 4,000 is the most recent; 2,000 must not be named.
    expect(screen.getByText(/4,000/)).toBeInTheDocument();
    expect(screen.queryByText(/2,000/)).toBeNull();
  });

  it('voids that same receipt, not the first one in the list', async () => {
    const user = userEvent.setup();
    const spies = renderDialog(
      'void-receipt',
      funding({
        receipts: [
          receipt('r-old', 2000, '2026-08-01T10:00:00.000Z'),
          receipt('r-new', 4000, '2026-08-10T10:00:00.000Z'),
        ],
      }),
    );

    await user.type(screen.getByRole('textbox', { name: t.funds.voidReceiptReason }), 'Duplicate');
    await user.click(saveButton());

    expect(spies.voidReceipt).toHaveBeenCalledWith({
      receiptId: 'r-new',
      reason: 'Duplicate',
    });
  });

  it('names the vendor of the purchase it will void', () => {
    renderDialog(
      'void-purchase',
      funding({
        purchases: [purchase('p-1', 'Vendor A', 2000), purchase('p-2', 'Vendor B', 1500)],
      }),
    );

    expect(screen.getByText(/Vendor B/)).toBeInTheDocument();
  });

  it('sends the reason with an undo-send', async () => {
    const user = userEvent.setup();
    const spies = renderDialog('undo-send', funding());

    await user.type(screen.getByRole('textbox', { name: t.funds.undoSendReason }), 'Wrong BOM');
    await user.click(saveButton());

    expect(spies.undoSend).toHaveBeenCalledWith({ reason: 'Wrong BOM' });
  });

  /**
   * The invoice moved here from the funding panel's purchase list. Verification refuses without
   * one (`INVOICE_MISSING`), so the IM was being turned away by a form that could not fix the
   * problem it was complaining about.
   */
  it('offers an invoice control for every purchase inside the verify form', () => {
    renderDialog(
      'verify',
      funding({
        purchases: [purchase('p-1', 'Vendor A', 2000), purchase('p-2', 'Vendor B', 1500)],
      }),
    );

    expect(
      screen.getAllByRole('button', { name: new RegExp(t.funds.attachInvoice, 'i') }),
    ).toHaveLength(2);
    expect(screen.getAllByText(t.funds.invoiceMissing)).toHaveLength(2);
  });
});
