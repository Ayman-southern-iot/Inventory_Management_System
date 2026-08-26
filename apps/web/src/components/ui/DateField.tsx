import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';

/**
 * A date picker built out of buttons.
 *
 * Not `<input type="date">`, and deliberately so. The native control renders differently in every
 * browser, cannot disable a past date in a way the user can see before clicking it, and — the
 * reason it keeps coming back — silently changes its value when a wheel scrolls over it while
 * focused. `Field.tsx` already blurs number inputs on wheel for that reason (`f9c643b`); a
 * control made of buttons cannot have the problem at all.
 *
 * Nothing commits until Set is pressed. The popover is a draft the user reviews: picking a day
 * and then closing without applying leaves the field exactly as it was, which is what makes it
 * safe to explore the calendar on a form you have half filled in.
 *
 * A calendar day, not an instant. `approval_deadline` is a Postgres `date`, and `532a4ba`
 * (D-014) exists precisely because treating these as instants shifted every date a day backwards
 * east of Greenwich. Everything here is built from local Y/M/D parts and emits `YYYY-MM-DD`;
 * `new Date('2026-08-13')` is never used, because that parses as UTC midnight.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** `YYYY-MM-DD` from local parts. `toISOString()` would convert to UTC and lose the day. */
function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function startOfToday(): { year: number; month: number; day: number; iso: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  return { year, month, day, iso: toIsoDate(year, month, day) };
}

interface DateFieldProps {
  label: string;
  /** `YYYY-MM-DD`, or null for empty. */
  value: string | null;
  onChange: (value: string | null) => void;
  hint?: string;
  error?: string;
  /** Shown when nothing is chosen. The field is optional wherever this component is used today. */
  placeholder?: string;
}

