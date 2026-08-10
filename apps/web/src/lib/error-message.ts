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
  if (error instanceof ApiError && isKnownCode(error.code)) {
    const template = t.errors[error.code];
    // A few error codes carry details that change the user-facing copy (e.g. INSUFFICIENT_STOCK
    // surfaces quarantine). Substitute {placeholders} from the server payload if present.
    const details = (error as { details?: Record<string, unknown> | null }).details;
    if (details && typeof template === 'string') {
      return template.replace(/\{(\w+)\}/g, (_, key: string) => {
        const value = details[key];
        return value === undefined || value === null ? `{${key}}` : String(value);
      });
    }
    return template;
  }
  if (error instanceof ApiError) return error.message;
  return t.errors.INTERNAL;
}
