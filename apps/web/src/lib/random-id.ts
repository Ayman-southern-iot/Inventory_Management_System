/**
 * A v4 UUID that works on every origin the app is actually served from.
 *
 * `crypto.randomUUID` exists only in a **secure context** — HTTPS, or `localhost`. Served over
 * plain HTTP from a LAN address (`http://192.168.0.48:5173`), which is how this tool gets
 * demoed and tested, it is `undefined`. Calling it there throws a `TypeError` inside the
 * mutation, the catch turns it into a generic failure, and the request is never sent: the
 * screen reports a server error for something the server never saw.
 *
 * `crypto.getRandomValues` has no such restriction, so the fallback is still
 * cryptographically random — not `Math.random`. These values become `Idempotency-Key`
 * headers, and a predictable key would let one request collide with another's stored response.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // RFC 4122 §4.4: pin the version to 4 and the variant to 10xx.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
