import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BorrowStatus, Role, type BorrowRequest } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import { BorrowingPage } from './BorrowingPage';

/**
 * Message audit M6. Rejecting a borrow released the reservation on the first click, with no second
 * look and no way back from the queue. It asks first now; approving is unchanged.
 */
const decide = vi.fn();

const borrow = {
  id: 'b-1',
  borrowNo: 'BR-000001',
  productName: 'Lenovo ThinkPad T14',
  location: 'Main Store / Meta / 1A',
  currentHolderId: 'u-1',
  requesterId: 'u-1',
  currentHolderName: 'Gina General',
  requesterName: 'Gina General',
  quantity: 1,
  unit: 'pcs',
  outstandingQty: 1,
  isReturnable: true,
  expectedReturnDate: '2026-10-11',
  status: BorrowStatus.PENDING,
} as unknown as BorrowRequest;

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useBorrows: () => ({
      data: { items: [borrow], page: 1, limit: 20, total: 1 },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    }),
    useDecideBorrow: () => ({ mutateAsync: decide, isPending: false }),
    useRevertBorrow: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCancelBorrow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('@/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'im-1', roles: [Role.INVENTORY_MANAGER] },
      hasRole: (...roles: string[]) => roles.includes(Role.INVENTORY_MANAGER),
    }),
  };
});

function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BorrowingPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('BorrowingPage reject', () => {
  beforeEach(() => {
    decide.mockReset().mockResolvedValue({});
  });

  it('asks first, and says what rejecting does', async () => {
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.borrowing.reject} BR-000001` }));

    expect(screen.getByRole('dialog', { name: t.borrowing.rejectConfirmTitle })).toBeInTheDocument();
    expect(screen.getByText(t.borrowing.rejectConfirmBody)).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();
  });

  it('rejects once confirmed', async () => {
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.borrowing.reject} BR-000001` }));
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.borrowing.reject}$`) }));

    expect(decide).toHaveBeenCalledWith({ id: 'b-1', input: { approve: false, note: null } });
  });

  it('leaves the request alone when cancelled', async () => {
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.borrowing.reject} BR-000001` }));
    await userEvent.click(screen.getByRole('button', { name: t.common.cancel }));

    expect(decide).not.toHaveBeenCalled();
  });

  it('still approves in one click', async () => {
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.borrowing.approve} BR-000001` }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(decide).toHaveBeenCalledWith({ id: 'b-1', input: { approve: true, note: null } });
  });
});
