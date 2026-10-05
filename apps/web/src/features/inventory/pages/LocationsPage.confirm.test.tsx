import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Room } from '@ims/shared';
import { t } from '@/i18n/en';
import { ToastProvider } from '@/components/ui/Toast';
import { LocationsPage } from './LocationsPage';

/** Message audit M6: deactivating a compartment asks first; activating one does not. */
const updateCompartment = vi.fn();
let isActive = true;

const room = (): Room =>
  ({
    id: 'room-1',
    name: 'Main Store',
    isActive: true,
    zones: [
      {
        id: 'zone-1',
        name: 'Meta',
        roomId: 'room-1',
        roomName: 'Main Store',
        isActive: true,
        compartments: [
          {
            id: 'c-1',
            zoneId: 'zone-1',
            zoneName: 'Meta',
            roomId: 'room-1',
            roomName: 'Main Store',
            code: '1A',
            storageId: 'MAI-MET-1A-0002',
            isActive,
            placementCount: 0,
          },
        ],
      },
    ],
  }) as unknown as Room;

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRooms: () => ({ data: [room()], isPending: false, error: null, refetch: vi.fn() }),
    useCreateRoom: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateRoom: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateZone: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateZone: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateCompartment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateCompartment: () => ({ mutateAsync: updateCompartment, isPending: false }),
  };
});

function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <LocationsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('LocationsPage compartment deactivation', () => {
  beforeEach(() => {
    updateCompartment.mockReset().mockResolvedValue({});
    isActive = true;
  });

  it('asks first, then deactivates once confirmed', async () => {
    open();

    // The row button and the dialog's confirm button share a name; the row's comes first.
    await userEvent.click(screen.getAllByRole('button', { name: t.users.deactivate })[0]!);
    expect(screen.getByRole('dialog', { name: t.locations.deactivateCompartmentTitle('1A') })).toBeInTheDocument();
    expect(screen.getByText(t.locations.deactivateCompartmentBody)).toBeInTheDocument();
    expect(updateCompartment).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: t.users.deactivate }));
    expect(updateCompartment).toHaveBeenCalledWith({ id: 'c-1', input: { isActive: false } });
  });

  it('does nothing when cancelled', async () => {
    open();

    await userEvent.click(screen.getAllByRole('button', { name: t.users.deactivate })[0]!);
    await userEvent.click(screen.getByRole('button', { name: t.common.cancel }));

    expect(updateCompartment).not.toHaveBeenCalled();
  });

  it('activates straight away', async () => {
    isActive = false;
    open();

    await userEvent.click(screen.getByRole('button', { name: t.users.activate }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updateCompartment).toHaveBeenCalledWith({ id: 'c-1', input: { isActive: true } });
  });
});
