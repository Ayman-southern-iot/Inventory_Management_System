import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { LocateDrawer, LocateEvent } from '@ims/shared';
import { RateLimitedError } from '../../common/errors';
import { CONFIG, type AppConfig } from '../../config';
import { MS_PER_SECOND } from '../../common/time';

/**
 * What a poll refused for a full house is told to wait. Well inside an event's lifetime, so a light
 * turned away does not miss the search that follows; retrying every second is at most 60 tries a
 * minute, inside its key's ceiling.
 */
const RETRY_WHEN_FULL_SECONDS = 1;

interface Waiter {
  after: number | undefined;
  /** The per-caller bucket it counts against; undefined only for a caller inside the API. */
  caller: string | undefined;
  settle: (event: LocateEvent | null) => void;
}

/**
 * The drawer-light events: a ring of the most recent ones, and the long-polls waiting for the next.
 *
 * **Memory only, one process.** Nothing here is worth persisting — an event is stale fifteen
 * seconds after it is made — and the API runs as a single process (`import-lock.service.ts` relies
 * on the same fact, and says what changes the day it does not). A restart empties the ring; a
 * light simply waits for the next search.
 *
 * Three rules a light can rely on:
 *
 *  - **`seq` never goes backwards**, across restarts too: it starts from the boot time in
 *    milliseconds and adds one per event, and one event a millisecond is far past the per-caller
 *    limit. A light keeping the last `seq` it acted on is never told to ignore a real event.
 *  - **An expired event is never handed out.** A light that wakes up, or comes back from a long
 *    disconnection, must not replay a search somebody made minutes ago.
 *  - **Falling behind costs nothing.** An `after` older than the ring gets the newest live event;
 *    otherwise the next live one after it.
 *  - **Being ahead costs nothing either.** An `after` beyond the newest `seq` — the API came back
 *    with its clock behind the old process, after a snapshot restore or an NTP step — counts as a
 *    fresh start. Otherwise every new `seq` would sit below it and the light would never wake.
 */
@Injectable()
export class LocateFeed implements OnModuleDestroy {
  private lastSeq = Date.now();
  private readonly events: LocateEvent[] = [];
  private readonly waiters = new Set<Waiter>();
  private isClosed = false;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  publish(drawers: LocateDrawer[]): LocateEvent {
    this.lastSeq += 1;
    const event: LocateEvent = {
      seq: this.lastSeq,
      ts: new Date().toISOString(),
      ttlMs: this.config.locate.eventTtlSeconds * MS_PER_SECOND,
      drawers,
    };
    this.events.push(event);
    if (this.events.length > this.config.locate.ringSize) this.events.shift();

    for (const waiter of [...this.waiters]) {
      if (waiter.after === undefined || event.seq > waiter.after) waiter.settle(event);
    }
    return event;
  }

  /** The newest event that has not expired, or null. */
  latest(now: number = Date.now()): LocateEvent | null {
    const newest = this.events.at(-1);
    return newest !== undefined && isLive(newest, now) ? newest : null;
  }

  /**
   * The event a light that has acted on `after` should act on next, waiting up to `waitSeconds`
   * (capped at `LOCATE_MAX_WAIT_SECONDS`) for one to be published. Null when none arrives in time
   * or `signal` aborts — the client went away, or the API is shutting down.
   *
   * `caller` is who is waiting — per key or per signed-in user, as the controller names it — and
   * no caller may hold more than `LOCATE_MAX_WAITERS_PER_CALLER` waits at once, so one cannot take
   * every slot and starve the lights (decided 2026-10-12). Every HTTP poll passes one.
   */
  async next(
    requestedAfter: number | undefined,
    waitSeconds: number | undefined,
    signal?: AbortSignal,
    caller?: string,
  ): Promise<LocateEvent | null> {
    const after =
      requestedAfter !== undefined && requestedAfter > this.lastSeq ? undefined : requestedAfter;
    const ready = this.readyFor(after, Date.now());
    if (ready !== null) return ready;

    const maxWait = this.config.locate.maxWaitSeconds;
    const waitMs = Math.min(waitSeconds ?? maxWait, maxWait) * MS_PER_SECOND;
    // Shutting down: a light that re-polls on the shutdown answer must not be parked again.
    if (waitMs === 0 || signal?.aborted || this.isClosed) return null;

    // Each waiter is a held socket. A full house, or a caller already holding its share, is a
    // capacity answer.
    if (this.waiters.size >= this.config.locate.maxWaiters) {
      throw new RateLimitedError(RETRY_WHEN_FULL_SECONDS);
    }
    if (caller !== undefined && this.waitingFor(caller) >= this.config.locate.maxWaitersPerCaller) {
      throw new RateLimitedError(RETRY_WHEN_FULL_SECONDS);
    }

    return new Promise<LocateEvent | null>((resolve) => {
      const waiter: Waiter = {
        after,
        caller,
        settle: (event) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          this.waiters.delete(waiter);
          resolve(event);
        },
      };
      const timer = setTimeout(() => waiter.settle(null), waitMs);
      const onAbort = () => waiter.settle(null);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.add(waiter);
    });
  }

  /** Open long-polls right now. */
  get waiting(): number {
    return this.waiters.size;
  }

  /** Open long-polls held by one caller. */
  waitingFor(caller: string): number {
    let count = 0;
    for (const waiter of this.waiters) if (waiter.caller === caller) count += 1;
    return count;
  }

  /** Release every held request at once, so a shutdown is not kept waiting on them. */
  onModuleDestroy(): void {
    this.isClosed = true;
    for (const waiter of [...this.waiters]) waiter.settle(null);
  }

  private readyFor(after: number | undefined, now: number): LocateEvent | null {
    const oldest = this.events[0];
    if (oldest === undefined) return null;
    // Fresh start, or fell behind further than the ring reaches: only the newest is worth showing.
    if (after === undefined || after < oldest.seq - 1) return this.latest(now);
    return this.events.find((event) => event.seq > after && isLive(event, now)) ?? null;
  }
}

function isLive(event: LocateEvent, now: number): boolean {
  return Date.parse(event.ts) + event.ttlMs > now;
}
