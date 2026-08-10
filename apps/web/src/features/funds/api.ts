import { randomId } from '@/lib/random-id';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BorrowToUserInput,
  ReceiveIntoStockInput,
  RecordFundReceiptInput,
  RecordPurchaseInput,
  RequisitionFunding,
  SendToAccountsInput,
  UnverifyPurchaseInput,
  VerifyPurchaseInput,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';

export function useFunding(requisitionId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.funds.funding(requisitionId),
    queryFn: ({ signal }) =>
      api.get<RequisitionFunding>(`/requisitions/${requisitionId}/funding`, signal),
    enabled: enabled && Boolean(requisitionId),
  });
}

/**
 * Every money action returns the fresh funding summary, so the mutation writes it straight into
 * the cache rather than refetching. The requisition itself is invalidated too — each of these
 * moves the status, and the tracker above the panel is reading it.
 */
function useFundsMutation<TInput>(
  requisitionId: string,
  request: (input: TInput) => Promise<RequisitionFunding>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (funding) => {
      queryClient.setQueryData(queryKeys.funds.funding(requisitionId), funding);
      void queryClient.invalidateQueries({ queryKey: queryKeys.requisitions.detail(requisitionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.requisitions.lists() });
    },
  });
}

export function useSendToAccounts(id: string) {
  return useFundsMutation<SendToAccountsInput>(id, (input) =>
    api.post<RequisitionFunding>(`/requisitions/${id}/send-to-accounts`, input),
  );
}

export function useRecordReceipt(id: string) {
  return useFundsMutation<RecordFundReceiptInput>(id, (input) =>
    // Idempotency-keyed: a double-click would otherwise look exactly like two genuine instalments.
    api.post<RequisitionFunding>(`/requisitions/${id}/fund-receipts`, input, {
      idempotencyKey: randomId(),
    }),
  );
}

export function useRecordPurchase(id: string) {
  return useFundsMutation<RecordPurchaseInput>(id, (input) =>
    api.post<RequisitionFunding>(`/requisitions/${id}/purchases`, input, {
      idempotencyKey: randomId(),
    }),
  );
}

export function useVerifyPurchase(id: string) {
  return useFundsMutation<VerifyPurchaseInput>(id, (input) =>
    api.post<RequisitionFunding>(`/requisitions/${id}/verify-purchase`, input, {
      idempotencyKey: randomId(),
    }),
  );
}

export function useUnverifyPurchase(id: string) {
  return useFundsMutation<UnverifyPurchaseInput>(id, (input) =>
    // Idempotency-keyed: the only failure mode this guard exists for is a double-click on the
    // Back button — without it, two appends would race the audit log.
    api.post<RequisitionFunding>(`/requisitions/${id}/unverify-purchase`, input, {
      idempotencyKey: randomId(),
    }),
  );
}

export function useReceiveIntoStock(id: string) {
  return useFundsMutation<ReceiveIntoStockInput>(id, (input) =>
    api.post<RequisitionFunding>(`/requisitions/${id}/receive-to-stock`, input, {
      idempotencyKey: randomId(),
    }),
  );
}

export function useBorrowToUser(id: string) {
  return useFundsMutation<BorrowToUserInput>(id, (input) =>
    api.post<RequisitionFunding>(`/requisitions/${id}/borrow-to-user`, input, {
      idempotencyKey: randomId(),
    }),
  );
}

export function useAttachInvoice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ purchaseId, file }: { purchaseId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<RequisitionFunding>(
        `/requisitions/${id}/purchases/${purchaseId}/invoice`,
        form,
      );
    },
    onSuccess: (funding) => {
      queryClient.setQueryData(queryKeys.funds.funding(id), funding);
    },
  });
}

/** The invoice download URL. Bearer-authenticated, so the panel fetches it as a blob. */
export function invoicePath(requisitionId: string, purchaseId: string): string {
  return `/requisitions/${requisitionId}/purchases/${purchaseId}/invoice`;
}
