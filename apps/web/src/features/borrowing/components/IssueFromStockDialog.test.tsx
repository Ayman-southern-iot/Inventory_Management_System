import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Placement, ProductDetail } from '@ims/shared';
import { t } from '@/i18n/en';
import { IssueFromStockDialog } from './IssueFromStockDialog';

/**
 * The Issue-from-stock form after the 2026-09-21 redesign.
 *
 * Three things here are worth a test because getting them wrong is silent. "Take all" and
 * "N left after this" are the IM's read on what the shelf looks like afterwards, and a stock
 * movement is not undoable without a compensating entry. The project field is Ayman's addition
 * — the borrow form carries one for any general user, so issuing on their behalf must too, or
 * the project's item list quietly loses a row.
 */

const issueSpy = vi.fn();
const createProjectSpy = vi.fn();

const ALICE = '11111111-1111-4111-8111-111111111111';
const BIN_A = '22222222-2222-4222-8222-222222222222';
const BIN_B = '33333333-3333-4333-8333-333333333333';

vi.mock('../api', () => ({
  useIssueFromStock: () => ({
    mutateAsync: (input: unknown) => {
      issueSpy(input);
      return Promise.resolve({});
    },
    isPending: false,
  }),
}));

vi.mock('@/features/users/api', () => ({
  useSelectableUsers: () => ({
    data: {
      items: [
        { id: ALICE, fullName: 'Alice Asker', designation: 'Engineer' },
        {
          id: '44444444-4444-4444-8444-444444444444',
          fullName: 'Bob Holder',
          designation: 'Technician',
        },
      ],
      page: 1,
      limit: 50,
      total: 2,
    },
  }),
}));

vi.mock('@/features/projects/api', () => ({
  useSelectableProjects: () => ({
    data: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Rooftop solar' }],
  }),
  useCreateProject: () => ({
    mutateAsync: (input: unknown) => {
      createProjectSpy(input);
      return Promise.resolve({ id: '66666666-6666-4666-8666-666666666666' });
    },
    isPending: false,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    compartmentId: BIN_A,
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
    ...overrides,
  };
}

function product(placements: Placement[] = [placement()]): ProductDetail {
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
    placements,
    activeBorrows: [],
  };
}

function renderDialog(value: ProductDetail = product()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IssueFromStockDialog open onClose={() => undefined} product={value} />
    </QueryClientProvider>,
  );
}

/** Open the picker, click a name. The trigger is a combobox, the options are a portalled list. */
async function pickPerson(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: new RegExp(t.borrowing.issueTo) }));
  await user.click(screen.getByRole('option', { name: new RegExp(name) }));
}

/**
 * A returnable issue is rejected by the schema without a date (`refineReturnDate`), so every
 * submit test has to answer it — the quick button is the shortest way there.
 */
async function fillReturnDate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: t.borrowing.plusWeek }));
}

