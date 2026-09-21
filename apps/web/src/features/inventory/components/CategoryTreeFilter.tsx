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
 * the seeded taxonomy ships with. Built to `category-tree-fix-plan.md`; the behaviour is
 * re-implemented here rather than the mockup's DOM code being copied, per that plan's first
 * handoff item.
 *
 * Two selections are not categories and are pinned outside the tree:
 *   `ALL`   — no category filter at all.
 *   `UNCAT` — products with no category, which is a first-class state since migration 0035.
 * `UNCAT` is the *only* way to filter to uncategorised products; the standalone "Uncategorized
 * only" checkbox was removed when this landed, because two controls writing overlapping filter
 * state is how a screen starts disagreeing with itself (fix-plan §2.4).
 */
export const CATEGORY_ALL = '__all__';
export const CATEGORY_UNCATEGORIZED = '__uncategorized__';

export type CategorySelection = typeof CATEGORY_ALL | typeof CATEGORY_UNCATEGORIZED | string;

/** Matches, plus the ancestors needed to reach them. Nothing else renders. */
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
  node?: CategoryNode;
  label: string;
  count: number | null;
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
}: {
  tree: CategoryNode[];
  value: CategorySelection;
  onChange: (next: CategorySelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  /**
   * Debounced, per the fix-plan's own critique: the tree walk plus a re-render on every
   * keystroke is fine at 120 nodes and stops being fine in the many hundreds the taxonomy makes
   * plausible. The input stays uncontrolled-feeling because `query` updates immediately; only
   * the filtering waits.
   */
  const debouncedQuery = useDebouncedValue(query, CATEGORY_SEARCH_DEBOUNCE_MS);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const search = useMemo(() => computeSearchSets(tree, debouncedQuery), [tree, debouncedQuery]);

  /** Flatten what is actually on screen, in order, so the cursor and Home/End agree with it. */
  const rows = useMemo(() => {
    const out: Row[] = [
      { id: CATEGORY_ALL, level: 1, hasChildren: false, label: t.inventory.allCategories, count: null },
      {
        id: CATEGORY_UNCATEGORIZED,
        level: 1,
        hasChildren: false,
        label: t.inventory.uncategorized,
        count: null,
      },
    ];

    const push = (node: CategoryNode, level: number): void => {
      if (search.active && !search.visible.has(node.id)) return;
      const hasChildren = node.children.length > 0;
      out.push({
        id: node.id,
        level,
        hasChildren,
        node,
        label: node.name,
        count: node.productCountInTree,
      });
      const isOpen = search.active ? search.autoExpand.has(node.id) : expanded.has(node.id);
      if (hasChildren && isOpen) node.children.forEach((child) => push(child, level + 1));
    };

    tree.forEach((node) => push(node, 1));
    return out;
  }, [tree, expanded, search]);

  const isOpenRow = useCallback(
    (id: string) => (search.active ? search.autoExpand.has(id) : expanded.has(id)),
    [search, expanded],
  );

  const selectedLabel = useMemo(() => {
    if (value === CATEGORY_ALL) return t.inventory.allCategories;
    if (value === CATEGORY_UNCATEGORIZED) return t.inventory.uncategorized;
    return findNode(tree, value)?.name ?? t.inventory.allCategories;
  }, [value, tree]);

  /**
   * A selection can point at a category another IM has since deleted or renamed away. Checked
   * on open, and the query is also refetched on window focus (see `useCategoryTree`) so the
   * label does not sit wrong for long while the panel is shut.
   */
  useEffect(() => {
    if (!open) return;
    if (value === CATEGORY_ALL || value === CATEGORY_UNCATEGORIZED) return;
    if (!findNode(tree, value)) onChange(CATEGORY_ALL);
  }, [open, value, tree, onChange]);

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      setActiveId(null);
      // Focus must come back to the trigger, or it lands on <body> and the next Tab restarts
      // from the top of the page.
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  function openPanel() {
    setOpen(true);
    setActiveId(value === CATEGORY_ALL || value === CATEGORY_UNCATEGORIZED ? value : value);
  }

  // Tabbing out closes the panel. `focusout` fires *before* the new element takes focus, so the
  // check has to happen on the next tick — a timing assumption, which is why it has this
  // comment and a regression test rather than being trusted silently.
  useEffect(() => {
    if (!open) return undefined;
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const onFocusOut = (): void => {
      window.setTimeout(() => {
        if (!wrap.contains(document.activeElement)) {
          setOpen(false);
          setActiveId(null);
        }
      }, 0);
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrap.contains(event.target as Node)) {
        setOpen(false);
        setActiveId(null);
      }
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

  // After the filter changes the cursor may be pointing at a row that no longer renders.
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

  function moveActive(delta: number) {
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.id === activeId);
    const from = current === -1 ? (delta > 0 ? -1 : 0) : current;
    const next = Math.max(0, Math.min(rows.length - 1, from + delta));
    setActiveId(rows[next]!.id);
  }

  /** Right: open a closed branch, else step onto its first child. */
  function expandOrDescend() {
    const index = rows.findIndex((row) => row.id === activeId);
    const row = rows[index];
    if (!row?.hasChildren) return;

    if (!isOpenRow(row.id)) {
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

    if (row.hasChildren && isOpenRow(row.id)) {
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

  return (
    <div ref={wrapRef} className="relative">
      <label
        htmlFor="category-tree-trigger"
        className="mb-1.5 block text-sm font-medium text-ink"
      >
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
        onClick={() => (open ? close() : openPanel())}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-[--radius-control] border border-border bg-surface px-3 text-left text-sm text-ink"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-subtle" />
      </button>

      {open ? (
        <div
          id="category-tree-panel"
          className="absolute z-20 mt-1 flex w-full min-w-72 flex-col rounded-[--radius-control] border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border px-2 py-2">
            <Search aria-hidden className="size-4 shrink-0 text-ink-subtle" />
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
              /**
               * 16px, not the 13.5px the rest of the form uses. Any input below 16px makes iOS
               * Safari zoom the viewport on focus and never zoom back out.
               */
              className="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-subtle"
            />
          </div>

          <div
            id="category-tree-list"
            role="tree"
            aria-label={t.inventory.category}
            className="max-h-80 overflow-y-auto py-1"
          >
            {rows.map((row) => {
              const isSelected = row.id === value;
              const isActive = row.id === activeId;
              const branchOpen = row.hasChildren && isOpenRow(row.id);
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
                    'flex cursor-pointer items-center gap-1.5 py-1.5 pr-3 text-sm',
                    isActive && 'bg-surface-muted',
                    isSelected ? 'font-medium text-brand' : 'text-ink',
                  )}
                  style={{ paddingLeft: `${row.level * 12}px` }}
                >
                  {row.hasChildren ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden
                      // Toggling a branch must not also select it — the chevron is its own
                      // target and stops the row's click.
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        });
                      }}
                      className="shrink-0 text-ink-subtle"
                    >
                      {branchOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                  ) : (
                    <span aria-hidden className="size-3.5 shrink-0" />
                  )}
                  <span className="flex-1 truncate">
                    <HighlightedLabel text={row.label} query={search.active ? debouncedQuery : ''} />
                  </span>
                  {row.count !== null ? (
                    <span className="shrink-0 tabular-nums text-xs text-ink-subtle">
                      {row.count}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/*
            Visible text, not a `title` tooltip: a native tooltip does not appear on keyboard
            focus and cannot be reached by touch at all, so the one place the count's meaning is
            explained would have been invisible to exactly the people most likely to need it.
          */}
          <p className="border-t border-border px-3 py-2 text-xs text-ink-subtle">
            {t.inventory.categoryCountHint}
          </p>

          {/* Announces that filtering happened; without it a screen reader gets no feedback. */}
          <div aria-live="polite" className="sr-only">
            {search.active ? t.inventory.categoryMatches.replace('{n}', String(search.matchCount)) : ''}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** ~140ms: long enough to skip the middle of a word, short enough not to feel laggy. */
const CATEGORY_SEARCH_DEBOUNCE_MS = 140;

function HighlightedLabel({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q.length === 0) return <>{text}</>;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-brand-subtle text-brand">{text.slice(index, index + q.length)}</mark>
      {text.slice(index + q.length)}
    </>
  );
}
