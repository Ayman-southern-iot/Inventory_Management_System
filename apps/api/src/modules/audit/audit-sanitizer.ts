/**
 * Phase 06 — sanitisation helpers for the audit log.
 *
 * The contract is clear: the audit table must never store passwords, password hashes, JWTs,
 * refresh tokens, cookies, authorisation headers, API keys, private keys, signing secrets, or
 * PDF signing tokens. Free-form text is capped so a verbose free-text "reason" field cannot
 * blow up the row. JSON depth is capped so a maliciously nested payload does not break the
 * admin page. These helpers keep the "every mutation is audited" promise honest.
 *
 * Pure functions. No DB, no I/O, so they're easy to unit-test.
 */

const MAX_STRING_BYTES = 1024;
const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 200;

/**
 * Every key whose name matches one of these (case-insensitive) will be redacted before it
 * hits the database. Listing them in one place is the rule: a missed key here becomes a leak.
 */
const SECRET_KEY_PATTERNS = [
  /^password$/i,
  /^passwordhash$/i,
  /^password_hash$/i,
  /^currentpassword$/i,
  /^current_password$/i,
  /^newpassword$/i,
  /^new_password$/i,
  /^oldpassword$/i,
  /^old_password$/i,
  // The hash is at least as sensitive as the cleartext — a future hash rotation must not
  // silently leak old hashes into the audit log.
  /^hash$/i,
  // Tokens of all flavours.
  /^token$/i,
  /^accessToken$/i,
  /^access_token$/i,
  /^refreshToken$/i,
  /^refresh_token$/i,
  /^idToken$/i,
  /^id_token$/i,
  /^jwt$/i,
  /^bearer$/i,
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  // Stored secrets the BOM signing uses.
  /^secret$/i,
  /^apiKey$/i,
  /^api_key$/i,
  /^signature$/i,
  /^signedUrl$/i,
  /^signed_url$/i,
  /^signingToken$/i,
  /^signing_token$/i,
  /^pdfToken$/i,
  /^pdf_token$/i,
  /^privateKey$/i,
  /^private_key$/i,
  /^publicKey$/i,
  /^public_key$/i,
];

const REDACTED = '[REDACTED]';
const ELLIPSIS = '…';

/**
 * Three-segment match: `aaa.bbb.ccc`, where each segment is a JSON-y path token (letters,
 * digits, underscore, hyphen). Anything else is left alone. The dotted-path approach is what
 * keeps a token like `refreshToken` inside an arbitrary metadata blob safe.
 */
/**
 * Substrings that make a key secret whatever it is embedded in. The anchored list above is an
 * exact-name allowlist, which means it protects the names someone thought of: `tokenHash`,
 * `refreshTokenHash`, `sessionToken`, `resetToken`, `tempPassword`, `passphrase` and `pwd` all
 * sailed through it. Nothing passes one today — but this file's contract is that the audit
 * table *cannot* hold a secret, and an allowlist can only promise that for names already
 * written down. Over-redacting an innocent key named `keyboard` costs nothing.
 */
const SECRET_KEY_SUBSTRINGS = [
  'password',
  'passphrase',
  'pwd',
  'secret',
  'token',
  'credential',
  'apikey',
  'privatekey',
  'signature',
  'authorization',
  'cookie',
  'hash',
];

function isSecretKey(key: string): boolean {
  const normalised = key.trim();
  if (!normalised) return false;
  for (const pattern of SECRET_KEY_PATTERNS) {
    if (pattern.test(normalised)) return true;
  }
  const flattened = normalised.toLowerCase().replace(/[_-]/g, '');
  return SECRET_KEY_SUBSTRINGS.some((needle) => flattened.includes(needle));
}

/**
 * A JWT is three base64url segments separated by dots. A string that matches this shape is
 * presumed to be a JWT and is redacted; we err on the side of caution rather than risk
 * carrying one through, because a leaked JWT is a session token, not a curiosity.
 */
const JWT_LIKE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BEARER_LIKE = /^Bearer\s+\S+$/i;

/**
 * The same two shapes, unanchored, so they are caught inside prose.
 *
 * Free-text notes go into metadata verbatim (`borrowing.service.ts`, `requisitions.service.ts`),
 * and "retried with Authorization: Bearer eyJhbG.eyJzdWI.SflKxw" is a note a real person
 * writes. The anchored versions above only match when the token is the *entire* string.
 *
 * The dotted pattern requires two segments, not three, because the PDF download token is
 * `b64url(payload).b64url(mac)` — two segments — and so never matched the JWT shape at all.
 */
