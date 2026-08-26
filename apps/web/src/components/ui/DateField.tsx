import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useAnchoredPosition } from '@/lib/useAnchoredPosition';

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
 * Emits an ISO instant. Migration 0027 made `approval_deadline` a `timestamptz` so the requester
 * can pick a time of day as well as a date.
 *
 * Every value is assembled from local Y/M/D/h/m parts through the `Date(y, m, d, h, min)`
 * constructor, never by parsing a string: `new Date('2026-08-13')` is UTC midnight and renders
 * as the 12th at +06, which is exactly the shift D-014 was about.
 */

/** Matches the w-72 on the popover below. */
const POPOVER_WIDTH_PX = 288;

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** A 12-hour clock, per Ayman's ruling 2026-08-26. */
const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
/** Quarter hours. A deadline is a rough intention, not an appointment; 60 options is noise. */
const MINUTES = ['00', '15', '30', '45'] as const;
const MERIDIEMS = ['AM', 'PM'] as const;

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
  /** An ISO instant, or null for empty. */
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

  const [open, setOpen] = useState(false);
  // Shared with the item-row suggestion list — both are portalled out of a Panel that clips.
  const {
    anchorRef: triggerRef,
    popoverRef,
    position,
  } = useAnchoredPosition<HTMLButtonElement, HTMLDivElement>(open, POPOVER_WIDTH_PX);

  /** The calendar day under consideration, as YYYY-MM-DD. Time is held separately below. */
  const [draft, setDraft] = useState<string | null>(null);
  /** 1-12, 0/15/30/45, and the meridiem — a 12-hour clock, per Ayman's ruling 2026-08-26. */
  const [hour12, setHour12] = useState(5);
  const [minute, setMinute] = useState(0);
  const [meridiem, setMeridiem] = useState<'AM' | 'PM'>('PM');
  const [viewYear, setViewYear] = useState(today.year);
  const [viewMonth, setViewMonth] = useState(today.month);

  // Reopening starts from the committed value, never from an abandoned draft.
  useEffect(() => {
    if (!open) return;

    const committed = value ? new Date(value) : null;
    if (committed && !Number.isNaN(committed.getTime())) {
      setDraft(toIsoDate(committed.getFullYear(), committed.getMonth(), committed.getDate()));
      const rawHour = committed.getHours();
      setHour12(rawHour % 12 === 0 ? 12 : rawHour % 12);
      setMinute(committed.getMinutes());
      setMeridiem(rawHour >= 12 ? 'PM' : 'AM');
      setViewYear(committed.getFullYear());
      setViewMonth(committed.getMonth());
    } else {
      setDraft(null);
      setViewYear(today.year);
      setViewMonth(today.month);
    }
  }, [open, value, today.year, today.month]);

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

  /**
   * The draft as a real instant — the value Set would commit.
   *
   * Built from local parts via the `Date(y, m, d, h, min)` constructor, never by parsing a
   * string. `new Date('2026-08-13T17:00')` is implementation-defined across browsers and
   * `new Date('2026-08-13')` is UTC midnight, which is the shift D-014 was about.
   */
  const draftInstant = useMemo(() => {
    if (!draft) return null;
    const [year, month, day] = draft.split('-').map(Number);
    // 12 AM is hour 0 and 12 PM is hour 12 — the two the naive `% 12` gets wrong.
    const hour24 =
      meridiem === 'AM' ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
    return new Date(year!, month! - 1, day!, hour24, minute, 0, 0);
  }, [draft, hour12, minute, meridiem]);

  /**
   * Ayman's ruling, 2026-08-26: "previous time and date not accepted, it should not also be
   * selectable". So a time is disabled, not merely refused, once it has passed — and only on
   * today, because on any later day every hour is still ahead.
   *
   * Stricter than the reference design, which disables past dates but leaves this morning's
   * hours pickable on today's date.
   */
  const draftIsToday = draft === today.iso;

  function isPastTime(candidateHour12: number, candidateMinute: number, candidateMeridiem: 'AM' | 'PM') {
    if (!draftIsToday) return false;
    const hour24 =
      candidateMeridiem === 'AM'
        ? candidateHour12 === 12
          ? 0
          : candidateHour12
        : candidateHour12 === 12
          ? 12
          : candidateHour12 + 12;
    const candidate = new Date(today.year, today.month, today.day, hour24, candidateMinute);
    return candidate.getTime() < Date.now();
  }

  /** Set is refused outright when the assembled instant is already behind us. */
  const draftIsPast = draftInstant !== null && draftInstant.getTime() < Date.now();

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
          {value ? formatDateTime(value) : (placeholder ?? t.common.dash)}
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

          {/*
            The time row. Buttons in a listbox, not `<select>` and not number inputs — a focused
            native control changes value on a wheel scroll, which is the whole reason this
            component exists rather than `<input type="datetime-local">`.
          */}
          <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3">
            <span className="mr-1 text-[0.625rem] font-semibold uppercase tracking-wider text-ink-subtle">
              {t.requisitions.timeLabel}
            </span>
            <TimeSelect
              label={t.requisitions.hourLabel}
              value={String(hour12).padStart(2, '0')}
              options={HOURS}
              isDisabled={(option) => isPastTime(Number(option), minute, meridiem)}
              onSelect={(option) => setHour12(Number(option))}
            />
            <span className="font-mono text-sm font-semibold text-ink-subtle">:</span>
            <TimeSelect
              label={t.requisitions.minuteLabel}
              value={String(minute).padStart(2, '0')}
              options={MINUTES}
              isDisabled={(option) => isPastTime(hour12, Number(option), meridiem)}
              onSelect={(option) => setMinute(Number(option))}
            />
            <TimeSelect
              label={t.requisitions.meridiemLabel}
              value={meridiem}
              options={MERIDIEMS}
              isDisabled={(option) => isPastTime(hour12, minute, option as 'AM' | 'PM')}
              onSelect={(option) => setMeridiem(option as 'AM' | 'PM')}
            />
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
              // Refused outright when the assembled instant has already passed, so the button
              // cannot commit something the server would reject at submit.
              disabled={!draftInstant || draftIsPast}
              onClick={() => {
                if (!draftInstant) return;
                onChange(draftInstant.toISOString());
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

/**
 * One segment of the time — hour, minute, or meridiem.
 *
 * A button that opens a list of buttons, not a `<select>`. A focused native select changes value
 * on a wheel scroll exactly as a number input does, and this component exists to be immune to
 * that. It is also the only way to grey out an option that has already passed, which
 * `<option disabled>` does inconsistently across browsers.
 */
function TimeSelect({
  label,
  value,
  options,
  isDisabled,
  onSelect,
}: {
  label: string;
  value: string;
  options: readonly string[];
  isDisabled: (option: string) => boolean;
  onSelect: (option: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className={cn(
          'flex items-center gap-1 rounded-[--radius-control] border border-border-strong',
          'bg-surface px-2 py-1.5 font-mono text-xs font-semibold text-ink hover:border-brand',
        )}
      >
        {value}
        <ChevronDown aria-hidden className="size-3 text-ink-subtle" />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label={label}
          className={cn(
            'absolute left-0 top-full z-10 mt-1 max-h-40 min-w-14 overflow-y-auto rounded-[--radius-control]',
            'border border-border bg-surface p-1 shadow-[--shadow-overlay]',
          )}
        >
          {options.map((option) => {
            const disabled = isDisabled(option);
            return (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option === value}
                  disabled={disabled}
                  onClick={() => {
                    onSelect(option);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full rounded-[--radius-control] px-2.5 py-1.5 text-center font-mono text-xs',
                    'text-ink hover:bg-brand-subtle',
                    option === value && 'bg-brand text-on-brand hover:bg-brand',
                    disabled &&
                      'cursor-not-allowed text-ink-subtle opacity-40 hover:bg-transparent',
                  )}
                >
                  {option}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
