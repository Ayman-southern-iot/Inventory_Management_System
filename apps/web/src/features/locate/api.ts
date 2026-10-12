import { useMutation } from '@tanstack/react-query';
import { LOCATE_MAX_PRODUCTS, type LocateAccepted } from '@ims/shared';
import { api } from '@/api/client';

/** `POST /locate`: lights the cabinet drawers that hold these products (Phase 13). */
export const LOCATE_PATH = '/locate';

/**
 * Tells the drawer lights where products are. Fire and forget: a failure is held in the
 * mutation's state and shown nowhere on purpose — nobody at the screen can act on it, and the
 * only honest symptom is that the drawer does not light.
 */
export function useLocate() {
  return useMutation({
    mutationFn: (productIds: readonly string[]) =>
      api.post<LocateAccepted>(LOCATE_PATH, { productIds }),
  });
}

/**
 * The distinct ids worth locating, or null. More than `LOCATE_MAX_PRODUCTS` is a search too broad
 * to light usefully, so it posts nothing rather than being cut down to the first few.
 */
export function locatableIds(productIds: readonly string[]): string[] | null {
  const distinct = [...new Set(productIds)];
  return distinct.length >= 1 && distinct.length <= LOCATE_MAX_PRODUCTS ? distinct : null;
}
