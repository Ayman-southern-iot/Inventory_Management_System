import { useQuery } from '@tanstack/react-query';
import { LIVE_IMPORT_STATUSES, type ImportJob } from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';

/**
 * One import run, polled while it is still going (`importing_data.md` §5.6, part J).
 *
 * **Polling, not a websocket.** §3.6: there is no realtime channel in this system, and adding one
 * for a screen that is open for a few minutes a month would be a moving part to operate for the
 * rest of the product's life. A poll that stops the moment the job reaches a terminal state costs
 * a request a second for the duration of an import and nothing at all otherwise.
 *
 * The endpoint is allow-listed through the lockout, which is what makes this work at all: every
 * other request from this browser is being refused 503 while the import runs.
 */
export function useImportJob(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.imports.detail(jobId ?? ''),
    enabled: jobId !== null,
    queryFn: () => api.get<ImportJob>(`/inventory/imports/${jobId!}`),
    /*
     * Stops on its own. `refetchInterval` returning false is what ends the poll, so a finished
     * import does not keep a timer running behind whatever the person navigates to next.
     */
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) return POLL_INTERVAL_MS;
      return LIVE_IMPORT_STATUSES.includes(job.status) ? POLL_INTERVAL_MS : false;
    },
    // The whole point is to be current; a cached answer would freeze the ring.
    staleTime: 0,
  });
}

/**
 * A second, not faster. The ring's *time* updates every second from a local clock, so a faster
 * poll would buy nothing visible while costing requests against an API that is mid-import.
 */
const POLL_INTERVAL_MS = 1_000;
