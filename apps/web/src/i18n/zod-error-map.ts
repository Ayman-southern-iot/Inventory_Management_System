import { z } from 'zod';
import { t } from './en';

/**
 * D-005. Submitting an empty requisition showed "String must contain at least 1 character(s)"
 * on the Item field while every field beside it correctly showed "Required".
 *
 * The cause is not that one schema: an absent field fails `invalid_type` (zod's default message
 * is already "Required"), while a field the user cleared to `""` fails `too_small` instead, and
 * zod's default for that is the sentence above. There are 27 bare `.min(1)` schemas in
 * `packages/shared/src/contracts`, so fixing the reported field would have left 26 others
 * waiting to be found by the next QA round.
 *
 * One error map, installed once, covers all of them. It also keeps the copy in `i18n/en.ts`
 * where `rules/30-frontend.md` requires it, rather than duplicating the word "Required" into a
 * shared contract that the API imports too — the API renders its own messages and has no
 * business carrying the SPA's wording.
 *
 * Side-effecting on import by design: this must be installed before any resolver runs, and a
 * function nobody remembers to call is the same defect again.
 */
const errorMap: z.ZodErrorMap = (issue, ctx) => {
  // Only the global fallback: a schema that sets its own message (`.min(1, '...')`) never
  // reaches here, so a deliberate, more specific message still wins.
  const isEmptyString =
    issue.code === z.ZodIssueCode.too_small &&
    issue.type === 'string' &&
    issue.minimum === 1;

  return { message: isEmptyString ? t.common.required : ctx.defaultError };
};

z.setErrorMap(errorMap);
