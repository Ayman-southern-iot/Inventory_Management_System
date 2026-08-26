/**
 * Calendar-day arithmetic, in a stated zone.
 *
 * A `date` column is a calendar day, not an instant, so "is this deadline in the past" is a
 * question about somebody's calendar — and the only defensible answer is the business's own.
 * Before this existed the codebase had three answers: two call sites formatted an instant as
 * UTC, and one asked Postgres for `current_date`, which resolves in the *database container's*
 * zone. The first is wrong east of Greenwich for the first hours of every day; the second is
 * right only for as long as two containers happen to agree, and only one of their timezones
 * is in version control (`infra/.env` holds the API's).
 *
 * `REPORTING_TIME_ZONE` is the configured answer and the reports module already resolves its
 * ranges against it — see the note in `reports.repository.ts` about not trusting the server's
 * zone. Everything user-visible that turns on "what day is it" goes through here now.
 */

/**
 * The calendar day at `instant` in `timeZone`, as `YYYY-MM-DD`.
 *
 * `en-CA` is the locale trick that yields ISO order with zero-padding; the callers compare the
 * result with `<` against a `date` column's text, so an unpadded `2026-9-5` would sort before
 * `2026-10-01` and silently mis-flag a month's worth of deadlines.
 */
export function todayIn(timeZone: string, instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Whether the runtime recognises `timeZone` as an IANA zone.
 *
 * Used by the config schema so a typo refuses the boot, per rules/10: validation crashes the
 * process with a message naming the variable rather than falling back to something that
 * silently works. Without it `Asia/Dhakaa` parsed fine and threw a `RangeError` at the first
 * overdue calculation of the day, in a request, in production.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A `date` column's value as `YYYY-MM-DD`, whatever the driver handed back.
 *
 * `532a4ba` configured pg to return `date` columns as strings, so the string branch is the
 * normal path. The `Date` branch stays because a driver-level regression there is exactly the
 * silent one-day shift D-014 was, and returning a wrong day is worse than the extra three lines.
 * `toISOString()` is safe here only because such a value is UTC midnight by construction.
 */
export function calendarDayOf(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
}
