import { describe, expect, it } from 'vitest';
import { documentNumber, nameTokenFor } from './document-number';

describe('nameTokenFor', () => {
  it('takes the first word of the full name', () => {
    expect(nameTokenFor('Gina General', 'general@ims.local')).toBe('GINA');
  });

  /**
   * The reason the name is not taken from the email: this office's addresses are role-shaped, so
   * the local part names the job rather than the person.
   */
  it('prefers the name over the email, which names the role', () => {
    expect(nameTokenFor('Imran Manager', 'im@ims.local')).toBe('IMRAN');
  });

  it('strips punctuation and accents down to what a document number can carry', () => {
    expect(nameTokenFor("O'Brien Smith", 'x@y.z')).toBe('OBRIEN');
  });

  it('truncates a very long first name so the number stays scannable', () => {
    expect(nameTokenFor('Bartholomewsonlongname X', 'x@y.z')).toBe('BARTHOLOMEWS');
  });

  /**
   * The case that decides whether this feature is safe to ship here: staff write their names in
   * Bengali. Transliterating would be a guess with somebody's name on it, so it falls back to the
   * email local part — and if that yields nothing either, to no suffix at all.
   */
  it('falls back to the email when the name has no Latin characters', () => {
    expect(nameTokenFor('আয়মান হোসেন', 'ayman@southerniot.net')).toBe('AYMAN');
  });

  it('takes only the first segment of a dotted local part', () => {
    expect(nameTokenFor(null, 'gina.general@ims.local')).toBe('GINA');
  });

  it('returns null when neither the name nor the email yields anything usable', () => {
    expect(nameTokenFor('আয়মান', 'আয়মান@example.com')).toBeNull();
    expect(nameTokenFor(null, null)).toBeNull();
  });
});

describe('documentNumber', () => {
  it('pads the serial and appends the person', () => {
    expect(documentNumber('REQ', 15, 'GINA')).toBe('REQ-000015-GINA');
    expect(documentNumber('BOM', 4, 'GINA')).toBe('BOM-000004-GINA');
  });

  /** No trailing dash, no placeholder — the serial alone is a complete, valid number. */
  it('omits the suffix entirely when there is no name to use', () => {
    expect(documentNumber('REQ', 15, null)).toBe('REQ-000015');
  });

  /**
   * Uniqueness is the sequence's job, never the name's. Two people sharing a first name must not
   * collide, and they do not — the serial still separates them.
   */
  it('keeps two people of the same name apart by their serials', () => {
    expect(documentNumber('REQ', 15, 'GINA')).not.toBe(documentNumber('REQ', 16, 'GINA'));
  });

  it('does not pad past six digits', () => {
    expect(documentNumber('REQ', 1_234_567, 'GINA')).toBe('REQ-1234567-GINA');
  });
});
