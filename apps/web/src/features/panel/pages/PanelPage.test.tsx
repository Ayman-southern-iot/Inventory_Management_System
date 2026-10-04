import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Catalogue } from '@ims/shared';
import type * as ClientModule from '@/api/client';
import { ApiError, NETWORK_ERROR_CODE, api } from '@/api/client';
import { t } from '@/i18n/en';
import { importSheetRows } from '@/test/panel-import-sheet';
import { PANEL_CATALOGUE_PATH } from '../api';
import { PANEL_IDLE_RESET_MS, PANEL_SEARCH_DEBOUNCE_MS } from '../constants';
import { PanelPage } from './PanelPage';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});
const get = vi.mocked(api.get);

const catalogue: Catalogue = {
  generatedAt: '2026-10-05T08:00:00.000Z',
  products: [
    {
      id: '00000000-0000-4000-8000-000000000101',
      code: 'TL-0001',
      name: 'ST-Link V3 MINIE',
      description: null,
      unit: 'pcs',
      category: null,
      stock: { total: 2, available: 2, inUse: 0 },
      locations: [
        {
          compartmentId: '00000000-0000-4000-8000-000000000201',
          label: 'Cabinet A / A1 / 1G-1H',
          room: 'Cabinet A',
          zone: 'A1',
          compartment: '1G-1H',
          storageId: 'CAB-A1-1G1H-0001',
          quantity: 2,
          available: 2,
        },
      ],
    },
  ],
  categories: [],
  // Every shelf of the v4 sheet, entered in IMS as OQ-P2 says, so no drawer is unmatched.
  locations: importSheetRows().map((row, index) => ({
    compartmentId: `00000000-0000-4000-8000-${String(300 + index).padStart(12, '0')}`,
    label: `${row.room} / ${row.zoneName} / ${row.compartmentCode}`,
    room: row.room,
    zone: row.zoneName,
    compartment: row.compartmentCode,
    storageId: `LAB-${index}`,
  })),
  counts: { products: 1, categories: 0, locations: 150 },
};

let client: QueryClient;
function renderPanel() {
  client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <PanelPage />
    </QueryClientProvider>,
  );
}

const searchField = () => screen.getByLabelText(t.panel.searchLabel, { selector: 'input' });
const key = (name: string) => screen.getByRole('button', { name });

async function typeOnScreen(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(searchField());
  for (const char of text) await user.click(key(char));
}

