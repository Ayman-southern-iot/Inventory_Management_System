import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIdleReset } from './useIdleReset';

const TIMEOUT_MS = 60_000;

describe('useIdleReset', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once the timeout passes with no touch', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleReset(onIdle, TIMEOUT_MS));

    vi.advanceTimersByTime(TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('restarts the clock on a touch, a key or a scroll', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleReset(onIdle, TIMEOUT_MS));

    for (const event of ['pointerdown', 'keydown', 'wheel']) {
      vi.advanceTimersByTime(TIMEOUT_MS - 1);
      window.dispatchEvent(new Event(event));
    }
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('fires again after the next quiet minute', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleReset(onIdle, TIMEOUT_MS));

    vi.advanceTimersByTime(TIMEOUT_MS);
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it('stops listening when the panel unmounts', () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleReset(onIdle, TIMEOUT_MS));
    unmount();
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
