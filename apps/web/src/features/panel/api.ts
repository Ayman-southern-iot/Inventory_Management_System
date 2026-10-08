import { useQuery } from '@tanstack/react-query';
import { ErrorCode, type Catalogue } from '@ims/shared';
import { ApiError, NETWORK_ERROR_CODE, api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { GATEWAY_FAILURE_STATUSES, PANEL_OFFLINE_RETRY_MS, PANEL_REFRESH_MS } from './constants';

/**
 * The only path the panel calls, besides the session restore every page shares. `GET /catalogue`
 * carries no person data by construction (contracts/catalogue.ts, "No names, ever"), which is why
 * it and not `GET /products/:id` feeds the panel: product detail answers a session with
 * `activeBorrows`, borrower names included. `panel-no-person-data.int-spec.ts` pins this path.
 */
export const PANEL_CATALOGUE_PATH = '/catalogue';

/** The API did not answer at all, or a proxy answered for it. */
export function isUnreachable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === NETWORK_ERROR_CODE) return true;
  return (
    GATEWAY_FAILURE_STATUSES.has(error.status) && error.code !== ErrorCode.SYSTEM_IMPORT_IN_PROGRESS
  );
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