export function DateField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
}: DateFieldProps) {
  const id = useId();
  const today = useMemo(startOfToday, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const [open, setOpen] = useState(false);
  /** The day the user is considering. Only `onChange` on Set makes it real. */
  const [draft, setDraft] = useState<string | null>(value);
  const [viewYear, setViewYear] = useState(today.year);
  const [viewMonth, setViewMonth] = useState(today.month);

  // Reopening starts from the committed value, never from an abandoned draft.
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    const parts = value?.split('-');
    setViewYear(parts ? Number(parts[0]) : today.year);
    setViewMonth(parts ? Number(parts[1]) - 1 : today.month);
  }, [open, value, today.year, today.month]);

  /**
   * Where the popover goes, measured against the trigger in viewport coordinates.
   *
   * The popover is rendered through a portal (see the bottom of this file), so it is a child of
   * `document.body` rather than of the field. That is the fix for it being cut off: `Panel`
   * carries `overflow-hidden` to keep its own children inside its rounded corners, and anything
   * absolutely positioned inside a Panel gets clipped by it. A portal has no such ancestor.
   *
   * It also flips above the trigger when there is not enough room below, which the old
   * `top-full` could not do — a field near the bottom of a long form put the calendar off the
   * end of the window.
   */
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const popoverHeight = popoverRef.current?.offsetHeight ?? 0;
    const GAP = 4;

    // Below unless it would overflow the viewport *and* there is more room above.
    const roomBelow = window.innerHeight - rect.bottom;
    const flipUp = popoverHeight > 0 && roomBelow < popoverHeight + GAP && rect.top > roomBelow;

    setPosition({
      top: flipUp ? rect.top - popoverHeight - GAP : rect.bottom + GAP,
      // Kept inside the right edge on a narrow window, and never off the left.
      left: Math.max(GAP, Math.min(rect.left, window.innerWidth - 288 - GAP)),
    });
  }, []);

  // Before paint, so the popover never renders at the wrong place for a frame.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  // Scrolling or resizing moves the trigger; the popover has to follow it. `capture` so a
  // scrolling ancestor counts, not just the window.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  // Close on an outside click or Escape. Escape matters more than it looks: this sits inside a
  // form, and a picker you can only dismiss by clicking away is a trap for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The popover is portalled out of the field, so "inside" has to mean either of them —
      // otherwise the first click on a day would close the thing it landed in.
      if (containerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  // You cannot page into a month that is entirely behind you. Letting someone browse July only to
  // find every day greyed out is a worse answer than not offering the trip.
  const atCurrentMonth = viewYear === today.year && viewMonth === today.month;

  function shiftMonth(direction: -1 | 1) {
    const next = viewMonth + direction;
    if (next < 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else if (next > 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(next);
    }
  }

  const leadingBlanks = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  return (
    // `relative` is load-bearing: the popover below is absolutely positioned and would
    // otherwise anchor to whatever distant ancestor happens to be positioned.
    <div className="relative flex flex-col gap-1.5" ref={containerRef}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>

      {/* The whole field opens the calendar, not just the icon — a click on the text is the
          same intent, and hunting for the one live pixel is the commonest complaint about
          date inputs. */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-[--radius-control] border border-border',
          'bg-surface px-3 text-left text-sm text-ink',
          'hover:border-border-strong focus-visible:border-brand focus-visible:outline-none',
          error && 'border-danger',
        )}
      >
        <Calendar aria-hidden className="size-4 shrink-0 text-ink-subtle" />
        <span className={cn('tabular-nums', !value && 'text-ink-subtle')}>
          {value ? formatDate(value) : (placeholder ?? t.common.dash)}
        </span>
      </button>

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={label}
              style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
              className={cn(
                'fixed z-50 w-72 rounded-[--radius-panel] border border-border',
                'bg-surface p-4 shadow-[--shadow-overlay]',
                // Hidden until measured, so it cannot flash at 0,0 on the first frame.
                position ? 'visible' : 'invisible',
              )}
            >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              disabled={atCurrentMonth}
              aria-label={t.common.previous}
              className={cn(
                'flex size-7 items-center justify-center rounded-[--radius-control]',
                'border border-border text-ink-muted hover:bg-surface-muted',
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface',
              )}
            >
              <ChevronLeft aria-hidden className="size-3.5" />
            </button>
            <div className="text-sm font-semibold text-ink">{monthLabel}</div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label={t.common.next}
              className={cn(
                'flex size-7 items-center justify-center rounded-[--radius-control]',
                'border border-border text-ink-muted hover:bg-surface-muted',
              )}
            >
              <ChevronRight aria-hidden className="size-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-7">
            {WEEKDAYS.map((weekday) => (
              <span
                key={weekday}
                className="pb-1.5 text-center text-[0.625rem] font-semibold text-ink-subtle"
              >
                {weekday}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: leadingBlanks }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden />
            ))}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const iso = toIsoDate(viewYear, viewMonth, day);
              // String comparison is safe and exact on zero-padded ISO dates, and avoids
              // constructing a Date only to compare it.
              const isPast = iso < today.iso;
              const isToday = iso === today.iso;
              const isSelected = iso === draft;

              return (
                <button
                  key={iso}
                  type="button"
                  disabled={isPast}
                  onClick={() => setDraft(iso)}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-[--radius-control]',
                    'text-xs tabular-nums text-ink hover:bg-brand-subtle',
                    isToday && 'font-bold text-brand',
                    isSelected && 'bg-brand text-on-brand hover:bg-brand',
                    isPast && 'cursor-not-allowed text-ink-subtle opacity-40 hover:bg-surface',
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                onChange(null);
                setOpen(false);
              }}
              className="px-1 py-1.5 text-xs font-semibold text-ink-muted hover:text-danger"
            >
              {t.common.clear}
            </button>
            <button
              type="button"
              disabled={!draft}
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              className={cn(
                'rounded-[--radius-control] bg-brand px-3.5 py-2 text-xs font-semibold',
                'text-on-brand hover:bg-brand-hover disabled:opacity-40',
              )}
            >
              {t.requisitions.setDeadline}
            </button>
          </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
