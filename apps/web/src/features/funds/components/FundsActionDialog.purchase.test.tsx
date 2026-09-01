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
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import * as fundsApi from '../api';
import { FundsActionDialog } from './FundsActionDialog';

/**
 * Recording a purchase, and the box the IM missed.
 *
 * Leaving a unit cost blank produced "Array must contain at least 1 element(s)". The payload
 * filtered lines to those with a cost above zero, so a blank one made `lines` empty and the only
 * complaint that surfaced was zod describing the array — a shape, not a field. The IM is told
 * which line is missing now, on the line.
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
    useAttachInvoice: vi.fn(),
    useUndoSendToAccounts: vi.fn(),
    useVoidReceipt: vi.fn(),
    useVoidPurchase: vi.fn(),
  };
});

const NOW = '2026-08-31T10:00:00.000Z';

function detail(): RequisitionDetail {
  return {
    id: 'req-1',
    requisitionNo: 'REQ-000014-GINA',
    requesterId: 'requester',
    requesterName: 'Gina General',
    departmentId: null,
    departmentName: null,
    projectId: null,
    projectName: null,
    urgency: RequisitionUrgency.NORMAL,
    approvalDeadline: null,
    reason: null,
    requestedAmount: 40_500,
    provisionalAmount: 40_500,
    approvedAmount: 40_500,
    requiredApproverCount: 2,
    thresholdAtSubmit: 15_000,
    status: RequisitionStatus.FUNDS_RECEIVED,
    submittedAt: NOW,
    decidedAt: NOW,
    isOverdue: false,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: 'item-1',
        productId: null,
        productName: null,
        productCode: null,
        itemName: 'tt',
        quantity: 200,
        estimatedUnitPrice: 200,
        estimatedLineTotal: 40_000,
        note: null,
        inStockQtyAtSubmit: null,
      },
    ],
    approvals: [],
    events: [],
    supportingDocument: null,
    supportingDocumentUrl: null,
    transportationCost: 500,
    transportationDescription: 'tt',
    requiresRevisionTag: false,
    revisedAfterSendBack: false,
    fundingSnapshots: [],
  } as unknown as RequisitionDetail;
}

function funding(): RequisitionFunding {
  return {
    requisitionId: 'req-1',
    requestedAmount: 40_500,
    approvedAmount: 40_500,
    funded: 40_500,
    spent: 0,
    transportation: 0,
    spentInclTransportation: 0,
    returned: 0,
    netFunded: 40_500,
    outstanding: 0,
    unspent: 40_500,
    isFullyFunded: true,
    receipts: [],
    purchases: [],
    returns: [],
  } as unknown as RequisitionFunding;
}

function renderPurchase() {
  const recordPurchase = vi.fn().mockResolvedValue({});
  const idle = (mutateAsync: unknown) =>
    ({ mutateAsync, isPending: false }) as unknown as ReturnType<typeof fundsApi.useRecordPurchase>;

  vi.mocked(fundsApi.useSendToAccounts).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useRecordReceipt).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useRecordPurchase).mockReturnValue(idle(recordPurchase) as never);
  vi.mocked(fundsApi.useVerifyPurchase).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useUnverifyPurchase).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useAttachInvoice).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useUndoSendToAccounts).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useVoidReceipt).mockReturnValue(idle(vi.fn()) as never);
  vi.mocked(fundsApi.useVoidPurchase).mockReturnValue(idle(vi.fn()) as never);

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <ToastProvider>
        <FundsActionDialog
          action="purchase"
          requisition={detail()}
          funding={funding()}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { recordPurchase };
}

describe('recording a purchase', () => {
  it('marks the line whose unit cost is missing, rather than describing the array', async () => {
    const user = userEvent.setup();
    const { recordPurchase } = renderPurchase();

    await user.type(screen.getByRole('textbox', { name: t.funds.vendor }), 'Techshop BD');
    // The form opens on the agreed unit cost, so an empty line is one the IM cleared.
    await user.clear(screen.getByRole('spinbutton', { name: t.funds.unitCost }));
    await user.click(screen.getByRole('button', { name: t.common.save }));

    // On the field, and the request never left — reaching the API is what produced the
    // unreadable array error in the first place.
    expect(await screen.findByText(t.requisitions.fieldRequired)).toBeInTheDocument();
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it('refuses a unit cost of zero, and says why rather than silently dropping the line', async () => {
    const user = userEvent.setup();
    const { recordPurchase } = renderPurchase();

    await user.type(screen.getByRole('textbox', { name: t.funds.vendor }), 'Techshop BD');
    const cost = screen.getByRole('spinbutton', { name: t.funds.unitCost });
    await user.clear(cost);
    await user.type(cost, '0');
    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(await screen.findByText(t.funds.unitCostPositive)).toBeInTheDocument();
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  /**
   * Asserted on the input rather than the message: an empty submit marks the vendor and the
   * date too, so "Required." is on the page three times and matching it by text proves nothing
   * about the line. `aria-invalid` is per control.
   */
  it('clears the mark on a line as soon as it is answered', async () => {
    const user = userEvent.setup();
    renderPurchase();

    const line = screen.getByRole('spinbutton', { name: t.funds.unitCost });
    await user.clear(line);
    await user.click(screen.getByRole('button', { name: t.common.save }));
    expect(line).toHaveAttribute('aria-invalid', 'true');

    await user.type(line, '150');

    expect(line).not.toHaveAttribute('aria-invalid');
  });

  /**
   * The form opens on the figures already agreed — the BOM unit cost where a BOM exists, the
   * requester's estimate otherwise. Typing every price again from blank is what made a missed
   * box so easy, and empty boxes tell the IM nothing about what was planned.
   */
  it('opens on the agreed unit cost rather than empty boxes', () => {
    renderPurchase();

    expect(screen.getByRole('spinbutton', { name: t.funds.unitCost })).toHaveValue(200);
  });

  /**
   * Buying fewer than planned is normal — the shop had six of the ten. The quantity used to be
   * fixed at whatever the BOM said, so the IM had to overstate the purchase and correct it
   * later, or not record it at all.
   */
  it('sends the quantity the IM actually bought, not the one that was planned', async () => {
    const user = userEvent.setup();
    const { recordPurchase } = renderPurchase();

    await user.type(screen.getByRole('textbox', { name: t.funds.vendor }), 'Techshop BD');
    const qty = screen.getByRole('spinbutton', { name: t.funds.quantity });
    await user.clear(qty);
    await user.type(qty, '50');
    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ quantity: 50, unitCost: 200 })],
      }),
    );
  });

  /**
   * The carriage is adjustable and pre-filled from what was planned, so the IM edits a figure
   * rather than remembering one. It counts towards the funded ceiling, which is why 50 × 200
   * plus 500 fits inside 40,500 and the same purchase at the full quantity would not.
   */
  it('opens on the planned carriage and sends what the IM leaves there', async () => {
    const user = userEvent.setup();
    const { recordPurchase } = renderPurchase();

    const carriage = screen.getByRole('spinbutton', { name: t.funds.transportationActual });
    expect(carriage).toHaveValue(500);

    await user.type(screen.getByRole('textbox', { name: t.funds.vendor }), 'Techshop BD');
    await user.clear(carriage);
    await user.type(carriage, '650');
    const qty = screen.getByRole('spinbutton', { name: t.funds.quantity });
    await user.clear(qty);
    await user.type(qty, '50');
    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(recordPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ transportationCost: 650 }),
    );
  });

  /** The ceiling is what has been funded, and the carriage counts towards it. */
  it('refuses a purchase that would spend more than has been funded', async () => {
    const user = userEvent.setup();
    const { recordPurchase } = renderPurchase();

    await user.type(screen.getByRole('textbox', { name: t.funds.vendor }), 'Techshop BD');
    const cost = screen.getByRole('spinbutton', { name: t.funds.unitCost });
    await user.clear(cost);
    // 200 units at 300 is 60,000 — the figure from the report, against 40,500 funded.
    await user.type(cost, '300');
    await user.click(screen.getByRole('button', { name: t.common.save }));

    expect(recordPurchase).not.toHaveBeenCalled();
  });

  /**
   * "Left to spend" is what is left **after** this purchase.
   *
   * It used to be what was available *before* it, printed beside the committed total — so on a
   * fresh requisition both numbers read the same and the pair said nothing. The fixture funds
   * 40,500; 200 units at 200 is 40,000 and the van is 500, so there is exactly nothing left.
   */
  it('shows nothing left when the purchase spends the whole grant', async () => {
    renderPurchase();

    const rows = screen.getByText(t.funds.leftToSpend).closest('div')!;
    expect(rows.querySelector('dd')?.textContent).toBe('0');
  });

  it('turns the figure negative and refuses to send once it is', async () => {
    const user = userEvent.setup();
    const { recordPurchase } = renderPurchase();

    await user.type(screen.getByRole('textbox', { name: t.funds.vendor }), 'Techshop BD');
    const carriageField = screen.getByRole('spinbutton', { name: t.funds.transportationActual });
    await user.clear(carriageField);
    // One taka more carriage than the grant can cover.
    await user.type(carriageField, '501');

    expect(screen.getByText(t.funds.overspendInline)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.common.save }));
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  /** Lowering the quantity puts it back inside the grant, and the figure follows. */
  it('recomputes as the quantity changes', async () => {
    const user = userEvent.setup();
    renderPurchase();

    const qty = screen.getByRole('spinbutton', { name: t.funds.quantity });
    await user.clear(qty);
    await user.type(qty, '100');

    // 100 × 200 = 20,000 of goods plus the 500 van, against 40,500 funded.
    const rows = screen.getByText(t.funds.leftToSpend).closest('div')!;
    expect(rows.querySelector('dd')?.textContent).toBe('20,000');
  });
});
