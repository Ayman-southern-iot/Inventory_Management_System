import { describe, expect, it } from 'vitest';
import { formatBdt } from './format';

describe('formatBdt', () => {
  it('prints two decimal places', () => {
    expect(formatBdt(1200)).toMatch(/1,200\.00/);
    expect(formatBdt(0)).toMatch(/0\.00/);
    expect(formatBdt(12.5)).toMatch(/12\.50/);
  });

  it('renders unknown values as an em dash, never as NaN', () => {
    // The page has crashed in the past because a renamed API field returned undefined here.
    // That must never happen again: a missing figure is not "NaN", and crashing the whole
    // screen on a transient mismatch is worse than showing an em dash.
    expect(formatBdt(undefined)).toBe('—');
    expect(formatBdt(null)).toBe('—');
    expect(formatBdt(Number.NaN)).toBe('—');
  });
});