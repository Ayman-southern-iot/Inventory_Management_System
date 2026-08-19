import { ErrorCode, type FieldIssue } from '@ims/shared';
import { ApiError } from '@/api/client';
import { t } from '@/i18n/en';

type ErrorCopyKey = keyof typeof t.errors;

function isKnownCode(code: string): code is ErrorCopyKey {
  return Object.prototype.hasOwnProperty.call(t.errors, code);
}

/**
 * The field-level issues the server sends for VALIDATION_FAILED. Defensive about the shape: a
 * malformed payload must degrade to the generic sentence, never to "undefined".
 */
function fieldIssueMessages(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details
    .filter(
      (issue): issue is FieldIssue =>
        typeof issue === 'object' &&
        issue !== null &&
        typeof (issue as FieldIssue).message === 'string' &&
        (issue as FieldIssue).message.trim().length > 0,
    )
    .map((issue) => issue.message.trim());
}

/**
 * Turns an error into copy from `i18n/en.ts`, switching on the stable `code` rather than the
 * server's message — the message is for the log, the code is the contract.
 */
export function messageForError(error: unknown): string {
  if (error instanceof ApiError && isKnownCode(error.code)) {
    const template = t.errors[error.code];
    const details = (error as { details?: Record<string, unknown> | null }).details;

    // VALIDATION_FAILED carries FieldIssue[] — the actual reasons the request was rejected.
    // Those beat the generic sentence, which promises highlighted fields the caller may not
    // render at all (FundsActionDialog is local state and a toast, not react-hook-form).
    if (error.code === ErrorCode.VALIDATION_FAILED) {
      const issues = fieldIssueMessages(details);
      // Deduped: two fields failing the same rule would otherwise read 'Required; Required'.
      if (issues.length > 0) return [...new Set(issues)].join('; ');
    }

    // A few error codes carry details that change the user-facing copy (e.g. INSUFFICIENT_STOCK
    // surfaces quarantine). Substitute {placeholders} from the server payload if present.
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
