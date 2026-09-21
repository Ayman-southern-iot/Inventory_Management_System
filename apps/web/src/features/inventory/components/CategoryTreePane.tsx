import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { CategoryNode } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';

/**
 * The category tree, to Ayman's `category-clean.html`.
 *
 * Two things carry the hierarchy, and both matter more than they look. **Guide lines** — an
 * elbow into each row, a vertical line continuing past any ancestor that still has siblings
 * below — let three levels read at a glance without shouting each one in a different weight or
 * colour, which is what the old indented table did. And the **`+` on each row**, revealed on
 * hover, puts "add a child here" where the parent is, instead of in a modal with a parent
 * dropdown you have to find your own row in.
 *
 * Search expands everything that matches and highlights the hit. It does not filter to matching
 * rows alone: a subcategory is meaningless without the branch it hangs from.
 */

/** The tree is capped at three levels by a database trigger (migration 0035). */
const MAX_DEPTH = 3;
/** The sentinel parent for "new top-level category" — never a real id. */
export const ROOT = '__root__';

export interface TreeRow {
  node: CategoryNode;
  depth: number;
  /**
   * One entry per ancestor level, true when that ancestor still has siblings below it. Decides
   * whether a vertical guide continues through this row's indent or stops.
   */
  ancestorLines: boolean[];
  isLast: boolean;
}

