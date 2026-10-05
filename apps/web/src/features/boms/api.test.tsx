import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { BomDetail } from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useBomForRequisition, useGenerateBom, useVoidBom } from './api';

/**
 * Audit F1. After the IM generated a BOM and came back to the requisition in the same session, the
 * page still said "Approved" and offered "Generate the BOM" again; "Send to Accounts" appeared only
 * after a full reload. Generating or voiding a BOM changes the status of every requisition on it,
 * but the shared BOM mutation refreshed only the BOM lists.
 */
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const SOURCE_A = '11111111-1111-4111-8111-111111111111';
const SOURCE_B = '22222222-2222-4222-8222-222222222222';

function bom(overrides: Partial<BomDetail> = {}): BomDetail {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    bomNo: 'BOM-000001',
    sources: [
      { requisitionId: SOURCE_A, requisitionNo: 'REQ-000001', footprints: [] },
      { requisitionId: SOURCE_B, requisitionNo: 'REQ-000002', footprints: [] },
    ],
    lines: [],
    ...overrides,
  } as unknown as BomDetail;
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

function invalidatedKeys(invalidate: ReturnType<typeof setup>['invalidate']): unknown[] {
  return invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

describe('BOM mutations refresh the requisitions they change', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockReset();
  });

  it.each([
    ['generating', () => useGenerateBom(), (hook: ReturnType<typeof useGenerateBom>) => hook.mutateAsync({ requisitionIds: [SOURCE_A], lines: [] } as never)],
    ['voiding', () => useVoidBom(), (hook: ReturnType<typeof useVoidBom>) => hook.mutateAsync({ id: 'b', input: { reason: 'wrong vendor' } })],
  ])('after %s, the requisition detail and lists are refetched', async (_label, useHook, run) => {
    vi.mocked(api.post).mockResolvedValue(bom());
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useHook() as never, { wrapper });

    await (run as (hook: unknown) => Promise<unknown>)(result.current);

    const keys = invalidatedKeys(invalidate);
    expect(keys).toContainEqual(queryKeys.requisitions.detail(SOURCE_A));
    expect(keys).toContainEqual(queryKeys.requisitions.detail(SOURCE_B));
    expect(keys).toContainEqual(queryKeys.requisitions.lists());
    expect(keys).toContainEqual(queryKeys.boms.byRequisition(SOURCE_A));
    expect(keys).toContainEqual(queryKeys.boms.candidates());
  });

  it('still refreshes the BOM lists', async () => {
    vi.mocked(api.post).mockResolvedValue(bom());
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useGenerateBom(), { wrapper });

    await result.current.mutateAsync({ requisitionIds: [SOURCE_A], lines: [] } as never);

    expect(invalidatedKeys(invalidate)).toContainEqual(queryKeys.boms.lists());
  });
});

/**
 * Audit F2. The live-BOM lookup is IM and Admin only on the server, but the funds panel asked for it
 * on every requisition page, so a requester or approver got a 403 each time.
 */
describe('useBomForRequisition', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('does not ask the server when the viewer cannot read it', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useBomForRequisition(SOURCE_A, { enabled: false }), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('asks as before when enabled, and by default', async () => {
    vi.mocked(api.get).mockResolvedValue(null);
    const { wrapper } = setup();
    const { result } = renderHook(() => useBomForRequisition(SOURCE_A), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
