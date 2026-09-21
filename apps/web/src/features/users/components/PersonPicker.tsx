import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { PAGINATION_MAX_LIMIT, type SelectableUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { useAnchoredPosition } from '@/lib/useAnchoredPosition';
import { useDebouncedValue } from '@/features/inventory/hooks/useDebouncedValue';
import { useSelectableUsers } from '../api';

/**
 * Choose a person, showing who they are rather than only their name.
 *
 * A native `<select>` cannot carry two lines and an avatar, and "which Rahman?" is a real
 * question in a company with several — the designation underneath is what answers it. Built as
 * a listbox rather than a tree: there is no hierarchy here, just a searchable list.
 *
 * **What it does not show, and why.** The design called for department and an employee code.
 * `SelectableUser` returns `id`, `fullName` and `designation` and nothing else, deliberately —
 * its contract says "no email, no roles, no department … a field nobody asked for is a field
 * nobody notices leaking". Department would be a considered reversal of that, and there is no
 * employee-code column in the schema at all. Designation is what the system actually knows.
 */
const PANEL_WIDTH_PX = 384;
const SEARCH_DEBOUNCE_MS = 140;

/** First letters of the first and last word — "Redwan Hossain" becomes RH. */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-2xs font-semibold text-brand"
    >
      {initialsOf(name)}
    </span>
  );
}

export function PersonPicker({
  value,
  onChange,
  label,
  error,
  required,
  /** Excluded from the list — usually the person who already holds the thing. */
  excludeId,
  placeholder,
}: {
  value: string;
  /** The person as well as the id — a caller that renders a summary needs their name. */
  onChange: (userId: string, person: SelectableUser) => void;
  label: string;
  error?: string;
  required?: boolean;
  excludeId?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const {
    anchorRef: triggerRef,
    popoverRef: panelRef,
    position,
  } = useAnchoredPosition<HTMLButtonElement, HTMLDivElement>(open, PANEL_WIDTH_PX);

  /**
   * Two queries, not one. The list is filtered by whatever is typed, but the *selected* person
   * has to keep rendering in the trigger even when the search excludes them — otherwise the
   * field appears to empty itself the moment you start typing.
   */
  const people = useSelectableUsers(
    {
      page: 1,
      limit: PAGINATION_MAX_LIMIT,
      ...(debouncedQuery.trim() ? { search: debouncedQuery.trim() } : {}),
    },
    open,
  );
  const everyone = useSelectableUsers({ page: 1, limit: PAGINATION_MAX_LIMIT }, value !== '');

  const options = useMemo(
    () => (people.data?.items ?? []).filter((person) => person.id !== excludeId),
    [people.data, excludeId],
  );

  const selected: SelectableUser | undefined = useMemo(
    () =>
      (everyone.data?.items ?? []).find((person) => person.id === value) ??
      (people.data?.items ?? []).find((person) => person.id === value),
    [everyone.data, people.data, value],
  );

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setActiveId(null);
    if (returnFocus) triggerRef.current?.focus();
  }, [triggerRef]);

  // Same shape as the category tree's: the panel is portalled, so containment is checked
  // against both the trigger's wrapper and the panel itself.
  useEffect(() => {
    if (!open) return undefined;
    const isInside = (node: Node | null): boolean =>
      node !== null &&
      Boolean(wrapRef.current?.contains(node) || panelRef.current?.contains(node));

    const dismiss = (): void => {
      setOpen(false);
      setActiveId(null);
    };
    const onFocusIn = (event: FocusEvent): void => {
      if (!isInside(event.target as Node)) dismiss();
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (!isInside(event.target as Node)) dismiss();
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, panelRef]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (activeId && options.some((person) => person.id === activeId)) return;
    setActiveId(options[0]?.id ?? null);
  }, [open, options, activeId]);

  function choose(id: string) {
    const person = options.find((candidate) => candidate.id === id);
    if (!person) return;
    onChange(id, person);
    setQuery('');
    close();
  }

  function move(delta: number) {
    if (options.length === 0) return;
    const current = options.findIndex((person) => person.id === activeId);
    const from = current === -1 ? (delta > 0 ? -1 : 0) : current;
    setActiveId(options[Math.max(0, Math.min(options.length - 1, from + delta))]!.id);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        if (options[0]) setActiveId(options[0].id);
        break;
      case 'End':
        event.preventDefault();
        if (options.length > 0) setActiveId(options[options.length - 1]!.id);
        break;
      case 'Enter':
        event.preventDefault();
        if (activeId) choose(activeId);
        break;
      case 'Escape':
        event.preventDefault();
        if (query.length > 0) setQuery('');
        else close();
        break;
      default:
        break;
    }
  }

  const triggerId = 'person-picker-trigger';

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={triggerId} className="sr-only">
        {label}
      </label>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-required={required ? true : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'flex min-h-11 w-full items-center gap-2.5 rounded-[--radius-control] border bg-surface px-3 py-1.5 text-left',
          open ? 'border-brand ring-2 ring-brand-subtle' : 'border-border',
          error && 'border-danger',
        )}
      >
        {selected ? (
          <>
            <Avatar name={selected.fullName} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                {selected.fullName}
              </span>
              <span className="block truncate text-xs text-ink-subtle">
                {selected.designation}
              </span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-ink-subtle">
            {placeholder ?? t.common.none}
          </span>
        )}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-subtle" />
      </button>

      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}

      {open
        ? createPortal(
            <div
              ref={panelRef}
              style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
              className={cn(
                'fixed z-50 w-96 overflow-hidden rounded-[--radius-panel] border border-border bg-surface shadow-[--shadow-overlay]',
                position ? 'visible' : 'invisible',
              )}
            >
              <div className="border-b border-border p-2.5">
                <div className="relative">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
                  />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder={t.borrowing.searchPeople}
                    aria-label={t.borrowing.searchPeople}
                    aria-controls="person-picker-list"
                    aria-activedescendant={activeId ? `person-opt-${activeId}` : undefined}
                    autoComplete="off"
                    // 16px: below that iOS Safari zooms the viewport on focus and never returns.
                    className="h-9 w-full rounded-[--radius-control] border border-border bg-canvas pl-8 pr-2.5 text-base text-ink outline-none placeholder:text-ink-subtle focus-visible:border-brand"
                  />
                </div>
              </div>

              <div
                id="person-picker-list"
                role="listbox"
                aria-label={label}
                className="max-h-72 overflow-y-auto p-1.5"
              >
                {options.length === 0 ? (
                  <p className="px-2 py-5 text-center text-sm text-ink-subtle">
                    {t.borrowing.noPeopleMatch}
                  </p>
                ) : (
                  options.map((person) => {
                    const isSelected = person.id === value;
                    const isActive = person.id === activeId;
                    return (
                      <div
                        key={person.id}
                        id={`person-opt-${person.id}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => choose(person.id)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-[--radius-control] px-2 py-1.5',
                          isActive && 'bg-surface-muted ring-2 ring-inset ring-brand',
                          isSelected && 'bg-brand-subtle',
                        )}
                      >
                        <Avatar name={person.fullName} />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-sm',
                              isSelected ? 'font-medium text-brand' : 'text-ink',
                            )}
                          >
                            {person.fullName}
                          </span>
                          <span className="block truncate text-xs text-ink-subtle">
                            {person.designation}
                          </span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
