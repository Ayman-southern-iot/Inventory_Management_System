/**
 * Serialises a typed query object into a query string, dropping anything the API should treat
 * as "not filtered". Extracted so list hooks in every feature encode filters identically —
 * two encoders would eventually disagree and produce two cache keys for one request.
 */
export function toSearchParams(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== null) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}
