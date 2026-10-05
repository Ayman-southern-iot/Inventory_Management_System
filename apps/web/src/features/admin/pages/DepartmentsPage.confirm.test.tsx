import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Department } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import { DepartmentsPage } from './DepartmentsPage';

/** Message audit M6: deactivating a department asks first; activating one does not. */
const update = vi.fn();
let rows: Department[] = [];

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useDepartments: () => ({
      data: { items: rows, page: 1, limit: 20, total: rows.length },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    }),
    useCreateDepartment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateDepartment: () => ({ mutateAsync: update, isPending: false }),
  };
});

const department = (overrides: Partial<Department> = {}): Department =>
  ({ id: 'd-1', name: 'Workshop', isActive: true, activeMemberCount: 0, ...overrides }) as unknown as Department;

function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <DepartmentsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('DepartmentsPage deactivation', () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({});
  });

  it('asks first, then deactivates once confirmed', async () => {
    rows = [department()];
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.users.deactivate} Workshop` }));
    expect(screen.getByRole('dialog', { name: t.departments.deactivateConfirmTitle('Workshop') })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.users.deactivate}$`) }));
    expect(update).toHaveBeenCalledWith({ id: 'd-1', input: { isActive: false } });
  });

  it('does nothing when cancelled', async () => {
    rows = [department()];
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.users.deactivate} Workshop` }));
    await userEvent.click(screen.getByRole('button', { name: t.common.cancel }));

    expect(update).not.toHaveBeenCalled();
  });

  it('activates straight away', async () => {
    rows = [department({ isActive: false })];
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.users.activate} Workshop` }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(update).toHaveBeenCalledWith({ id: 'd-1', input: { isActive: true } });
  });
});
