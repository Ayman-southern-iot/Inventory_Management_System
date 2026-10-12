import { LocateState, type LocateDrawer } from '@ims/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitedError } from '../../common/errors';
import type { AppConfig } from '../../config';
import { LocateFeed } from './locate-feed';

const BOOT = Date.parse('2026-10-12T08:00:00.000Z');
const TTL_SECONDS = 15;
const MAX_WAIT_SECONDS = 25;

const drawers = (zone: string): LocateDrawer[] => [
  { zone, room: 'Cabinet B', state: LocateState.GREEN, cells: ['1A'] },
];

const feedWith = (overrides: Partial<AppConfig['locate']> = {}) =>
  new LocateFeed({
    locate: {
      eventTtlSeconds: TTL_SECONDS,
      maxWaitSeconds: MAX_WAIT_SECONDS,
      maxWaiters: 32,
      ringSize: 64,
      ...overrides,
    },
  } as AppConfig);

describe('LocateFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BOOT);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('numbers events from the boot time, one apart, so a restart never goes backwards', () => {
    const feed = feedWith();
    expect(feed.publish(drawers('B1')).seq).toBe(BOOT + 1);
    expect(feed.publish(drawers('B2')).seq).toBe(BOOT + 2);
  });

  it('answers at once with the next event after `after`', async () => {
    const feed = feedWith();
    const first = feed.publish(drawers('B1'));
    const second = feed.publish(drawers('B2'));
    await expect(feed.next(first.seq, 0)).resolves.toEqual(second);
  });

  it('wakes a waiting poll when an event is published', async () => {
    const feed = feedWith();
    const waiting = feed.next(undefined, MAX_WAIT_SECONDS);
    expect(feed.waiting).toBe(1);
    const event = feed.publish(drawers('B2'));
    await expect(waiting).resolves.toEqual(event);
    expect(feed.waiting).toBe(0);
  });

  it('answers null when nothing is published in time, and frees the slot', async () => {
    const feed = feedWith();
    const waiting = feed.next(undefined, 2);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(waiting).resolves.toBeNull();
    expect(feed.waiting).toBe(0);
  });

  it('caps the wait at the configured maximum', async () => {
    const feed = feedWith();
    const waiting = feed.next(undefined, 3_600);
    await vi.advanceTimersByTimeAsync(MAX_WAIT_SECONDS * 1_000 - 1);
    expect(feed.waiting).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBeNull();
  });

  it('never hands out an expired event, to a fresh poll or to one that is behind', async () => {
    const feed = feedWith();
    const old = feed.publish(drawers('B1'));
    vi.setSystemTime(BOOT + TTL_SECONDS * 1_000);
    await expect(feed.next(undefined, 0)).resolves.toBeNull();
    await expect(feed.next(old.seq - 1, 0)).resolves.toBeNull();
    expect(feed.latest()).toBeNull();
  });

  it('skips expired events for a poll that is behind and returns the first live one', async () => {
    const feed = feedWith();
    const stale = feed.publish(drawers('B1'));
    vi.setSystemTime(BOOT + 10_000);
    const fresh = feed.publish(drawers('B2'));
    vi.setSystemTime(BOOT + TTL_SECONDS * 1_000 + 1);
    await expect(feed.next(stale.seq - 1, 0)).resolves.toEqual(fresh);
  });

  it('gives a poll older than the ring the newest event, not the oldest it still holds', async () => {
    const feed = feedWith({ ringSize: 2 });
    const dropped = feed.publish(drawers('B1'));
    feed.publish(drawers('B2'));
    const newest = feed.publish(drawers('B3'));
    await expect(feed.next(dropped.seq - 1, 0)).resolves.toEqual(newest);
  });

  it('gives a fresh poll the newest live event', async () => {
    const feed = feedWith();
    feed.publish(drawers('B1'));
    const newest = feed.publish(drawers('B2'));
    await expect(feed.next(undefined, 0)).resolves.toEqual(newest);
  });

  it('waits rather than replaying when the light is already up to date', async () => {
    const feed = feedWith();
    const seen = feed.publish(drawers('B1'));
    await expect(feed.next(seen.seq, 0)).resolves.toBeNull();
  });

  it('refuses a poll past the waiter cap with a 429 to retry well inside an event lifetime', async () => {
    const feed = feedWith({ maxWaiters: 2 });
    void feed.next(undefined, 5);
    void feed.next(undefined, 5);
    const refused = await feed.next(undefined, 5).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RateLimitedError);
    const { details } = (refused as RateLimitedError).getResponse() as {
      details: { retryAfterSeconds: number };
    };
    expect(details.retryAfterSeconds).toBeLessThan(TTL_SECONDS);
    feed.onModuleDestroy();
  });

  /** An API back with its clock behind the old process hands out seqs below the light's `after`. */
  it('treats an `after` beyond the newest seq as a fresh start, so the light still wakes', async () => {
    const feed = feedWith();
    const fromBeforeTheRestart = BOOT + 10_000_000;
    const current = feed.publish(drawers('B1'));
    // Answered at once with the newest live event, like a light starting up.
    await expect(feed.next(fromBeforeTheRestart, 0)).resolves.toEqual(current);

    // And parked, then woken, once nothing live is waiting.
    vi.setSystemTime(BOOT + TTL_SECONDS * 1_000);
    const waiting = feed.next(fromBeforeTheRestart, MAX_WAIT_SECONDS);
    expect(feed.waiting).toBe(1);
    const next = feed.publish(drawers('B2'));
    await expect(waiting).resolves.toEqual(next);
  });

  it('parks no new poll once shutting down', async () => {
    const feed = feedWith();
    feed.onModuleDestroy();
    await expect(feed.next(undefined, MAX_WAIT_SECONDS)).resolves.toBeNull();
    expect(feed.waiting).toBe(0);
  });

  it('refuses a caller past its own share of waits, and not another caller', async () => {
    const feed = feedWith({ maxWaitersPerCaller: 2 });
    void feed.next(undefined, 5, undefined, 'apikey:a');
    void feed.next(undefined, 5, undefined, 'apikey:a');
    await expect(feed.next(undefined, 5, undefined, 'apikey:a')).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    void feed.next(undefined, 5, undefined, 'apikey:b');
    expect(feed.waitingFor('apikey:a')).toBe(2);
    expect(feed.waitingFor('apikey:b')).toBe(1);
    feed.onModuleDestroy();
  });

  it('gives a caller its share back once one of its waits ends', async () => {
    const feed = feedWith({ maxWaitersPerCaller: 1 });
    const first = feed.next(undefined, 2, undefined, 'user:u');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(first).resolves.toBeNull();
    void feed.next(undefined, 2, undefined, 'user:u');
    expect(feed.waitingFor('user:u')).toBe(1);
    feed.onModuleDestroy();
  });

  it('frees the slot when the client goes away', async () => {
    const feed = feedWith();
    const gone = new AbortController();
    const waiting = feed.next(undefined, 5, gone.signal);
    gone.abort();
    await expect(waiting).resolves.toBeNull();
    expect(feed.waiting).toBe(0);
  });

  it('releases every waiting poll on shutdown', async () => {
    const feed = feedWith();
    const waiting = [feed.next(undefined, 25), feed.next(undefined, 25)];
    feed.onModuleDestroy();
    await expect(Promise.all(waiting)).resolves.toEqual([null, null]);
  });
});
