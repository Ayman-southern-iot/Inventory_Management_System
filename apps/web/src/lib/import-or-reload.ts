/**
 * Loads a lazily split chunk, and reloads the page once if it cannot.
 *
 * A page that stays open across a deploy still holds the old entry bundle, and the old entry
 * asks for the old chunk names, which the new build no longer serves. The lab panel's kiosk is
 * exactly that page: it can sit on the login screen for days and then open `/panel`. A reload
 * fetches the new build. The flag makes it happen at most once per tab session: if the chunk
 * still fails after the reload, the error goes to the error boundary instead of looping.
 *
 * A dropped network fails the same import in the same way, and reloading then lands on the
 * browser's own offline page, outside the app — on a touch kiosk, with no way back. So the reload
 * happens only when the server answers; otherwise the error boundary shows, with its Reload.
 */

export interface ReloadGuard {
  /** True once this tab has reloaded for a failed chunk, or when that cannot be known. */
  isSet(): boolean;
  set(): void;
  clear(): void;
  reload(): void;
  /** Whether the server answers at all, so a reload would load the app and not an error page. */
  canReachServer(): Promise<boolean>;
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
    // The page's own URL: the server answers it with the app (SPA fallback), so a 2xx here means
    // a reload would succeed. `navigator.onLine` is no use: it stays true with the LAN up and the
    // server down. HEAD and no-store, so nothing is downloaded and no cached answer is trusted.
    canReachServer: async () => {
      try {
        const response = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
        return response.ok;
      } catch {
        return false;
      }
    },
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
    // Offline looks exactly like a missing chunk; only a server that answers is worth reloading.
    if (!(await guard.canReachServer())) throw error;
    guard.set();
    // The flag did not stick (storage full or refused): a reload could come back here for ever.
    if (!guard.isSet()) throw error;
    guard.reload();
    // The page is going away; leave the lazy component suspended until it does.
    return new Promise<T>(() => {});
  }
}
