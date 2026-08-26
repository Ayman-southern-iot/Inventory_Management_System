/**
 * Matching typed text against the product catalogue, for the item field on a requisition.
 *
 * Pure and separate from the component so the *rules* can be tested without a DOM — the ordering
 * and the strictness are the behaviour here, not the list that renders them.
 *
 * The problem all three functions serve: one requester types "Arduino Uno R3" and another types
 * "arduino uno", and the system ends up holding two products that no report can reconcile. Free
 * text stays possible on purpose (requirements §3 — something we do not stock yet must still be
 * requestable), so the defence is making the catalogue entry easy to land on, not forbidding
 * anything else.
 */

const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Ranked catalogue matches for a typed term.
 *
 * The order is the point: an exact name first, then a prefix, then anything containing the term.
 * Ranking by nothing (the previous `filter` + `slice(0, 6)`) meant "Arduino Uno R3" could fall
 * outside the first six results for "arduino", which reads as "we do not stock it" and is how the
 * second spelling gets typed.
 */
export function rankMatches<T extends { name: string; productCode: string }>(
  products: readonly T[],
  term: string,
): T[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [...products];

  const scored: Array<{ product: T; score: number }> = [];

  for (const product of products) {
    const name = product.name.toLowerCase();
    const code = product.productCode.toLowerCase();

    // Lower is better.
    let score: number;
    if (name === needle) score = 0;
    else if (code === needle) score = 1;
    else if (name.startsWith(needle)) score = 2;
    else if (code.startsWith(needle)) score = 3;
    else if (name.includes(needle)) score = 4;
    else if (code.includes(needle)) score = 5;
    else continue;

    scored.push({ product, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
    .map((entry) => entry.product);
}

/**
 * The catalogue entry a piece of free text is unmistakably the same as.
 *
 * Only an exact match once case, surrounding space and internal runs of whitespace are normalised
 * — "arduino  uno r3" is the same product as "Arduino Uno R3", and treating it as a new item is
 * the duplicate this exists to prevent. This one is applied *automatically* on blur, so anything
 * looser here would silently attach a requisition to the wrong product, which is worse than the
 * duplicate it would have prevented.
 */
export function exactCatalogueMatch<T extends { name: string }>(
  products: readonly T[],
  text: string,
): T | undefined {
  const needle = normalise(text);
  if (!needle) return undefined;
  return products.find((product) => normalise(product.name) === needle);
}

/**
 * The one catalogue entry free text is *probably* meant to be, when it is not exactly one.
 *
 * This is the Arduino case as stated: someone types "arduino uno" for the board we list as
 * "Arduino Uno R3". `exactCatalogueMatch` cannot see it, and should not — it links without asking.
 * This one only *offers*, so it can be looser, and the field renders it as "Did you mean ...?".
 *
 * Two deliberate limits:
 *
 * - **One candidate or none.** With "Arduino Uno R3" and "Arduino Uno R4" both in the catalogue,
 *   "arduino uno" means nothing in particular, and a coin-flip suggestion is worse than the list
 *   the requester already has open.
 * - **Prefix only, in either direction.** "arduino uno" → "Arduino Uno R3" (they typed less than
 *   the full name), "arduino uno r3 board" → "Arduino Uno R3" (they typed more). A shared
 *   substring is not evidence: every product containing "cable" is not the same cable.
 */
export function nearestCatalogueMatch<T extends { name: string }>(
  products: readonly T[],
  text: string,
): T | undefined {
  const needle = normalise(text);
  if (!needle) return undefined;

  const candidates: T[] = [];
  for (const product of products) {
    const name = normalise(product.name);
    // An exact match is not a near match — it is handled, and linked, elsewhere.
    if (name === needle) return undefined;
    if (name.startsWith(needle) || needle.startsWith(name)) candidates.push(product);
  }

  return candidates.length === 1 ? candidates[0] : undefined;
}