describe('PanelPage', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue(catalogue);
  });
  afterEach(() => {
    vi.useRealTimers();
    client.clear();
  });

  it('shows the three cabinets and the open shelves before anything is typed', () => {
    renderPanel();
    for (const name of ['Cabinet A', 'Cabinet B', 'Roller cabinet', t.panel.openShelves]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    for (const code of ['A1', 'A5', 'B3', 'R5', 'LB', 'LR']) {
      expect(document.querySelector(`[data-unit="${code}"]`)).not.toBeNull();
    }
  });

  it('finds ST-Link from the on-screen keyboard and lights its cell in drawer A1', async () => {
    const user = userEvent.setup();
    renderPanel();

    await typeOnScreen(user, 'ST-LINK');
    const result = await screen.findByRole('button', { name: /ST-Link V3 MINIE/ });
    expect(result).toHaveTextContent('A1-1G-1H');
    expect(result).toHaveTextContent(t.panel.onHand(2));

    await user.click(result);
    const lit = document.querySelector('[aria-current="location"]');
    expect(lit).toHaveAttribute('data-address', 'A1-1G-1H');
    const cell = screen.getByRole('region', { name: t.panel.cellContentsTitle('A1-1G-1H') });
    expect(within(cell).getByText('ST-Link V3 MINIE')).toBeInTheDocument();
    expect(within(cell).getByText(t.panel.onHand(2))).toBeInTheDocument();
    expect(screen.getByText(t.panel.drawerFront)).toBeInTheDocument();
  });

  it('asks the API for the catalogue and nothing else, through a search and a drawer', async () => {
    // K2: product detail would name borrowers to this session; the panel must never call it.
    const user = userEvent.setup();
    renderPanel();
    await typeOnScreen(user, 'ST-LINK');
    await user.click(await screen.findByRole('button', { name: /ST-Link V3 MINIE/ }));
    await user.click(screen.getByRole('button', { name: /^1A-1B/ }));

    expect(get).toHaveBeenCalled();
    expect(get.mock.calls.map(([path]) => path)).toEqual(
      get.mock.calls.map(() => PANEL_CATALOGUE_PATH),
    );
  });

  it('warns, with a count, about plan drawers IMS has no zone for', async () => {
    get.mockResolvedValue({
      ...catalogue,
      locations: catalogue.locations.filter((shelf) => !['A2', 'R5'].includes(shelf.zone)),
    });
    renderPanel();
    const warning = await screen.findByText(t.panel.unmatchedDrawers(2, 'A2, R5'));
    expect(warning).toBeInTheDocument();
  });

  it('shows no such warning when every drawer is set up in IMS', async () => {
    renderPanel();
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    await screen.findByRole('region', { name: 'Cabinet A' });
    expect(screen.queryByText(/no zone in IMS/)).not.toBeInTheDocument();
  });

  it('says there is no match and suggests a drawer code', async () => {
    const user = userEvent.setup();
    renderPanel();
    await typeOnScreen(user, 'ZZZZ');
    expect(await screen.findByText(t.panel.noMatch)).toBeInTheDocument();
  });

  it('returns to the cabinet overview after a minute without a touch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();

    await typeOnScreen(user, 'A1');
    await act(() => vi.advanceTimersByTimeAsync(PANEL_SEARCH_DEBOUNCE_MS));
    await user.click(await screen.findByRole('button', { name: /A1$/ }));
    expect(screen.getByText(t.panel.drawerFront)).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(PANEL_IDLE_RESET_MS));
    expect(screen.queryByText(t.panel.drawerFront)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cabinet A' })).toBeInTheDocument();
    expect(searchField()).toHaveValue('');

    // The next person taps the field: the keyboard has to come back.
    await user.click(searchField());
    expect(screen.getByRole('group', { name: t.onScreenKeyboard.label })).toBeInTheDocument();
  });

  it('brings the keyboard back for the next person after someone typed and walked away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();
    await typeOnScreen(user, 'ZZ');
    // The keys keep focus in the field, so it is still focused when the idle reset fires.
    expect(searchField()).toHaveFocus();

    await act(() => vi.advanceTimersByTimeAsync(PANEL_IDLE_RESET_MS));
    expect(screen.queryByRole('group', { name: t.onScreenKeyboard.label })).not.toBeInTheDocument();

    await user.click(searchField());
    expect(screen.getByRole('group', { name: t.onScreenKeyboard.label })).toBeInTheDocument();
  });

  it('keeps the last counts under an offline banner when the API stops answering', async () => {
    const user = userEvent.setup();
    renderPanel();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    get.mockRejectedValue(new ApiError(NETWORK_ERROR_CODE, 'Cannot reach the server', 0));
    await act(() => client.refetchQueries());

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(t.panel.offline(10));
    expect(banner).toHaveTextContent(/Showing counts from/);
    // The cached copy still answers a search.
    await typeOnScreen(user, 'ST');
    expect(await screen.findByRole('button', { name: /ST-Link V3 MINIE/ })).toBeInTheDocument();
  });

  it('draws the map and says it cannot reach the server when offline before the first load', async () => {
    get.mockRejectedValue(new ApiError(NETWORK_ERROR_CODE, 'Cannot reach the server', 0));
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText(t.panel.offline(10))).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cabinet A' })).toBeInTheDocument();
    await typeOnScreen(user, 'ST');
    expect(await screen.findByText(t.states.offlineTitle)).toBeInTheDocument();
  });

  it('does not call a cell empty when the catalogue has not been read', async () => {
    get.mockRejectedValue(new ApiError(NETWORK_ERROR_CODE, 'Cannot reach the server', 0));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(t.panel.offline(10));

    await user.click(document.querySelector<HTMLButtonElement>('[data-unit="A1"]')!);
    await user.click(screen.getByRole('button', { name: /^1G-1H/ }));
    expect(screen.queryByText(t.panel.cellEmpty)).not.toBeInTheDocument();
    expect(screen.getByText(t.states.offlineTitle)).toBeInTheDocument();
  });

  it('still finds a drawer by its code before the catalogue is read: drawers come from the plan', async () => {
    get.mockRejectedValue(new ApiError(NETWORK_ERROR_CODE, 'Cannot reach the server', 0));
    const user = userEvent.setup();
    renderPanel();
    await typeOnScreen(user, 'A1');
    expect(await screen.findByRole('button', { name: /A1$/ })).toBeInTheDocument();
  });

  it('offers a retry when the API answers with an error and nothing is cached', async () => {
    get.mockRejectedValue(new ApiError('INTERNAL', 'boom', 500));
    const user = userEvent.setup();
    renderPanel();
    await typeOnScreen(user, 'ST');

    expect(await screen.findByRole('alert')).toHaveTextContent(t.states.errorBody);
    get.mockResolvedValue(catalogue);
    await user.click(screen.getByRole('button', { name: t.common.retry }));
    expect(await screen.findByRole('button', { name: /ST-Link V3 MINIE/ })).toBeInTheDocument();
  });
});
