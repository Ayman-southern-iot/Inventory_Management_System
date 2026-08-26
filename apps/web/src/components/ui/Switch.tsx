import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * An on/off switch, for revealing an optional section rather than submitting a value.
 *
 * `role="switch"` on a real `<button>`, not a restyled checkbox. A checkbox announces itself as
 * "checked", which is the wrong word for a section that is showing or hidden, and it drags along
 * form-submission semantics this has nothing to do with — the switch does not go on the wire, it
 * only decides whether the fields under it exist.
 *
 * The whole row is the hit target, label included. A 20px track is a small thing to ask someone
 * to hit, and the label is the part they are actually reading.
 */
interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, hint, disabled = false }: SwitchProps) {
  const id = useId();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={hint ? `${id}-hint` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start justify-between gap-4 text-left',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{label}</span>
        {hint ? (
          <span id={`${id}-hint`} className="text-xs text-ink-subtle">
            {hint}
          </span>
        ) : null}
      </span>

      {/* `aria-hidden`: the button already carries the state, so the track is decoration. */}
      <span
        aria-hidden
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 size-4 rounded-full bg-surface shadow-[--shadow-panel]',
            'transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
    </button>
  );
}
