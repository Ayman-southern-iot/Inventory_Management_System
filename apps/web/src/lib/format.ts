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
export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString();
}

/** A signed figure, so an adjustment of −3 never reads as a receipt of 3. */
export function formatSignedQuantity(quantity: number): string {
  return quantity > 0 ? `+${formatQuantity(quantity)}` : formatQuantity(quantity);
}
