import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, FolderOpen, Pencil } from 'lucide-react';
import type { CategoryNode } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';

/**
 * Everything about the selected category, to Ayman's `category-clean.html`.
 *
 * The page's whole shape rests on one decision: the tree shows *what exists*, this pane shows
 * *what you can do about it*. Nothing acts from the tree except adding a child, so a hundred
 * rows carry one affordance instead of four, and the destructive action lives at the bottom of
 * a panel you had to deliberately open.
 */

const MAX_DEPTH = 3;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface p-3.5">
      <p className="mb-0.5 text-2xs text-ink-subtle">{label}</p>
      <p className="font-mono text-base">{value}</p>
    </div>
  );
}

/** Counts every active descendant, so the deactivate warning can say what is underneath. */
function activeDescendants(node: CategoryNode): { cats: number; items: number } {
  let cats = 0;
  let items = 0;
  const walk = (current: CategoryNode): void => {
    for (const child of current.children) {
      if (child.isActive) {
        cats += 1;
        items += child.productCountInTree;
      }
      walk(child);
    }
  };
  walk(node);
  return { cats, items };
}

export function CategoryDetailPane({
  node,
  path,
  onBack,
  onRename,
  onToggleTrackable,
  onSetActive,
  onAddChild,
  addError,
  renameError,
  isSaving,
  onStartAddRoot,
}: {
  node: CategoryNode | null;
  /** Root first, this category last. */
  path: CategoryNode[];
  onBack: () => void;
  onRename: (id: string, name: string) => void;
  onToggleTrackable: (node: CategoryNode) => void;
  onSetActive: (node: CategoryNode, isActive: boolean) => void;
  onAddChild: (parentId: string, name: string) => void;
  addError: string | null;
  renameError: string | null;
  isSaving: boolean;
  onStartAddRoot: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [childName, setChildName] = useState('');
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  // Selecting a different category must not carry the previous one's half-typed state with it.
  useEffect(() => {
    setRenaming(false);
    setChildName('');
    setConfirmingDeactivate(false);
  }, [node?.id]);

  useEffect(() => {
    if (renaming) {
      setDraftName(node?.name ?? '');
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming, node?.name]);

  if (!node) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-[--radius-panel] border border-border bg-surface">
        <div className="flex flex-col items-center gap-1.5 p-10 text-center">
          <FolderOpen aria-hidden className="mb-1.5 size-8 text-ink-subtle" />
          <h2 className="text-sm font-semibold text-ink-muted">
            {t.categories.nothingSelectedTitle}
          </h2>
          <p className="max-w-70 text-sm leading-relaxed text-ink-subtle">
            {t.categories.nothingSelectedBody}
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={onStartAddRoot}>
            {t.categories.addRoot}
          </Button>
        </div>
      </section>
    );
  }

  const depth = path.length;
  const atMaxDepth = depth >= MAX_DEPTH;
  const hasChildren = node.children.length > 0;
  const beneath = activeDescendants(node);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto rounded-[--radius-panel] border border-border bg-surface">
      <div className="p-6 md:p-7">
        {/* Only reachable on a narrow screen, where the two panes take turns. */}
        <Button
          variant="ghost"
          size="sm"
          className="mb-3.5 md:hidden"
          icon={<ChevronLeft aria-hidden className="size-3.5" />}
          onClick={onBack}
        >
          {t.categories.backToTree}
        </Button>

        <p className="mb-2.5 wrap-break-word font-mono text-2xs text-ink-subtle">
          {path.map((step) => step.name).join(' / ')}
        </p>

        {renaming ? (
          <div className="mb-1">
            <input
              ref={renameRef}
              value={draftName}
              disabled={isSaving}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRename(node.id, draftName);
                if (event.key === 'Escape') setRenaming(false);
              }}
              aria-label={t.categories.rename.replace('{name}', node.name)}
              className="w-full max-w-105 rounded-[--radius-control] border border-brand bg-surface px-2 py-1 text-xl font-bold text-ink outline-none"
            />
            {renameError ? (
              <p role="alert" className="mt-1 text-xs text-danger">
                {renameError}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mb-1 flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight text-ink">{node.name}</h2>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t.categories.rename.replace('{name}', node.name)}
              icon={<Pencil aria-hidden className="size-3.5" />}
              onClick={() => setRenaming(true)}
            />
          </div>
        )}

        <p className="mb-5 flex items-center gap-1.5 text-sm text-ink-muted">
          <span
            aria-hidden
            className={cn(
              'size-1.75 rounded-full',
              node.isActive ? 'bg-success' : 'bg-ink-subtle',
            )}
          />
          {node.isActive ? t.common.active : t.common.inactive}
        </p>

        {/* A 1px gap over a border-coloured background draws the dividers without four rules. */}
        <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-[--radius-control] border border-border bg-border">
          {hasChildren ? (
            <>
              <Stat label={t.categories.subcategories} value={node.children.length} />
              <Stat label={t.categories.itemsBelow} value={node.productCountInTree} />
            </>
          ) : (
            <>
              <Stat label={t.categories.itemsInStock} value={node.productCountInTree} />
              <Stat
                label={t.categories.depth}
                value={t.categories.depthValue
                  .replace('{n}', String(depth))
                  .replace('{max}', String(MAX_DEPTH))}
              />
            </>
          )}
        </div>

        {/* `Switch` is the whole row — label, hint and track — so it is not wrapped in one. */}
        <div className="border-y border-border py-3.5">
          <Switch
            checked={node.isTrackable}
            disabled={isSaving}
            label={t.categories.trackable}
            hint={t.categories.trackableSub}
            onChange={() => onToggleTrackable(node)}
          />
        </div>

        {atMaxDepth ? (
          <p className="border-t border-border py-3.5 text-xs text-ink-subtle">
            {t.categories.maxDepthNote.replace('{name}', node.name)}
          </p>
        ) : (
          <div className="border-t border-border py-4">
            <p className="mb-2 text-sm text-ink">{t.categories.addSubcategory}</p>
            <div className="flex gap-2">
              <input
                value={childName}
                disabled={isSaving}
                onChange={(event) => setChildName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && childName.trim()) {
                    onAddChild(node.id, childName);
                    setChildName('');
                  }
                }}
                placeholder={t.categories.addSubcategoryPlaceholder}
                aria-label={t.categories.addChildName}
                className="h-8 min-w-0 flex-1 rounded-[--radius-control] border border-border bg-surface-muted px-2.5 text-sm text-ink outline-none focus-visible:border-brand"
              />
              <Button
                size="sm"
                disabled={!childName.trim() || isSaving}
                onClick={() => {
                  onAddChild(node.id, childName);
                  setChildName('');
                }}
              >
                {t.categories.add}
              </Button>
            </div>
            {addError ? (
              <p role="alert" className="mt-1.5 text-xs text-danger">
                {addError}
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2.5 text-sm text-ink-muted">
            {node.isActive ? t.categories.dangerZone : t.categories.isInactive}
          </p>

          {node.isActive ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="border-danger text-danger hover:bg-danger-subtle"
                onClick={() => {
                  // Straight through when nothing hangs below it — a confirmation nobody needs
                  // is a confirmation everybody learns to click past.
                  if (beneath.cats === 0) onSetActive(node, false);
                  else setConfirmingDeactivate(true);
                }}
              >
                {t.categories.deactivate}
              </Button>

              {confirmingDeactivate ? (
                <div className="mt-3 rounded-[--radius-control] border border-danger bg-danger-subtle p-3.5">
                  {/*
                    OQ-G3: whether deactivating a parent cascades to its children is undecided.
                    Rather than pick silently, this says what the button will actually do.
                  */}
                  <p className="mb-2.5 text-xs leading-relaxed text-ink">
                    {t.categories.deactivateWarning
                      .replaceAll('{name}', node.name)
                      .replace(
                        '{cats}',
                        beneath.cats === 1
                          ? t.categories.warnCatsOne
                          : t.categories.warnCats.replace('{n}', String(beneath.cats)),
                      )
                      .replace(
                        '{items}',
                        t.categories.warnItems.replace('{n}', String(beneath.items)),
                      )}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="border-danger text-danger hover:bg-danger-subtle"
                      isLoading={isSaving}
                      onClick={() => {
                        onSetActive(node, false);
                        setConfirmingDeactivate(false);
                      }}
                    >
                      {t.categories.deactivateOnlyThis}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmingDeactivate(false)}
                    >
                      {t.common.cancel}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="border-success text-success hover:bg-success-subtle"
              onClick={() => onSetActive(node, true)}
            >
              {t.categories.reactivate}
            </Button>
          )}
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2.5 text-sm text-ink-muted">{t.categories.activity}</p>
          <div className="flex justify-between py-1 text-xs text-ink-muted">
            <span>{t.categories.added}</span>
            <span className="font-mono text-ink-subtle">{formatDate(node.createdAt)}</span>
          </div>
          <div className="flex justify-between py-1 text-xs text-ink-muted">
            <span>{t.categories.lastChanged}</span>
            <span className="font-mono text-ink-subtle">{formatDate(node.updatedAt)}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
            {t.categories.activityNote}
          </p>
        </div>
      </div>
    </section>
  );
}
