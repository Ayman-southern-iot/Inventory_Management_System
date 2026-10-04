import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@ims/shared';
import { ApiError } from '@/api/client';
import { fieldErrorsFor, messageForError } from './error-message';
import { t } from '@/i18n/en';

describe('messageForError', () => {
  it('maps a known error code to project copy, not the server message', () => {
    const error = new ApiError(ErrorCode.FORBIDDEN, 'raw server text', 403);
    expect(messageForError(error)).toBe(t.errors.FORBIDDEN);
  });

  it('has copy for every error code the API can emit', () => {
    // A code with no entry here would surface raw server text to the user.
    for (const code of Object.values(ErrorCode)) {
      expect(t.errors, `missing copy for ${code}`).toHaveProperty(code);
    }
  });

  it('falls back to the server message for an unrecognised code', () => {
    expect(messageForError(new ApiError('SOMETHING_NEW', 'server said this', 400))).toBe(
      'server said this',
    );
  });

  it('never leaks a non-ApiError to the user', () => {
    expect(messageForError(new Error('TypeError: undefined is not a function'))).toBe(
      t.errors.INTERNAL,
    );
  });
  /**
   * The server sends field-level issues as `FieldIssue[]` (`{ path, message }`) in `details`.
   * Before this, every VALIDATION_FAILED surfaced 'Please correct the highlighted fields' in a
   * toast — and nothing highlighted, because dialogs like FundsActionDialog are local state, not
   * react-hook-form. The actual reason was already on the wire and thrown away.
   */
  it('surfaces the server field messages for VALIDATION_FAILED', () => {
    const error = new ApiError(ErrorCode.VALIDATION_FAILED, 'Request validation failed', 400, [
      { path: 'amountReturned', message: 'Amount returned must not exceed the unspent amount' },
    ]);
    expect(messageForError(error)).toBe('Amount returned must not exceed the unspent amount');
  });

  it('joins several field messages', () => {
    const error = new ApiError(ErrorCode.VALIDATION_FAILED, 'Request validation failed', 400, [
      { path: 'a', message: 'First problem' },
      { path: 'b', message: 'Second problem' },
    ]);
    expect(messageForError(error)).toBe('First problem; Second problem');
  });

  it('falls back to generic copy when VALIDATION_FAILED carries no field details', () => {
    expect(messageForError(new ApiError(ErrorCode.VALIDATION_FAILED, 'x', 400))).toBe(
      t.errors.VALIDATION_FAILED,
    );
  });

  it('still substitutes placeholders from object details', () => {
    const error = new ApiError('INSUFFICIENT_STOCK_QUARANTINED', 'x', 409, {
      available: 1,
      quarantined: 2,
    });
    expect(messageForError(error)).toBe(
      'Only 1 are available at this location — 2 are in quarantine.',
    );
  });

  /**
   * Message audit M2. The server sends zod's default English in `FieldIssue.message`, and the
   * toast used to show it as it came: "Invalid uuid", "String must contain at least 1 character(s)".
   */
  it('turns the server’s raw validation wording into plain sentences', () => {
    const error = new ApiError(ErrorCode.VALIDATION_FAILED, 'Request validation failed', 400, [
      { path: 'lines.0.newProduct.productCode', message: 'String must contain at least 1 character(s)' },
      { path: 'lines.0.compartmentId', message: 'Invalid uuid' },
    ]);
    // Sentences that already end in a full stop are joined with a space, not ".;".
    expect(messageForError(error)).toBe('Storage ID is required. Compartment: Choose an option.');
  });

  it('humanises the per-field messages a form marks inline, without repeating the field name', () => {
    const error = new ApiError(ErrorCode.VALIDATION_FAILED, 'Request validation failed', 400, [
      { path: 'name', message: 'String must contain at least 2 character(s)' },
      { path: 'quantity', message: 'Number must be greater than 0' },
    ]);
    expect(fieldErrorsFor(error)).toEqual({
      name: 'Use at least 2 characters.',
      quantity: 'Enter a number greater than 0.',
    });
  });

  /**
   * Message audit M3. A caller that knows what it was doing can say it better than a code can:
   * a 409 from "new department" is a duplicate name, and a 403 from "change password" is a wrong
   * current password. The override applies to one call, so no other screen's wording changes.
   */
  describe('per-call overrides', () => {
    it('replaces the generic sentence for that code', () => {
      const conflict = new ApiError(ErrorCode.CONFLICT, 'A department with that name exists', 409);
      expect(messageForError(conflict)).toBe(t.errors.CONFLICT);
      expect(messageForError(conflict, { CONFLICT: 'A department with that name already exists.' })).toBe(
        'A department with that name already exists.',
      );
    });

    it('does not touch a different code', () => {
      const forbidden = new ApiError(ErrorCode.FORBIDDEN, 'x', 403);
      expect(messageForError(forbidden, { CONFLICT: 'unused' })).toBe(t.errors.FORBIDDEN);
    });

    it('lets real field issues win over an override for VALIDATION_FAILED', () => {
      const error = new ApiError(ErrorCode.VALIDATION_FAILED, 'x', 400, [
        { path: 'reason', message: 'String must contain at least 3 character(s)' },
      ]);
      // "Reason" is a known field, so the toast names it.
      expect(messageForError(error, { VALIDATION_FAILED: 'That file was not accepted.' })).toBe(
        'Reason: Use at least 3 characters.',
      );
    });

    it('uses the override for VALIDATION_FAILED when there are no field issues (an upload refusal)', () => {
      const error = new ApiError(ErrorCode.VALIDATION_FAILED, 'That file type is not accepted.', 400);
      expect(messageForError(error, { VALIDATION_FAILED: 'That file was not accepted.' })).toBe(
        'That file was not accepted.',
      );
    });
  });

  /**
   * Message audit M8. A template with {placeholders} used to be returned with the braces showing
   * whenever the server sent no details, or sent them under another name.
   */
  describe('placeholders', () => {
    const withPlaceholders = Object.entries(t.errors).filter(([, text]) => /\{\w+\}/.test(text));

    it('has a plain sentence for every error that quotes a figure', () => {
      expect(withPlaceholders.length).toBeGreaterThan(0);
      for (const [code] of withPlaceholders) {
        expect(t.errorsPlain, `missing plain copy for ${code}`).toHaveProperty(code);
        expect((t.errorsPlain as Record<string, string>)[code]).not.toMatch(/\{\w+\}/);
      }
    });

    it('never shows braces when the server sent no details', () => {
      for (const [code] of withPlaceholders) {
        const message = messageForError(new ApiError(code, 'x', 400));
        expect(message, code).not.toMatch(/[{}]/);
      }
    });

    it('never shows braces when the details do not carry the figure', () => {
      const message = messageForError(new ApiError('BOM_QUANTITY_EXCEEDS_SOURCE', 'x', 400, { other: 1 }));
      expect(message).not.toMatch(/[{}]/);
    });

    it('still fills the figures when they are there', () => {
      const message = messageForError(new ApiError('BOM_QUANTITY_EXCEEDS_SOURCE', 'x', 400, { max: 4 }));
      expect(message).toContain('4');
    });
  });
});
