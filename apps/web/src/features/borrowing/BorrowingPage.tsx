import { useMemo, useState } from 'react';
import { Check, RotateCcw, Undo2, X } from 'lucide-react';
import {
  BorrowFilter,
  BorrowStatus,
  PAGINATION_DEFAULT_LIMIT,
  Role,
  type BorrowRequest,
  type ListBorrowsQuery,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { PageHeader, Pagination, Panel, Table } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { messageForError } from '@/lib/error-message';
import { useAuth } from '@/features/auth/auth-context';
import { SEARCH_DEBOUNCE_MS } from '@/features/inventory/constants';
import { useDebouncedValue } from '@/features/inventory/hooks/useDebouncedValue';
import { useBorrows, useCancelBorrow, useDecideBorrow, useRevertBorrow } from './api';
import { BorrowStatusBadge } from './components/BorrowStatusBadge';
import { ReturnDialog } from './components/ReturnDialog';

const FILTERS: Array<{ value: BorrowFilter; label: string }> = [
  { value: BorrowFilter.ALL, label: t.borrowing.filterAll },
  { value: BorrowFilter.PENDING, label: t.borrowing.filterPending },
  { value: BorrowFilter.OUT, label: t.borrowing.filterOut },
  { value: BorrowFilter.RETURNED, label: t.borrowing.filterReturned },
  { value: BorrowFilter.OVERDUE, label: t.borrowing.filterOverdue },
];

/**
 * One screen for both audiences. The Inventory Manager sees everyone's borrows and can act on
 * them; everybody else sees only their own, enforced server-side rather than by hiding buttons.
 */
export function BorrowingPage({ mine = false }: { mine?: boolean }) {
  const toast = useToast();
  const { hasRole } = useAuth();
  const canManage = hasRole(Role.INVENTORY_MANAGER, Role.ADMIN) && !mine;

  const [filter, setFilter] = useState<BorrowFilter>(BorrowFilter.ALL);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [returning, setReturning] = useState<BorrowRequest | undefined>(undefined);

  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const query = useMemo<ListBorrowsQuery>(
    () => ({
      page,
      limit: PAGINATION_DEFAULT_LIMIT,
      filter,
      mine,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    }),
    [page, filter, mine, debouncedSearch],
  );

  const borrows = useBorrows(query);
  const decide = useDecideBorrow();
  const revert = useRevertBorrow();
  const cancel = useCancelBorrow();

  async function act(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      toast.success(successMessage);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <>
      <PageHeader
        title={mine ? t.borrowing.myTitle : t.borrowing.title}
        subtitle={mine ? t.borrowing.mySubtitle : t.borrowing.subtitle}
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-4 py-3">
          <div className="min-w-56 flex-1">
            <TextField
              label={t.common.search}
              placeholder={t.borrowing.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div
            role="group"
            aria-label={t.common.filters}
            className="flex flex-wrap gap-1 pb-1"
          >
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => {
                  setFilter(option.value);
                  setPage(1);
                }}
                className={cn(
                  'rounded-[--radius-control] px-3 py-1.5 text-sm transition-colors',
                  filter === option.value
                    ? 'bg-brand-subtle font-medium text-brand'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <QueryBoundary
          isLoading={borrows.isPending}
          error={borrows.error}
          data={borrows.data}
          onRetry={() => void borrows.refetch()}
          loadingFallback={<SkeletonRows columns={6} />}
          isEmpty={(data) => data.items.length === 0}
          emptyFallback={
            <EmptyState
              title={mine ? t.borrowing.myEmptyTitle : t.borrowing.emptyTitle}
              body={mine ? t.borrowing.myEmptyBody : t.borrowing.emptyBody}
            />
          }
        >
          {(data) => (
            <>
              <Table
                headers={[
                  t.borrowing.borrowNo,
                  t.borrowing.product,
                  mine ? t.borrowing.project : t.borrowing.borrower,
                  t.borrowing.quantity,
                  t.borrowing.expectedReturn,
                  t.users.status,
                  '',
                ]}
              >
                {data.items.map((borrow) => (
                  <tr key={borrow.id} className="hover:bg-surface-muted/50">
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">
                      {borrow.borrowNo}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{borrow.productName}</p>
                      <p className="text-xs text-ink-subtle">{borrow.location}</p>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {mine ? (borrow.projectName ?? t.common.none) : borrow.requesterName}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink">
                      {borrow.quantity} {borrow.unit}
                      {borrow.outstandingQty > 0 && borrow.outstandingQty < borrow.quantity ? (
                        <span className="block text-xs text-ink-subtle">
                          {borrow.outstandingQty} {t.borrowing.outstanding.toLowerCase()}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-ink-muted">
                      {borrow.isReturnable
                        ? (borrow.expectedReturnDate ?? t.common.none)
                        : t.borrowing.consumable}
                    </td>
                    <td className="px-4 py-2.5">
                      <BorrowStatusBadge borrow={borrow} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {canManage && borrow.status === BorrowStatus.PENDING ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${t.borrowing.approve} ${borrow.borrowNo}`}
                              icon={<Check aria-hidden className="size-4 text-success" />}
                              isLoading={decide.isPending}
                              onClick={() =>
                                void act(
                                  () =>
                                    decide.mutateAsync({
                                      id: borrow.id,
                                      input: { approve: true, note: null },
                                    }),
                                  t.borrowing.approved,
                                )
                              }
                            >
                              {t.borrowing.approve}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${t.borrowing.reject} ${borrow.borrowNo}`}
                              icon={<X aria-hidden className="size-4 text-danger" />}
                              onClick={() =>
                                void act(
                                  () =>
                                    decide.mutateAsync({
                                      id: borrow.id,
                                      input: { approve: false, note: null },
                                    }),
                                  t.borrowing.rejected,
                                )
                              }
                            >
                              {t.borrowing.reject}
                            </Button>
                          </>
                        ) : null}

                        {canManage &&
                        borrow.isReturnable &&
                        (borrow.status === BorrowStatus.ISSUED ||
                          borrow.status === BorrowStatus.PARTIALLY_RETURNED) ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<RotateCcw aria-hidden className="size-4" />}
                            onClick={() => setReturning(borrow)}
                          >
                            {t.borrowing.recordReturn}
                          </Button>
                        ) : null}

                        {/* OQ-04: only offered while nothing has come back yet. */}
                        {canManage &&
                        borrow.status === BorrowStatus.ISSUED &&
                        borrow.returnedQty === 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${t.borrowing.revert} ${borrow.borrowNo}`}
                            icon={<Undo2 aria-hidden className="size-4" />}
                            onClick={() => {
                              const reason = window.prompt(t.borrowing.revertReason);
                              if (!reason) return;
                              void act(
                                () => revert.mutateAsync({ id: borrow.id, input: { reason } }),
                                t.borrowing.reverted,
                              );
                            }}
                          />
                        ) : null}

                        {mine && borrow.status === BorrowStatus.PENDING ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void act(
                                () => cancel.mutateAsync({ id: borrow.id }),
                                t.borrowing.cancelled,
                              )
                            }
                          >
                            {t.borrowing.cancel}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
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

      <ReturnDialog borrow={returning} onClose={() => setReturning(undefined)} />
    </>
  );
}
