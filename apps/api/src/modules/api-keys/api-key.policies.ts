import { ApiKeyScopeDeniedError } from '../../common/errors';

/*
 * Rules about what a key may do *within* a route its scope already opens. ADR-0002 keeps every
 * "is a key asking?" decision at the request boundary — scopes in `JwtAuthGuard`, per-route
 * rules in the controller through `@CurrentApiKey()` — so the services below stay unaware of
 * keys. These run after validation, where the guard cannot look: it sees the request before its
 * body has been parsed.
 */

/**
 * K2 (Ayman, confirmed 2026-10-01): no person's name reaches an API key, on any route. A product's
 * loan list names every borrower and project, so a key is answered with an empty one. How much is
 * out still shows in the placements' reserved and available figures.
 *
 * Every route that answers with a `ProductDetail` must go through here, not only the `GET`: the
 * first fix covered the `GET` alone and `PATCH /products/:id` kept telling a `catalog:write` key
 * who had the item. A person (`apiKey` null) gets the detail untouched.
 */
export function withoutLoansForKey<T extends { activeBorrows: unknown[] }>(
  apiKey: { id: string } | null,
  detail: T,
): T {
  return apiKey ? { ...detail, activeBorrows: [] } : detail;
}

/**
 * OQ-KT12 (Arif, 2026-09-29):`catalog:write` creates and edits, but never archives or
 * re-activates. Archiving takes an item out of circulation — nobody can borrow or take it — and
 * that is a person's decision, made in the web app. Every other field stays editable by key.
 */
export function refuseActivationChangeByKey(
  apiKey: { id: string } | null,
  isActive: boolean | undefined,
): void {
  if (apiKey && isActive !== undefined) {
    throw new ApiKeyScopeDeniedError(
      'An API key cannot archive or re-activate. A person does that in the web app',
    );
  }
}
