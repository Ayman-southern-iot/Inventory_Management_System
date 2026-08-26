import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

const CONTROL = cn(
  'w-full rounded-[--radius-control] border border-border bg-surface px-3 text-sm text-ink',
  'placeholder:text-ink-subtle disabled:bg-surface-muted disabled:text-ink-subtle',
  'aria-[invalid=true]:border-danger',
);

interface FieldShellProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** Every control gets a real `<label for>` — the accessibility floor, not a nice-to-have. */
function FieldShell({ label, htmlFor, hint, error, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, onWheel, ...rest },
  ref,
) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, 'h-10', className)}
        onWheel={(event) => {
          // A focused `type="number"` input treats the wheel as increment/decrement, so an
          // ordinary page scroll silently rewrites whatever numeric field the cursor happens
          // to be over — unit costs, approved amounts, stock quantities. Dropping focus stops
          // the mutation and lets the page scroll on. `preventDefault` would also stop the
          // value changing, but it freezes scrolling under the cursor: a worse surprise.
          if (
            event.currentTarget.type === 'number' &&
            document.activeElement === event.currentTarget
          ) {
            event.currentTarget.blur();
          }
          onWheel?.(event);
        }}
        {...rest}
      />
    </FieldShell>
  );
});

interface CellInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Not rendered. Becomes the accessible name, since the visible label is the column header. */
  label: string;
  error?: string;
}

/**
 * An input for a table cell, where the column header is the visible label.
 *
 * `TextField` cannot do this job. It always renders a `<label>`, so a table of rows either
 * repeats the label on every row or passes an empty string and leaves an invisible element
 * still taking up vertical space — which is what pushed the item rows out of alignment and made
 * the line total and delete button need `pt-6` nudges to sit level with the inputs.
 *
 * The label still exists, as `aria-label`. A `<th>` alone does not reliably name an input inside
 * the cell across screen readers, and rules/30's accessibility floor is not negotiable just
 * because the label is drawn somewhere else.
 *
 * Keeps `TextField`'s wheel guard: a focused number input treats the wheel as increment, so an
 * ordinary page scroll would rewrite whichever unit price the cursor sat over.
 */
export const CellInput = forwardRef<HTMLInputElement, CellInputProps>(function CellInput(
  { label, error, className, onWheel, ...rest },
  ref,
) {
  const id = useId();
  return (
    <>
      <input
        ref={ref}
        id={id}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(CONTROL, 'h-9', className)}
        onWheel={(event) => {
          if (
            event.currentTarget.type === 'number' &&
            document.activeElement === event.currentTarget
          ) {
            event.currentTarget.blur();
          }
          onWheel?.(event);
        }}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
});

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, className, children, ...rest },
  ref,
) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error}>
      <select
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, 'h-10', className)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, hint, error, className, rows = 3, ...rest }, ref) {
    const id = useId();
    return (
      <FieldShell label={label} htmlFor={id} hint={hint} error={error}>
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(CONTROL, 'py-2', className)}
          {...rest}
        />
      </FieldShell>
    );
  },
);

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn('size-4 rounded border-border-strong accent-brand', className)}
        {...rest}
      />
      <label htmlFor={id} className="text-sm text-ink select-none">
        {label}
      </label>
    </div>
  );
});