// 16+ chars per segment: a base64url HMAC-SHA256 is 43 and a JWT payload longer still, while
// dotted prose an admin actually writes ("order_note.final", "SPEC-2.rev3") stays readable.
const EMBEDDED_TOKEN = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]+)?\b/;
const EMBEDDED_BEARER = /\bBearer\s+[A-Za-z0-9._-]+/i;

/**
 * A "looks-secret" string. Conservative on purpose: false positives are merely redacted
 * noise, false negatives are a session hijack.
 */
function looksLikeSecretString(value: string): boolean {
  if (JWT_LIKE.test(value)) return true;
  if (BEARER_LIKE.test(value)) return true;
  if (EMBEDDED_BEARER.test(value)) return true;
  if (EMBEDDED_TOKEN.test(value)) return true;
  return false;
}

/**
 * Cap string length so an unbounded "reason" field cannot bloat a single audit row past the
 * detail drawer. The exact count is a deliberate "human-readable on screen" choice.
 */
function truncateString(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_STRING_BYTES) return value;
  const sliced = value.slice(0, MAX_STRING_BYTES);
  return `${sliced}${ELLIPSIS}`;
}

/**
 * Walks an arbitrary value and returns a sanitised clone. Cycles are guarded by the depth
 * limit — without it a self-referencing payload would loop forever.
 */
function sanitiseInternal(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[depth-truncated]';

  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    if (looksLikeSecretString(value)) return REDACTED;
    return truncateString(value);
  }
  if (typeof value !== 'object') return String(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      return [
        ...value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitiseInternal(item, depth + 1)),
        `[+${value.length - MAX_ARRAY_LENGTH} more]`,
      ];
    }
    return value.map((item) => sanitiseInternal(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = sanitiseInternal(v, depth + 1);
    }
  }
  return out;
}

/** Public entry point. Pure: same input → same output, no shared state. */
export function sanitiseMetadata(value: unknown): unknown {
  return sanitiseInternal(value, 0);
}

/* ----------------------------------------------------------------- differences */

/**
 * Compute the safe before/after diff for an update. The shape matches the example in the
 * plan and is rendered as is by the detail drawer. `null === undefined` is intentionally
 * treated as "no change" — callers pass `undefined` when a field is absent from the patch.
 */
export interface AuditChange {
  before: unknown;
  after: unknown;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!isEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!isEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Diff two user-shaped records and return only fields whose value genuinely changed. Keys the
 * caller passes in `keys` restrict the comparison to the columns the domain owns — there is
 * no point diffing a password hash that the diff contract must not surface anyway.
 */
export function diffSafeFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  keys: ReadonlyArray<keyof T & string>,
): Record<string, AuditChange> {
  const changes: Record<string, AuditChange> = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const beforeValue = before[key];
    const afterValue = after[key];
    if (isEqual(beforeValue, afterValue)) continue;
    if (isSecretKey(key)) {
      // Never include the value even when the caller asked for it; surface "we changed it"
      // without saying what.
      changes[key] = { before: REDACTED, after: REDACTED };
      continue;
    }
    changes[key] = { before: beforeValue ?? null, after: afterValue ?? null };
  }
  return changes;
}

/* ----------------------------------------------------------------- paths/strings */

/**
 * A request path arrives as the full URL the user hit. Strip the query string and fragment
 * (any signed-URL token in the path would normally be in `?token=…`) so the admin can
 * reproduce the route without re-leaking what they came in with.
 */
export function sanitiseRequestPath(rawPath: string | null | undefined): string | null {
  if (rawPath == null) return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  // Use the URL constructor when possible — it understands proxies — and fall back to string
  // slicing if the input is just a bare path.
  try {
    const u = new URL(trimmed, 'http://placeholder.invalid');
    return `${u.pathname}`;
  } catch {
    const qIndex = trimmed.indexOf('?');
    const hIndex = trimmed.indexOf('#');
    const cut = [qIndex, hIndex].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    return cut === undefined ? trimmed : trimmed.slice(0, cut);
  }
}

/**
 * A user agent is rarely more useful in audit than a truncated "browser X on OS Y". Cap it so
 * a malicious client cannot inflate a row through an enormous UA header.
 */
export function sanitiseUserAgent(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return truncateString(raw);
}
