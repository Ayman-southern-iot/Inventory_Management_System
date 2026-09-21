import { describe, expect, it } from 'vitest';
import { redactUrl } from './redact-url';

/**
 * A key presented as `?api_key=...` is the less safe way in, and the reason is that URLs get
 * written down. We cannot stop a proxy logging its own, but this application must never copy a
 * live credential into its container output — which the exception filter would otherwise do on
 * every 4xx, and keep.
 */
describe('redactUrl', () => {
  it('hides a key in the query string', () => {
    expect(redactUrl('/api/v1/products?api_key=ims_supersecretvalue')).toBe(
      '/api/v1/products?api_key=REDACTED',
    );
  });

  it('hides it when other parameters come first and after', () => {
    expect(redactUrl('/api/v1/products?limit=10&api_key=ims_secret&page=2')).toBe(
      '/api/v1/products?limit=10&api_key=REDACTED&page=2',
    );
  });

  it('stops at a fragment rather than swallowing the rest', () => {
    expect(redactUrl('/api/v1/products?api_key=ims_secret#section')).toBe(
      '/api/v1/products?api_key=REDACTED#section',
    );
  });

  /** Express lowercases nothing in a query string; a caller may type it however they like. */
  it('is case-insensitive about the parameter name', () => {
    expect(redactUrl('/api/v1/products?API_KEY=ims_secret')).toBe(
      '/api/v1/products?API_KEY=REDACTED',
    );
  });

  it('leaves a URL without a key exactly as it was', () => {
    expect(redactUrl('/api/v1/products?limit=10')).toBe('/api/v1/products?limit=10');
  });

  it('never returns the secret, whatever it is given', () => {
    const secret = 'ims_thisMustNotSurvive';
    for (const url of [
      `/x?api_key=${secret}`,
      `/x?a=1&api_key=${secret}`,
      `/x?api_key=${secret}&b=2`,
      `/x?api_key=${secret}#f`,
    ]) {
      expect(redactUrl(url)).not.toContain(secret);
    }
  });

  it('tolerates null and undefined', () => {
    expect(redactUrl(null)).toBe('');
    expect(redactUrl(undefined)).toBe('');
  });
});
