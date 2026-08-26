import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { RequisitionFormPage } from './RequisitionFormPage';

/**
 * Transportation is collapsed behind a switch.
 *
 * The assertion that matters is the last one: closing the section has to clear the amount. A
 * figure left behind a closed section would keep counting toward the requested total and toward
 * the approver threshold, with nothing on screen to explain why the number is what it is.
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

const toggle = () => screen.getByRole('switch', { name: new RegExp(t.requisitions.transportation.heading, 'i') });
const requestedTotal = () =>
  screen.getByText(t.requisitions.transportation.requested).closest('div')!.textContent!;

describe('the transportation section', () => {
  it('is collapsed until the switch is turned on', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText(t.requisitions.transportation.amount)).not.toBeInTheDocument();

    await user.click(toggle());

    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(t.requisitions.transportation.amount)).toBeInTheDocument();
    expect(screen.getByLabelText(t.requisitions.transportation.description)).toBeInTheDocument();
  });

  it('adds the amount to the requested total', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(toggle());
    await user.type(screen.getByLabelText(t.requisitions.transportation.amount), '1200');

    expect(requestedTotal()).toContain('1,200');
  });

  it('clears the amount when the section is closed, so it stops counting', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(toggle());
    await user.type(screen.getByLabelText(t.requisitions.transportation.amount), '1200');
    expect(requestedTotal()).toContain('1,200');

    await user.click(toggle());

    // The defect this prevents: a hidden 1,200 still inflating the figure that decides how many
    // approvers the request needs.
    expect(requestedTotal()).not.toContain('1,200');
    expect(screen.queryByLabelText(t.requisitions.transportation.amount)).not.toBeInTheDocument();

    // And it is genuinely gone, not merely hidden — reopening shows an empty field.
    await user.click(toggle());
    expect(screen.getByLabelText(t.requisitions.transportation.amount)).toHaveValue(null);
  });
});
