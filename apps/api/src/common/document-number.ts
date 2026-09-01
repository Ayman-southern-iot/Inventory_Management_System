/**
 * The person's part of a document number — `REQ-000015-GINA`, `BOM-000004-GINA`.
 *
 * Ayman's ruling, 2026-08-29: a requisition and its BOM should say whose they are on the number
 * itself, so a stack of printouts can be sorted by hand without opening any of them.
 *
 * Taken from the **first word of the full name**, because there is no username column on `users`
 * and the email local part gives `GENERAL` for Gina General — worse than useless on a document
 * meant to identify a person.
 *
 * Frozen at creation, like the serial beside it. A later rename does not rewrite documents that
 * have already been printed, filed and referenced in an audit trail.
 */

/** Longest name fragment kept. Past this the number stops being scannable at a glance. */
const MAX_NAME_LENGTH = 12;

/**
 * `Gina General` → `GINA`. Returns null when nothing usable survives, and the caller then omits
 * the suffix entirely rather than emitting a trailing dash or a placeholder.
 *
 * Non-Latin names are the reason for the null: this office writes Bengali, and `আয়মান` has no
 * A–Z to keep. Transliterating would be a guess with a person's name on it, so the fallback is
 * the email local part, and failing that the plain serial — which is still unique, still valid,
 * and honest about knowing no short form for them.
 */
export function nameTokenFor(fullName: string | null, email: string | null): string | null {
  const fromName = tokenise(firstWord(fullName));
  if (fromName) return fromName;

  const fromEmail = tokenise(firstWord((email ?? '').split('@')[0] ?? null));
  return fromEmail;
}

function firstWord(value: string | null): string | null {
  if (!value) return null;
  // Split on whitespace *and* the separators a local part uses, so `gina.general` gives `gina`
  // rather than the whole string.
  const [first] = value.trim().split(/[\s._-]+/);
  return first ?? null;
}

function tokenise(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_NAME_LENGTH);
}

/**
 * `REQ` + a zero-padded serial + the person, when there is one to name.
 *
 * The serial alone carries uniqueness — the sequence guarantees it — so the name is decoration
 * that must never be load-bearing. Two people called Gina produce `REQ-000015-GINA` and
 * `REQ-000016-GINA`, which is fine: the serial still tells them apart.
 */
export function documentNumber(prefix: string, serial: number, nameToken: string | null): string {
  const padded = String(serial).padStart(6, '0');
  return nameToken ? `${prefix}-${padded}-${nameToken}` : `${prefix}-${padded}`;
}
