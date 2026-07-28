/**
 * The only place the frontend reads its environment. Same reasoning as the backend's config
 * module: one file, validated, no `import.meta.env` scattered at call sites.
 *
 * `VITE_API_BASE_URL` defaults to a same-origin relative path, which is what both the Vite dev
 * proxy and Caddy in production serve — so there is no environment-specific URL logic anywhere
 * in the app (rules/10-no-hardcoding.md).
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export const webConfig = Object.freeze({
  apiBaseUrl: API_BASE_URL.replace(/\/$/, ''),
  /** Refresh this far before the access token actually expires, to absorb clock skew. */
  tokenRefreshSkewSeconds: 60,
});
