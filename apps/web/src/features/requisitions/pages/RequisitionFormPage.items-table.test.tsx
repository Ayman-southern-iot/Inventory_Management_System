import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { RequisitionFormPage } from './RequisitionFormPage';

/**
 * The items section is a real `<table>` with one `<thead>`.
 *
 * It was a twelve-column grid where every cell carried its own `<label>`, blanked on rows after
 * the first. An empty label still occupies a line box, so each row sat a little higher than the
 * one above, the line total and delete button needed `pt-6` nudges to look level, and
 * "Unit price (BDT)" wrapped to two lines and shoved the row apart. Reported as "broken", and it
 * was.
 *
 * These assertions are about structure rather than pixels, because structure is what was wrong:
 * headers appear once, every row has the same cells, and the columns cannot resize themselves as
 * the requester types.
 */

vi.mock('../api', () => ({
  useRequisition: () => ({ data: undefined, isPending: false }),
  useCreateRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApprovalPolicy: () => ({
    data: { expenseThresholdBdt: 15_000, approversBelowThreshold: 1, approversAtOrAboveThreshold: 2 },
    isPending: false,
  }),
  useUploadOrphanSupportingDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadSupportingDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveSupportingDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/admin/api', () => ({
  useDepartments: () => ({ data: { items: [] }, isPending: false }),
}));
vi.mock('@/features/projects/api', () => ({
  useProjects: () => ({ data: [], isPending: false }),
}));
vi.mock('@/features/inventory/api', () => ({
  useAllProducts: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RequisitionFormPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const itemsTable = () => screen.getByRole('table');

describe('the items table', () => {
  it('names its columns once, in a header row', () => {
    renderForm();
    const headers = within(itemsTable()).getAllByRole('columnheader');

    expect(headers.map((header) => header.textContent)).toEqual([
      t.requisitions.itemName,
      t.requisitions.quantity,
      t.requisitions.unitPrice,
      t.requisitions.lineTotal,
      t.requisitions.removeItem,
    ]);
  });

  it('still names each column once after more rows are added', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: t.requisitions.addItem }));
    await user.click(screen.getByRole('button', { name: t.requisitions.addItem }));

    // The defect: three rows used to mean three copies of every label.
    expect(within(itemsTable()).getAllByRole('columnheader')).toHaveLength(5);
    expect(within(itemsTable()).getAllByRole('row')).toHaveLength(4); // header + 3 items
  });

  it('gives every row the same five cells', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: t.requisitions.addItem }));

    const [, firstRow, secondRow] = within(itemsTable()).getAllByRole('row');
    expect(within(firstRow!).getAllByRole('cell')).toHaveLength(5);
    expect(within(secondRow!).getAllByRole('cell')).toHaveLength(5);
  });

  /**
   * Row-scoped accessible names. Three rows of controls all called "Item" is ambiguous to a
   * screen reader and to `getByLabelText`, so each carries its row number.
   */
  it('distinguishes the controls in one row from another', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: t.requisitions.addItem }));

    expect(screen.getByLabelText(`${t.requisitions.itemName} 1`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${t.requisitions.itemName} 2`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${t.requisitions.unitPrice} 2`)).toBeInTheDocument();
  });

  it('fixes its column widths so a long name cannot reflow the header', () => {
    renderForm();
    // `table-fixed` is what stops "Unit price (BDT)" wrapping the moment a long item name lands
    // beside it. Asserted because it is a single class carrying a visible requirement.
    expect(itemsTable().className).toContain('table-fixed');
  });

  it('says how the catalogue works once, not on every row', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: t.requisitions.addItem }));

    expect(screen.getAllByText(t.requisitions.itemNameHint)).toHaveLength(1);
  });

  it('cannot delete the only row, but can once there are two', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByRole('button', { name: `${t.requisitions.removeItem} 1` })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: t.requisitions.addItem }));
    expect(screen.getByRole('button', { name: `${t.requisitions.removeItem} 1` })).toBeEnabled();
  });
});
