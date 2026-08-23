import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { BomLineEditorRow } from './BomLineEditorRow';
import type { BomGenerateLine } from './types';

interface BomGenerateForm {
  lines: BomGenerateLine[];
}

function Harness({
  overrideQty,
  sourceQuantity = 6,
}: {
  overrideQty: number;
  sourceQuantity?: number;
}) {
  const form = useForm<BomGenerateForm>({
    defaultValues: {
      lines: [
        {
          requisitionId: 'req-1',
          requisitionNo: 'REQ-000042',
          requisitionItemId: 'riq-1',
          itemName: 'Steel bar 12mm',
          sourceQuantity,
          quantity: overrideQty,
          estimatedUnitPrice: null,
          unitCost: 250,
          vendor: 'Acme Steel',
          removed: false,
        },
      ],
    },
  });
  return (
    <FormProvider {...form}>
      <table>
        <tbody>
          <BomLineEditorRow
            index={0}
            control={form.control}
            register={form.register}
            itemName="Steel bar 12mm"
            sourceQuantity={sourceQuantity}
            removed={false}
            lineTotal={1000}
          />
        </tbody>
      </table>
    </FormProvider>
  );
}

const qty = () => screen.getByLabelText(/qty/i) as HTMLInputElement;

describe('BomLineEditorRow — source quantity hint', () => {
  it('renders the source quantity read-only next to the editable quantity input', () => {
    render(<Harness overrideQty={4} />);

    expect(screen.getByText(/originally 6 on the requisition/i)).toBeInTheDocument();
    expect(qty().value).toBe('4');
  });

  it('keeps the source quantity hint visible when the override matches the source', () => {
    render(<Harness overrideQty={6} />);
    expect(screen.getByText(/originally 6 on the requisition/i)).toBeInTheDocument();
  });
});

/**
 * QA round 2, D-028 — High.
 *
 * The display was derived from the form value: `value={field.value === sourceQuantity ? '' :
 * String(field.value)}`. The empty string was overloaded to mean "same as the source", so the
 * moment the IM typed the source quantity the field blanked itself. Buying exactly what was
 * requested — the ordinary case — looked impossible, and on a line whose source is 1 the only
 * legal value is the one that clears.
 *
 * The convention itself is worth keeping: leaving the box empty means "keep the source". It
 * just cannot be inferred from the value, because the value is the same either way. Only the
 * IM having actually emptied the box means the box is empty.
 */
describe('BomLineEditorRow — typing the source quantity', () => {
  it('keeps the number visible when the IM types the full source quantity', async () => {
    const user = userEvent.setup();
    render(<Harness overrideQty={4} />);

    await user.clear(qty());
    await user.type(qty(), '6');

    expect(qty().value).toBe('6');
  });

  it('holds 1 on a line whose source is 1 — the case with no other legal value', async () => {
    const user = userEvent.setup();
    render(<Harness overrideQty={1} sourceQuantity={1} />);

    await user.clear(qty());
    await user.type(qty(), '1');

    expect(qty().value).toBe('1');
  });

  it('still lets the IM empty the box to mean "keep the source"', async () => {
    const user = userEvent.setup();
    render(<Harness overrideQty={4} />);

    await user.clear(qty());

    // Empty on screen, because that is what the IM did — and the form carries the source
    // quantity underneath, which is the whole point of the convention.
    expect(qty().value).toBe('');
  });

  it('clamps above the source without blanking the field', async () => {
    const user = userEvent.setup();
    render(<Harness overrideQty={4} />);

    await user.clear(qty());
    await user.type(qty(), '99');

    expect(qty().value).toBe('6');
  });
});
