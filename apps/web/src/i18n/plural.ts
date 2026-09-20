/**
 * Pick the singular or plural form of a counted string and substitute the count.
 *
 * English only, deliberately: this project has one copy file and no translation pipeline,
 * so `Intl.PluralRules` would buy nothing but a dependency on locale data. The two-form
 * signature is the shape a real i18n library would want later, so swapping one in means
 * changing this function rather than every call site.
 *
 * Zero takes the plural form — "0 approvers" — which is correct English and avoids the
 * "0 approver" that a bare `n > 1` test produces.
 */
export function plural(count: number, one: string, other: string): string {
  return (count === 1 ? one : other).replace('{n}', String(count));
}
