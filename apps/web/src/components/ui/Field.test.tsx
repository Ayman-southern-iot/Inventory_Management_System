import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Controller, useForm } from 'react-hook-form';
import { TextField } from './Field';

/**
 * A focused `type="number"` input treats a wheel event as increment/decrement, so an ordinary
 * page scroll silently rewrites whatever numeric field the cursor happens to be over — unit
 * costs, approved amounts, stock quantities. Every numeric control in this app is a TextField,
 * so the guard belongs here rather than at the eleven call sites.
 */
describe('TextField wheel guard', () => {
  it('drops focus from a number field on wheel, so scrolling cannot change the value', () => {
    render(<TextField label="Unit cost" type="number" defaultValue={100} />);
    const input = screen.getByLabelText('Unit cost');

    input.focus();
    expect(input).toHaveFocus();

    fireEvent.wheel(input, { deltaY: 100 });

    expect(input).not.toHaveFocus();
  });

  it('leaves a focused text field alone — the guard is only for number inputs', () => {
    render(<TextField label="Vendor" type="text" />);
    const input = screen.getByLabelText('Vendor');

    input.focus();
    fireEvent.wheel(input, { deltaY: 100 });

    expect(input).toHaveFocus();
  });

  it('still calls a caller-supplied onWheel', () => {
    const onWheel = vi.fn();
    render(<TextField label="Quantity" type="number" onWheel={onWheel} />);

    fireEvent.wheel(screen.getByLabelText('Quantity'), { deltaY: 100 });

    expect(onWheel).toHaveBeenCalledTimes(1);
  });

  /**
   * The guard blurs, which fires `field.onBlur` — so on a form that validates on blur, a stray
   * wheel would paint an error the user never earned. No `useForm` in this app sets `mode`, so
   * RHF's default (`onSubmit`) applies and blur only marks the field touched. This pins that:
   * switching a form to `mode: 'onBlur'` fails here instead of surprising a user.
   * Mirrors ItemRow's wiring, which passes `onBlur={field.onBlur}` explicitly.
   */
  it('does not paint a validation error when the guard blurs an empty required field', () => {
    function Harness() {
      const { control } = useForm<{ price?: number }>({ defaultValues: {} });
      return (
        <Controller
          control={control}
          name="price"
          rules={{ required: 'Required' }}
          render={({ field, fieldState }) => (
            <TextField
              label="Unit price"
              type="number"
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={field.value === undefined ? '' : String(field.value)}
              onChange={(event) =>
                field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
              }
              error={fieldState.error?.message}
            />
          )}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText('Unit price');

    input.focus();
    fireEvent.wheel(input, { deltaY: 100 });

    expect(input).not.toHaveFocus();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });
});
