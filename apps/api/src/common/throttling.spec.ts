import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { apiKeyTracker, isApiKeyRequest } from './throttling';

/**
 * ADR-0002: a key is rate-limited per key, and every key-shaped request also still counts against
 * its address (Phase 10's ceiling), so rotating made-up keys cannot buy unlimited requests.
 * Both decisions must read the credential exactly as `JwtAuthGuard` does, or a request is
 * counted in a tier that does not match what the guard then treats it as.
 */
const context = (request: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('isApiKeyRequest', () => {
  it('reads a Bearer key and a URL key as key requests', () => {
    expect(isApiKeyRequest(context({ headers: { authorization: 'Bearer ims_abc' } }))).toBe(true);
    expect(isApiKeyRequest(context({ headers: {}, query: { api_key: 'ims_abc' } }))).toBe(true);
  });

  /**
   * The guard lets a session header win over a URL key on a GET. Counting that request as a key
   * request skipped the session's own ceiling, and a made-up `?api_key=` per request then bought
   * a fresh key bucket every time — a signed-in user with no rate limit at all.
   */
  it('treats a session header as a session, whatever sits in the URL', () => {
    expect(
      isApiKeyRequest(
        context({ headers: { authorization: 'Bearer eyJhbGciOi' }, query: { api_key: 'ims_x' } }),
      ),
    ).toBe(false);
  });

  it('trims the way the guard trims, so padding cannot move a key into the looser tier', () => {
    expect(isApiKeyRequest(context({ headers: { authorization: 'Bearer   ims_abc' } }))).toBe(true);
    expect(isApiKeyRequest(context({ headers: {}, query: { api_key: '  ims_abc' } }))).toBe(true);
  });

  it('is not fooled by a session with no key anywhere', () => {
    expect(isApiKeyRequest(context({ headers: {} }))).toBe(false);
  });
});

describe('apiKeyTracker', () => {
  const token = 'ims_ABCDEFGHsecretsecretsecretsecretsecret';

  it('puts the same key in the same bucket however it was presented', () => {
    const bucket = apiKeyTracker({ headers: { authorization: `Bearer ${token}` } });
    expect(apiKeyTracker({ headers: {}, query: { api_key: token } })).toBe(bucket);
    expect(apiKeyTracker({ headers: { authorization: `Bearer   ${token}` } })).toBe(bucket);
  });

  /**
   * The public prefix used to be the bucket, and it is shown in the admin list and audit rows —
   * so made-up tokens sharing a real key's prefix could spend that key's budget and starve the
   * panel. The bucket is now a hash of the whole key, which only its holder can reproduce.
   */
  it('gives two keys that share a public prefix two buckets', () => {
    const lookalike = 'ims_ABCDEFGHsomethingelseentirelydifferent';
    expect(apiKeyTracker({ headers: { authorization: `Bearer ${lookalike}` } })).not.toBe(
      apiKeyTracker({ headers: { authorization: `Bearer ${token}` } }),
    );
  });

  it('never puts the key, or its public prefix, into the bucket name', () => {
    const bucket = apiKeyTracker({ headers: { authorization: `Bearer ${token}` } });
    expect(bucket).not.toContain('secret');
    expect(bucket).not.toContain('ABCDEFGH');
  });
});
