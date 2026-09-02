import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ExpenseReport } from '@ims/shared';
import { t } from '@/i18n/en';
import { ExpenseFlow } from './ExpenseFlow';

/**
 * The two gaps under the flow, and the one that was wrong.
 *
 * Money returned to Accounts has left the building; money in hand has not. Reporting their sum as
 * "in hand" overstates what the IM is still holding by exactly whatever went back — and it did,
 * from the page's rebuild until 2026-09-02, because `inHand` was `funded − spent` with no
 * `returned` term.
 *
 * The failure was invisible in the obvious way: the number looked plausible, and nothing on the
 * page contradicted it. The requisition's own funding panel had it right the whole time, so the
 * test that matters is the one that pins the two surfaces to the same arithmetic.
 */

/** Ayman's screenshot of 2026-09-02, which is where the discrepancy was spotted. */
function totals(overrides: Partial<ExpenseReport['totals']> = {}): ExpenseReport['totals'] {
  return {
    requisitionCount: 1,
    requested: 20_500,
    approved: 20_500,
    funded: 20_500,
    // The report folds the carriage into spent: 18,000 of invoices + 1,000 of transport.
    spent: 19_000,
    purchased: 18_000,
    transportation: 1_000,
    returned: 1_000,
    netCash: 19_500,
    ...overrides,
  };
}

function renderFlow(over: Partial<ExpenseReport['totals']> = {}) {
  render(<ExpenseFlow totals={totals(over)} periodLabel="September 2026" />);
}

/** The strip is a run of label/value pairs; this reads the value sitting next to one label. */
function figureFor(label: string): string {
  const node = screen.getByText(label);
  return within(node.parentElement as HTMLElement).getAllByText(/[\d,]+\.\d{2}/)[0]!.textContent!;
}

describe('the two gaps under the expense flow', () => {
  it('shows what went back to Accounts as its own figure', () => {
    renderFlow();

    expect(figureFor(t.expenses.gapReturned)).toBe('1,000.00');
  });

  /**
   * The regression itself. 20,500 funded − 19,000 spent is 1,500, but 1,000 of that has already
   * been handed back, so only 500 is in hand. The old code printed 1,500.
   */
  it('does not count returned money as still in hand', () => {
    renderFlow();

    expect(figureFor(t.expenses.gapInHand)).toBe('500.00');
    expect(figureFor(t.expenses.gapInHand)).not.toBe('1,500.00');
  });

  /**
   * The two surfaces must agree, because a reader comparing them is exactly how this was found.
   * The requisition's funding panel computes `funded − spent − transportation − returned`; the
   * report has already folded transportation into `spent`, so the same figure falls out here.
   */
  it('agrees with the requisition funding panel', () => {
    const t0 = totals();
    const panelUnspent = t0.funded - t0.purchased - t0.transportation - t0.returned;

    renderFlow();

    expect(figureFor(t.expenses.gapInHand)).toBe(panelUnspent.toFixed(2));
  });

  it('shows nothing returned as a zero rather than hiding the row', () => {
    renderFlow({ returned: 0, netCash: 20_500 });

    expect(figureFor(t.expenses.gapReturned)).toBe('0.00');
    // With nothing returned, in hand is the whole remainder again.
    expect(figureFor(t.expenses.gapInHand)).toBe('1,500.00');
  });

  /**
   * Floored, not negative. Accounts releasing more than was spent-and-returned is an overage to
   * investigate, not a debt — the same reasoning the funding endpoint applies to `unspent`.
   */
  it('floors in hand at zero rather than showing a negative', () => {
    renderFlow({ spent: 21_000, purchased: 20_000, returned: 1_000 });

    expect(figureFor(t.expenses.gapInHand)).toBe('0.00');
  });

  it('still shows what Accounts has not released yet', () => {
    renderFlow({ approved: 20_500, funded: 12_000 });

    expect(figureFor(t.expenses.gapAwaiting)).toBe('8,500.00');
  });
});
