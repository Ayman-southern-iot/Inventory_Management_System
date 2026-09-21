import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { CategoryNode } from '@ims/shared';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

/**
 * The inventory screen's category filter: a searchable tree behind a combobox trigger.
 *
 * Replaces a flat `<select>` of every node, which stopped being usable at the ~120 categories
 * the seeded taxonomy ships with. Built to `category-tree-fix-plan.md` and its companion
 * mockup; the behaviour and the layout are re-implemented here rather than the mockup's DOM
 * being copied, per that plan's first handoff item.
 *
 * The layout is deliberate, not decoration:
 *   - **All categories** is pinned above the scroll area and **Uncategorized** below it, so
 *     neither scrolls away. They are the two answers people reach for most and they are not
 *     categories, so they do not belong inside the tree.
 *   - Weight carries depth. Top level is heavy, the third level is light and dimmed, so the
 *     shape of the tree is readable before any of it is read.
 *   - Counts sit in pills at the right edge, aligned, so a column of numbers is scannable.
 *   - The keyboard cursor is an inset ring, distinct from selection's filled pill — they are
 *     different states and looked identical when both were just a background change.
 *
 * `UNCAT` is the only way to filter to uncategorised products; the standalone "Uncategorized
 * only" checkbox was removed when this landed, because two controls writing overlapping filter
 * state is how a screen starts disagreeing with itself (fix-plan §2.4).
 */
export const CATEGORY_ALL = '__all__';
export const CATEGORY_UNCATEGORIZED = '__uncategorized__';

export type CategorySelection = typeof CATEGORY_ALL | typeof CATEGORY_UNCATEGORIZED | string;

/** ~140ms: long enough to skip the middle of a word, short enough not to feel laggy. */
const SEARCH_DEBOUNCE_MS = 140;

interface SearchSets {
  active: boolean;
  visible: Set<string>;
  autoExpand: Set<string>;
  matchCount: number;
}

/**
 * The actual search fix.
 *
 * A node is kept when it matches *or* when something beneath it matches. A parent whose own
 * label matches does **not** drag its whole subtree into view — searching "Sensors" should
 * surface Sensors, not Sensors and its forty descendants. Only branches containing a match are
 * auto-expanded, and only as far as the match.
 */
function computeSearchSets(roots: CategoryNode[], query: string): SearchSets {
  const q = query.trim().toLowerCase();
  const visible = new Set<string>();
  const autoExpand = new Set<string>();
  let matchCount = 0;

  if (q.length === 0) return { active: false, visible, autoExpand, matchCount };

  const walk = (node: CategoryNode): boolean => {
    const selfMatch = node.name.toLowerCase().includes(q);
    if (selfMatch) matchCount += 1;

    let childMatch = false;
    for (const child of node.children) {
      if (walk(child)) childMatch = true;
    }

    const relevant = selfMatch || childMatch;
    if (relevant) {
      visible.add(node.id);
      if (childMatch) autoExpand.add(node.id);
    }
    return relevant;
  };

  roots.forEach(walk);
  return { active: true, visible, autoExpand, matchCount };
}

/** One rendered row, in document order — what the keyboard cursor walks. */
interface Row {
  id: string;
  level: number;
  hasChildren: boolean;
  label: string;
  count: number | null;
  /** Pinned rows sit outside the scrolling tree but still take part in keyboard order. */
  pinned?: 'top' | 'bottom';
}

function findNode(roots: CategoryNode[], id: string): CategoryNode | undefined {
  for (const node of roots) {
    if (node.id === id) return node;
    const deeper = findNode(node.children, id);
    if (deeper) return deeper;
  }
  return undefined;
}

