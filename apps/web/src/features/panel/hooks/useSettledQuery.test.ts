import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettledQuery } from './useSettledQuery';

const DELAY_MS = 250;

describe('useSettledQuery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () =>
    renderHook(({ query }) => useSettledQuery(query, DELAY_MS), { initialProps: { query: '' } });

  it('settles a typed query once typing pauses for the delay', () => {
    const { result, rerender } = setup();
    rerender({ query: 'ST' });
    expect(result.current).toBe('');
    act(() => vi.advanceTimersByTime(DELAY_MS));
    expect(result.current).toBe('ST');
  });

  it('clears at once, without waiting for the delay', () => {
    const { result, rerender } = setup();
    rerender({ query: 'ST-LINK' });
    act(() => vi.advanceTimersByTime(DELAY_MS));
    rerender({ query: '' });
    expect(result.current).toBe('');
  });

  it('never shows the query from before a clear while the next one is being typed', () => {
    const { result, rerender } = setup();
    rerender({ query: 'ST-LINK' });
    act(() => vi.advanceTimersByTime(DELAY_MS));
    rerender({ query: '' });
    act(() => vi.advanceTimersByTime(DELAY_MS / 5));
    rerender({ query: 'A' });
    act(() => vi.advanceTimersByTime(DELAY_MS / 5));
    expect(result.current).toBe('');
    act(() => vi.advanceTimersByTime(DELAY_MS));
    expect(result.current).toBe('A');
  });
});
