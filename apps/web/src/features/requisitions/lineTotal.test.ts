import { describe, expect, it } from 'vitest';
import { lineTotalOf } from './lineTotal';

/**
 * D-017. The reported case is the first one here: the form multiplied -5 by -1000 and displayed
 * 5,000.00, which is the worst shape this defect can take because the figure looks right.
 */
describe('lineTotalOf', () => {
  it('refuses to cost a line where two negatives multiply into a plausible positive', () => {
    expect(lineTotalOf(-5, -1000)).toBeNull();
  });

  it('refuses a quantity above the schema bound', () => {
    expect(lineTotalOf(1_000_001, 10)).toBeNull();
  });

  it('refuses a unit price above the schema bound', () => {
    // The second half of the report: 99,999,999,999 was totalled and shown before submit
    // rejected it.
    expect(lineTotalOf(1, 99_999_999_999)).toBeNull();
  });

  it('refuses a fractional quantity', () => {
    expect(lineTotalOf(1.5, 100)).toBeNull();
  });

  it.each([
    ['an empty quantity', undefined, 100],
    ['an empty price', 2, undefined],
    ['a null quantity', null, 100],
    ['a string quantity', '2', 100],
  ])('returns null for %s', (_label, quantity, unitPrice) => {
    expect(lineTotalOf(quantity, unitPrice)).toBeNull();
  });

  it('costs a valid line', () => {
    expect(lineTotalOf(3, 250)).toBe(750);
  });

  /** Zero is a legitimate price, and must stay distinguishable from "not costable". */
  it('costs a free line as 0, not as null', () => {
    expect(lineTotalOf(4, 0)).toBe(0);
  });
});
