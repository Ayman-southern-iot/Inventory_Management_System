import { useEffect, useRef } from 'react';
import { locatableIds, useLocate } from '../api';

/**
 * Posts one locate for a search that has settled: `search` is the settled text and `productIds`
 * its result, or null for both while typing is still going on or the result is not ready yet.
 *
 * Once per settled search: a refetch that returns the same products, in any order, does not light
 * the drawers again, but anything that unsettles the search does, so searching the same word
 * twice lights twice. `isEnabled` false pauses it without forgetting what it last posted, so a
 * screen can step away from its results and back without lighting them again. Returns the
 * mutation so a screen can also post on a tap.
 */
export function useLocateSettledResult(
  search: string | null,
  productIds: readonly string[] | null,
  isEnabled = true,
) {
  const locate = useLocate();
  const { mutate } = locate;
  const lastPosted = useRef<string | null>(null);
  const ids = search === null || productIds === null ? null : locatableIds(productIds);
  const signature = ids === null ? null : `${search}\n${[...ids].sort().join(',')}`;

  // A fire-and-forget mutation, not a data fetch: rule 30-frontend.md's "no useEffect + fetch" is
  // about reading server state, which this does not. Keyed on `signature`, which `ids` is derived
  // from, so the effect runs once per distinct settled result rather than on every render.
  useEffect(() => {
    if (!isEnabled) return;
    if (signature === null || ids === null) {
      lastPosted.current = null;
      return;
    }
    if (signature === lastPosted.current) return;
    lastPosted.current = signature;
    mutate(ids);
  }, [signature, isEnabled, mutate]);

  return locate;
}
