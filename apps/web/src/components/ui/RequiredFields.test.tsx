import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { z } from 'zod';
import { RequiredFields } from './RequiredFields';
import { SelectField, TextAreaField, TextField } from './Field';

/**
 * The marker is derived, not declared.
 *
 * Marking every required control by hand across two dozen forms is a second source of truth,
 * and it fails silently in the worst direction: a contract changes, nobody revisits the list,
 * and a field stops being marked while the API still refuses it empty. Reading the schema means
 * the marker cannot say something the resolver will contradict.
 */
const schema = z.object({
  vendor: z.string().min(1),
  note: z.string().nullable(),
  category: z.string().min(1),
});

describe('RequiredFields', () => {
  it('marks the controls its schema will refuse empty, and leaves the rest alone', () => {
    render(
      <RequiredFields schema={schema}>
        <TextField label="Vendor" name="vendor" />
        <TextAreaField label="Note" name="note" />
        <SelectField label="Category" name="category">
          <option value="">None</option>
        </SelectField>
      </RequiredFields>,
    );

    expect(screen.getByRole('textbox', { name: 'Vendor' })).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveAttribute(
      'aria-required',
      'true',
    );
    // Nullable is a real answer of "none", not an omission — the same call D-006 made by hand
    // for the requisition's project.
    expect(screen.getByRole('textbox', { name: 'Note' })).not.toHaveAttribute('aria-required');
  });

  it('lets a field overrule the schema, for a requirement the schema cannot see', () => {
    render(
      <RequiredFields schema={schema}>
        {/* The funds dialog's reversal reason: mandatory only when the action is a reversal. */}
        <TextAreaField label="Note" name="note" required />
      </RequiredFields>,
    );

    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAttribute('aria-required', 'true');
  });

  it('marks nothing outside a provider, so an unwrapped form is unchanged', () => {
    render(<TextField label="Vendor" name="vendor" />);

    expect(screen.getByRole('textbox', { name: 'Vendor' })).not.toHaveAttribute('aria-required');
  });

  /** Colour is never the only signal (WCAG 3.3.1) — the visible marker rides with it. */
  it('shows a visible marker that is hidden from assistive tech', () => {
    render(
      <RequiredFields schema={schema}>
        <TextField label="Vendor" name="vendor" />
      </RequiredFields>,
    );

    const marker = screen.getByText('*');
    expect(marker).toHaveAttribute('aria-hidden');
    // The announced name stays clean, which is the whole reason the marker is hidden.
    expect(screen.getByRole('textbox', { name: 'Vendor' })).toBeInTheDocument();
  });
});
