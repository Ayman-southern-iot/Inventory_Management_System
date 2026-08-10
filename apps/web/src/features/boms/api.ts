import { randomId } from '@/lib/random-id';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BomCandidate,
  BomDetail,
  BomSignedUrlResponse,
  GenerateBomInput,
  ListBomsQuery,
  Paginated,
  Bom,
  RequisitionDetail,
  SendBackForRevisionInput,
  VoidBomInput,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

/** Fresh per write: a retry of a failed attempt is new, a double-click is a repeat. */
const newIdempotencyKey = () => randomId();

/**
 * Approved requisitions ready to batch, with their lines pre-filled. Short cache so the
 * IM does not wait on a full list refetch while they tick candidates.
 */
export function useBomCandidates() {
  return useQuery({
    queryKey: queryKeys.boms.candidates(),
    queryFn: ({ signal }) =>
      api.get<BomCandidate[]>('/boms/candidates', signal),
    // The picker drives the generate page; keep it around a minute — longer than the list,
    // because a fresh requisition that just got approved should not require a refresh.
    staleTime: 60_000,
  });
}

export function useBoms(query: ListBomsQuery) {
  return useQuery({
    queryKey: queryKeys.boms.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<Bom>>(`/boms${toSearchParams(query)}`, signal),
    placeholderData: (previous) => previous,
  });
}

export function useBom(id: string) {
  return useQuery({
    queryKey: queryKeys.boms.detail(id),
    queryFn: ({ signal }) => api.get<BomDetail>(`/boms/${id}`, signal),
    enabled: id.length > 0,
  });
}

/**
 * Every write invalidates the lists and, where it applies, the one detail that changed.
 * Generate / void both reshape a BOM, so the matching detail receives the new shape via
 * `setQueryData` — the next read does not pay for a refetch round-trip.
 */
function useBomMutation<TInput>(mutationFn: (input: TInput) => Promise<BomDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.boms.lists() });
      queryClient.setQueryData(queryKeys.boms.detail(result.id), result);
    },
  });
}

export function useGenerateBom() {
  return useBomMutation((input: GenerateBomInput) =>
    api.post<BomDetail>('/boms', input, {
      // A double-click on Generate must produce one BOM, not two. The same key + scope
      // replays the original response.
      idempotencyKey: newIdempotencyKey(),
    }),
  );
}

export function useRenderBom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.post<{ bom: BomDetail }>(
        `/boms/${id}/render`,
        undefined,
        {
          idempotencyKey: newIdempotencyKey(),
        },
      ),
    onSuccess: async (result, { id }) => {
      // Refresh the detail so `hasPdf` flips true. Bust the lists too: an IM scanning
      // the index would expect the same change to land there.
      queryClient.setQueryData(queryKeys.boms.detail(id), result.bom);
      await queryClient.invalidateQueries({ queryKey: queryKeys.boms.lists() });
    },
  });
}

export function useVoidBom() {
  return useBomMutation(({ id, input }: { id: string; input: VoidBomInput }) =>
    api.post<BomDetail>(`/boms/${id}/void`, input),
  );
}

/**
 * The signed URL has a TTL — call it lazily, the moment the user clicks Download.
 * `enabled: false` keeps it from running on mount; the `Download PDF` button fires
 * it via `refetch()`. The signed URL is a path relative to the API origin, so the
 * browser opens it in the same tab session.
 */
export function useBomSignedUrl(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['boms', 'pdf-url', id],
    queryFn: ({ signal }) =>
      api.get<BomSignedUrlResponse>(`/boms/${id}/pdf-url`, signal),
    enabled: enabled && id.length > 0,
    // Always re-issue; the TTL is the whole point.
    staleTime: 0,
    retry: false,
  });
}

/**
 * 1-item + over-budget send-back. The IM sees a single approved line and a budget that
 * doesn't fit any candidate unit price; the legitimate path is to bounce the requisition
 * back to the requester for budget revision, not to translate-and-cancel. After success
 * we drop the candidate from the picker cache so the page state stays consistent, and we
 * eagerly invalidate the requisition detail / list queries so the requester lands on a
 * refreshed view the moment the send-back hits the wire.
 */
export function useSendBackForRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SendBackForRevisionInput }) =>
      api.post<RequisitionDetail>(`/requisitions/${id}/send-back-for-revision`, input, {
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: async (detail) => {
      // The detail shape updates: status flips to DRAFT, requiresRevisionTag true.
      queryClient.setQueryData(queryKeys.requisitions.detail(detail.id), detail);
      await queryClient.invalidateQueries({ queryKey: queryKeys.requisitions.lists() });
      // The candidate disappears from the picker too — a DRAFT requisition is not pickable.
      await queryClient.invalidateQueries({ queryKey: queryKeys.boms.candidates() });
    },
  });
}
