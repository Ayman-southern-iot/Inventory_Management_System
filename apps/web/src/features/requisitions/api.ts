import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDelegationInput,
  DecideRequisitionInput,
  Delegation,
  ListRequisitionsQuery,
  Paginated,
  Requisition,
  RequisitionDetail,
  SaveRequisitionInput,
  WithdrawApprovalInput,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/** How often the approver's badge re-reads its count. A minute is fresh enough to act on. */
const AWAITING_POLL_MS = 60_000;

/** Fresh per submit: a retry of a failed attempt is new, a double-click is a repeat. */
const newIdempotencyKey = () => crypto.randomUUID();

export function useRequisitions(query: ListRequisitionsQuery) {
  return useQuery({
    queryKey: queryKeys.requisitions.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<Requisition>>(`/requisitions${toSearchParams(query)}`, signal),
    placeholderData: (previous) => previous,
  });
}

export function useRequisition(id: string) {
  return useQuery({
    queryKey: queryKeys.requisitions.detail(id),
    queryFn: ({ signal }) => api.get<RequisitionDetail>(`/requisitions/${id}`, signal),
    enabled: id.length > 0,
    // 15s is short enough that the lifecycle tracker feels live, but long enough that an
    // idle page doesn't hammer the API. Mutations on this requisition also call
    // `setQueryData` directly, so this is the fallback for changes made by other users
    // (e.g. accounts funding the requisition, or an approver acting in another tab).
    refetchInterval: 15_000,
  });
}

/** Drives the approver's pending badge. Only callers with an approval role may read it. */
export function useAwaitingCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.requisitions.awaitingCount(),
    queryFn: ({ signal }) => api.get<{ count: number }>('/requisitions/awaiting-count', signal),
    enabled,
    // Keeps the count moving while the approver sits on a page, until the websocket lands.
    refetchInterval: AWAITING_POLL_MS,
  });
}

/**
 * Every write invalidates the lists and, where it applies, the one detail that changed —
 * never the whole cache. The awaiting badge moves on almost every action, so it goes too.
 */
function useRequisitionMutation<TInput>(
  mutationFn: (input: TInput) => Promise<RequisitionDetail>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.requisitions.lists() });
      queryClient.setQueryData(queryKeys.requisitions.detail(result.id), result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.requisitions.awaitingCount() });
    },
  });
}

export function useCreateRequisition() {
  return useRequisitionMutation((input: SaveRequisitionInput) =>
    api.post<RequisitionDetail>('/requisitions', input),
  );
}

export function useUpdateRequisition() {
  return useRequisitionMutation(({ id, input }: { id: string; input: SaveRequisitionInput }) =>
    api.put<RequisitionDetail>(`/requisitions/${id}`, input),
  );
}

export function useSubmitRequisition() {
  return useRequisitionMutation(({ id }: { id: string }) =>
    api.post<RequisitionDetail>(`/requisitions/${id}/submit`, undefined, {
      // Submitting twice would seed two approval chains.
      idempotencyKey: newIdempotencyKey(),
    }),
  );
}

export function useCancelRequisition() {
  return useRequisitionMutation(({ id }: { id: string }) =>
    api.post<RequisitionDetail>(`/requisitions/${id}/cancel`),
  );
}

export function useDecideRequisition() {
  return useRequisitionMutation(
    ({ approvalId, input }: { approvalId: string; input: DecideRequisitionInput }) =>
      api.post<RequisitionDetail>(`/requisitions/approvals/${approvalId}/decision`, input, {
        idempotencyKey: newIdempotencyKey(),
      }),
  );
}

export function useWithdrawApproval() {
  return useRequisitionMutation(
    ({ approvalId, input }: { approvalId: string; input: WithdrawApprovalInput }) =>
      api.post<RequisitionDetail>(`/requisitions/approvals/${approvalId}/withdraw`, input),
  );
}

/* ------------------------------------------------------------------ delegation */

export function useMyDelegations(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.delegations.mine(),
    queryFn: ({ signal }) => api.get<Delegation[]>('/requisitions/delegations/mine', signal),
    enabled,
  });
}

export function useCreateDelegation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDelegationInput) =>
      api.post<Delegation>('/requisitions/delegations', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.delegations.mine() }),
  });
}

export function useRevokeDelegation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.del<void>(`/requisitions/delegations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.delegations.mine() }),
  });
}
