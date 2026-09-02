import { describe, expect, it } from 'vitest';
import { decideRequisitionSchema } from './requisitions';

/**
 * A rejection has to say why; an approval does not.
 *
 * One rejection ends the whole request — the other approvers are never asked — so the requester is
 * owed a reason. "Rejected" with an empty note leaves them nothing to act on and no idea whether
 * to revise and resubmit or drop it. An approval carries no such debt, and demanding a note for
 * one would only train people to type a full stop.
 *
 * The rule lives on the shared schema so the dialog and the API cannot disagree about it — the
 * form imports the same refinement rather than restating it.
 */
describe('deciding a requisition', () => {
  it('accepts an approval with no note', () => {
    const result = decideRequisitionSchema.safeParse({ approve: true });

    expect(result.success).toBe(true);
  });

  it('accepts an approval with a note', () => {
    const result = decideRequisitionSchema.safeParse({ approve: true, note: 'Looks fine.' });

    expect(result.success).toBe(true);
  });

  it('refuses a rejection with no note at all', () => {
    const result = decideRequisitionSchema.safeParse({ approve: false });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['note']);
  });

  it('refuses a rejection with an explicitly null note', () => {
    const result = decideRequisitionSchema.safeParse({ approve: false, note: null });

    expect(result.success).toBe(false);
  });

  /** Whitespace is not a reason. The schema trims, so this must not slip through as "  ". */
  it('refuses a rejection whose note is only whitespace', () => {
    const result = decideRequisitionSchema.safeParse({ approve: false, note: '   ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['note']);
  });

  it('accepts a rejection that gives a reason', () => {
    const result = decideRequisitionSchema.safeParse({
      approve: false,
      note: 'We already have three of these in the Uttara store.',
    });

    expect(result.success).toBe(true);
  });

  /** The error is attached to the field, so the dialog can show it under the textarea. */
  it('attaches the failure to the note field, not the form', () => {
    const result = decideRequisitionSchema.safeParse({ approve: false, note: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.every((issue) => issue.path[0] === 'note')).toBe(true);
  });
});
