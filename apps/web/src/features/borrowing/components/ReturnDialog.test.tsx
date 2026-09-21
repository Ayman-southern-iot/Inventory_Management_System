import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BorrowStatus, type BorrowRequest } from '@ims/shared';
import { t } from '@/i18n/en';
import { ReturnDialog } from './ReturnDialog';

/**
 * Recording a return.
 *
 * Ayman's ask: the IM should not have to go and look up where the thing came from. The shelf
 * picker has always defaulted to the origin, but nothing on the form said so — three selects
 * reading "Main Store / Meta / 1A" look like an arbitrary starting point, so the IM checks.
 */

const returnSpy = vi.fn();

const ORIGIN = '55555555-5555-4555-8555-555555555555';
const OTHER_SHELF = '66666666-6666-4666-8666-666666666666';

vi.mock('../api', () => ({
  useReturnBorrow: () => ({
    mutateAsync: (input: unknown) => {
      returnSpy(input);
      return Promise.resolve({});
    },
    isPending: false,
  }),
}));

const ZONE = '77777777-7777-4777-8777-777777777777';
const ROOM = '88888888-8888-4888-8888-888888888888';

function compartment(id: string, code: string, seq: string) {
  return {
    id,
    zoneId: ZONE,
    zoneName: 'Meta',
    roomId: ROOM,
    roomName: 'Main Store',
    code,
    storageId: `MAI-MET-${code}-${seq}`,
    isActive: true,
    placementCount: 1,
  };
}

vi.mock('@/features/inventory/api', () => ({
  useZones: () => ({
    data: [
      {
        id: ZONE,
        name: 'Meta',
        roomId: ROOM,
        roomName: 'Main Store',
        isActive: true,
        compartments: [
          compartment(ORIGIN, '1A', '0001'),
          compartment(OTHER_SHELF, '2B', '0002'),
        ],
      },
    ],
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function borrow(overrides: Partial<BorrowRequest> = {}): BorrowRequest {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    borrowNo: 'BR-000004',
    requesterId: '11111111-1111-4111-8111-111111111111',
    requesterName: 'Alice Asker',
    currentHolderId: '11111111-1111-4111-8111-111111111111',
    currentHolderName: 'Alice Asker',
    productId: '44444444-4444-4444-8444-444444444444',
    productName: 'Oscilloscope',
    productCode: 'OSC-0001',
    unit: 'pcs',
    compartmentId: ORIGIN,
    location: 'Main Store / Meta / 1A',
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

// No default parameter: passing `undefined` explicitly would fall back to it and render a
// borrow anyway, which is exactly the case the last test is trying to check.
function renderDialog(value: BorrowRequest | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReturnDialog borrow={value} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('ReturnDialog', () => {
  beforeEach(() => {
    returnSpy.mockClear();
  });

  it('names the shelf the borrow left from', () => {
    renderDialog(borrow());

    expect(screen.getByText(t.borrowing.takenFrom)).toBeInTheDocument();
    expect(screen.getByText('Main Store / Meta / 1A')).toBeInTheDocument();
  });

  /** The origin is only useful if the form says the picker is already on it. */
  it('says the origin is already selected, and offers no undo yet', () => {
    renderDialog(borrow());

    expect(screen.getByText(t.borrowing.takenFromHint)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.borrowing.putItBack }),
    ).not.toBeInTheDocument();
  });

  it('offers to undo a reshelve, and undoes it', async () => {
    const user = userEvent.setup();
    renderDialog(borrow());

    await user.selectOptions(
      screen.getByLabelText(new RegExp(t.inventory.compartment)),
      OTHER_SHELF,
    );
    const undo = await screen.findByRole('button', { name: t.borrowing.putItBack });

    await user.click(undo);

    await waitFor(() =>
      expect(screen.getByLabelText(new RegExp(t.inventory.compartment))).toHaveValue(ORIGIN),
    );
    expect(screen.getByText(t.borrowing.takenFromHint)).toBeInTheDocument();
  });

  /** Reshelving is allowed — the origin is a default, not a constraint. */
  it('returns to a different shelf when the IM picks one', async () => {
    const user = userEvent.setup();
    renderDialog(borrow());

    await user.selectOptions(
      screen.getByLabelText(new RegExp(t.inventory.compartment)),
      OTHER_SHELF,
    );
    await user.click(screen.getByRole('button', { name: t.borrowing.recordReturn }));

    await waitFor(() =>
      expect(returnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ compartmentId: OTHER_SHELF, quantity: 5 }),
        }),
      ),
    );
  });

  it('shows nothing until a borrow is chosen', () => {
    renderDialog(undefined);
    expect(screen.queryByText(t.borrowing.takenFrom)).not.toBeInTheDocument();
  });
});
