import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setSessionLostHandler } from './client';
import { readStoredTokens, writeStoredTokens } from './token-store';

/** A JSON response as the API would send it. */
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('a request whose access token has expired', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const onSessionLost = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    writeStoredTokens({ accessToken: 'stale', refreshToken: 'refresh', expiresIn: 900 });
    fetchMock.mockReset();
    onSessionLost.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setSessionLostHandler(onSessionLost);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionLostHandler(null);
  });

  it('keeps the session when the refresh cannot reach the server, and reports it as offline', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED', message: 'expired' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await api.get('/catalogue').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NETWORK');
    expect(readStoredTokens()).not.toBeNull();
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('keeps the session when a proxy answers the refresh for an API that is down', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED', message: 'expired' }))
      .mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));

    await api.get('/catalogue').catch(() => undefined);

    expect(readStoredTokens()).not.toBeNull();
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('keeps the session when the API is locked for an import (its own 503)', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED', message: 'expired' }))
      .mockResolvedValueOnce(reply(503, { code: 'SYSTEM_IMPORT_IN_PROGRESS', message: 'busy' }));

    await api.get('/catalogue').catch(() => undefined);

    expect(readStoredTokens()).not.toBeNull();
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('signs out when the server refuses the refresh', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED', message: 'expired' }))
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED', message: 'expired' }));

    const error = await api.get('/catalogue').catch((caught: unknown) => caught);

    expect((error as ApiError).status).toBe(401);
    expect(readStoredTokens()).toBeNull();
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('retries the request with the new token when the refresh succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED', message: 'expired' }))
      .mockResolvedValueOnce(
        reply(200, { accessToken: 'fresh', refreshToken: 'refresh-2', expiresIn: 900, user: {} }),
      )
      .mockResolvedValueOnce(reply(200, { ok: true }));

    await expect(api.get('/catalogue')).resolves.toEqual({ ok: true });
    expect(readStoredTokens()?.accessToken).toBe('fresh');
  });
});
