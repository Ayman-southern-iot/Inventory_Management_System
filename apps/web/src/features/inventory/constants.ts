/** Named constants for this feature. An unnamed literal mid-function is never the exception. */

/** The product search hits a trigram index; 300ms is roughly one word of typing. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The ledger panel on a product card is a recent-history strip, not the full audit view. */
export const LEDGER_PAGE_LIMIT = 10;

/** Categories are a small, hand-maintained tree — one page holds the whole thing. */
export const CATEGORY_TREE_LIMIT = 200;
