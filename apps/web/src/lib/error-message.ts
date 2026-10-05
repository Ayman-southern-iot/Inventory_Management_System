import { ErrorCode, type FieldIssue } from '@ims/shared';
import { ApiError } from '@/api/client';
import { t } from '@/i18n/en';
import { humanizeValidationMessage } from './validation-message';

type ErrorCopyKey = keyof typeof t.errors;

/**
 * Copy a caller can supply for one code, for one call. A code is deliberately generic ("That change
 * conflicts with the current state"); the screen that made the request knows what it was doing and
 * can say what actually clashed. Applies to that call only, so no other screen's wording changes.
 */
export type ErrorOverrides = Partial<Record<ErrorCopyKey, string>>;

function isKnownCode(code: string): code is ErrorCopyKey {
  return Object.prototype.hasOwnProperty.call(t.errors, code);
}

function isFieldIssue(issue: unknown): issue is FieldIssue {
  return (
    typeof issue === 'object' &&
    issue !== null &&
    typeof (issue as FieldIssue).message === 'string' &&
    (issue as FieldIssue).message.trim().length > 0
  );
}

/**
 * The field-level issues the server sends for VALIDATION_FAILED, turned into plain sentences.
 * Defensive about the shape: a malformed payload must degrade to the generic sentence, never to
 * "undefined".
 */
function fieldIssueMessages(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details
    .filter(isFieldIssue)
    .map((issue) => humanizeValidationMessage(issue.message, typeof issue.path === 'string' ? issue.path : undefined));
}

/**
 * Joins sentences that already end in a full stop with a space, and bare phrases with "; ".
 * Without this, "Storage ID is required." and "Compartment: Choose an option." read ".;".
 */
function joinMessages(messages: string[]): string {
  return messages.reduce((joined, message, index) => {
    if (index === 0) return message;
    return `${joined}${/[.!?]$/.test(joined) ? ' ' : '; '}${message}`;
  }, '');
}

/** Fills `{placeholders}` from `details`; reports whether any were left unfilled. */
function fill(template: string, details: Record<string, unknown> | null | undefined): { text: string; complete: boolean } {
  let complete = true;
  const text = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = details?.[key];
    if (value === undefined || value === null) {
      complete = false;
      return `{${key}}`;
    }
    return String(value);
  });
  return { text, complete };
}

/**
 * Turns an error into copy from `i18n/en.ts`, switching on the stable `code` rather than the
 * server's message — the message is for the log, the code is the contract.
 */
export function messageForError(error: unknown, overrides?: ErrorOverrides): string {
  if (error instanceof ApiError && isKnownCode(error.code)) {
    const code = error.code;
    const template = t.errors[code];
    const details = (error as { details?: Record<string, unknown> | null }).details;

    // VALIDATION_FAILED carries FieldIssue[] — the actual reasons the request was rejected.
    // Those beat the generic sentence, which promises highlighted fields the caller may not
    // render at all (FundsActionDialog is local state and a toast, not react-hook-form).
    if (code === ErrorCode.VALIDATION_FAILED) {
      const issues = fieldIssueMessages(details);
      // Deduped: two fields failing the same rule would otherwise read 'Required; Required'.
      if (issues.length > 0) return joinMessages([...new Set(issues)]);
    }

    const override = overrides?.[code];
    if (override !== undefined) return override;

    // A few error codes carry details that change the user-facing copy (e.g. INSUFFICIENT_STOCK
    // surfaces quarantine). Substitute {placeholders} from the server payload if present, and fall
    // back to the sentence without figures rather than ever showing a literal "{max}" (M8).
    if (typeof template === 'string' && /\{\w+\}/.test(template)) {
      const filled = fill(template, details);
      if (filled.complete) return filled.text;
      const plain = (t.errorsPlain as Partial<Record<ErrorCopyKey, string>>)[code];
      return plain ?? t.errors.INTERNAL;
    }
    return template;
  }
  if (error instanceof ApiError) return error.message;
  return t.errors.INTERNAL;
}

/**
 * The server's field issues, keyed by the field they belong to, so a caller can mark the input
 * instead of only raising a toast.
 *
 * D-025: recording 150,000 against an approved 99,000 was correctly refused, but the only
 * feedback was "Please correct the highlighted fields" with nothing highlighted, no
 * `aria-invalid` and no inline message. The reason was already on the wire — `FieldIssue.path`
 * has always been there — and nobody was reading it.
 *
 * The last issue for a path wins; the server sends at most one per field in practice, and
 * arbitrarily picking the first would be no more correct. The field is not named in the message:
 * it is shown beside the field it belongs to.
 */
export function fieldErrorsFor(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== ErrorCode.VALIDATION_FAILED) return {};

  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return {};

  const out: Record<string, string> = {};
  for (const issue of details) {
    if (isFieldIssue(issue) && typeof issue.path === 'string') {
      out[issue.path] = humanizeValidationMessage(issue.message);
    }
  }
  return out;
}
