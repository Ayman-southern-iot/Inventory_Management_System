import { describe, expect, it } from 'vitest';
import { isValidTimeZone, todayIn } from './calendar';

/**
 * QA round 2, the tail of D-014.
 *
 * Three places asked "what day is it" and got three different answers: two computed
 * `new Date().toISOString().slice(0, 10)` (UTC), one used SQL `current_date` (the database
 * container's zone). Between 00:00 and 06:00 in Dhaka the UTC answer is yesterday, so an
 * overdue flag was a day behind for six hours every day — and if the API's zone and the
 * database's ever diverge, which nothing in the repo prevents because one is versioned and
 * the other lives in `infra/.env`, the two answers disagree around the clock rather than
 * for six hours.
 *
 * The instant below is inside that window on purpose: 20:00 UTC on the 23rd is 02:00 on the
 * 24th in Dhaka. Any implementation that formats an instant as UTC returns the 23rd here.
 */
const INSIDE_THE_WINDOW = new Date('2026-08-23T20:00:00.000Z');

describe('todayIn', () => {
  it('returns the calendar day in the given zone, not in UTC', () => {
    // The exact expression the three call sites used, kept here as the thing being replaced.
    expect(INSIDE_THE_WINDOW.toISOString().slice(0, 10)).toBe('2026-08-23');

    expect(todayIn('Asia/Dhaka', INSIDE_THE_WINDOW)).toBe('2026-08-24');
  });

  it('agrees with UTC when the zone is UTC', () => {
    expect(todayIn('UTC', INSIDE_THE_WINDOW)).toBe('2026-08-23');
  });

  it('handles a zone west of Greenwich, where the shift goes the other way', () => {
    // 20:00 UTC is still the 23rd in New York (16:00 EDT), but 01:00 UTC would be the 22nd.
    expect(todayIn('America/New_York', new Date('2026-08-23T01:00:00.000Z'))).toBe('2026-08-22');
  });

  it('pads month and day so the result sorts and compares as a string', () => {
    // The callers compare with `<` against a YYYY-MM-DD column value, so '2026-9-5' would
    // silently mis-order against '2026-10-01'.
    expect(todayIn('Asia/Dhaka', new Date('2026-09-05T06:00:00.000Z'))).toBe('2026-09-05');
  });

  it('defaults to now when no instant is given', () => {
    expect(todayIn('Asia/Dhaka')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isValidTimeZone', () => {
  it('accepts a real IANA zone', () => {
    expect(isValidTimeZone('Asia/Dhaka')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects a typo, which is the whole point of validating at boot', () => {
    // `z.string().min(1)` accepted this, and the first overdue calculation of the day would
    // have thrown a RangeError at request time instead of the process refusing to start.
    expect(isValidTimeZone('Asia/Dhakaa')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});
