import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logoutWith } from './client';
import { readStoredTokens } from './token-store';

/** A JSON response as the API would send it. */
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });

/** The request's path from `/auth` on, whatever the configured API base is. */
const authPath = (input: unknown) => String(input).replace(/^.*(\/auth\/)/, '$1');

describe('logoutWith: signing out with tokens already removed from storage', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const held = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the logout with the tokens it was given, since storage is already empty', async () => {
    fetchMock.mockResolvedValueOnce(noContent());

    await logoutWith(held);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(authPath(input)).toBe('/auth/logout');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access');
    expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'refresh' });
  });

  it('refreshes an expired access token in memory and logs out with the new pair, writing nothing to storage', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED', message: 'expired' }))
      .mockResolvedValueOnce(reply(200, { accessToken: 'fresh', refreshToken: 'rotated', expiresIn: 900 }))
      .mockResolvedValueOnce(noContent());

    await logoutWith(held);

    expect(fetchMock.mock.calls.map(([input]) => authPath(input))).toEqual([
      '/auth/logout',
      '/auth/refresh',
      '/auth/logout',
    ]);
    const [, last] = fetchMock.mock.calls[2] ?? [];
    expect((last?.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
    expect(JSON.parse(String(last?.body))).toEqual({ refreshToken: 'rotated' });
    expect(readStoredTokens()).toBeNull();
  });

  it('does not refresh when the server refuses for any reason but an expired token', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { code: 'TOKEN_REUSE_DETECTED', message: 'reused' }));

    await expect(logoutWith(held)).rejects.toMatchObject({ code: 'TOKEN_REUSE_DETECTED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readStoredTokens()).toBeNull();
  });
});
