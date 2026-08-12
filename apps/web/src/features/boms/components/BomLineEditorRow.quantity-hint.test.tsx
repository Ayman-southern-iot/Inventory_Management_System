import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { BomLineEditorRow } from './BomLineEditorRow';
import type { BomGenerateLine } from './types';

interface BomGenerateForm {
  lines: BomGenerateLine[];
}

function Harness({ overrideQty }: { overrideQty: number }) {
  const form = useForm<BomGenerateForm>({
    defaultValues: {
      lines: [
        {
          requisitionId: 'req-1',
          requisitionNo: 'REQ-000042',
          requisitionItemId: 'riq-1',
          itemName: 'Steel bar 12mm',
          sourceQuantity: 6,
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
            sourceQuantity={6}
            removed={false}
            lineTotal={1000}
          />
        </tbody>
      </table>
    </FormProvider>
  );
}

describe('BomLineEditorRow — source quantity hint', () => {
  it('renders the source quantity read-only next to the editable quantity input', () => {
    render(<Harness overrideQty={4} />);

    // The hint explicitly says "Originally 6 on the requisition" so the IM sees the
    // number they started with while their override (4) sits in the editable input.
    expect(screen.getByText(/originally 6 on the requisition/i)).toBeInTheDocument();

    // The input itself shows the override (4), not the source (6) — empty-equals-source
    // visual only kicks in when the override equals the source.
    const qtyInput = screen.getByLabelText(/qty/i) as HTMLInputElement;
    expect(qtyInput.value).toBe('4');
  });

  it('keeps the source quantity hint visible even when the override matches the source', () => {
    // Override equals the source — the input is empty by design, but the IM still needs
    // to see what they were going to type back. The hint is independent of the override.
    render(<Harness overrideQty={6} />);
    expect(screen.getByText(/originally 6 on the requisition/i)).toBeInTheDocument();
  });
});
