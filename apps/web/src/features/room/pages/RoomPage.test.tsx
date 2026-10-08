import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { type Catalogue } from '@ims/shared';
import type * as ClientModule from '@/api/client';
import { ApiError, NETWORK_ERROR_CODE, api } from '@/api/client';
import { t } from '@/i18n/en';
import { DESKTOP_MEDIA, DESKTOP_MIN_WIDTH_PX } from '@/lib/useMediaQuery';
import { PANEL_CATALOGUE_PATH } from '@/features/panel/api';
import { PANEL_OFFLINE_RETRY_MS } from '@/features/panel/constants';
import { MS_PER_SECOND } from '@/features/panel/constants';
import { ROUTES } from '@/routes/paths';
import scene from '../assets/scene-v4.json';
import { RoomPage } from './RoomPage';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  // Every method mocked, so any call besides the catalogue read shows up in the K2 check.
  const methods = ['get', 'post', 'put', 'patch', 'del', 'upload', 'blob', 'loginRequest'] as const;
  return { ...actual, api: Object.fromEntries(methods.map((name) => [name, vi.fn()])) };
});

// jsdom has no WebGL. The 3D scene is exercised in the browser check (scripts/room-e2e); here it
// only has to come up and say it drew.
vi.mock('../scene/RoomScene', () => ({
  RoomScene: class {
    constructor(options: { onFirstFrame: () => void }) {
      queueMicrotask(options.onFirstFrame);
    }
    focusOn() {}
    setStock() {}
    dispose() {}
  },
}));

const get = vi.mocked(api.get);
const at = (zone: string, compartment: string, room: string, n: number) => ({
  compartmentId: `00000000-0000-4000-8000-${String(200 + n).padStart(12, '0')}`,
  label: `${room} / ${zone} / ${compartment}`,
  room,
  zone,
  compartment,
  storageId: `CAB-${zone}-${compartment.replace('-', '')}-${String(n).padStart(4, '0')}`,
});
const servoShelf = at('B2', '2A-2D', 'Cabinet B', 104);
const espShelf = at('A2', '1A', 'Cabinet A', 32);
const product = (
  n: number,
  name: string,
  code: string,
  shelf: typeof servoShelf,
  quantity: number,
) => ({
  id: `00000000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`,
  code,
  name,
  description: null,
  unit: 'pcs',
  category: null,
  stock: { total: quantity, available: quantity, inUse: 0 },
  locations: [{ ...shelf, quantity, available: quantity }],
});
const catalogue: Catalogue = {
  generatedAt: '2026-10-09T08:00:00.000Z',
  products: [
    product(1, 'STS3215 serial bus servo', 'CTO-ELECTRICAL-0001', servoShelf, 14),
    product(2, 'ESP32-S3 DevKitC-1', 'CTO-ELECTRICAL-0005', espShelf, 5),
  ],
  categories: [],
  locations: [servoShelf, espShelf],
  counts: { products: 2, categories: 0, locations: 2 },
};

