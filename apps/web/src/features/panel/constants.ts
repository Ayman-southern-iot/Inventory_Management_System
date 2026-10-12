/**
 * Timings and limits for the lab panel (`/panel`). The figures marked "brief" are from Arif's
 * panel brief of 2026-10-05, quoted in the pull request that added the panel; the others are this
 * feature's own.
 */

/** A universal constant (rules/10-no-hardcoding.md, "Exceptions"). */
export const MS_PER_SECOND = 1_000;

/** Brief: after a minute with no touch, go back to the cabinet overview. */
export const PANEL_IDLE_RESET_MS = 60 * MS_PER_SECOND;

/** Brief: 250 ms. (The inventory list's server search waits 300 ms; this one searches locally.) */
export const PANEL_SEARCH_DEBOUNCE_MS = 250;

/**
 * How long a search must rest before the drawer lights are told about it (Phase 13, decided
 * 2026-10-12). Longer than the inventory page's, because the on-screen keyboard is slow and a
 * pause between two taps is not a finished search.
 */
export const PANEL_LOCATE_SETTLE_MS = 1 * MS_PER_SECOND;

/** Brief: while the API is unreachable, try again every 10 s. */
export const PANEL_OFFLINE_RETRY_MS = 10 * MS_PER_SECOND;

/**
 * How stale the shelf counts may get while the API is healthy. One catalogue read a minute is
 * well inside the session throttle (`THROTTLE_AUTHENTICATED_LIMIT`, 300 a minute by default).
 */
export const PANEL_REFRESH_MS = 60 * MS_PER_SECOND;

/** Rows a search draws before asking for a narrower query. Keeps a one-letter search cheap. */
export const PANEL_MAX_RESULTS = 40;
