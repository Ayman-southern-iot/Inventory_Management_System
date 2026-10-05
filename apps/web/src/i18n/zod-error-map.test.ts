import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requisitionItemInputSchema } from '@ims/shared';
import { t } from './en';
// Side-effect import, exactly as main.tsx does it. Importing the installer rather than calling
// a function keeps the test on the same wiring the app ships.
import './zod-error-map';

/**
 * D-005. An empty Item field reported "String must contain at least 1 character(s)" while its
 * neighbours reported "Required", because an absent field and a cleared field fail with two
 * different zod issue codes.
 */
describe('the global zod error map', () => {
  it('reports a cleared string field as Required, not as a character count', () => {
    const result = requisitionItemInputSchema.safeParse({
      productId: null,
      itemName: '',
      quantity: 1,
      estimatedUnitPrice: 100,
      note: null,
    });

    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((candidate) => candidate.path[0] === 'itemName');
    expect(issue?.message).toBe(t.common.required);
    expect(issue?.message).not.toMatch(/character/i);
  });

  it('leaves an absent field on zod’s own Required message', () => {
    const result = requisitionItemInputSchema.safeParse({
      productId: null,
      quantity: 1,
      estimatedUnitPrice: 100,
      note: null,
    });

    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((candidate) => candidate.path[0] === 'itemName');
    expect(issue?.message).toBe('Required');
  });

  /**
   * The map is the global fallback, so a schema that states its own message must still win.
   * Without this, a future "be helpful everywhere" edit could flatten a deliberate message.
   */
  it('does not override a message the schema sets for itself', () => {
    const explicit = z.string().min(1, 'Pick at least one item');
    expect(explicit.safeParse('').error?.issues[0]?.message).toBe('Pick at least one item');
  });

  /**
   * Numeric bounds share the `too_small` code and must not be read as an empty field. This used to
   * assert zod's own wording ("Number must be greater than or equal to 1"); that wording is what
   * the message audit (M2) found reaching users, so the assertion now says the same thing in plain
   * words. The point of the test is unchanged: a number below its minimum is not "Required".
   */
  it('gives a numeric lower bound its own plain wording, not "Required"', () => {
    const message = z.number().min(1).safeParse(0).error?.issues[0]?.message;
    expect(message).not.toBe(t.common.required);
    expect(message).toBe('Enter 1 or more.');
  });

  /** Message audit M2: the rest of zod's default English, in words a person would use. */
  it('replaces the character count wording for a minimum above one', () => {
    expect(z.string().min(2).safeParse('a').error?.issues[0]?.message).toBe('Use at least 2 characters.');
  });

  it('replaces "Invalid email" and "Invalid uuid"', () => {
    expect(z.string().email().safeParse('abc').error?.issues[0]?.message).toBe('Enter a valid email address.');
    expect(z.string().uuid().safeParse('').error?.issues[0]?.message).toBe('Choose an option.');
  });

  /** An empty email is a missing email, not a malformed one (the login page said "Invalid email"). */
  it('reports an empty string failing a format check as Required', () => {
    expect(z.string().email().safeParse('').error?.issues[0]?.message).toBe(t.common.required);
  });
});
