import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@ims/shared';
import { ApiError, NETWORK_ERROR_CODE } from '@/api/client';
import { isUnreachable } from './api';

/**
 * What the panel treats as "the API cannot be reached": the offline banner and the 10 s retry.
 * The import lock's own 503 is the one exception — the lock overlay already says what is going
 * on, so the panel words it with the app's copy instead of calling it offline.
 */
describe('isUnreachable', () => {
  it.each([
    ['a network failure', new ApiError(NETWORK_ERROR_CODE, 'Cannot reach the server', 0), true],
    ['a 502 from the proxy', new ApiError(ErrorCode.INTERNAL, 'Request failed', 502), true],
    ['a 503 from the proxy', new ApiError(ErrorCode.INTERNAL, 'Request failed', 503), true],
    ['a 504 from the proxy', new ApiError(ErrorCode.INTERNAL, 'Request failed', 504), true],
    [
      'the import lock (the API’s own 503)',
      new ApiError(ErrorCode.SYSTEM_IMPORT_IN_PROGRESS, 'Import in progress', 503),
      false,
    ],
    ['a 500 the API answered', new ApiError(ErrorCode.INTERNAL, 'boom', 500), false],
    [
      'a 429 the API answered',
      new ApiError(ErrorCode.RATE_LIMITED, 'Too Many Requests', 429),
      false,
    ],
    ['a 401 the API answered', new ApiError(ErrorCode.TOKEN_EXPIRED, 'Session expired', 401), false],
    ['something that is not an ApiError', new TypeError('boom'), false],
    ['nothing at all', null, false],
  ])('%s → %s', (_label, error, expected) => {
    expect(isUnreachable(error)).toBe(expected);
  });
});