describe('IssueFromStockDialog', () => {
  beforeEach(() => {
    issueSpy.mockClear();
    createProjectSpy.mockClear();
  });

  it('offers only shelves with something available', () => {
    renderDialog(
      product([
        placement(),
        placement({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          compartmentId: BIN_B,
          compartmentCode: '2B',
          quantity: 3,
          reservedQty: 3,
          availableQty: 0,
        }),
      ]),
    );

    const bin = screen.getByLabelText(new RegExp(t.borrowing.fromBin));
    const codes = Array.from(bin.querySelectorAll('option')).map((o) => o.textContent);
    expect(codes.some((c) => c?.includes('1A'))).toBe(true);
    // Every unit on 2B is already spoken for; offering it is offering a choice that can only 409.
    expect(codes.some((c) => c?.includes('2B'))).toBe(false);
  });

  it('fills the quantity from Take all and says nothing is left', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: t.borrowing.takeAll }));

    expect(screen.getByLabelText(new RegExp(t.borrowing.quantity))).toHaveValue(7);
    expect(
      screen.getByText(t.borrowing.leftAfterThis.replace('{n}', '0')),
    ).toBeInTheDocument();
  });

  /** The number the IM is really deciding: what the shelf looks like afterwards. */
  it('counts down what is left as the quantity is typed', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(new RegExp(t.borrowing.quantity)), '2');

    await waitFor(() =>
      expect(screen.getByText(t.borrowing.leftAfterThis.replace('{n}', '5'))).toBeInTheDocument(),
    );
  });

  it('sets a return date a week out from the quick button', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: t.borrowing.plusWeek }));

    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    expect(screen.getByLabelText(new RegExp(t.borrowing.returnDate))).toHaveValue(
      expected.toISOString().slice(0, 10),
    );
  });

  /** A consumable never comes back, so a stale date must not ride along on the request. */
  it('drops the return date when the item is not coming back', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: t.borrowing.plusWeek }));
    await user.click(screen.getByLabelText(t.borrowing.expectedBack));

    expect(
      screen.queryByLabelText(new RegExp(t.borrowing.returnDate)),
    ).not.toBeInTheDocument();

    await pickPerson(user, 'Alice Asker');
    await user.click(screen.getByRole('button', { name: t.borrowing.takeAll }));
    await user.click(screen.getByRole('button', { name: t.borrowing.issueFromStock }));

    await waitFor(() =>
      expect(issueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isReturnable: false, expectedReturnDate: null }),
      ),
    );
  });

  it('issues to the chosen person from the chosen shelf', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickPerson(user, 'Alice Asker');
    await user.type(screen.getByLabelText(new RegExp(t.borrowing.quantity)), '2');
    await fillReturnDate(user);
    await user.click(screen.getByRole('button', { name: t.borrowing.issueFromStock }));

    await waitFor(() =>
      expect(issueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ borrowerId: ALICE, compartmentId: BIN_A, quantity: 2 }),
      ),
    );
  });

  /** Ayman's addition: the borrow form carries a project, so issuing on someone's behalf must. */
  it('carries an existing project through to the request', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickPerson(user, 'Alice Asker');
    await user.type(screen.getByLabelText(new RegExp(t.borrowing.quantity)), '1');
    await fillReturnDate(user);
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t.borrowing.project}`)),
      '55555555-5555-4555-8555-555555555555',
    );
    await user.click(screen.getByRole('button', { name: t.borrowing.issueFromStock }));

    await waitFor(() =>
      expect(issueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: '55555555-5555-4555-8555-555555555555' }),
      ),
    );
  });

  it('creates a project inline and issues against the new one', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickPerson(user, 'Alice Asker');
    await user.type(screen.getByLabelText(new RegExp(t.borrowing.quantity)), '1');
    await fillReturnDate(user);
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t.borrowing.project}`)),
      '__new__',
    );
    await user.type(
      screen.getByLabelText(new RegExp(t.borrowing.projectName)),
      'Warehouse retrofit',
    );
    await user.click(screen.getByRole('button', { name: t.borrowing.issueFromStock }));

    await waitFor(() =>
      expect(createProjectSpy).toHaveBeenCalledWith({
        name: 'Warehouse retrofit',
        allowDuplicateName: false,
      }),
    );
    // The id the API handed back, not the `__new__` sentinel.
    expect(issueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: '66666666-6666-4666-8666-666666666666' }),
    );
  });

  it('spells out the sentence it is about to commit', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickPerson(user, 'Alice Asker');
    await user.type(screen.getByLabelText(new RegExp(t.borrowing.quantity)), '2');

    await waitFor(() =>
      expect(
        screen.getByText(
          new RegExp(
            t.borrowing.issueSummary
              .replace('{qty}', '2')
              .replace('{unit}', 'pcs')
              .replace('{from}', 'Main Store / Meta / 1A')
              .replace('{to}', 'Alice Asker'),
          ),
        ),
      ).toBeInTheDocument(),
    );
  });

  it('says so rather than offering a form when every shelf is empty', () => {
    renderDialog(product([placement({ quantity: 0, availableQty: 0 })]));

    expect(screen.getByText(t.inventory.nothingToMove)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.borrowing.issueFromStock })).toBeDisabled();
  });
});
