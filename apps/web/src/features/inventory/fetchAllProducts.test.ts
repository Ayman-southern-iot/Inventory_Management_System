import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PAGINATION_MAX_LIMIT, type ListProductsQuery } from '@ims/shared';
import { api } from '@/api/client';
import { fetchAllProducts } from './api';

/**
 * D-002. The requisition form's item picker searches the catalogue client-side, so it needs the
 * whole list. It asked for one page and stopped, so past `PAGINATION_MAX_LIMIT` products the
 * rest were invisible with nothing on screen to say so: you type a name that exists and the
 * picker offers nothing, which reads as "we do not stock it".
 */

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { get: vi.fn() } };
});

const QUERY = {
  page: 1,
  limit: PAGINATION_MAX_LIMIT,
  includeInactive: false,
  inStockOnly: false,
} as ListProductsQuery;

const productsPage = (from: number, count: number, total: number) => ({
  items: Array.from({ length: count }, (_, i) => ({ id: `p${from + i}`, name: `Product ${from + i}` })),
  total,
  page: 1,
  limit: PAGINATION_MAX_LIMIT,
});

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe('fetchAllProducts', () => {
  it('keeps paging until it has the whole catalogue', async () => {
    const total = PAGINATION_MAX_LIMIT + 30;
    vi.mocked(api.get)
      .mockResolvedValueOnce(productsPage(0, PAGINATION_MAX_LIMIT, total))
      .mockResolvedValueOnce(productsPage(PAGINATION_MAX_LIMIT, 30, total));

    const products = await fetchAllProducts(QUERY, undefined);

    expect(products).toHaveLength(total);
    // The product past the first page is the one D-002 hid.
    expect(products.at(-1)).toMatchObject({ id: `p${total - 1}` });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('asks for the next page, not the same one twice', async () => {
    const total = PAGINATION_MAX_LIMIT + 1;
    vi.mocked(api.get)
      .mockResolvedValueOnce(productsPage(0, PAGINATION_MAX_LIMIT, total))
      .mockResolvedValueOnce(productsPage(PAGINATION_MAX_LIMIT, 1, total));

    await fetchAllProducts(QUERY, undefined);

    const [firstUrl] = vi.mocked(api.get).mock.calls[0] as [string];
    const [secondUrl] = vi.mocked(api.get).mock.calls[1] as [string];
    expect(firstUrl).toContain('page=1');
    expect(secondUrl).toContain('page=2');
    expect(secondUrl).toContain(`limit=${PAGINATION_MAX_LIMIT}`);
  });

  /**
   * The guard `fetchAllProjects` carries: a table changing under a paged read can report a total
   * the pages never reach. An empty page ends the loop rather than spinning forever.
   */
  it('stops on an empty page even when total claims there is more', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(productsPage(0, 2, 999))
      .mockResolvedValueOnce(productsPage(0, 0, 999));

    const products = await fetchAllProducts(QUERY, undefined);

    expect(products).toHaveLength(2);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('makes a single request when everything fits on one page', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(productsPage(0, 3, 3));

    await fetchAllProducts(QUERY, undefined);

    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
