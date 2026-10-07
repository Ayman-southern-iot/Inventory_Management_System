/**
 * Loads a lazily split chunk, and reloads the page once if it cannot.
 *
 * A page that stays open across a deploy still holds the old entry bundle, and the old entry
 * asks for the old chunk names, which the new build no longer serves. The lab panel's kiosk is
 * exactly that page: it can sit on the login screen for days and then open `/panel`. A reload
 * fetches the new build. The flag makes it happen at most once per tab session: if the chunk
 * still fails after the reload, the error goes to the error boundary instead of looping.
 */

export interface ReloadGuard {
  /** True once this tab has reloaded for a failed chunk, or when that cannot be known. */
  isSet(): boolean;
  set(): void;
  clear(): void;
  reload(): void;
}

export function sessionReloadGuard(key: string): ReloadGuard {
  return {
    // Storage that cannot be read counts as "already reloaded": no guard, no reload.
    isSet: () => {
      try {
        return window.sessionStorage.getItem(key) !== null;
      } catch {
        return true;
      }
    },
    set: () => {
      try {
        window.sessionStorage.setItem(key, '1');
      } catch {
        // Checked again by the caller before it reloads.
      }
    },
    clear: () => {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Nothing was stored, so there is nothing to clear.
      }
    },
    reload: () => window.location.reload(),
  };
}

export async function importOrReloadOnce<T>(
  load: () => Promise<T>,
  guard: ReloadGuard,
): Promise<T> {
  try {
    const loaded = await load();
    guard.clear();
    return loaded;
  } catch (error) {
    if (guard.isSet()) throw error;
    guard.set();
    // The flag did not stick (storage full or refused): a reload could come back here for ever.
    if (!guard.isSet()) throw error;
    guard.reload();
    // The page is going away; leave the lazy component suspended until it does.
    return new Promise<T>(() => {});
  }
}
