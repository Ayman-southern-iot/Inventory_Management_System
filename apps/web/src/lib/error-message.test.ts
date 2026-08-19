import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@ims/shared';
import { ApiError } from '@/api/client';
import { messageForError } from './error-message';
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
});
