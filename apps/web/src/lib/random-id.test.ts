import { afterEach, describe, expect, it } from 'vitest';
import { randomId } from './random-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const original = crypto.randomUUID;
afterEach(() => {
  Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
});

/** Reproduces a non-secure origin, where the browser does not define `crypto.randomUUID`. */
function asInsecureContext() {
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
}

describe('randomId', () => {
  it('returns a v4 uuid in a secure context', () => {
    expect(randomId()).toMatch(UUID_V4);
  });

  /**
   * The regression this exists for: served over plain HTTP from a LAN address,
   * `crypto.randomUUID` is undefined. Every idempotent mutation threw a TypeError before it
   * could send, and the UI reported a server error for a request the server never received.
   */
  it('still returns a v4 uuid when randomUUID is unavailable', () => {
    asInsecureContext();

    expect(randomId()).toMatch(UUID_V4);
  });

  it('does not throw on a non-secure origin', () => {
    asInsecureContext();

    expect(() => randomId()).not.toThrow();
  });

  it('produces distinct values in the fallback path', () => {
    asInsecureContext();

    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    // Idempotency keys that collide would let one request return another's stored response.
    expect(ids.size).toBe(500);
  });
});
