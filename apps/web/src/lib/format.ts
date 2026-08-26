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

/**
 * A calendar day, for the fields that are a day rather than an instant: an approval deadline,
 * an expected return date. These arrive as `YYYY-MM-DD` and were being printed verbatim, which
 * is why the app showed three date formats at once (D-011) — a raw `2026-08-13` here, a
 * `formatDateTime` "Aug 12, 2026" there, and a bare `toLocaleString()` "8/13/2026, 1:57:26 PM"
 * somewhere else.
 *
 * Parsed as local midnight, not through `new Date('2026-08-13')`, which JavaScript reads as
 * **UTC** midnight and then renders in local time — at +06 that prints the day before. That is
 * the same class of bug as D-014, and it is not being reintroduced at the view layer.
 */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';

  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  const parsed = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(isoDate);

  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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
 *
 * `undefined` / `NaN` print as an em dash: an unknown figure is not the same as zero, and the
 * underlying API returning a stale shape (a renamed field, say) would otherwise throw at render
 * time and crash the whole screen. Crashing on a transient mismatch costs more than it saves.
 */
export function formatBdt(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
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
