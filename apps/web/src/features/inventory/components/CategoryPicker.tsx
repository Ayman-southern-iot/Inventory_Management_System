import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CategoryNode } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { messageForError } from '@/lib/error-message';
import { useCreateCategory } from '../api';

/**
 * Classification on the product form: Category → Subcategory → Type, side by side.
 *
 * Three rules from `category-taxonomy-spec.md` that a single dropdown cannot express:
 *
 *   §6  Not a flat list of every leaf. The seeded tree is ~120 nodes; one `<select>` of them is
 *       a scroll, not a choice.
 *   §1  Every level is skippable. A product may be filed at level 1, 2 or 3 — "Electronics" is
 *       a valid answer when no subcategory fits, and so is nothing at all.
 *   §5  New nodes can be created without leaving the form, IM-only, through the same API as the
 *       management screen. Sending somebody away mid-entry is how products get filed under the
 *       nearest wrong node.
 *
 * Inline creation is the last option in each select (`+ New…`), not a button beside it. Three
 * columns plus three buttons does not fit, and the codebase already uses this shape for the
 * borrow form's project picker.
 *
 * The breadcrumb underneath is the answer to "what did I just pick" — with three narrow selects
 * that truncate long names, the chosen path is otherwise unreadable.
 */
const CREATE_OPTION = '__new__';

export function CategoryPicker({
  tree,
  value,
  onChange,
  canCreate,
  error,
}: {
  tree: CategoryNode[];
  /** The chosen category id, or null for "not classified". */
  value: string | null;
  onChange: (categoryId: string | null) => void;
  /** Inline creation is IM-only (spec §3). Everyone else just picks. */
  canCreate: boolean;
  error?: string;
}) {
  const toast = useToast();
  const createCategory = useCreateCategory();

  /**
   * The path down to `value`, recomputed from the tree rather than held in state. A product
   * arriving already filed at level 3 must open with all three selects populated, and deriving
   * that is simpler than syncing three pieces of state against an incoming prop.
   */
  const path = useMemo(() => findPath(tree, value), [tree, value]);

  const [creatingAt, setCreatingAt] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  const levels = useMemo(() => {
    const active = (nodes: CategoryNode[]) => nodes.filter((node) => node.isActive);
    return [
      active(tree),
      path[0] ? active(path[0].children) : [],
      path[1] ? active(path[1].children) : [],
    ];
  }, [tree, path]);

  const labels = [
    t.inventory.categoryLevel1,
    t.inventory.categoryLevel2,
    t.inventory.categoryLevel3,
  ];

  async function submitNew(level: number): Promise<void> {
    const name = draftName.trim();
    if (name.length === 0) return;
    try {
      // The parent is whatever is selected one level up — null at level 1, which is exactly
      // what "a new top-level category" means.
      const parentId = level === 0 ? null : (path[level - 1]?.id ?? null);
      const created = await createCategory.mutateAsync({ name, parentId, isTrackable: true });
      toast.success(t.categories.created);
      // Select it immediately. Creating a category and then having to find it in the list is
      // the friction this control exists to remove.
      onChange(created.id);
      setCreatingAt(null);
      setDraftName('');
    } catch (err) {
      toast.error(messageForError(err));
    }
  }

  function onLevelChange(level: number, next: string) {
    if (next === CREATE_OPTION) {
      setCreatingAt(level);
      setDraftName('');
      return;
    }
    setCreatingAt(null);
    // Clearing a level drops back to its parent, so "Electronics > Sensors" minus the Sensors
    // is still "Electronics" rather than nothing.
    onChange(next === '' ? (path[level - 1]?.id ?? null) : next);
  }

  return (
    <fieldset className="rounded-[--radius-control] border border-border bg-surface-muted/50 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <legend className="contents text-sm font-medium text-ink">
          {t.inventory.classification}
        </legend>
        <span className="text-xs text-ink-subtle">{t.inventory.classificationHint}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {levels.map((options, level) => {
          // A level below an unchosen parent has nothing to offer and no parent to hang a new
          // node from, so it is disabled rather than hidden — the row keeps its shape.
          const disabled = level > 0 && !path[level - 1];
          return (
            <SelectField
              key={level}
              label={labels[level]!}
              error={level === 0 ? error : undefined}
              disabled={disabled}
              value={path[level]?.id ?? ''}
              onChange={(event) => onLevelChange(level, event.target.value)}
            >
              <option value="">
                {level === 0 ? t.inventory.noCategory : t.inventory.categoryStopHere}
              </option>
              {options.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
              {canCreate && !disabled ? (
                <option value={CREATE_OPTION}>{t.inventory.categoryCreateOption}</option>
              ) : null}
            </SelectField>
          );
        })}
      </div>

      {creatingAt !== null ? (
        <div className="mt-2 flex items-end gap-2 rounded-[--radius-control] border border-border bg-surface p-2">
          <div className="flex-1">
            <TextField
              label={`${t.categories.newCategory} — ${labels[creatingAt]!}`}
              value={draftName}
              autoFocus
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                // Enter must add the category, not submit the product form underneath.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submitNew(creatingAt);
                }
              }}
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="mb-0.5"
            isLoading={createCategory.isPending}
            onClick={() => void submitNew(creatingAt)}
          >
            {t.common.add}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mb-0.5"
            onClick={() => {
              setCreatingAt(null);
              setDraftName('');
            }}
          >
            {t.common.cancel}
          </Button>
        </div>
      ) : null}

      {path.length > 0 ? (
        <p
          aria-label={t.inventory.categoryPathLabel}
          className="mt-2 flex flex-wrap items-center gap-1 text-xs text-ink-muted"
        >
          {path.map((node, index) => {
            const isLast = index === path.length - 1;
            return (
              <span key={node.id} className="flex items-center gap-1">
                {index > 0 ? (
                  <ChevronRight aria-hidden className="size-3 shrink-0 text-ink-subtle" />
                ) : null}
                <span
                  className={cn(
                    isLast && 'rounded-full bg-brand-subtle px-2 py-0.5 font-medium text-brand',
                  )}
                >
                  {node.name}
                </span>
              </span>
            );
          })}
        </p>
      ) : null}
    </fieldset>
  );
}

/** The chain of nodes from the root down to `id`, or `[]` when nothing is selected. */
function findPath(nodes: CategoryNode[], id: string | null): CategoryNode[] {
  if (!id) return [];
  for (const node of nodes) {
    if (node.id === id) return [node];
    const deeper = findPath(node.children, id);
    if (deeper.length > 0) return [node, ...deeper];
  }
  return [];
}
