import { describe, expect, it } from 'vitest';
import { formatDate } from './format';

/**
 * D-011. The app rendered three date formats at once: a raw `2026-08-13` where an ISO field was
 * printed verbatim, `Aug 12, 2026` from `formatDateTime`, and `8/13/2026, 1:57:26 PM` from a bare
 * `toLocaleString()`. `formatDate` is the missing third helper, for fields that are a calendar
 * day rather than an instant.
 */
describe('formatDate', () => {
  /**
   * The trap this helper exists to avoid. `new Date('2026-08-13')` is parsed as UTC midnight and
   * then rendered in local time, so at Asia/Dhaka (+06) a naive implementation prints the 12th.
   * That is D-014's bug class, and the view layer is not reintroducing it.
   */
  it('keeps the calendar day it was given, whatever the local offset', () => {
    expect(formatDate('2026-08-13')).toContain('13');
    expect(formatDate('2026-08-13')).not.toContain('12');
  });

  it('formats as a readable day, not as a raw ISO string', () => {
    const formatted = formatDate('2026-08-13');
    expect(formatted).not.toBe('2026-08-13');
    expect(formatted).toMatch(/2026/);
  });

  it('accepts a full timestamp by reading only its date part', () => {
    expect(formatDate('2026-08-13T20:00:00.000Z')).toContain('13');
  });

  it.each([null, undefined, ''])('renders %s as a dash rather than "Invalid Date"', (value) => {
    expect(formatDate(value)).toBe('—');
  });

  it('shows an unparseable value verbatim rather than "Invalid Date"', () => {
    expect(formatDate('not a date')).toBe('not a date');
  });
});
