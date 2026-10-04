import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importOrReloadOnce, sessionReloadGuard, type ReloadGuard } from './import-or-reload';

const KEY = 'test.chunk-reloaded';
const chunkGone = () => new TypeError('Failed to fetch dynamically imported module');

/** The real sessionStorage guard, with reload replaced so the test page does not go away. */
function guard(): ReloadGuard & { reload: ReturnType<typeof vi.fn> } {
  return { ...sessionReloadGuard(KEY), reload: vi.fn() };
}

/** Resolves true if `promise` has not settled after the microtask queue drains. */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return !settled;
}

describe('importOrReloadOnce', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('hands back the module and clears the flag when the chunk loads', async () => {
    sessionStorage.setItem(KEY, '1');
    const g = guard();
    await expect(importOrReloadOnce(() => Promise.resolve('module'), g)).resolves.toBe('module');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(g.reload).not.toHaveBeenCalled();
  });

  it('reloads the page once, with the flag set, when the chunk is gone', async () => {
    const g = guard();
    const loading = importOrReloadOnce(() => Promise.reject(chunkGone()), g);
    expect(await isPending(loading)).toBe(true);
    expect(g.reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(KEY)).toBe('1');
  });

  it('does not reload a second time: after the reload the error reaches the error boundary', async () => {
    sessionStorage.setItem(KEY, '1');
    const g = guard();
    await expect(importOrReloadOnce(() => Promise.reject(chunkGone()), g)).rejects.toThrow(
      'dynamically imported module',
    );
    expect(g.reload).not.toHaveBeenCalled();
  });

  it('never reloads when storage cannot be read, since nothing would stop a loop', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const g = guard();
    await expect(importOrReloadOnce(() => Promise.reject(chunkGone()), g)).rejects.toThrow();
    expect(g.reload).not.toHaveBeenCalled();
  });

  it('never reloads when the flag cannot be written', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const g = guard();
    await expect(importOrReloadOnce(() => Promise.reject(chunkGone()), g)).rejects.toThrow();
    expect(g.reload).not.toHaveBeenCalled();
  });
});
