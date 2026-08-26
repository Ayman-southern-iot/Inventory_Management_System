import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { RequisitionFormPage } from './RequisitionFormPage';

/**
 * D-004. Editing a draft rendered "No department" / "No project" even though both were saved,
 * because the two dropdowns are fed by their own queries and the form reset does not wait for
 * them. A `<select>` handed a value with no matching `<option>` silently keeps "", so whichever
 * of the three queries settles last decides whether the user sees their own data.
 *
 * The ordering is the whole defect, so the test stages it: the requisition resolves first, the
 * option lists arrive on a later render. Mocking all three as already-loaded would pass against
 * the broken code and prove nothing.
 */

const DETAIL = {
  id: 'req-1',
  departmentId: 'dept-1',
  projectId: 'proj-1',
  urgency: 'NORMAL',
  approvalDeadline: '2099-01-01',
  reason: 'because',
  items: [
    { productId: null, itemName: 'Widget', quantity: 2, estimatedUnitPrice: 100, note: null },
  ],
  transportationCost: null,
  transportationDescription: null,
};

const DEPARTMENTS = [{ id: 'dept-1', name: 'Engineering' }];
const PROJECTS = [{ id: 'proj-1', name: 'Test' }];

/** Flipped between renders to stage the arrival of the option lists. */
let optionsLoaded = false;

vi.mock('../api', () => ({
  useRequisition: () => ({ data: DETAIL, isPending: false }),
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
  useDepartments: () => ({
    data: optionsLoaded ? { items: DEPARTMENTS } : undefined,
    isPending: !optionsLoaded,
  }),
}));

vi.mock('@/features/projects/api', () => ({
  useProjects: () => ({
    data: optionsLoaded ? PROJECTS : undefined,
    isPending: !optionsLoaded,
  }),
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

function renderEditForm() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/requisitions/req-1/edit']}>
        <Routes>
          <Route path="/requisitions/:requisitionId/edit" element={<RequisitionFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RequisitionFormPage, editing a saved draft', () => {
  it('shows the saved department and project once their option lists arrive', () => {
    optionsLoaded = false;
    const { rerender } = renderEditForm();

    // The option lists land after the requisition, which is the sequence that broke it.
    optionsLoaded = true;
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/requisitions/req-1/edit']}>
          <Routes>
            <Route path="/requisitions/:requisitionId/edit" element={<RequisitionFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const department = screen.getByLabelText(t.requisitions.department) as HTMLSelectElement;
    const project = screen.getByLabelText(t.requisitions.project) as HTMLSelectElement;

    expect(department.value).toBe('dept-1');
    expect(project.value).toBe('proj-1');
  });
});
