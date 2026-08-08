import { randomId } from '@/lib/random-id';
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
  SupportingDocument,
  WithdrawApprovalInput,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/** How often the approver's badge re-reads its count. A minute is fresh enough to act on. */
const AWAITING_POLL_MS = 60_000;

/** Fresh per submit: a retry of a failed attempt is new, a double-click is a repeat. */
const newIdempotencyKey = () => randomId();

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
    // Live updates come from window focus (returning to the tab re-reads) and from
    // mutations on this requisition calling `setQueryData` directly. An unconditional
    // 15s poll was tried and trips the per-user throttler once multiple tabs share an
    // IP — focus-only is the right balance between "feels live" and "doesn't 429".
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
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

/* ----------------------------------------------------------- supporting doc */

/**
 * Replace is modeled as "post a fresh file" — the server inserts a new `stored_files` row
 * and repoints the FK. The old row stays in place. On the wire this is identical to upload.
 */
export function useUploadSupportingDocument(requisitionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<SupportingDocument>(
        `/requisitions/${requisitionId}/supporting-document`,
        form,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.requisitions.detail(requisitionId),
      });
    },
  });
}

export function useRemoveSupportingDocument(requisitionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<void>(`/requisitions/${requisitionId}/supporting-document`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.requisitions.detail(requisitionId),
      });
    },
  });
}

/**
 * Pre-draft attach (orphan upload). Used by the SupportingDocumentField on the empty
 * Make Requisition form, before any requisition row exists. The returned id is then
 * lifted into the save body as `pendingSupportingDocumentId`; the create service claims
 * it in the same transaction.
 *
 * There is no query invalidation on success — no requisition exists yet, so there is
 * nothing to invalidate. The form is the resume UI; refreshing it loses the local
 * `pendingFile` state and the user has to re-pick. That is the cost of not having a
 * "drafts gallery" yet (out of scope; see the plan's follow-ups).
 */
export function useUploadOrphanSupportingDocument() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<SupportingDocument>('/uploads/supporting-document', form);
    },
  });
}
