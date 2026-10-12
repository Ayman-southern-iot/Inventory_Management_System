import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LOCATE_MAX_PRODUCTS } from '@ims/shared';
import type * as ClientModule from '@/api/client';
import { api } from '@/api/client';
import { LOCATE_PATH } from '../api';
import { useLocateSettledResult } from './useLocateSettledResult';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});
const post = vi.mocked(api.post);

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

function mount(search: string | null, ids: readonly string[] | null) {
  return renderHook(
    ({ text, found }: { text: string | null; found: readonly string[] | null }) =>
      useLocateSettledResult(text, found),
    { wrapper, initialProps: { text: search, found: ids } },
  );
}

/** A mutation calls its function a few microtasks after `mutate`; let any pending one run. */
const settle = () => act(async () => {});

describe('useLocateSettledResult', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ seq: 1 });
  });

  it('posts the distinct ids once for a settled result', async () => {
    const { rerender } = mount('servo', [A, B, A]);
    await waitFor(() => expect(post).toHaveBeenCalled());
    // A re-render, or a refetch returning the same products, is the same settled result.
    rerender({ text: 'servo', found: [A, B] });
    await settle();
    expect(post.mock.calls).toEqual([[LOCATE_PATH, { productIds: [A, B] }]]);
  });

  it('posts again when the search unsettles and settles on the same word', async () => {
    const { rerender } = mount('servo', [A]);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    rerender({ text: null, found: null });
    rerender({ text: 'servo', found: [A] });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  });

  it('treats the same products in another order as the same result', async () => {
    const { rerender } = mount('servo', [A, B]);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    rerender({ text: 'servo', found: [B, A] });
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('neither posts nor forgets while paused, so stepping away and back lights nothing', async () => {
    const { rerender } = renderHook(
      ({ found, isEnabled }: { found: readonly string[]; isEnabled: boolean }) =>
        useLocateSettledResult('servo', found, isEnabled),
      { wrapper, initialProps: { found: [A], isEnabled: true } },
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    rerender({ found: [A], isEnabled: false });
    rerender({ found: [A, B], isEnabled: false });
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    rerender({ found: [A], isEnabled: true });
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it(`posts nothing for no match or for more than ${LOCATE_MAX_PRODUCTS} products`, async () => {
    const tooMany = Array.from(
      { length: LOCATE_MAX_PRODUCTS + 1 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const { rerender } = mount('servo', []);
    rerender({ text: 'res', found: tooMany });
    rerender({ text: null, found: null });
    await settle();
    expect(post).not.toHaveBeenCalled();
  });
});
