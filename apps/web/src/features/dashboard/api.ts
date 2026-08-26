import { useQuery } from '@tanstack/react-query';
import type { PersonalRecord } from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';

/**
 * The signed-in person's own record. No parameters — the endpoint reads `req.user.id` and there
 * is no way to ask about anyone else (ruling 2026-08-26: own figures only).
 */
export function usePersonalRecord() {
  return useQuery({
    queryKey: queryKeys.dashboard.me(),
    queryFn: ({ signal }) => api.get<PersonalRecord>('/dashboard/me', signal),
  });
}
