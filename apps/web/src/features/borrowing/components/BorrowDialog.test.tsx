import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Placement, ProductDetail } from '@ims/shared';
import { t } from '@/i18n/en';
import { BorrowDialog } from './BorrowDialog';

/**
 * A general user asking to borrow something.
 *
 * The case under test is inline project creation, which had no coverage: the select carries a
 * `__new__` sentinel, but `projectId` on the wire is `uuid().nullable()`, so the sentinel was
 * failing validation and `handleSubmit` never reached the submit handler. The button appeared
 * to do nothing at all.
 */

const createBorrowSpy = vi.fn();
const createProjectSpy = vi.fn();

const EXISTING_PROJECT = '55555555-5555-4555-8555-555555555555';
const NEW_PROJECT_ID = '66666666-6666-4666-8666-666666666666';

vi.mock('../api', () => ({
  useCreateBorrow: () => ({
    mutateAsync: (input: unknown) => {
      createBorrowSpy(input);
      return Promise.resolve({});
    },
    isPending: false,
  }),
}));

vi.mock('@/features/projects/api', () => ({
  useSelectableProjects: () => ({ data: [{ id: EXISTING_PROJECT, name: 'Rooftop solar' }] }),
  useCreateProject: () => ({
    mutateAsync: (input: unknown) => {
      createProjectSpy(input);
      return Promise.resolve({ id: NEW_PROJECT_ID });
    },
    isPending: false,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function placement(): Placement {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    compartmentId: '22222222-2222-4222-8222-222222222222',
    compartmentCode: '1A',
    zoneId: '88888888-8888-4888-8888-888888888888',
    zoneName: 'Meta',
    roomId: '99999999-9999-4999-8999-999999999999',
    roomName: 'Main Store',
    quantity: 7,
    reservedQty: 0,
    quarantinedQty: 0,
    availableQty: 7,
    version: 1,
  };
}

function product(): ProductDetail {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    productCode: 'LEN-0001',
    name: 'Lenovo ThinkPad T14',
    categoryId: null,
    categoryName: null,
    isTrackable: true,
    unit: 'pcs',
    defaultReturnable: true,
    description: null,
    isActive: true,
    totalQuantity: 7,
    totalReserved: 0,
    totalAvailable: 7,
    totalOnHand: 7,
    totalQuarantined: 0,
    totalInUse: 0,
    totalOwned: 7,
    createdAt: '2026-09-01T00:00:00.000Z',
    placements: [placement()],
    activeBorrows: [],
  };
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BorrowDialog open onClose={() => undefined} product={product()} />
    </QueryClientProvider>,
  );
}

/** Everything the schema insists on before it will look at the project field. */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(new RegExp(t.borrowing.quantity)), '2');
  await user.type(screen.getByLabelText(new RegExp(t.borrowing.expectedReturn)), '2026-12-31');
}

describe('BorrowDialog', () => {
  beforeEach(() => {
    createBorrowSpy.mockClear();
    createProjectSpy.mockClear();
  });

  it('sends an existing project straight through', async () => {
    const user = userEvent.setup();
    renderDialog();

    await fillRequired(user);
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t.borrowing.project}`)),
      EXISTING_PROJECT,
    );
    await user.click(screen.getByRole('button', { name: t.borrowing.borrow }));

    await waitFor(() =>
      expect(createBorrowSpy).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: EXISTING_PROJECT }),
      ),
    );
  });

  it('creates a project inline and requests against the new one', async () => {
    const user = userEvent.setup();
    renderDialog();

    await fillRequired(user);
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t.borrowing.project}`)),
      '__new__',
    );
    await user.type(
      screen.getByLabelText(new RegExp(t.borrowing.projectName)),
      'Warehouse retrofit',
    );
    await user.click(screen.getByRole('button', { name: t.borrowing.borrow }));

    await waitFor(() =>
      expect(createProjectSpy).toHaveBeenCalledWith({
        name: 'Warehouse retrofit',
        allowDuplicateName: false,
      }),
    );
    // The id the API handed back, never the `__new__` sentinel.
    expect(createBorrowSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: NEW_PROJECT_ID }),
    );
  });
});
