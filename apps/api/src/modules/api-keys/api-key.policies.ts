import { ApiKeyScopeDeniedError } from '../../common/errors';

/*
 * Rules about what a key may do *within* a route its scope already opens. ADR-0002 keeps every
 * "is a key asking?" decision at the request boundary — scopes in `JwtAuthGuard`, per-route
 * rules in the controller through `@CurrentApiKey()` — so the services below stay unaware of
 * keys. These run after validation, where the guard cannot look: it sees the request before its
 * body has been parsed.
 */

/**
 * OQ-KT12 (Arif, 2026-09-29): `catalog:write` creates and edits, but never archives or
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
