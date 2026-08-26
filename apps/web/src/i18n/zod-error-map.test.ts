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

  /** Numeric bounds share the `too_small` code and must keep their own wording. */
  it('leaves a numeric lower bound alone', () => {
    const message = z.number().min(1).safeParse(0).error?.issues[0]?.message;
    expect(message).not.toBe(t.common.required);
    expect(message).toMatch(/greater than or equal to 1/i);
  });
});
