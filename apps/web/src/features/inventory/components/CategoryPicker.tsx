import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { CategoryNode } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useCreateCategory } from '../api';

/**
 * Cascading category picker: Top-Level → Subcategory → Type, with inline creation at any level.
 *
 * Three rules from `category-taxonomy-spec.md` that a plain dropdown cannot express:
 *
 *   §6  Not a flat list of every leaf. The seeded tree is ~200 nodes; a single `<select>` of
 *       them is a scroll, not a choice.
 *   §1  Every level is skippable. A product may be filed at level 1, 2 or 3 — "Electronics" is
 *       a valid answer when no subcategory fits, and so is nothing at all.
 *   §5  "+ New" at each level, IM-only, calling the same API as the management screen. Making
 *       somebody leave a half-filled product form to go and create a category is how products
 *       end up filed under the nearest wrong node.
 *
 * The value is whichever level was chosen last — that is what "stopping at level 2" means.
 */
export function CategoryPicker({
  tree,
  value,
  onChange,
  canCreate,
  error,
}: {
  tree: CategoryNode[];
  /** The chosen category id, or null for "not categorised". */
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

  const [openCreateAt, setOpenCreateAt] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  const levels = useMemo(() => {
    const active = (nodes: CategoryNode[]) => nodes.filter((node) => node.isActive);
    const first = active(tree);
    const second = path[0] ? active(path[0].children) : [];
    const third = path[1] ? active(path[1].children) : [];
    return [first, second, third];
  }, [tree, path]);

  const labels = [t.inventory.categoryLevel1, t.inventory.categoryLevel2, t.inventory.categoryLevel3];

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
      // the friction this whole control exists to remove.
      onChange(created.id);
      setOpenCreateAt(null);
      setDraftName('');
    } catch (err) {
      toast.error(messageForError(err));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {levels.map((options, level) => {
        // Level 2 and 3 only make sense once the level above has been chosen.
        if (level > 0 && !path[level - 1]) return null;
        // A level with nothing in it and no way to add one is a dead control.
        if (options.length === 0 && !canCreate) return null;

        return (
          <div key={level} className="flex flex-col gap-1.5">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <SelectField
                  label={labels[level]!}
                  error={level === 0 ? error : undefined}
                  value={path[level]?.id ?? ''}
                  onChange={(event) => {
                    const next = event.target.value;
                    // Clearing a level drops back to its parent rather than to nothing, so
                    // "Electronics > Sensors" minus the Sensors is still "Electronics".
                    onChange(next === '' ? (path[level - 1]?.id ?? null) : next);
                  }}
                >
                  <option value="">
                    {level === 0 ? t.inventory.noCategory : t.inventory.categoryStopHere}
                  </option>
                  {options.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </SelectField>
              </div>
              {canCreate ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mb-0.5"
                  aria-label={`${t.categories.newCategory} — ${labels[level]!}`}
                  icon={<Plus aria-hidden className="size-4" />}
                  onClick={() => {
                    setOpenCreateAt(openCreateAt === level ? null : level);
                    setDraftName('');
                  }}
                />
              ) : null}
            </div>

            {openCreateAt === level ? (
              <div className="flex items-end gap-2 rounded-[--radius-control] bg-surface-muted p-2">
                <div className="flex-1">
                  <TextField
                    label={t.categories.newCategory}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter must not submit the product form underneath.
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitNew(level);
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="mb-0.5"
                  isLoading={createCategory.isPending}
                  onClick={() => void submitNew(level)}
                >
                  {t.common.add}
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
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
