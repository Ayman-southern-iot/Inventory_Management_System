import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LOCATE_MAX_PRODUCTS, Role, type Paginated, type Product } from '@ims/shared';
import type * as ClientModule from '@/api/client';
import { api } from '@/api/client';
import { LOCATE_PATH } from '@/features/locate/api';
import { t } from '@/i18n/en';
import { LOCATE_SETTLE_MS } from '../constants';
import { InventoryPage } from './InventoryPage';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  const methods = ['get', 'post', 'put', 'patch', 'del', 'upload', 'blob', 'loginRequest'] as const;
  return { ...actual, api: Object.fromEntries(methods.map((name) => [name, vi.fn()])) };
});
vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ user: null, hasRole: (...roles: Role[]) => roles.includes(Role.GENERAL) }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const product = (index: number, name: string): Product => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  productCode: `CTO-Electrical-${String(index).padStart(2, '0')}`,
  name,
  categoryId: null,
  categoryName: null,
  isTrackable: true,
  unit: 'pcs',
  defaultReturnable: true,
  description: null,
  isActive: true,
  totalQuantity: 2,
  totalReserved: 0,
  totalAvailable: 2,
  totalOnHand: 2,
  totalQuarantined: 0,
  totalInUse: 0,
  totalOwned: 2,
  createdAt: '2026-10-12T08:00:00.000Z',
});

const SERVO = product(1, 'Feetech STS3215 servo');
/** One more resistor kit than a locate may name. */
const RESISTORS = Array.from({ length: LOCATE_MAX_PRODUCTS + 1 }, (_, index) =>
  product(10 + index, `Resistor kit ${index}`),
);

/** The server's search, as far as this page can tell: a name match on `?search=`. */
function answer(path: string): Paginated<Product> {
  const search = new URLSearchParams(path.split('?')[1] ?? '').get('search')?.toLowerCase();
  const all = [SERVO, ...RESISTORS];
  const items = search ? all.filter((item) => item.name.toLowerCase().includes(search)) : all;
  return { items, page: 1, limit: 20, total: items.length };
}

let client: QueryClient;
function renderPage() {
  client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const locatePosts = () => post.mock.calls.filter(([path]) => path === LOCATE_PATH);
/** A mutation calls its function a few microtasks after `mutate`; let any pending one run. */
const settle = () => act(async () => {});

describe('InventoryPage — drawer lights', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (path: string) => (path.startsWith('/products') ? answer(path) : []));
  });
  afterEach(() => {
    vi.useRealTimers();
    client.clear();
  });

  async function search(text: string) {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    await user.type(screen.getByLabelText(t.common.search), text);
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_SETTLE_MS * 2));
  }

  it('lights the drawers once, after typing rests, for a search with five or fewer matches', async () => {
    await search('STS3215');
    // One locate for the settled search — not one per keystroke.
    await waitFor(() => expect(locatePosts()).toEqual([[LOCATE_PATH, { productIds: [SERVO.id] }]]));
  });

  /**
   * While a new search loads, the previous result stays on screen as a placeholder. It must not be
   * posted under the new search's name: the new one has not answered yet.
   */
  it('waits for the new search\'s own result, not the previous one kept on screen while it loads', async () => {
    const pending = 'STS3215 servo';
    get.mockImplementation(async (path: string) => {
      if (!path.startsWith('/products')) return [];
      const search = new URLSearchParams(path.split('?')[1] ?? '').get('search');
      return search === pending ? new Promise<never>(() => undefined) : answer(path);
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    const field = screen.getByLabelText(t.common.search);
    await user.type(field, 'STS3215');
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_SETTLE_MS * 2));
    await waitFor(() => expect(locatePosts()).toHaveLength(1));

    await user.type(field, ' servo');
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_SETTLE_MS * 2));
    await settle();
    expect(screen.getByText(SERVO.name)).toBeInTheDocument(); // the placeholder, still shown
    expect(locatePosts()).toHaveLength(1);
  });

  it(`posts nothing for a search with more than ${LOCATE_MAX_PRODUCTS} matches`, async () => {
    await search('Resistor');
    expect(await screen.findByText(RESISTORS[0]!.name)).toBeInTheDocument();
    await settle();
    expect(locatePosts()).toEqual([]);
  });

  it('posts nothing for a search with no match', async () => {
    await search('nothing like it');
    await settle();
    expect(locatePosts()).toEqual([]);
  });
});
