import { describe, expect, it } from 'vitest';
import { queryBoolean } from './common.js';

/**
 * Regression guard for the IM-portal bug where `?mine=false` returned the IM's
 * own (empty) requisitions instead of everyone's. `z.coerce.boolean()` parses
 * any non-empty string as `true`, so `mine=false` was being coerced to `true`.
 *
 * `queryBoolean` correctly handles the strings that an Express query string
 * actually carries.
 */
describe('queryBoolean', () => {
  it('parses the literal string "true" as true', () => {
    expect(queryBoolean().parse('true')).toBe(true);
  });

  it('parses the literal string "false" as false', () => {
    // The bug: z.coerce.boolean() parses "false" as true.
    expect(queryBoolean().parse('false')).toBe(false);
  });

  it('parses "0" as false and "1" as true', () => {
    expect(queryBoolean().parse('1')).toBe(true);
    expect(queryBoolean().parse('0')).toBe(false);
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(queryBoolean().parse('TRUE')).toBe(true);
    expect(queryBoolean().parse('  False  ')).toBe(false);
  });

  it('falls back to the default for unrecognised strings', () => {
    expect(queryBoolean(false).parse('yes')).toBe(false);
    expect(queryBoolean(true).parse('yes')).toBe(true);
    expect(queryBoolean(false).parse('')).toBe(false);
  });

  it('defaults when the field is omitted', () => {
    expect(queryBoolean(false).parse(undefined)).toBe(false);
    expect(queryBoolean(true).parse(undefined)).toBe(true);
  });

  it('passes native booleans through unchanged', () => {
    expect(queryBoolean().parse(true)).toBe(true);
    expect(queryBoolean().parse(false)).toBe(false);
  });
});
