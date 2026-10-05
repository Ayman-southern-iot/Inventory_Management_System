import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import { UsersPage } from './UsersPage';

/**
 * Message audit M6. Deactivating a user ends their access, and it happened on the first click. It
 * asks first now; activating, which restores access, does not.
 */
const setActive = vi.fn();

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    email: 'gina@ims.local',
    fullName: 'Gina General',
    designation: 'Engineer',
    departmentId: null,
    departmentName: null,
    roles: ['GENERAL'],
    isActive: true,
    mustChangePassword: false,
    lastLoginAt: null,
    ...overrides,
  } as unknown as User;
}

let rows: User[] = [];

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useUsers: () => ({
      data: { items: rows, page: 1, limit: 20, total: rows.length },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    }),
    useDepartments: () => ({ data: { items: [] } }),
    useSetUserActive: () => ({ mutateAsync: setActive, isPending: false }),
  };
});

function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <UsersPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('UsersPage deactivation', () => {
  beforeEach(() => {
    setActive.mockReset().mockResolvedValue({});
  });

  it('asks before deactivating, and says what happens', async () => {
    rows = [user()];
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.users.deactivate} Gina General` }));

    expect(screen.getByRole('dialog', { name: t.users.deactivateConfirmTitle('Gina General') })).toBeInTheDocument();
    expect(screen.getByText(t.users.deactivateConfirmBody)).toBeInTheDocument();
    expect(setActive).not.toHaveBeenCalled();
  });

  it('deactivates once confirmed', async () => {
    rows = [user()];
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.users.deactivate} Gina General` }));
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.users.deactivate}$`) }));

    expect(setActive).toHaveBeenCalledWith({ id: 'u-1', isActive: false });
  });

  it('does nothing when the prompt is cancelled', async () => {
    rows = [user()];
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.users.deactivate} Gina General` }));
    await userEvent.click(screen.getByRole('button', { name: t.common.cancel }));

    expect(setActive).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('activates straight away: restoring access needs no second look', async () => {
    rows = [user({ isActive: false })];
    open();

    await userEvent.click(screen.getByRole('button', { name: `${t.users.activate} Gina General` }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setActive).toHaveBeenCalledWith({ id: 'u-1', isActive: true });
  });
});