/** Depth-first, honouring what is expanded and what the query matches. */
export function visibleRows(
  nodes: CategoryNode[],
  expanded: ReadonlySet<string>,
  query: string,
): TreeRow[] {
  const q = query.trim().toLowerCase();
  const rows: TreeRow[] = [];

  const matches = (node: CategoryNode): boolean =>
    node.name.toLowerCase().includes(q) || node.children.some(matches);

  const walk = (list: CategoryNode[], depth: number, ancestorLines: boolean[]): void => {
    const shown = q ? list.filter(matches) : list;
    shown.forEach((node, index) => {
      const isLast = index === shown.length - 1;
      rows.push({ node, depth, ancestorLines, isLast });
      // While searching every branch is open: a hit three levels down is useless if the path
      // to it is collapsed.
      const isOpen = q ? true : expanded.has(node.id);
      if (node.children.length > 0 && isOpen) {
        walk(node.children, depth + 1, [...ancestorLines, !isLast]);
      }
    });
  };

  walk(nodes, 0, []);
  return rows;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-xs bg-brand-subtle px-px text-inherit">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

/** One indent column. `pass` draws only the vertical line; the last one draws the elbow too. */
function Guide({ variant }: { variant: 'pass' | 'blank' | 'elbow' | 'elbow-last' }) {
  if (variant === 'blank') return <span aria-hidden className="h-full w-6 shrink-0" />;
  return (
    <span aria-hidden className="relative h-full w-6 shrink-0">
      <span
        className={cn(
          'absolute left-2.75 top-0 w-px bg-border',
          variant === 'elbow-last' ? 'h-1/2' : 'bottom-0',
        )}
      />
      {variant !== 'pass' ? (
        <span className="absolute left-2.75 top-1/2 h-px w-2.25 bg-border" />
      ) : null}
    </span>
  );
}

export function CategoryTreePane({
  tree,
  query,
  selectedId,
  onSelect,
  expanded,
  onToggleExpanded,
  addingUnder,
  onStartAdd,
  onCancelAdd,
  onSubmitAdd,
  addError,
  isAdding,
}: {
  tree: CategoryNode[];
  /** Filters the tree; the input itself lives in the page header. */
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: ReadonlySet<string>;
  onToggleExpanded: (id: string) => void;
  /** The parent the inline input is open under, `ROOT` for a top-level one, or null. */
  addingUnder: string | null;
  onStartAdd: (parentId: string) => void;
  onCancelAdd: () => void;
  onSubmitAdd: (parentId: string, name: string) => void;
  addError: string | null;
  isAdding: boolean;
}) {
  const rows = useMemo(() => visibleRows(tree, expanded, query), [tree, expanded, query]);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingUnder) {
      setDraft('');
      // A newly rendered input is not focused by the browser; without this the IM has to click
      // the box they just asked for.
      inputRef.current?.focus();
    }
  }, [addingUnder]);

  /** Roving focus, so the whole tree is one tab stop and arrows move within it. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>, row: TreeRow, index: number) {
    const move = (to: number) => {
      event.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (next) document.getElementById(`cat-row-${next.node.id}`)?.focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'ArrowRight':
        // Open a closed branch; step into an open one. The standard treeview behaviour.
        if (row.node.children.length > 0 && !expanded.has(row.node.id)) {
          event.preventDefault();
          onToggleExpanded(row.node.id);
        } else if (row.node.children.length > 0) {
          move(index + 1);
        }
        break;
      case 'ArrowLeft':
        if (row.node.children.length > 0 && expanded.has(row.node.id)) {
          event.preventDefault();
          onToggleExpanded(row.node.id);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(row.node.id);
        break;
      default:
        break;
    }
  }

  const inlineAdd = (parentId: string, depth: number, ancestorLines: boolean[]) => (
    <li key={`add-${parentId}`}>
      <div className="flex h-8.5 items-center gap-1.5 pr-1.5">
        {ancestorLines.slice(1).map((hasMore, level) => (
          <Guide key={level} variant={hasMore ? 'pass' : 'blank'} />
        ))}
        {depth > 0 ? <Guide variant="elbow-last" /> : null}
        <span aria-hidden className="size-5.5 shrink-0" />
        <input
          ref={inputRef}
          value={draft}
          disabled={isAdding}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmitAdd(parentId, draft);
            if (event.key === 'Escape') onCancelAdd();
          }}
          // Blur commits rather than discards: the IM's next click is usually the tree, and
          // silently throwing away a typed name is the crueller of the two options.
          onBlur={() => (draft.trim() ? onSubmitAdd(parentId, draft) : onCancelAdd())}
          placeholder={parentId === ROOT ? t.categories.addRootName : t.categories.addChildName}
          aria-label={parentId === ROOT ? t.categories.addRootName : t.categories.addChildName}
          className="h-6.5 min-w-0 flex-1 rounded-[--radius-control] border border-brand bg-surface px-2 text-sm text-ink outline-none"
        />
      </div>
      {addError ? (
        <p role="alert" className="pb-1.5 pl-7 text-xs text-danger">
          {addError}
        </p>
      ) : null}
    </li>
  );

  const countLabel = query.trim()
    ? rows.length === 1
      ? t.categories.matchOne
      : t.categories.matchLabel.replace('{n}', String(rows.length))
    : rows.length === 1
      ? t.categories.countOne
      : t.categories.countLabel.replace('{n}', String(rows.length));

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-[--radius-panel] border border-border bg-surface md:w-95">
      <div className="shrink-0 border-b border-border p-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus aria-hidden className="size-3.5" />}
          onClick={() => onStartAdd(ROOT)}
        >
          {t.categories.addRoot}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.length === 0 && addingUnder !== ROOT ? (
          <p className="px-4 py-7 text-center text-sm text-ink-subtle">
            {t.categories.noMatch.replace('{q}', query)}
          </p>
        ) : (
          <ul role="tree" aria-label={t.categories.title} className="m-0 list-none p-0">
            {rows.map((row, index) => {
              const { node, depth, ancestorLines, isLast } = row;
              const isOpen = query.trim() ? true : expanded.has(node.id);
              const atMaxDepth = depth + 1 >= MAX_DEPTH;

              return (
                <li key={node.id} role="none">
                  <div
                    id={`cat-row-${node.id}`}
                    role="treeitem"
                    tabIndex={index === 0 ? 0 : -1}
                    aria-level={depth + 1}
                    aria-selected={selectedId === node.id}
                    {...(node.children.length > 0 ? { 'aria-expanded': isOpen } : {})}
                    onClick={() => onSelect(node.id)}
                    onKeyDown={(event) => onKeyDown(event, row, index)}
                    className={cn(
                      'group relative flex h-8.5 cursor-pointer items-center gap-1.5 rounded-[--radius-control] pr-1.5',
                      selectedId === node.id ? 'bg-brand-subtle' : 'hover:bg-surface-muted',
                    )}
                  >
                    {ancestorLines.slice(1).map((hasMore, level) => (
                      <Guide key={level} variant={hasMore ? 'pass' : 'blank'} />
                    ))}
                    {depth > 0 ? (
                      <Guide variant={isLast ? 'elbow-last' : 'elbow'} />
                    ) : null}

                    {node.children.length > 0 ? (
                      <button
                        type="button"
                        aria-label={(isOpen ? t.categories.collapse : t.categories.expand).replace(
                          '{name}',
                          node.name,
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleExpanded(node.id);
                        }}
                        className="flex size-5.5 shrink-0 items-center justify-center rounded-[--radius-control] text-ink-muted hover:bg-border"
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn('size-3 transition-transform', isOpen && 'rotate-90')}
                        />
                      </button>
                    ) : (
                      <span aria-hidden className="size-5.5 shrink-0" />
                    )}

                    <span
                      aria-hidden
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        node.isActive ? 'bg-success' : 'bg-ink-subtle',
                      )}
                    />

                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm',
                        selectedId === node.id && 'font-semibold text-brand',
                        !node.isActive && 'text-ink-subtle',
                      )}
                    >
                      <Highlight text={node.name} query={query} />
                    </span>

                    <span className="shrink-0 font-mono text-2xs text-ink-subtle">
                      {node.productCountInTree}
                    </span>

                    {/*
                      Hidden until the row is hovered or the button itself is focused, so a
                      120-row tree is not 120 competing call-to-actions — but never hidden from
                      the keyboard, which is why it is opacity rather than `display`.
                    */}
                    <button
                      type="button"
                      disabled={atMaxDepth}
                      title={
                        atMaxDepth
                          ? t.categories.maxDepthTitle
                          : t.categories.addChildTo.replace('{name}', node.name)
                      }
                      aria-label={t.categories.addChildTo.replace('{name}', node.name)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartAdd(node.id);
                      }}
                      className={cn(
                        'flex size-5.5 shrink-0 items-center justify-center rounded-[--radius-control] text-ink-muted opacity-0 hover:bg-border',
                        'group-hover:opacity-100 focus-visible:opacity-100',
                        atMaxDepth && 'cursor-not-allowed group-hover:opacity-20',
                      )}
                    >
                      <Plus aria-hidden className="size-3.5" />
                    </button>
                  </div>

                  {addingUnder === node.id
                    ? inlineAdd(node.id, depth + 1, [...ancestorLines, !isLast])
                    : null}
                </li>
              );
            })}
            {addingUnder === ROOT ? inlineAdd(ROOT, 0, []) : null}
          </ul>
        )}
      </div>

      <p className="shrink-0 border-t border-border px-3.5 py-2 font-mono text-2xs text-ink-subtle">
        {countLabel}
      </p>
    </aside>
  );
}