export function CategoryTreeFilter({
  tree,
  value,
  onChange,
  uncategorizedCount,
}: {
  tree: CategoryNode[];
  value: CategorySelection;
  onChange: (next: CategorySelection) => void;
  /** How many products have no category. Null while it is still loading. */
  uncategorizedCount?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  /**
   * Debounced, per the fix-plan's own critique: the tree walk plus a re-render on every
   * keystroke is fine at 120 nodes and stops being fine in the many hundreds the taxonomy makes
   * plausible. Typing stays instant because `query` updates immediately; only filtering waits.
   */
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const search = useMemo(() => computeSearchSets(tree, debouncedQuery), [tree, debouncedQuery]);

  const isBranchOpen = useCallback(
    (id: string) => (search.active ? search.autoExpand.has(id) : expanded.has(id)),
    [search, expanded],
  );

  /** The rows inside the scroll area, flattened in document order. */
  const treeRows = useMemo(() => {
    const out: Row[] = [];
    const push = (node: CategoryNode, level: number): void => {
      if (search.active && !search.visible.has(node.id)) return;
      const hasChildren = node.children.length > 0;
      out.push({
        id: node.id,
        level,
        hasChildren,
        label: node.name,
        count: node.productCountInTree,
      });
      if (hasChildren && isBranchOpen(node.id)) {
        node.children.forEach((child) => push(child, level + 1));
      }
    };
    tree.forEach((node) => push(node, 1));
    return out;
  }, [tree, search, isBranchOpen]);

  const allRow: Row = {
    id: CATEGORY_ALL,
    level: 1,
    hasChildren: false,
    label: t.inventory.allCategories,
    count: null,
    pinned: 'top',
  };
  const uncatRow: Row = {
    id: CATEGORY_UNCATEGORIZED,
    level: 1,
    hasChildren: false,
    label: t.inventory.uncategorized,
    count: uncategorizedCount ?? null,
    pinned: 'bottom',
  };

  /** Keyboard order follows the screen: pinned top, the tree, pinned bottom. */
  const rows = useMemo(() => [allRow, ...treeRows, uncatRow], [treeRows, uncategorizedCount, value]);

  const selectedLabel = useMemo(() => {
    if (value === CATEGORY_ALL) return t.inventory.allCategories;
    if (value === CATEGORY_UNCATEGORIZED) return t.inventory.uncategorized;
    return findNode(tree, value)?.name ?? t.inventory.allCategories;
  }, [value, tree]);

  /**
   * A selection can point at a category another IM has since deleted or renamed away. Checked
   * on open, and the query is refetched on window focus (see `useCategoryTree`) so the label
   * does not sit wrong for long while the panel is shut.
   */
  useEffect(() => {
    if (!open) return;
    if (value === CATEGORY_ALL || value === CATEGORY_UNCATEGORIZED) return;
    if (!findNode(tree, value)) onChange(CATEGORY_ALL);
  }, [open, value, tree, onChange]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setActiveId(null);
    // Focus must come back to the trigger, or it lands on <body> and the next Tab restarts
    // from the top of the page.
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Tabbing out closes the panel. `focusout` fires *before* the new element takes focus, so the
  // check has to happen on the next tick — a timing assumption, which is why it has this
  // comment and a regression test rather than being trusted silently.
  useEffect(() => {
    if (!open) return undefined;
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const dismiss = (): void => {
      setOpen(false);
      setActiveId(null);
    };
    const onFocusOut = (): void => {
      window.setTimeout(() => {
        if (!wrap.contains(document.activeElement)) dismiss();
      }, 0);
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrap.contains(event.target as Node)) dismiss();
    };

    wrap.addEventListener('focusout', onFocusOut);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      wrap.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // After the filter changes the cursor may point at a row that no longer renders.
  useEffect(() => {
    if (!open) return;
    if (activeId && rows.some((row) => row.id === activeId)) return;
    setActiveId(rows[0]?.id ?? null);
  }, [open, rows, activeId]);

  function choose(id: string) {
    onChange(id);
    setQuery('');
    close();
  }

  function toggleBranch(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function moveActive(delta: number) {
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.id === activeId);
    const from = current === -1 ? (delta > 0 ? -1 : 0) : current;
    setActiveId(rows[Math.max(0, Math.min(rows.length - 1, from + delta))]!.id);
  }

  /** Right: open a closed branch, else step onto its first child. */
  function expandOrDescend() {
    const index = rows.findIndex((row) => row.id === activeId);
    const row = rows[index];
    if (!row?.hasChildren) return;
    if (!isBranchOpen(row.id)) {
      setExpanded((prev) => new Set(prev).add(row.id));
      return;
    }
    const child = rows[index + 1];
    if (child && child.level === row.level + 1) setActiveId(child.id);
  }

  /** Left: close an open branch, else step up to its parent. */
  function collapseOrAscend() {
    const index = rows.findIndex((row) => row.id === activeId);
    const row = rows[index];
    if (!row) return;
    if (row.hasChildren && isBranchOpen(row.id)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      return;
    }
    for (let i = index - 1; i >= 0; i -= 1) {
      if (rows[i]!.level === row.level - 1) {
        setActiveId(rows[i]!.id);
        return;
      }
    }
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'ArrowRight':
        // Not mirrored for RTL. The ARIA pattern flips Left/Right in right-to-left layouts;
        // this app is English-only today, and the mapping is here to be found if that changes.
        event.preventDefault();
        expandOrDescend();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        collapseOrAscend();
        break;
      case 'Home':
        event.preventDefault();
        if (rows[0]) setActiveId(rows[0].id);
        break;
      case 'End':
        event.preventDefault();
        if (rows.length > 0) setActiveId(rows[rows.length - 1]!.id);
        break;
      case 'Enter':
        event.preventDefault();
        if (activeId) choose(activeId);
        break;
      case 'Escape':
        // Two stages: clear a query first, close on the second press. Closing on the first
        // throws away a search the user is halfway through typing.
        event.preventDefault();
        if (query.length > 0) setQuery('');
        else close();
        break;
      default:
        break;
    }
  }

  const renderRow = (row: Row) => {
    const isSelected = row.id === value;
    const isActive = row.id === activeId;
    const branchOpen = row.hasChildren && isBranchOpen(row.id);

    return (
      <div
        key={row.id}
        id={`category-opt-${row.id}`}
        role="treeitem"
        aria-level={row.level}
        aria-selected={isSelected}
        aria-expanded={row.hasChildren ? branchOpen : undefined}
        onClick={() => choose(row.id)}
        className={cn(
          'flex cursor-pointer select-none items-center gap-1.5 rounded-[--radius-control] py-1.5 pr-2 text-sm leading-tight',
          'hover:bg-surface-muted',
          isSelected && 'bg-brand-subtle',
          // The keyboard cursor is a ring, not a fill — selection is already a fill, and when
          // both were backgrounds you could not tell which row Enter would take.
          isActive && 'bg-surface-muted ring-2 ring-inset ring-brand',
        )}
        style={{ paddingLeft: `${row.level * 10}px` }}
      >
        {row.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            // Toggling a branch must not also select it.
            onClick={(event) => {
              event.stopPropagation();
              toggleBranch(row.id);
            }}
            className="flex size-4 shrink-0 items-center justify-center text-ink-subtle"
          >
            {branchOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          // Hidden, not absent: a leaf still occupies the twisty's width so labels stay aligned.
          <span aria-hidden className="size-4 shrink-0" />
        )}

        <span
          className={cn(
            'flex-1 truncate',
            row.level === 1 && 'font-semibold',
            row.level === 2 && 'font-medium',
            row.level >= 3 && 'font-normal text-ink-muted',
            isSelected && 'text-brand',
          )}
        >
          <HighlightedLabel text={row.label} query={search.active ? debouncedQuery : ''} />
        </span>

        {row.count !== null ? (
          <span
            // The count's meaning lives on the badge itself, not in a `title` tooltip — a native
            // tooltip appears on neither keyboard focus nor touch.
            aria-label={t.inventory.categoryCountLabel
              .replace('{n}', String(row.count))
              .replace('{name}', row.label)}
            className={cn(
              'shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-2xs tabular-nums',
              isSelected ? 'text-brand' : 'text-ink-subtle',
            )}
          >
            {row.count}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor="category-tree-trigger" className="mb-1.5 block text-sm font-medium text-ink">
        {t.inventory.category}
      </label>
      <button
        ref={triggerRef}
        id="category-tree-trigger"
        type="button"
        role="combobox"
        aria-haspopup="tree"
        aria-expanded={open}
        aria-controls="category-tree-panel"
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-[--radius-control] border bg-surface px-3 text-left text-sm font-medium text-ink',
          open ? 'border-brand ring-2 ring-brand-subtle' : 'border-border',
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 text-ink-subtle transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          id="category-tree-panel"
          className="absolute z-20 mt-1.5 w-[22rem] max-w-[90vw] overflow-hidden rounded-[--radius-panel] border border-border bg-surface shadow-[--shadow-overlay]"
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
                placeholder={t.inventory.categorySearch}
                aria-label={t.inventory.categorySearch}
                aria-controls="category-tree-list"
                aria-activedescendant={activeId ? `category-opt-${activeId}` : undefined}
                autoComplete="off"
                /**
                 * 16px (`text-base`), not the 13.5px the rest of the form uses. Any input below
                 * 16px makes iOS Safari zoom the viewport on focus and never zoom back out.
                 */
                className="h-9 w-full rounded-[--radius-control] border border-border bg-canvas pl-8 pr-2.5 text-base text-ink outline-none placeholder:text-ink-subtle focus-visible:border-brand"
              />
            </div>
          </div>

          {/*
            Visible, not screen-reader-only: sighted users need to know the list was filtered
            too, and "no matches" is otherwise just an empty box.
          */}
          <p aria-live="polite" className="min-h-4 px-3 pb-1.5 pt-1 text-2xs text-ink-subtle">
            {search.active ? t.inventory.categoryMatches.replace('{n}', String(search.matchCount)) : ''}
          </p>

          <div className="border-b border-border px-1.5 py-1">{renderRow(allRow)}</div>

          <div
            id="category-tree-list"
            role="tree"
            aria-label={t.inventory.category}
            className="max-h-72 overflow-y-auto px-1.5 py-1.5"
          >
            {treeRows.length === 0 ? (
              <p className="px-2 py-5 text-center text-sm text-ink-subtle">
                {t.inventory.categoryNoMatches}
              </p>
            ) : (
              treeRows.map(renderRow)
            )}
          </div>

          <div className="border-t border-border px-1.5 py-1">{renderRow(uncatRow)}</div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-2">
            <button
              type="button"
              onClick={() => choose(CATEGORY_ALL)}
              className="rounded px-1.5 py-1 text-xs text-ink-muted hover:text-ink"
            >
              {t.inventory.categoryClear}
            </button>
            <span aria-hidden className="text-2xs text-ink-subtle">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> {t.inventory.categoryKeyMove} · <Kbd>→</Kbd>
              <Kbd>←</Kbd> {t.inventory.categoryKeyExpand} · <Kbd>Enter</Kbd>{' '}
              {t.inventory.categoryKeySelect}
            </span>
          </div>

          <p className="border-t border-border px-3 py-1.5 text-2xs text-ink-subtle">
            {t.inventory.categoryCountHint}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded border border-b-2 border-border bg-surface-muted px-1 py-px font-sans text-2xs text-ink-muted">
      {children}
    </kbd>
  );
}

function HighlightedLabel({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q.length === 0) return <>{text}</>;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-pending-subtle px-px text-inherit">
        {text.slice(index, index + q.length)}
      </mark>
      {text.slice(index + q.length)}
    </>
  );
}
