import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { TextField } from '@/components/ui/Field';

interface QuantityFieldProps<TValues extends FieldValues> {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  label: string;
  hint?: string;
  error?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}

/**
 * A number input wired to react-hook-form.
 *
 * `register(..., { valueAsNumber: true })` turns a cleared field into `NaN`, which the shared
 * zod schema reports as "expected number, received nan" — server-shaped copy leaking into the
 * UI. Mapping empty to `undefined` gets the schema's "Required" instead, which is the truth.
 */
export function QuantityField<TValues extends FieldValues>({
  control,
  name,
  label,
  hint,
  error,
  min,
  max,
  disabled,
}: QuantityFieldProps<TValues>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <TextField
          label={label}
          hint={hint}
          error={error}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          name={field.name}
          ref={field.ref}
          onBlur={field.onBlur}
          value={field.value === undefined || field.value === null ? '' : String(field.value)}
          onChange={(event) => {
            const raw = event.target.value;
            field.onChange(raw === '' ? undefined : Number(raw));
          }}
        />
      )}
    />
  );
}
