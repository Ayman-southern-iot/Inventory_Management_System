import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { RequisitionFormPage } from './RequisitionFormPage';

const createSpy = vi.fn();

vi.mock('../api', () => ({
  useRequisition: () => ({ data: undefined, isPending: false }),
  useCreateRequisition: () => ({
    mutateAsync: (input: unknown) => {
      createSpy(input);
      return Promise.resolve({ id: 'req-1' });
    },
    isPending: false,
  }),
  useUpdateRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

/**
 * Mutable so one test can put the catalogue query in its failed state. D-002 shipped a query
 * the API rejects, and `catalogue.isError` was never read — the picker was simply empty.
 */
const catalogueRefetch = vi.fn();
// useAllProducts pages the whole catalogue and returns a flat array, not a Paginated page (D-002).
const CATALOGUE_LOADED = { data: [], isPending: false, isError: false, error: null, refetch: catalogueRefetch };
let catalogueResult: Record<string, unknown> = CATALOGUE_LOADED;

vi.mock('@/features/inventory/api', () => ({
  useAllProducts: () => catalogueResult,
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

describe('RequisitionFormPage', () => {
  beforeEach(() => {
    catalogueResult = CATALOGUE_LOADED;
    catalogueRefetch.mockClear();
  });

  it('saves with a null project when the user picks "No project"', async () => {
    createSpy.mockClear();
    const user = userEvent.setup();
    renderForm();

    // Selecting the empty option EXPLICITLY is what reproduces the bug. The form's
    // defaultValues already hold null, and React Hook Form keeps values in its own state — so a
    // test that never touches the select would pass against the unfixed code and prove nothing.
    // The change event is what puts '' into form state, which is what zod rejects.
    await user.selectOptions(screen.getByLabelText(t.requisitions.project), '');
    await user.selectOptions(screen.getByLabelText(t.requisitions.department), '');

    // One item is the minimum the schema accepts.
    await user.type(screen.getByLabelText(t.requisitions.itemName), 'Test widget');
    await user.type(screen.getByLabelText(t.requisitions.quantity), '2');
    await user.type(screen.getByLabelText(t.requisitions.unitPrice), '100');

    await user.click(screen.getByRole('button', { name: t.requisitions.saveDraft }));

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[0]).toMatchObject({ projectId: null, departmentId: null });
  });

  it('updates the items Total as the user types quantity and unit price', async () => {
    // The line total inside the row was already correct (it reads from the watched single-row
    // path), but the bottom-of-form Total was stuck at 0.00. This test pins the fix: typing
    // 4 × 399.99 in the empty row must produce "1,599.96" in the panel footer.
    const user = userEvent.setup();
    renderForm();

    const total = screen.getByText(t.requisitions.total).parentElement!.querySelector('span:last-child')!;
    expect(total.textContent).toBe('0.00');

    await user.type(screen.getByLabelText(t.requisitions.itemName), 'test widget');
    await user.type(screen.getByLabelText(t.requisitions.quantity), '4');
    await user.type(screen.getByLabelText(t.requisitions.unitPrice), '399.99');

    expect(total.textContent).toBe('1,599.96');
  });

  /**
   * D-002. `CATALOGUE_QUERY` asked for 200 rows against a max of 100, so /products 400d on
   * every load; nothing read `isError`, so the form rendered an empty picker and every line
   * became unlinked free text. The limit is fixed by the contract test — this pins the other
   * half: a catalogue that fails for any reason has to say so.
   */
  it('tells the requester when the catalogue failed to load', () => {
    catalogueResult = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('limit must be less than or equal to 100'),
      refetch: catalogueRefetch,
    };

    renderForm();

    expect(screen.getByRole('alert')).toHaveTextContent(t.requisitions.catalogueUnavailable);
  });

  it('offers a retry that refetches the catalogue', async () => {
    catalogueResult = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('limit must be less than or equal to 100'),
      refetch: catalogueRefetch,
    };
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: t.common.retry }));

    expect(catalogueRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows no catalogue warning when the catalogue loaded', () => {
    renderForm();

    expect(screen.queryByText(t.requisitions.catalogueUnavailable)).toBeNull();
  });
});
