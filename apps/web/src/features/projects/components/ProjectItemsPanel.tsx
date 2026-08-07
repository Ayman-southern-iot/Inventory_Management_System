import { useState } from 'react';
import {
  PAGINATION_DEFAULT_LIMIT,
  ProjectUsage,
  type ListProjectItemsQuery,
  type ProjectItem,
} from '@ims/shared';
import { messageForError } from '@/lib/error-message';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Pagination, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { formatDateTime, formatQuantity } from '@/lib/format';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { useProjectItems, useRemoveProjectItem } from '../api';
import { UsageTag } from './UsageTag';

type FilterKey = 'all' | 'inUse' | 'returned';

const FILTERS: { key: FilterKey; label: string; usage?: ProjectUsage }[] = [
  { key: 'all', label: t.projects.filterAll },
  { key: 'inUse', label: t.projects.filterInUse, usage: ProjectUsage.IN_USE },
  { key: 'returned', label: t.projects.filterReturned, usage: ProjectUsage.RETURNED },
];

/**
 * One row per borrow. A borrow is the unit — the same product can be partly returned and
 * partly out, and one row would otherwise have to lie about which state it is in.
 *
 * Filtering is server-side: the API applies `usage` to both rows and count, so pagination
 * stays correct as the user switches pills.
 */
export function ProjectItemsPanel({
  projectId,
  canRemove,
}: {
  projectId: string;
  canRemove: boolean;
}) {
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);

  const active = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0]!;
  const query: ListProjectItemsQuery = {
    page,
    limit: PAGINATION_DEFAULT_LIMIT,
    ...(active.usage ? { usage: active.usage } : {}),
  };
  const items = useProjectItems(projectId, query);

  return (
    <Panel>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{t.projects.itemsHeading}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">{t.projects.itemsHint}</p>
        </div>
        <div role="group" aria-label={t.common.filters} className="flex flex-wrap gap-1 pb-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              aria-pressed={filterKey === filter.key}
              onClick={() => {
                setFilterKey(filter.key);
                setPage(1);
              }}
              className={cn(
                'rounded-[--radius-control] px-3 py-1.5 text-sm transition-colors',
                filterKey === filter.key
                  ? 'bg-brand-subtle font-medium text-brand'
                  : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      <QueryBoundary
        isLoading={items.isPending}
        error={items.error}
        data={items.data}
        onRetry={() => void items.refetch()}
        loadingFallback={<SkeletonRows columns={5} />}
        isEmpty={(data) => data.items.length === 0}
        emptyFallback={<EmptyState title={t.projects.itemsEmpty} />}
      >
        {(data) => (
          <>
            <Table
              headers={[
                t.borrowing.product,
                t.requisitions.quantity,
                t.projects.borrowedBy,
                t.users.status,
              ]}
            >
              {data.items.map((item) => (
                <ItemRow
                  key={item.borrowRequestId}
                  item={item}
                  projectId={projectId}
                  canRemove={canRemove}
                />
              ))}
            </Table>
            <Pagination
              page={data.page}
              limit={data.limit}
              total={data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </QueryBoundary>
    </Panel>
  );
}

function ItemRow({
  item,
  projectId,
  canRemove,
}: {
  item: ProjectItem;
  projectId: string;
  canRemove: boolean;
}) {
  const toast = useToast();
  const remove = useRemoveProjectItem(projectId);

  async function onRemove() {
    try {
      await remove.mutateAsync(item.borrowRequestId);
      toast.success(t.projects.removed);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  // When nothing has come back yet, just print the borrowed total; once returns begin, the
  // outstanding figure is the number that matters when the IM is hunting for the item.
  const qtyLabel =
    item.returnedQty > 0
      ? t.projects.outstanding(item.outstandingQty, item.quantity)
      : formatQuantity(item.quantity);

  return (
    <tr>
      <td className="px-4 py-2.5 text-ink">
        <span className="font-medium">{item.productName}</span>
        <span className="block font-mono text-xs text-ink-subtle">{item.productCode}</span>
        {item.purpose ? (
          <span className="block text-xs text-ink-muted">{item.purpose}</span>
        ) : null}
        {item.expectedReturnDate ? (
          <span className="block text-xs text-ink-muted">
            {formatDateTime(item.expectedReturnDate)}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-ink">{qtyLabel}</td>
      <td className="px-4 py-2.5 text-sm text-ink">{item.borrowerName}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <UsageTag usage={item.usage} />
          {canRemove ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onRemove()}
              isLoading={remove.isPending}
              title={t.projects.removeHint}
            >
              {t.projects.remove}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
