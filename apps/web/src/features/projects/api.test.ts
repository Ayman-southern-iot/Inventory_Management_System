import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paginated, Project } from '@ims/shared';
import { api } from '@/api/client';
import { fetchAllProjects } from './api';

/**
 * `GET /projects` cannot return more than `PAGINATION_MAX_LIMIT` rows in one call. Before this
 * change `useProjects` fetched exactly one page, so a project past the 100th disappeared from
 * the borrow dialog and requisition form with no signal (Finding 2). This proves the paging
 * loop itself — not the hook — because it is the part that can silently drop rows again.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
}));

function project(id: string): Project {
  return { id, name: `Project ${id}`, isActive: true, createdAt: '2026-01-01T00:00:00.000Z' };
}

function makePage(items: Project[], pageNo: number, total: number): Paginated<Project> {
  return { items, page: pageNo, limit: 2, total };
}

describe('fetchAllProjects', () => {
  // Each test queues its own `mockResolvedValueOnce` sequence; without a reset, an earlier
  // test's unconsumed queue would bleed into the next one and both call counts and args.
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('keeps requesting subsequent pages until it has collected `total` items', async () => {
    const get = vi.mocked(api.get);
    get
      .mockResolvedValueOnce(makePage([project('1'), project('2')], 1, 5))
      .mockResolvedValueOnce(makePage([project('3'), project('4')], 2, 5))
      .mockResolvedValueOnce(makePage([project('5')], 3, 5));

    const result = await fetchAllProjects(undefined);

    expect(result.map((p) => p.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenNthCalledWith(1, '/projects?page=1&limit=100', undefined);
    expect(get).toHaveBeenNthCalledWith(2, '/projects?page=2&limit=100', undefined);
    expect(get).toHaveBeenNthCalledWith(3, '/projects?page=3&limit=100', undefined);
  });

  it('stops without a second request when the first page already covers the total', async () => {
    const get = vi.mocked(api.get);
    get.mockResolvedValueOnce(makePage([project('1'), project('2')], 1, 2));

    const result = await fetchAllProjects(undefined);

    expect(result).toHaveLength(2);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('stops on an empty page rather than looping forever if `total` disagrees with the rows', async () => {
    const get = vi.mocked(api.get);
    get
      .mockResolvedValueOnce(makePage([project('1')], 1, 10))
      .mockResolvedValueOnce(makePage([], 2, 10));

    const result = await fetchAllProjects(undefined);

    expect(result.map((p) => p.id)).toEqual(['1']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('passes the query signal through to every page request', async () => {
    const get = vi.mocked(api.get);
    get
      .mockResolvedValueOnce(makePage([project('1'), project('2')], 1, 3))
      .mockResolvedValueOnce(makePage([project('3')], 2, 3));
    const controller = new AbortController();

    await fetchAllProjects(controller.signal);

    expect(get).toHaveBeenNthCalledWith(1, expect.any(String), controller.signal);
    expect(get).toHaveBeenNthCalledWith(2, expect.any(String), controller.signal);
  });
});
