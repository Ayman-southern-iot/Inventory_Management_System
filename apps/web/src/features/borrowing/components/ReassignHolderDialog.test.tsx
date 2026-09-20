import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BorrowStatus, type AssignHolderInput, type BorrowRequest } from '@ims/shared';
import { t } from '@/i18n/en';
import { ReassignHolderDialog } from './ReassignHolderDialog';

const assignSpy = vi.fn();
const toastSpy = vi.fn();

vi.mock('../api', () => ({
  useAssignHolder: () => ({
    mutateAsync: (input: { id: string; input: AssignHolderInput }) => {
      assignSpy(input);
      return Promise.resolve({} as BorrowRequest);
    },
    isPending: false,
  }),
}));

vi.mock('@/features/users/api', () => ({
  useSelectableUsers: () => ({
    data: {
      items: [
        { id: '11111111-1111-4111-8111-111111111111', fullName: 'Alice Asker', designation: 'Engineer' },
        { id: '22222222-2222-4222-8222-222222222222', fullName: 'Bob Holder', designation: 'Technician' },
      ],
      page: 1,
      limit: 50,
      total: 2,
    },
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    success: (m: string) => toastSpy(m),
    error: (m: string) => toastSpy(m),
  }),
}));

/** Issued to Alice, who still holds it — the ordinary starting state. */
function borrow(overrides: Partial<BorrowRequest> = {}): BorrowRequest {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    borrowNo: 'BR-000042',
    requesterId: '11111111-1111-4111-8111-111111111111',
    requesterName: 'Alice Asker',
    currentHolderId: '11111111-1111-4111-8111-111111111111',
    currentHolderName: 'Alice Asker',
    productId: '44444444-4444-4444-8444-444444444444',
    productName: 'Oscilloscope',
    productCode: 'OSC-0001',
    unit: 'pcs',
    compartmentId: '55555555-5555-4555-8555-555555555555',
    location: 'Zone A / A1',
    quantity: 5,
    returnedQty: 0,
    outstandingQty: 5,
    projectId: null,
    projectName: null,
    isReturnable: true,
    expectedReturnDate: '2026-12-31',
    purpose: 'Field testing',
    status: BorrowStatus.ISSUED,
    decidedByName: 'Imran Manager',
    decisionNote: null,
    decidedAt: '2026-09-01T00:00:00.000Z',
    issuedAt: '2026-09-01T00:00:00.000Z',
    returnedAt: null,
    isOverdue: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderDialog(value: BorrowRequest | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReassignHolderDialog borrow={value} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('ReassignHolderDialog', () => {
  beforeEach(() => {
    assignSpy.mockClear();
    toastSpy.mockClear();
  });

  it('names who currently holds it, so the IM is not reassigning blind', () => {
    renderDialog(borrow({ currentHolderId: '22222222-2222-4222-8222-222222222222', currentHolderName: 'Bob Holder' }));
    expect(screen.getByText(/Bob Holder/)).toBeInTheDocument();
  });

  /**
   * The sentence that stops an IM reaching for "record a return, then issue it again", which
   * is what they did before this dialog existed and which writes two movements to the ledger
   * that never physically happened.
   */
  it('says plainly that no stock moves', () => {
    renderDialog(borrow());
    expect(screen.getByText(t.borrowing.reassignNoStockHint)).toBeInTheDocument();
  });

  it('leaves the current holder out of the list of candidates', () => {
    renderDialog(borrow());
    const picker = screen.getByLabelText(new RegExp(t.borrowing.reassignHolder));
    const values = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent);
    expect(values.some((v) => v?.includes('Bob Holder'))).toBe(true);
    // Alice already has it; offering her is offering a choice that can only 409.
    expect(values.some((v) => v?.includes('Alice Asker'))).toBe(false);
  });

  it('submits the new holder and the reason', async () => {
    const user = userEvent.setup();
    renderDialog(borrow());

    await user.selectOptions(screen.getByLabelText(new RegExp(t.borrowing.reassignHolder)), '22222222-2222-4222-8222-222222222222');
    await user.type(
      screen.getByLabelText(new RegExp(t.borrowing.reassignReason)),
      'Alice handed it over before leave',
    );
    await user.click(screen.getByRole('button', { name: t.borrowing.reassign }));

    expect(assignSpy).toHaveBeenCalledWith({
      id: '33333333-3333-4333-8333-333333333333',
      input: { holderId: '22222222-2222-4222-8222-222222222222', reason: 'Alice handed it over before leave' },
    });
  });

  /** The reason is required in the database too; the form should not need a round trip to say so. */
  it('refuses to submit without a reason', async () => {
    const user = userEvent.setup();
    renderDialog(borrow());

    await user.selectOptions(screen.getByLabelText(new RegExp(t.borrowing.reassignHolder)), '22222222-2222-4222-8222-222222222222');
    await user.click(screen.getByRole('button', { name: t.borrowing.reassign }));

    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('refuses to submit without a holder', async () => {
    const user = userEvent.setup();
    renderDialog(borrow());

    await user.type(screen.getByLabelText(new RegExp(t.borrowing.reassignReason)), 'Handed over');
    await user.click(screen.getByRole('button', { name: t.borrowing.reassign }));

    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('renders nothing until a borrow is chosen', () => {
    renderDialog(undefined);
    expect(screen.queryByText(t.borrowing.reassignNoStockHint)).not.toBeInTheDocument();
  });
});
