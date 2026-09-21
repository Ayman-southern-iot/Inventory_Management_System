import { useCallback, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CategoryNode } from '@ims/shared';
import { QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useCategoryTree, useCreateCategory, useUpdateCategory } from '../api';
import { CategoryDetailPane } from '../components/CategoryDetailPane';
import { CategoryTreePane, ROOT } from '../components/CategoryTreePane';

/**
 * Category management, rebuilt to Ayman's `category-clean.html` (2026-09-22).
 *
 * What changed is the shape of the job, not the data. The old screen was a flat table with
 * two-space indentation standing in for hierarchy, four controls on every row, and a modal with
 * a parent dropdown you had to find your own row in. This is a tree beside a detail panel: the
 * tree answers "what exists and where", the panel answers "what can I do about this one", and
 * adding a child happens on the parent's own row.
 *
 * **On the mockup's colours.** It proposes a copper accent and Manrope/IBM Plex Mono. The
 * layout and interaction here follow it exactly; the palette and fonts do not, because those
 * are app-wide identity rather than one page's design — a copper Categories screen beside a
 * blue everything-else reads as a bug. Every one of the mockup's CSS variables has a project
 * token that means the same thing, so this is a straight substitution.
 *
 * This file is orchestration only: the two panes are the components, and every mutation lands
 * here so that error handling and cache invalidation happen once.
 */

/** Root first, the node itself last. Empty when the id is not in the tree. */
function pathTo(nodes: CategoryNode[], id: string): CategoryNode[] {
  for (const node of nodes) {
    if (node.id === id) return [node];
    const deeper = pathTo(node.children, id);
    if (deeper.length > 0) return [node, ...deeper];
  }
  return [];
}

/** Sibling names at a given parent, for catching a duplicate before the round trip. */
function siblingNames(nodes: CategoryNode[], parentId: string): string[] {
  if (parentId === ROOT) return nodes.map((node) => node.name);
  const path = pathTo(nodes, parentId);
  const parent = path[path.length - 1];
  return parent ? parent.children.map((node) => node.name) : [];
}

