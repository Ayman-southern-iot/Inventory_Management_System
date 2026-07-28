import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
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
  { label, hint, error, className, ...rest },
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
        {...rest}
      />
    </FieldShell>
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
