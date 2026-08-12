import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type BomLine, type RequisitionFootprints } from '@ims/shared';
import { t } from '@/i18n/en';
import { BomSourceSection } from './BomSourceSection';
import { bomLine, sourceFootprints } from '../__fixtures__/bom';

/**
 * Per-source breakdown mirrors the printed PDF — item subtotal, transportation
 * (only when non-zero), total amount. These tests pin the conditional render
 * so a regression in the formula or the gate does not pass silently.
 */

function renderSection(source: RequisitionFootprints, lines: BomLine[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BomSourceSection source={source} lines={lines} />
    </QueryClientProvider>,
  );
}

describe('BomSourceSection — per-source breakdown', () => {
  // The breakdown prints two/three rows of "label + value", and the items table also
  // prints each line's `totalCost`. The breakdown value can collide with either, so
  // every assertion is scoped to the label's parent to avoid cross-element matches.

  function rowValue(label: string): HTMLElement {
    // Each breakdown row is a flex container: the label is a span inside it; the value
    // is the *last* span. Walk the row and return that span.
    const labelEl = screen.getByText(label);
    const row = labelEl.parentElement;
    if (!row) throw new Error(`row missing for label "${label}"`);
    const spans = row.querySelectorAll('span');
    const valueEl = spans[spans.length - 1];
    if (!valueEl) throw new Error(`value span missing for label "${label}"`);
    return valueEl as HTMLElement;
  }

  it('shows Item subtotal and Total amount rows when there is no transportation', () => {
    const source = sourceFootprints({ transportationCost: null });
    const lines = [
      bomLine({ totalCost: 1700, requisitionNo: source.requisitionNo }),
      bomLine({ totalCost: 1900, requisitionNo: source.requisitionNo }),
    ];

    renderSection(source, lines);

    expect(rowValue(t.boms.itemsSubtotal).textContent).toBe('3,600');
    expect(rowValue(t.boms.totalAmount).textContent).toBe('3,600');
    // No zero-row Transportation cell.
    expect(screen.queryByText(t.boms.transportation)).not.toBeInTheDocument();
  });

  it('shows the Transportation row with the description when cost > 0', () => {
    const source = sourceFootprints({
      transportationCost: 200,
      transportationDescription: 'Pickup truck to Gazipur',
    });
    // Items sum 2,200 + transportation 200 = 2,400 — distinct from the per-row line totals
    // so `getByText` cannot double-find the value.
    const lines = [
      bomLine({ totalCost: 1100, requisitionNo: source.requisitionNo }),
      bomLine({ totalCost: 1100, requisitionNo: source.requisitionNo }),
    ];

    renderSection(source, lines);

    expect(rowValue(t.boms.itemsSubtotal).textContent).toBe('2,200');
    expect(rowValue(t.boms.transportation).textContent).toBe('200');
    // The description hint lives inside the label's parent span as a child span with the
    // italic class. Scope the match to that hint span specifically so it doesn't also
    // match the parent label span (which contains "Transportation — Pickup truck to Gazipur").
    expect(
      document.querySelector('span.italic')?.textContent,
    ).toContain('Pickup truck to Gazipur');
    expect(rowValue(t.boms.totalAmount).textContent).toBe('2,400');

    // The order matters: the breakdown reads Transportation → Items subtotal → Total
    // amount so it mirrors the BOM PDF layout (operator, 2026-08-12). Compare the DOM
    // order of the three breakdown labels against the rendered sequence.
    const breakdownContainer = rowValue(t.boms.totalAmount).closest('div.border-t');
    const breakdownLabels = breakdownContainer
      ? Array.from(breakdownContainer.querySelectorAll('span')).map((s) => s.textContent ?? '')
      : [];
    const labelsByPos = breakdownLabels.filter((text) =>
      [t.boms.transportation, t.boms.itemsSubtotal, t.boms.totalAmount].some((label) =>
        text.includes(label),
      ),
    );
    // Transportation appears with its description chip, so the label text is
    // "Transportation — Pickup truck to Gazipur"; the other two are exact matches.
    expect(labelsByPos[0]).toMatch(/^Transportation/);
    expect(labelsByPos[1]).toContain(t.boms.itemsSubtotal);
    expect(labelsByPos[2]).toContain(t.boms.totalAmount);
  });

  it('treats transportationCost === 0 the same as null (no row, total = items)', () => {
    const source = sourceFootprints({ transportationCost: 0 });
    const lines = [
      bomLine({ totalCost: 1300, requisitionNo: source.requisitionNo }),
      bomLine({ totalCost: 1300, requisitionNo: source.requisitionNo }),
    ];

    renderSection(source, lines);

    expect(rowValue(t.boms.itemsSubtotal).textContent).toBe('2,600');
    expect(screen.queryByText(t.boms.transportation)).not.toBeInTheDocument();
    expect(rowValue(t.boms.totalAmount).textContent).toBe('2,600');
  });
});