let isWide = true;
let fetched: string[] = [];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderRoom(entry: string = ROUTES.room) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={ROUTES.room} element={<RoomPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ready = () => screen.findByRole('img', { name: t.room.canvasLabel });
const details = () => screen.getByRole('complementary');
const searchBox = () => screen.getByRole('combobox');

describe('RoomPage', () => {
  beforeEach(() => {
    isWide = true;
    fetched = [];
    get.mockResolvedValue(catalogue);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === DESKTOP_MEDIA && isWide,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify(scene), { status: 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('tells a narrow screen to use a PC and asks for nothing: no scene, no catalogue', () => {
    isWide = false;
    renderRoom();

    expect(screen.getByRole('heading', { name: t.room.narrowTitle })).toBeInTheDocument();
    expect(screen.getByText(t.room.narrowBody(DESKTOP_MIN_WIDTH_PX))).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(fetched).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('K2: reads only the name-free catalogue from the API, and the scene file', async () => {
    renderRoom(`${ROUTES.room}?cell=B2-2A-2D`);
    await ready();
    await within(details()).findByText('STS3215 serial bus servo');

    const calls = Object.entries(api).flatMap(([method, fn]) =>
      vi.mocked(fn).mock.calls.map((args) => `${method} ${String(args[0])}`),
    );
    expect(new Set(calls)).toEqual(new Set([`get ${PANEL_CATALOGUE_PATH}`]));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toMatch(/scene-v4.*\.json$/);
  });

  it('finds a part by search and selects its cell, in the address bar and the side list', async () => {
    const user = userEvent.setup();
    renderRoom();
    await ready();
    await screen.findByText(t.room.idle);

    await user.type(searchBox(), 'STS3215');
    expect(
      await screen.findByRole('option', { name: /STS3215 serial bus servo/ }),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('location')).toHaveTextContent(`${ROUTES.room}?cell=B2-2A-2D`);
    const side = details();
    expect(within(side).getByRole('heading', { name: 'B2-2A-2D' })).toBeInTheDocument();
    expect(within(side).getByText('STS3215 serial bus servo')).toBeInTheDocument();
    expect(within(side).getByText(t.panel.onHand(14))).toBeInTheDocument();
    expect(within(side).getByText(t.panel.free(14))).toBeInTheDocument();
    expect(within(side).getByText(servoShelf.storageId)).toBeInTheDocument();
    expect(searchBox()).toHaveValue('');
  });

  it('opens on the cell a link names: /room?cell=A2-1A', async () => {
    renderRoom(`${ROUTES.room}?cell=a2-1a`);
    await ready();

    const side = details();
    expect(within(side).getByRole('heading', { name: 'A2-1A' })).toBeInTheDocument();
    expect(await within(side).findByText('ESP32-S3 DevKitC-1')).toBeInTheDocument();
  });

  it('says so when the link names a cell the plan does not have', async () => {
    renderRoom(`${ROUTES.room}?cell=B2-9Z`);
    await ready();

    expect(within(details()).getByRole('alert')).toHaveTextContent(t.room.unknownCell('B2-9Z'));
  });

  it('keeps the room and shows the offline banner when the API cannot be reached', async () => {
    get.mockRejectedValue(new ApiError(NETWORK_ERROR_CODE, 'Cannot reach the server', 0));
    renderRoom(`${ROUTES.room}?cell=B2-2A-2D`);
    await ready();

    expect(
      await screen.findByText(t.panel.offline(PANEL_OFFLINE_RETRY_MS / MS_PER_SECOND), {
        exact: false,
      }),
    ).toBeInTheDocument();
    // The cell is still named; its contents wait for the catalogue rather than reading "empty".
    expect(within(details()).getByRole('heading', { name: 'B2-2A-2D' })).toBeInTheDocument();
    expect(within(details()).queryByText(t.panel.cellEmpty)).not.toBeInTheDocument();
  });

  it('focuses the search on "/", clears it on Escape, and a second Escape clears the selection', async () => {
    const user = userEvent.setup();
    renderRoom(`${ROUTES.room}?cell=B2-2A-2D`);
    await ready();

    await user.keyboard('/');
    expect(searchBox()).toHaveFocus();
    await user.keyboard('servo');
    await user.keyboard('{Escape}');
    expect(searchBox()).toHaveValue('');
    expect(screen.getByTestId('location')).toHaveTextContent('?cell=B2-2A-2D');

    await user.keyboard('{Escape}');
    expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${ROUTES.room}$`));
    expect(screen.getByText(t.room.idle)).toBeInTheDocument();
  });

  it('clears the selection on Escape when the search box does not have focus', async () => {
    const user = userEvent.setup();
    renderRoom(`${ROUTES.room}?cell=B2-2A-2D`);
    await ready();
    expect(document.activeElement).toBe(document.body);

    await user.keyboard('{Escape}');

    expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${ROUTES.room}$`));
    expect(screen.getByText(t.room.idle)).toBeInTheDocument();
  });
  it('opens a drawer from the search, lists its cells with parts, and goes to one', async () => {
    const user = userEvent.setup();
    renderRoom();
    await ready();
    await screen.findByText(t.room.idle);

    await user.type(searchBox(), 'B2');
    await user.click(await screen.findByRole('option', { name: /Drawer B2/ }));

    const side = details();
    expect(within(side).getByRole('heading', { name: 'B2' })).toBeInTheDocument();
    expect(within(side).getByText(t.room.drawerCells)).toBeInTheDocument();
    await user.click(within(side).getByRole('button', { name: /B2-2A-2D/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('?cell=B2-2A-2D');
    expect(within(details()).getByText('STS3215 serial bus servo')).toBeInTheDocument();
  });

  it('chooses with the arrow keys and closes the list when the box loses focus', async () => {
    const user = userEvent.setup();
    renderRoom();
    await ready();
    await screen.findByText(t.room.idle);

    await user.type(searchBox(), 'e');
    const options = await screen.findAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('says an open-shelf cell is not in the 3D model, and still lists it', async () => {
    renderRoom(`${ROUTES.room}?cell=LB-1`);
    await ready();

    expect(within(details()).getByText(t.room.openShelf)).toBeInTheDocument();
    expect(within(details()).getByRole('heading', { name: 'LB-1' })).toBeInTheDocument();
  });

  it('goes back to the whole room on Reset view', async () => {
    const user = userEvent.setup();
    renderRoom(`${ROUTES.room}?cell=B2-2A-2D`);
    await ready();

    await user.click(screen.getByRole('button', { name: t.room.resetView }));

    expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${ROUTES.room}$`));
    expect(screen.getByText(t.room.idle)).toBeInTheDocument();
  });

  it('names drawers IMS has no zone for, so they do not just look empty', async () => {
    renderRoom();
    await ready();

    // The catalogue above has zones for A2 and B2 only.
    expect(await screen.findByRole('note')).toHaveTextContent(/A1, A3/);
  });

  it('says the scene could not load, and loads it on retry', async () => {
    const user = userEvent.setup();
    let failing = true;
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return failing
        ? new Response('gone', { status: 500 })
        : new Response(JSON.stringify(scene), { status: 200 });
    });
    renderRoom();

    expect(await screen.findByText(t.room.sceneFailed)).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: t.common.retry }));
    expect(await screen.findByRole('img', { name: t.room.canvasLabel })).toBeInTheDocument();
  });
});
