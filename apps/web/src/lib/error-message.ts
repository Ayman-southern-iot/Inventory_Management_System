import { ApiError } from '@/api/client';
import { t } from '@/i18n/en';

type ErrorCopyKey = keyof typeof t.errors;

function isKnownCode(code: string): code is ErrorCopyKey {
  return Object.prototype.hasOwnProperty.call(t.errors, code);
}

/**
 * Turns an error into copy from `i18n/en.ts`, switching on the stable `code` rather than the
 * server's message — the message is for the log, the code is the contract.
 */
export function messageForError(error: unknown): string {
  if (error instanceof ApiError && isKnownCode(error.code)) return t.errors[error.code];
  if (error instanceof ApiError) return error.message;
  return t.errors.INTERNAL;
}
