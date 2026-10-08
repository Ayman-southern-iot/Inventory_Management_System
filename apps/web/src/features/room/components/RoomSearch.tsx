import { forwardRef, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import type { PanelDrawer } from '@/features/panel/layout';
import type { SearchResult, StockRow } from '@/features/panel/search';

export type RoomSearchChoice =
  | { kind: 'drawer'; drawer: PanelDrawer }
  | { kind: 'row'; row: StockRow };

interface RoomSearchProps {
  value: string;
  result: SearchResult;
  onChange: (value: string) => void;
  onChoose: (choice: RoomSearchChoice) => void;
  /** Escape in an empty box: hand it on, so it can clear the selection instead. */
  onEscapeEmpty: () => void;
}

function choicesOf(result: SearchResult): RoomSearchChoice[] {
  return [
    ...result.drawers.map((drawer) => ({ kind: 'drawer' as const, drawer })),
    ...result.rows.map((row) => ({ kind: 'row' as const, row })),
  ];
}

/**
 * The search box over the room: the panel's search (`searchPanel`), so a part found on the wall
 * panel is found here, and a drawer code or address answers too. A combobox — arrow keys move
 * through the results, Enter picks one, Escape clears.
 */
export const RoomSearch = forwardRef<HTMLInputElement, RoomSearchProps>(function RoomSearch(
  { value, result, onChange, onChoose, onEscapeEmpty },
  ref,
) {
  const listId = useId();
  const [activeIndex, setActive] = useState(0);
  const [hasFocus, setFocus] = useState(false);
  const choices = choicesOf(result);
  // Closed once the box loses focus, so it never sits over the room catching clicks.
  const isOpen = hasFocus && value.trim() !== '';
  // A refreshed catalogue can shorten the list under the highlight.
  const active = Math.min(activeIndex, Math.max(0, choices.length - 1));
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    if (isOpen) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  });

  const choose = (choice: RoomSearchChoice | undefined) => {
    if (choice === undefined) return;
    onChoose(choice);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (choices.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + choices.length) % choices.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(choices[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (value === '') onEscapeEmpty();
      else onChange('');
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <label className="flex h-10 items-center gap-2 rounded-control border border-border bg-surface px-3 focus-within:border-brand">
        <Search aria-hidden className="size-4 shrink-0 text-ink-subtle" />
        <span className="sr-only">{t.room.searchLabel}</span>
        <input
          ref={ref}
          type="search"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-activedescendant={isOpen && choices.length > 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={value}
          placeholder={t.room.searchPlaceholder}
          onChange={(event) => {
            setActive(0);
            onChange(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
      </label>
      {isOpen ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t.room.resultsLabel}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded-control border border-border bg-surface p-1 shadow-overlay"
        >
          {choices.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">{t.panel.noMatch}</li>
          ) : null}
          {choices.map((choice, index) => (
            <li
              key={choice.kind === 'drawer' ? `drawer:${choice.drawer.code}` : choice.row.key}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              // Keep focus in the box: a click that blurred it first would close the list.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(choice)}
              className={cn(
                'flex cursor-pointer items-baseline justify-between gap-3 rounded-control px-3 py-2 text-sm',
                index === active ? 'bg-brand-subtle text-ink' : 'text-ink hover:bg-surface-muted',
              )}
            >
              {choice.kind === 'drawer' ? (
                <>
                  <span className="font-medium">{choice.drawer.name}</span>
                  <span className="shrink-0 font-mono text-ink-muted">
                    {t.panel.drawerResult} {choice.drawer.code}
                  </span>
                </>
              ) : (
                <>
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{choice.row.name}</span>{' '}
                    <span className="text-ink-muted">{choice.row.code}</span>
                  </span>
                  <span className="shrink-0 font-mono text-ink-muted">
                    {choice.row.address ??
                      (choice.row.imsLabel === '' ? t.panel.notOnShelf : t.panel.notOnPlan)}
                  </span>
                </>
              )}
            </li>
          ))}
          {result.hiddenCount > 0 ? (
            <li className="px-3 py-2 text-xs text-ink-subtle">
              {t.panel.moreResults(result.hiddenCount)}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
});
