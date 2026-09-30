import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/api/keys';
import { useSetServiceAccountActive } from './api';

/**
 * The page test mocks the hook, so it can only show the hook was asked to deactivate. This pins
 * what actually leaves the browser — the path and the body — and which cache entries go stale.
 */

const patch = vi.fn();

vi.mock('@/api/client', () => ({
  api: {
    patch: (path: string, body: unknown) => {
      patch(path, body);
      return Promise.resolve({});
    },
  },
}));

const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

describe('useSetServiceAccountActive', () => {
  let client: QueryClient;

  beforeEach(() => {
    patch.mockClear();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it('PATCHes the account with isActive false and nothing else', async () => {
    const { result } = renderHook(() => useSetServiceAccountActive(), { wrapper });

    await result.current.mutateAsync({ id: ACCOUNT_ID, isActive: false });

    expect(patch).toHaveBeenCalledWith(`/admin/api-keys/service-accounts/${ACCOUNT_ID}`, {
      isActive: false,
    });
  });

  /**
   * Each key row carries `serviceAccountIsActive`, so deactivating an account changes what the
   * key list must say (Blocked). The static usage document is not touched: it cannot change.
   */
  it('marks the account list and the key lists stale, and leaves the usage document alone', async () => {
    const accountsKey = queryKeys.apiKeys.serviceAccounts();
    const keysKey = queryKeys.apiKeys.list({ page: 1, limit: 25, includeRevoked: false });
    const usageKey = queryKeys.apiKeys.usage();
    client.setQueryData(accountsKey, []);
    client.setQueryData(keysKey, { items: [], page: 1, limit: 25, total: 0 });
    client.setQueryData(usageKey, {});
    const { result } = renderHook(() => useSetServiceAccountActive(), { wrapper });

    await result.current.mutateAsync({ id: ACCOUNT_ID, isActive: false });

    await waitFor(() => expect(client.getQueryState(accountsKey)?.isInvalidated).toBe(true));
    expect(client.getQueryState(keysKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(usageKey)?.isInvalidated).toBe(false);
  });
});