export function CategoriesPage() {
  const toast = useToast();
  const categories = useCategoryTree();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [treeAddError, setTreeAddError] = useState<string | null>(null);
  const [detailAddError, setDetailAddError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const tree = useMemo(() => categories.data ?? [], [categories.data]);
  const path = useMemo(
    () => (selectedId ? pathTo(tree, selectedId) : []),
    [tree, selectedId],
  );
  const selected = path.length > 0 ? path[path.length - 1]! : null;

  const isSaving = createCategory.isPending || updateCategory.isPending;

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /**
   * Caught here rather than at the API, because the API's message is a constraint violation and
   * this one names the parent. Not a second source of truth: the unique index still decides, and
   * a name that slips past this still fails on the server.
   */
  function duplicateMessage(parentId: string, name: string): string | null {
    const taken = siblingNames(tree, parentId).some(
      (sibling) => sibling.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (!taken) return null;
    if (parentId === ROOT) return t.categories.duplicateAtRoot.replace('{name}', name.trim());
    const parent = pathTo(tree, parentId).at(-1);
    return t.categories.duplicateUnder
      .replace('{name}', name.trim())
      .replace('{parent}', parent?.name ?? '');
  }

  async function addCategory(
    parentId: string,
    rawName: string,
    setError: (message: string | null) => void,
  ) {
    const name = rawName.trim();
    if (!name) {
      setAddingUnder(null);
      setError(null);
      return;
    }

    const duplicate = duplicateMessage(parentId, name);
    if (duplicate) {
      setError(duplicate);
      return;
    }

    try {
      const created = await createCategory.mutateAsync({
        name,
        parentId: parentId === ROOT ? null : parentId,
        isTrackable: true,
      });
      toast.success(t.categories.created);
      setAddingUnder(null);
      setError(null);
      // Open the parent and select what was just made — otherwise the new row is invisible
      // under a collapsed branch and the IM cannot tell whether it worked.
      if (parentId !== ROOT) {
        setExpanded((current) => new Set(current).add(parentId));
      }
      setSelectedId(created.id);
    } catch (error) {
      setError(messageForError(error));
    }
  }

  async function rename(id: string, rawName: string) {
    const name = rawName.trim();
    const current = pathTo(tree, id).at(-1);
    if (!name || name === current?.name) {
      setRenameError(null);
      return;
    }

    const parentId = current?.parentId ?? ROOT;
    const taken = siblingNames(tree, parentId).some(
      (sibling) =>
        sibling.trim().toLowerCase() === name.toLowerCase() && sibling !== current?.name,
    );
    if (taken) {
      setRenameError(
        parentId === ROOT
          ? t.categories.duplicateAtRoot.replace('{name}', name)
          : t.categories.duplicateUnder
              .replace('{name}', name)
              .replace('{parent}', pathTo(tree, parentId).at(-1)?.name ?? ''),
      );
      return;
    }

    try {
      await updateCategory.mutateAsync({ id, input: { name } });
      toast.success(t.categories.updated);
      setRenameError(null);
    } catch (error) {
      setRenameError(messageForError(error));
    }
  }

  async function setField(id: string, input: { isTrackable?: boolean; isActive?: boolean }) {
    try {
      await updateCategory.mutateAsync({ id, input });
      toast.success(t.categories.updated);
    } catch (error) {
      // Deactivating a category that still holds products is refused by the API with a reason
      // worth reading, so the message is surfaced rather than replaced.
      toast.error(messageForError(error));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col items-start justify-between gap-4 pb-4 sm:flex-row sm:items-baseline">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-ink">{t.categories.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t.categories.subtitle}</p>
        </div>
        <div className="relative w-full sm:w-60">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.categories.filter}
            aria-label={t.categories.filter}
            autoComplete="off"
            // 16px on mobile: below that iOS Safari zooms the viewport on focus and never returns.
            className="h-9 w-full rounded-[--radius-control] border border-border bg-surface pl-8 pr-2.5 text-base text-ink outline-none placeholder:text-ink-subtle focus-visible:border-brand sm:text-sm"
          />
        </div>
      </header>

      <QueryBoundary
        isLoading={categories.isPending}
        error={categories.error}
        data={tree}
        onRetry={() => void categories.refetch()}
        loadingFallback={<SkeletonRows columns={2} />}
      >
        {(nodes) => (
          // On a narrow screen the two panes take turns: the tree until something is selected,
          // the detail after, with a Back button. Side by side from `md` up.
          <div className="flex min-h-0 flex-1 flex-col gap-4 md:min-h-150 md:flex-row">
            <div className={selected ? 'hidden md:flex' : 'flex min-h-0 flex-1'}>
              <CategoryTreePane
                tree={nodes}
                query={query}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setAddingUnder(null);
                  setTreeAddError(null);
                }}
                expanded={expanded}
                onToggleExpanded={toggleExpanded}
                addingUnder={addingUnder}
                onStartAdd={(parentId) => {
                  setAddingUnder(parentId);
                  setTreeAddError(null);
                }}
                onCancelAdd={() => {
                  setAddingUnder(null);
                  setTreeAddError(null);
                }}
                onSubmitAdd={(parentId, name) =>
                  void addCategory(parentId, name, setTreeAddError)
                }
                addError={treeAddError}
                isAdding={createCategory.isPending}
              />
            </div>

            <div className={selected ? 'flex min-h-0 flex-1' : 'hidden md:flex md:flex-1'}>
              <CategoryDetailPane
                node={selected}
                path={path}
                onBack={() => setSelectedId(null)}
                onRename={(id, name) => void rename(id, name)}
                onToggleTrackable={(node) =>
                  void setField(node.id, { isTrackable: !node.isTrackable })
                }
                onSetActive={(node, isActive) => void setField(node.id, { isActive })}
                onAddChild={(parentId, name) =>
                  void addCategory(parentId, name, setDetailAddError)
                }
                addError={detailAddError}
                renameError={renameError}
                isSaving={isSaving}
                onStartAddRoot={() => {
                  setAddingUnder(ROOT);
                  setTreeAddError(null);
                }}
              />
            </div>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
