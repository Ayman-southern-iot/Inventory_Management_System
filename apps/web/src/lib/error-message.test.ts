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
});
