import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requiredFields } from './required-fields';

describe('requiredFields', () => {
  it('marks a plain field required and an optional one not', () => {
    const schema = z.object({ vendor: z.string(), note: z.string().optional() });

    expect(requiredFields(schema)).toEqual(new Set(['vendor']));
  });

  /**
   * The distinction D-006 drew by hand: a nullable field has a real answer of "none". The
   * requisition's project is the standing example — no project means personal development,
   * which is an answer rather than an omission.
   */
  it('does not mark a nullable field, which can honestly be empty', () => {
    const schema = z.object({ amount: z.number(), projectId: z.string().nullable() });

    expect(requiredFields(schema)).toEqual(new Set(['amount']));
  });

  it('treats a defaulted field as not required — the form need not supply it', () => {
    const schema = z.object({ a: z.string(), b: z.string().default('x') });

    expect(requiredFields(schema)).toEqual(new Set(['a']));
  });

  /** Several of this app's dialogs cross-validate two fields, which wraps the object. */
  it('sees through a refinement that hides the shape', () => {
    const schema = z
      .object({ cost: z.number(), description: z.string().nullable() })
      .refine((v) => v.cost === 0 || v.description !== null, 'Describe the cost');

    expect(requiredFields(schema)).toEqual(new Set(['cost']));
  });

  it('returns nothing rather than throwing for a schema with no shape', () => {
    expect(requiredFields(z.string())).toEqual(new Set());
  });
});
