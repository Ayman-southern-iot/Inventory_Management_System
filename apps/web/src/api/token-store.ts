import { type AuthTokens } from '@ims/shared';

/**
 * Tokens live in localStorage rather than an httpOnly cookie. That is a deliberate trade for
 * this system: it is an internal tool on a single origin with no third-party embeds, and the
 * SPA needs the refresh token to rotate proactively. The mitigations that matter are the short
 * access-token life and server-side reuse detection, both of which are in place.
 *
 * If this ever becomes internet-facing, revisit — see docs/state/DECISIONS.md.
 */
const STORAGE_KEY = 'ims.auth.tokens';

/** Lets a sign-out in one tab sign the others out too. */
export const TOKEN_STORAGE_KEY = STORAGE_KEY;

export function readStoredTokens(): AuthTokens | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthTokens>;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresIn: parsed.expiresIn ?? 0,
    };
  } catch {
    // Private-browsing modes can throw on localStorage access; an unreadable store is the
    // same as no session rather than a crash on boot.
    return null;
  }
}

export function writeStoredTokens(tokens: AuthTokens): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      }),
    );
  } catch {
    // Nothing useful to do — the session simply will not survive a reload.
  }
}

export function clearStoredTokens(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignored for the same reason as above.
  }
}
