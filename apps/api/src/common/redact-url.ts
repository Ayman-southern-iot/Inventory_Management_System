import { API_KEY_QUERY_PARAM } from '@ims/shared';

/** What replaces the value. Distinctive enough to grep for when auditing a log. */
const REDACTED = 'REDACTED';

/**
 * Matches `api_key=<anything up to the next separator>`, case-insensitively.
 *
 * Built from the shared constant rather than spelled out, so renaming the parameter cannot
 * leave the redaction behind pointing at a name nothing uses any more — which would fail
 * open, silently, and only be noticed by whoever found the key in a log.
 */
const KEY_IN_URL = new RegExp(`([?&]${API_KEY_QUERY_PARAM}=)[^&#\\s]*`, 'gi');

/**
 * Strip an API key out of a URL before anything writes it down.
 *
 * Presenting a key as `?api_key=...` is supported (see `API_KEY_QUERY_PARAM`) and it is the
 * less safe way in precisely because URLs get logged. We cannot stop Caddy or a corporate
 * proxy recording their own access logs, but we can stop *this* application copying a live
 * credential into its container output every time a request 4xxs.
 */
export function redactUrl(url: string | null | undefined): string {
  if (!url) return '';
  return url.replace(KEY_IN_URL, `$1${REDACTED}`);
}
