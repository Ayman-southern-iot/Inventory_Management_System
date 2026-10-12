import { MS_PER_SECOND } from '../../common/time';

/**
 * A fixed window of calls per caller, held in memory.
 *
 * Why not the global throttler: its trackers run in a global guard whose order relative to
 * `JwtAuthGuard` is not declared (`common/throttling.ts`), so it cannot rely on knowing *who* is
 * calling — it counts by address or by the raw key. `POST /locate` is counted per signed-in user
 * and per key, which only the handler, running after authentication, can know.
 *
 * Per process, like the import lock (`import-lock.service.ts`): correct while the API runs as one
 * process, and the day it runs two this becomes a shared store.
 */
export class CallerWindow {
  private readonly windows = new Map<string, { count: number; resetsAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Counts one call by `caller`. Returns 0 when it is allowed, otherwise the whole seconds until
   * the caller's window resets — at least 1, so a `Retry-After` is never 0.
   */
  take(caller: string, now: number): number {
    // Callers are people and keys — a few dozen at most — so a full sweep keeps the map bounded
    // without a timer to clean up.
    for (const [key, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(key);
    }

    const window = this.windows.get(caller);
    if (window === undefined) {
      this.windows.set(caller, { count: 1, resetsAt: now + this.windowMs });
      return 0;
    }
    if (window.count >= this.limit) {
      return Math.max(1, Math.ceil((window.resetsAt - now) / MS_PER_SECOND));
    }
    window.count += 1;
    return 0;
  }
}
