/**
 * Move focus to the first control the form has marked invalid.
 *
 * Called after `setError`, one frame later: react-hook-form sets the error in state, and the
 * `aria-invalid` attribute this queries only exists once React has re-rendered. Reading the DOM
 * synchronously finds the *previous* render's markings, which on a second failed submit means
 * focusing a field the requester has since fixed.
 *
 * Queried from the document rather than passed a list of refs because the fields that can fail
 * are not all plain inputs — the deadline is a button that opens a calendar — and every control
 * in the kit already sets `aria-invalid` for its red border. One rule, no register of refs to
 * keep in step.
 *
 * Scrolling matters as much as focus: on a long requisition the offending field is usually above
 * the fold, and a submit that appears to do nothing is how QA produced duplicate drafts.
 */
export function focusFirstInvalid(root: ParentNode = document): void {
  requestAnimationFrame(() => {
    const first = root.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!first) return;
    // Feature-detected, and focus still happens if it is missing. This runs inside a
    // `requestAnimationFrame`, so a throw here escapes every caller — there is no call stack
    // left to catch it — and takes down whatever runs next instead of failing visibly here.
    if (typeof first.scrollIntoView === 'function') {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    first.focus({ preventScroll: true });
  });
}
