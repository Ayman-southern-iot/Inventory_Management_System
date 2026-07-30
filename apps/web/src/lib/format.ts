/**
 * Formatting helpers.
 *
 * Locale and time zone are deliberately left undefined so the browser supplies them. Everyone
 * on this system sits in Asia/Dhaka, but pinning that here would be a hardcoded business value
 * (rules/10-no-hardcoding.md) — and the machine already knows the answer.
 */

/** Timestamps arrive as ISO strings; an unparseable one is shown verbatim rather than "Invalid Date". */
export function formatDateTime(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Quantities are integers; grouping keeps 12000 from reading as 1200. */
/**
 * Money, with exactly two decimals.
 *
 * Fixed decimals rather than `toLocaleString()`'s default: in a column of figures that have to be
 * read against each other, 1,200 next to 1,200.50 invites a misread, and these are the numbers
 * someone signs off on. No currency symbol — the whole system is BDT and repeating it in every
 * cell is noise (rules/10: BDT is a project glossary term, not a per-row label).
 */
export function formatBdt(amount: number): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString();
}

/** A signed figure, so an adjustment of −3 never reads as a receipt of 3. */
export function formatSignedQuantity(quantity: number): string {
  return quantity > 0 ? `+${formatQuantity(quantity)}` : formatQuantity(quantity);
}
