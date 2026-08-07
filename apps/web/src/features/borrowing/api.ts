import { randomId } from '@/lib/random-id';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAGINATION_MAX_LIMIT } from '@ims/shared';
import type {
  BorrowRequest,
  CreateBorrowRequestInput,
  CreateProjectInput,
  DecideBorrowInput,
  ListBorrowsQuery,
  Paginated,
  Project,
  ReturnBorrowInput,
  RevertBorrowInput,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/**
 * A fresh key per submit, so a retry of a failed request is a new attempt while a double-click
 * on the same one is recognised as a repeat.
 */
function newIdempotencyKey(): string {
  return randomId();
}

export function useBorrows(query: ListBorrowsQuery) {
  return useQuery({
    queryKey: queryKeys.borrows.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<BorrowRequest>>(`/borrowing${toSearchParams(query)}`, signal),
    placeholderData: (previous) => previous,
  });
}

export function usePendingBorrowCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.borrows.pendingCount(),
    queryFn: ({ signal }) => api.get<{ count: number }>('/borrowing/pending-count', signal),
    enabled,
    // Same cadence as the requisition approval badge, so the two sidebar numbers move in sync.
    refetchInterval: 60_000,
  });
}

/**
 * Every project, for the pickers in the borrow dialog and the requisition form.
 *
 * `GET /projects` is paginated (rules/40-database.md) and cannot return more than
 * `PAGINATION_MAX_LIMIT` in one call, so a single request silently truncates once the project
 * count passes 100 — realistic for this org per OQ-19. There is no search or "load more" in
 * either picker, so truncation would just make a project disappear with no signal. Instead this
 * pages through with the server's own `total` as the stop condition and concatenates, so the
 * hook still resolves to a plain `Project[]` and neither consumer needs to change.
 */
/** Exported only for the pagination unit test — not part of the feature's public surface. */
export async function fetchAllProjects(signal: AbortSignal | undefined): Promise<Project[]> {
  const items: Project[] = [];
  let page = 1;
  let total = Infinity;

  while (items.length < total) {
    const result = await api.get<Paginated<Project>>(
      `/projects?page=${page}&limit=${PAGINATION_MAX_LIMIT}`,
      signal,
    );
    items.push(...result.items);
    total = result.total;
    // A page with no rows but a total the loop hasn't reached would spin forever; treat it as
    // the end rather than trust `total` to be perfectly in sync with a concurrently-changing table.
    if (result.items.length === 0) break;
    page += 1;
  }

  return items;
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: ({ signal }) => fetchAllProjects(signal),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<Project>('/projects', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() }),
  });
}

/** Invalidates stock as well as borrows — a reservation changes what the product card shows. */
function useBorrowMutation<TInput>(
  mutationFn: (input: TInput) => Promise<BorrowRequest>,
  productIdOf: (input: TInput, result: BorrowRequest) => string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (result, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.borrows.all() });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.products.detail(productIdOf(input, result)),
      });
      // Totals on the list move too, but only the lists — not every product detail.
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.lists() });
    },
  });
}

export function useCreateBorrow() {
  return useBorrowMutation(
    (input: CreateBorrowRequestInput) =>
      api.post<BorrowRequest>('/borrowing', input, { idempotencyKey: newIdempotencyKey() }),
    (input) => input.productId,
  );
}

export function useDecideBorrow() {
  return useBorrowMutation(
    ({ id, input }: { id: string; input: DecideBorrowInput }) =>
      api.post<BorrowRequest>(`/borrowing/${id}/decision`, input, {
        // The reason this header exists: approving twice would issue stock twice.
        idempotencyKey: newIdempotencyKey(),
      }),
    (_input, result) => result.productId,
  );
}

export function useReturnBorrow() {
  return useBorrowMutation(
    ({ id, input }: { id: string; input: ReturnBorrowInput }) =>
      api.post<BorrowRequest>(`/borrowing/${id}/returns`, input, {
        idempotencyKey: newIdempotencyKey(),
      }),
    (_input, result) => result.productId,
  );
}

export function useRevertBorrow() {
  return useBorrowMutation(
    ({ id, input }: { id: string; input: RevertBorrowInput }) =>
      api.post<BorrowRequest>(`/borrowing/${id}/revert`, input),
    (_input, result) => result.productId,
  );
}

export function useCancelBorrow() {
  return useBorrowMutation(
    ({ id }: { id: string }) => api.post<BorrowRequest>(`/borrowing/${id}/cancel`),
    (_input, result) => result.productId,
  );
}
