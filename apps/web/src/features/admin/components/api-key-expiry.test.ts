import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPIRY_DAYS, expiryOptions, reconcileExpiry } from './api-key-expiry';

/**
 * The server refuses a write key that outlives `API_KEY_WRITE_MAX_LIFETIME_DAYS`, a value the
 * shared schema cannot see. The dialog's only defence is never offering a longer option, so the
 * option list is the rule and is pinned here for ceilings the page fixture does not exercise.
 */
describe('expiryOptions', () => {
  it('offers every preset to a read-only key, whatever the write ceiling', () => {
    expect(expiryOptions(false, 7)).toEqual([30, 90, 365]);
  });

  it('adds the ceiling itself when it is not a preset', () => {
    expect(expiryOptions(true, 180)).toEqual([30, 90, 180]);
  });

  it('does not repeat a ceiling that is already a preset', () => {
    expect(expiryOptions(true, 90)).toEqual([30, 90]);
  });

  it('offers only the ceiling when it is under every preset', () => {
    expect(expiryOptions(true, 14)).toEqual([14]);
  });
});

describe('reconcileExpiry', () => {
  it('keeps the current choice while it is still offered', () => {
    expect(reconcileExpiry(30, true, 180)).toBe(30);
  });

  it('keeps Never for a read-only key', () => {
    expect(reconcileExpiry(null, false, 180)).toBeNull();
  });

  it('replaces Never with the default once the key can write', () => {
    expect(reconcileExpiry(null, true, 180)).toBe(DEFAULT_EXPIRY_DAYS);
  });

  it('pulls a choice over the ceiling back to the default', () => {
    expect(reconcileExpiry(365, true, 180)).toBe(DEFAULT_EXPIRY_DAYS);
  });

  it('falls back to the ceiling when the ceiling is under the default', () => {
    expect(reconcileExpiry(null, true, 60)).toBe(60);
  });

  it('puts a ceiling-only value back to the default when the key goes read-only again', () => {
    expect(reconcileExpiry(180, false, 180)).toBe(DEFAULT_EXPIRY_DAYS);
  });
});
