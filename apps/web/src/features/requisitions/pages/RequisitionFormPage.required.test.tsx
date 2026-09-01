import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import * as requisitionsApi from '../api';
import { RequisitionFormPage } from './RequisitionFormPage';

/**
 * QA-008 / D-006. The three fields required at submit — department, deadline, reason — were
 * enforced only by the API, so a requester learned they were missing from one toast that named
 * all three whether or not they were missing, and only *after* save-then-submit had already
 * created a draft with a reference number (D-015). QA produced two orphan drafts that way.
 *
 * The rule has not changed. Where it is enforced has: the form refuses to send, marks the
 * offending controls, and moves focus to the first of them.
 */
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useCreateRequisition: vi.fn(),
    useUpdateRequisition: vi.fn(),
    useSubmitRequisition: vi.fn(),
    useRequisition: vi.fn(),
  };
});

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useDepartments: () => ({ data: { items: [] }, isPending: false }) };
});

vi.mock('@/features/projects/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useProjects: () => ({ data: [], isPending: false }) };
});

const createSpy = vi.fn();
const submitSpy = vi.fn();

function renderForm() {
  vi.mocked(requisitionsApi.useCreateRequisition).mockReturnValue({
    mutateAsync: createSpy,
    isPending: false,
  } as unknown as ReturnType<typeof requisitionsApi.useCreateRequisition>);
  vi.mocked(requisitionsApi.useUpdateRequisition).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof requisitionsApi.useUpdateRequisition>);
  vi.mocked(requisitionsApi.useSubmitRequisition).mockReturnValue({
    mutateAsync: submitSpy,
    isPending: false,
  } as unknown as ReturnType<typeof requisitionsApi.useSubmitRequisition>);
  vi.mocked(requisitionsApi.useRequisition).mockReturnValue({
    data: undefined,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof requisitionsApi.useRequisition>);

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/requisitions/new']}>
          <RequisitionFormPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('the fields a submit cannot do without', () => {
  it('marks every empty required field instead of describing them in a toast', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: t.requisitions.submit }));

    await waitFor(() => {
      // One message per field, on the field — not one sentence listing all three.
      expect(screen.getAllByText(t.requisitions.fieldRequired).length).toBeGreaterThanOrEqual(3);
    });
  });

  /**
   * The half that matters most: reaching the API is what creates the orphan draft, so a refused
   * submit must not have called it at all.
   */
  it('never reaches the server, so no orphan draft is created', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: t.requisitions.submit }));

    await waitFor(() => {
      expect(screen.getAllByText(t.requisitions.fieldRequired).length).toBeGreaterThanOrEqual(3);
    });
    expect(createSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('marks the required fields before anything is wrong, so the requirement is known', () => {
    renderForm();

    // The asterisk is decorative; `aria-required` is what is announced, and it is what proves
    // the marker is wired to the control rather than painted next to it.
    expect(
      document.querySelectorAll('[aria-required="true"]').length,
    ).toBeGreaterThanOrEqual(3);
  });
});
