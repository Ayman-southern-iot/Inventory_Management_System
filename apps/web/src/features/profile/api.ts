import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StoredFile } from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';

/**
 * The signed-in user's own signature. Every route is scoped to the caller server-side — there is
 * no user id in any of these paths, by design.
 */
export function useMySignature(enabled = true) {
  return useQuery({
    queryKey: queryKeys.profile.signature(),
    queryFn: ({ signal }) =>
      api.get<{ signature: StoredFile | null }>('/me/signature', signal),
    enabled,
  });
}

export function useUploadSignature() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      // Field name must match the server's FileInterceptor('file').
      form.append('file', file);
      return api.upload<{ signature: StoredFile }>('/me/signature', form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.signature() });
    },
  });
}

export function useDeleteSignature() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<void>('/me/signature'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.signature() });
    },
  });
}
