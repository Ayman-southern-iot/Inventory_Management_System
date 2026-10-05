import { t } from '@/i18n/en';

/**
 * Plain wording for the validation messages zod writes in its own English.
 *
 * Message audit M2: users read "String must contain at least 2 character(s)", "Number must be
 * greater than 0" and "Invalid uuid". They come from two places that both use zod's defaults: the
 * browser's form validation, and the server's `FieldIssue.message`. A field issue carries only a
 * path and a message, no code, so the wording is matched here rather than the issue.
 *
 * Only zod's own default sentences are rewritten. Anything else is a sentence somebody wrote on
 * purpose ("An expected return date is required") and is returned exactly as it came.
 *
 * `field` is the server's field path. It is passed only where the message is shown without the field
 * beside it (a toast), and is named only when it is one of `t.validation.fields`.
 */
export function humanizeValidationMessage(raw: string, field?: string): string {
  const message = raw.trim();
  const label = labelForField(field);
  const v = t.validation;

  const named = (text: string): string => (label ? v.named(label, text) : text);
  const required = (): string => (label ? v.requiredNamed(label) : v.required);

  if (message === 'Required') return required();

  let match = /^String must contain at least (\d+) character\(s\)$/.exec(message);
  if (match) return Number(match[1]) <= 1 ? required() : named(v.tooShort(Number(match[1])));

  match = /^String must contain at most (\d+) character\(s\)$/.exec(message);
  if (match) return named(v.tooLong(Number(match[1])));

  match = /^String must contain exactly (\d+) character\(s\)$/.exec(message);
  if (match) return named(v.exactLength(Number(match[1])));

  match = /^Number must be greater than or equal to (-?[\d.]+)$/.exec(message);
  if (match) return named(v.atLeast(match[1]!));

  match = /^Number must be greater than (-?[\d.]+)$/.exec(message);
  if (match) return named(v.greaterThan(match[1]!));

  match = /^Number must be less than or equal to (-?[\d.]+)$/.exec(message);
  if (match) return named(v.atMost(match[1]!));

  match = /^Number must be less than (-?[\d.]+)$/.exec(message);
  if (match) return named(v.lessThan(match[1]!));

  match = /^Array must contain at least (\d+) element\(s\)$/.exec(message);
  if (match) return named(v.tooFewItems(Number(match[1])));

  match = /^Array must contain at most (\d+) element\(s\)$/.exec(message);
  if (match) return named(v.tooManyItems(Number(match[1])));

  if (/^Expected number, received /.test(message)) return named(v.notANumber);
  if (message === 'Invalid email') return named(v.invalidEmail);
  if (message === 'Invalid uuid') return named(v.invalidChoice);
  if (message === 'Invalid url') return named(v.invalidUrl);
  if (message.startsWith('Invalid enum value')) return named(v.invalidEnum);
  if (message === 'Invalid date' || message === 'Invalid datetime') return named(v.invalidDate);
  if (message === 'Invalid input' || message === 'Invalid' || /^Expected .*, received /.test(message)) {
    return named(v.invalidGeneric);
  }

  return message;
}

/** The label for the last segment of a field path, or nothing when it is not one we name. */
function labelForField(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const last = path.split('.').pop() ?? '';
  const fields = t.validation.fields as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(fields, last) ? fields[last] : undefined;
}
