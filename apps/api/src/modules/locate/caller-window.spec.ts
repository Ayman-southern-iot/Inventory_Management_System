import { describe, expect, it } from 'vitest';
import { CallerWindow } from './caller-window';

describe('CallerWindow', () => {
  it('allows the limit, refuses the next, and says when to come back', () => {
    const window = new CallerWindow(3, 60_000);
    expect([0, 1, 2].map(() => window.take('user:a', 1_000))).toEqual([0, 0, 0]);
    expect(window.take('user:a', 1_000)).toBe(60);
    expect(window.take('user:a', 31_000)).toBe(30);
  });

  it('counts each caller on its own', () => {
    const window = new CallerWindow(1, 60_000);
    expect(window.take('user:a', 0)).toBe(0);
    expect(window.take('user:b', 0)).toBe(0);
    expect(window.take('apikey:k', 0)).toBe(0);
    expect(window.take('user:a', 0)).toBeGreaterThan(0);
  });

  it('opens a fresh window once the old one has passed', () => {
    const window = new CallerWindow(1, 60_000);
    window.take('user:a', 0);
    expect(window.take('user:a', 59_999)).toBe(1);
    expect(window.take('user:a', 60_000)).toBe(0);
  });

  it('never asks for a wait of zero seconds', () => {
    const window = new CallerWindow(1, 60_000);
    window.take('user:a', 0);
    expect(window.take('user:a', 59_999)).toBe(1);
  });
});
