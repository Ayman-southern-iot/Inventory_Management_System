import { ErrorCode, type ApiErrorBody, type AuthTokens, type LoginResponse } from '@ims/shared';
import { webConfig } from './config';
import { clearStoredTokens, readStoredTokens, writeStoredTokens } from './token-store';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skips the Authorization header and the refresh dance — login and refresh itself. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

/**
 * A single in-flight refresh, shared by every 401 that arrives while it is running. Without
 * this, six parallel queries expiring together fire six refreshes, five of which present an
 * already-rotated token and trip the server's reuse detection — logging the user out.
 */
let refreshInFlight: Promise<AuthTokens | null> | null = null;

/** Set by AuthProvider so a failed refresh can drop the app back to the login screen. */
let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

function url(path: string): string {
  return `${webConfig.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await response.json()) as Partial<ApiErrorBody>;
  } catch {
    // A non-JSON error body means the proxy or the network answered, not the API.
  }
  return new ApiError(
    body.code ?? ErrorCode.INTERNAL,
    body.message ?? 'Request failed',
    response.status,
    body.details,
  );
}

async function rawRequest<T>(path: string, options: RequestOptions, accessToken: string | null) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken && !options.anonymous) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(url(path), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('NETWORK', 'Cannot reach the server', 0);
  }

  if (response.status === 204) return undefined as T;
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

/**
 * Serialises refreshes across every tab on this origin.
 *
 * The in-process single-flight below is per browsing context, so two open tabs whose access
 * tokens expire together — they always do, they were issued together — each fire their own
 * refresh. The loser presents a token the winner already rotated away, the server correctly
 * reads that as a replay, and the user is signed out of both tabs for no reason. The server
 * is right; the client has to stop racing itself.
 *
 * `navigator.locks` is the browser's own cross-tab mutex. Where it is unavailable the callback
 * simply runs unguarded, which is exactly today's behaviour rather than a new failure mode.
 */
const REFRESH_LOCK = 'ims.auth.refresh';

async function withCrossTabLock<T>(run: () => Promise<T>): Promise<T> {
  if (!('locks' in navigator)) return run();
  return navigator.locks.request(REFRESH_LOCK, run);
}

async function refreshTokens(staleAccessToken: string | null): Promise<AuthTokens | null> {
  return withCrossTabLock(async () => {
    // Re-read inside the lock. If another tab refreshed while this one waited, the stored
    // token is already fresh — using it directly avoids a second, pointless rotation.
    const stored = readStoredTokens();
    if (!stored) return null;
    if (staleAccessToken && stored.accessToken !== staleAccessToken) return stored;

    try {
      const result = await rawRequest<LoginResponse>(
        '/auth/refresh',
        { method: 'POST', body: { refreshToken: stored.refreshToken }, anonymous: true },
        null,
      );
      writeStoredTokens(result);
      return result;
    } catch {
      clearStoredTokens();
      return null;
    }
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const stored = readStoredTokens();

  try {
    return await rawRequest<T>(path, options, stored?.accessToken ?? null);
  } catch (error) {
    const isExpired =
      error instanceof ApiError &&
      error.status === 401 &&
      !options.anonymous &&
      error.code !== ErrorCode.TOKEN_REUSE_DETECTED;

    if (!isExpired) throw error;

    refreshInFlight ??= refreshTokens(stored?.accessToken ?? null).finally(() => {
      refreshInFlight = null;
    });
    const refreshed = await refreshInFlight;

    if (!refreshed) {
      onSessionLost?.();
      throw error;
    }
    return rawRequest<T>(path, options, refreshed.accessToken);
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  /** Login must not send a stale Authorization header from a previous session. */
  loginRequest: <T>(path: string, body: unknown) =>
    apiRequest<T>(path, { method: 'POST', body, anonymous: true }),
};
