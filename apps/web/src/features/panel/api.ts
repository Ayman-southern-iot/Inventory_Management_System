import { useQuery } from '@tanstack/react-query';
import { ErrorCode, type Catalogue } from '@ims/shared';
import { ApiError, api, isApiUnreachable } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { PANEL_OFFLINE_RETRY_MS, PANEL_REFRESH_MS } from './constants';

/**
 * The only path the panel calls, besides the session restore every page shares. `GET /catalogue`
 * carries no person data by construction (contracts/catalogue.ts, "No names, ever"), which is why
 * it and not `GET /products/:id` feeds the panel: product detail answers a session with
 * `activeBorrows`, borrower names included. `panel-no-person-data.int-spec.ts` pins this path.
 */
export const PANEL_CATALOGUE_PATH = '/catalogue';

/**
 * The API did not answer at all, or a proxy answered for it: the offline banner and the 10 s
 * retry. The app-wide rule (`isApiUnreachable`, which also keeps a session alive through an
 * outage) with one exception: the import lock's own 503. That one has its overlay and is worded
 * by `messageForError`, rather than being called offline.
 */
export function isUnreachable(error: unknown): boolean {
  const isImportLock =
    error instanceof ApiError && error.code === ErrorCode.SYSTEM_IMPORT_IN_PROGRESS;
  return isApiUnreachable(error) && !isImportLock;
}

/**
 * One read of the whole catalogue, searched on the device. A kiosk keeps answering from the last
 * good copy while the network is down; the offline banner says so, and the next poll — every
 * 10 s while unreachable, every minute otherwise — brings it back without a touch.
 */
export function usePanelCatalogue() {
  return useQuery({
    queryKey: queryKeys.catalogue.all(),
    queryFn: ({ signal }) => api.get<Catalogue>(PANEL_CATALOGUE_PATH, signal),
    // The poll is the retry. Two quick retries on top would only delay the banner.
    retry: false,
    refetchInterval: (query) =>
      isUnreachable(query.state.error) ? PANEL_OFFLINE_RETRY_MS : PANEL_REFRESH_MS,
    refetchIntervalInBackground: true,
  });
}
