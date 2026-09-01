import { describe, expect, it } from 'vitest';
import { amountInWords } from './amount-in-words';

describe('amountInWords', () => {
  it('writes out the small cases', () => {
    expect(amountInWords(0)).toBe('Taka Zero Only');
    expect(amountInWords(1)).toBe('Taka One Only');
    expect(amountInWords(19)).toBe('Taka Nineteen Only');
    expect(amountInWords(20)).toBe('Taka Twenty Only');
    expect(amountInWords(21)).toBe('Taka Twenty-One Only');
    expect(amountInWords(100)).toBe('Taka One Hundred Only');
    expect(amountInWords(999)).toBe('Taka Nine Hundred Ninety-Nine Only');
  });

  it('writes the money-audit scenario', () => {
    expect(amountInWords(1_000)).toBe('Taka One Thousand Only');
    expect(amountInWords(20_500)).toBe('Taka Twenty Thousand Five Hundred Only');
  });

  /**
   * The reason this helper exists rather than a thousand/million library: this office counts in
   * lakh and crore. "One hundred thousand" on a document read here is both wrong-looking and
   * slower to check against the digits beside it.
   */
  it('groups in lakh and crore, not thousands and millions', () => {
    expect(amountInWords(100_000)).toBe('Taka One Lakh Only');
    expect(amountInWords(150_000)).toBe('Taka One Lakh Fifty Thousand Only');
    expect(amountInWords(10_000_000)).toBe('Taka One Crore Only');
    expect(amountInWords(12_345_678)).toBe(
      'Taka One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only',
    );
  });

  it('writes poisha as hundredths, the way a cheque is written', () => {
    expect(amountInWords(1_500.5)).toBe('Taka One Thousand Five Hundred and Fifty Poisha Only');
    expect(amountInWords(0.05)).toBe('Taka Zero and Five Poisha Only');
    expect(amountInWords(45_320.62)).toBe(
      'Taka Forty-Five Thousand Three Hundred Twenty and Sixty-Two Poisha Only',
    );
  });

  /**
   * The words exist to disagree loudly with an altered figure, so they must never disagree with
   * an honest one. Rounding first is what guarantees that.
   */
  it('rounds to the cent so the words cannot contradict the figure beside them', () => {
    expect(amountInWords(0.994)).toBe('Taka Zero and Ninety-Nine Poisha Only');
    // 99.999 rounds to 100.00 — the whole part carries rather than printing "Ninety-Nine and
    // One Hundred Poisha", which is the bug this arithmetic is arranged to avoid.
    expect(amountInWords(99.999)).toBe('Taka One Hundred Only');
  });

  /**
   * Not a rounding rule so much as a note on what the input actually is.
   *
   * `1.005` is not 1.005 in IEEE-754 — it is 1.00499999999999989, so rounding it to the cent
   * honestly gives 1.00, and any "fix" that printed One Poisha here would be inventing money.
   * It never arises in practice: every amount reaching this function comes from a
   * `NUMERIC(14,2)` column and is already exact to the cent. The rounding is belt and braces,
   * and this test records that it is not load-bearing.
   */
  it('is not asked to repair floating point it was never given', () => {
    expect(amountInWords(1.005)).toBe('Taka One Only');
  });

  /** Better to print nothing than a confidently wrong number on something that gets paid. */
  it('returns nothing rather than a wrong answer for input it cannot state', () => {
    expect(amountInWords(-1)).toBe('');
    expect(amountInWords(Number.NaN)).toBe('');
    expect(amountInWords(Number.POSITIVE_INFINITY)).toBe('');
    expect(amountInWords(10_000_000_000)).toBe('');
  });
});
