# Message and copy audit

Review of every alert, toast, inline error, confirmation and empty state a user can meet: is it
professional, accurate and useful? **2026-10-04.** Nothing was changed in the app; this is findings.

## Verdict

**The authored copy is good. The messages that go wrong are the ones nobody authored.**
The text in `apps/web/src/i18n/en.ts` is specific, calm and usually says what to do next
("Lower a unit cost, or record a further fund receipt first."). There are no exclamation marks, no
blame, no slang, and every one of the 69 API error codes has its own sentence.
What lets the app down:
1. **Raw library text reaches users** ("String must contain at least 2 character(s)", "Invalid uuid").
2. **The app throws away good server messages** and shows a generic or even wrong one.
3. **A handful of internal words** leak into copy ("bounced", "PDF cached", "From bin").
4. **Inconsistency** in toast punctuation, wording and confirmations.

Ranked below as M1–M11; M1–M3 are the ones a user will actually notice.

## Status after the fixes (branch `fix/professional-messages`)

| # | Finding | Status |
|---|---|---|
| M1 | Wrong current password said "no permission" | **Fixed.** The change-password call maps `FORBIDDEN` to "Your current password is not correct." Client only; the server's auth behaviour is untouched. |
| M2 | Raw zod text, "Invalid uuid", unmarked Storage ID | **Fixed.** `lib/validation-message.ts` + a widened `i18n/zod-error-map.ts` cover zod's default wording for forms and for server field issues. Add-to-inventory now marks Storage ID, name and "which product" as required, on the field. An empty email reads "Required". |
| M3 | Specific server messages replaced by generic ones | **Fixed for the cases found,** by six new error codes (`DUPLICATE_DEPARTMENT_NAME`, `DUPLICATE_ROOM_NAME`, `DUPLICATE_ZONE_NAME`, `DUPLICATE_COMPARTMENT_CODE`, `DEPARTMENT_HAS_ACTIVE_USERS`, `LOCATION_HOLDS_STOCK`), still 409. Uploads now say "That file type is not accepted…". **Duplicate user email** and **the last administrator** also have codes now (`USER_EMAIL_IN_USE`, `LAST_ADMINISTRATOR`), done on the owner's instruction to fix everything (user management is on the auth STOP list). |
| M4 | Internal words | **Fixed:** "bounce" (4 strings), "PDF cached" -> "PDF ready.", "From bin" -> "From compartment", "For revise" -> "For revision", "(s)" plurals, "un-verify", "This screen crashed". Product search placeholder now says "storage ID". |
| M5 | Inconsistent punctuation and case | **Fixed:** ten success toasts and one error now end in a full stop; Title Case dashboard labels are sentence case; one contraction removed. "inactive / deactivated / archived": the slot-warning strings now say deactivated; the category and archived-product wording is unchanged. |
| M6 | Destructive actions ask inconsistently | **Fixed.** Borrow reject and deactivating a user, a department or a compartment now ask first, through one shared `ConfirmDialog` that says what will happen. Activating, which restores access, stays one click. Rejecting still needs no reason (open). |
| M7 | No next step | **Fixed:** `INTERNAL`, `NETWORK` and the upload fallback now say what to do. |
| M8 | `{placeholders}` could show literally | **Fixed:** every error that quotes a figure has a figure-free twin in `t.errorsPlain`. Covered by tests for all 12. |
| M9 | Error toasts announced politely | **Fixed:** error toasts are `role="alert"`, success `role="status"`. |
| M10 | Limits typed into copy | **Partly fixed:** the 5 MB attachment limit and the password minimum are now built from their constants; "within seven seconds" is gone from the audit-log empty state. The signature hint "up to 2 MB" is still a typed number. |
| M11 | Threshold 0 accepted; BOM with no vendor | **Not changed, logged as OQ-35 and OQ-36.** These are business rules; guessing a minimum would invent a requirement. |

New tests: 42 in the web suite (humanizer, error mapper, zod map, toast) and 9 integration tests for the
new codes (shown failing 7 of 9 without the service change). One existing test was updated on purpose:
`zod-error-map.test.ts` asserted zod's own wording for a numeric minimum ("greater than or equal to 1"),
which is exactly the text this change replaces; it now asserts the plain wording and still proves a
number below its minimum is not reported as "Required".

### Verified in the running app

The local web and API containers were rebuilt from this branch and the same probe
(`scripts/playwright-audit/messages.js`) was run again. Before -> after:

| Action | Before | After |
|---|---|---|
| Wrong current password | You do not have permission to do that. | Your current password is not correct. |
| New project, empty or 1 letter | String must contain at least 2 character(s) | Use at least 2 characters. |
| Receive stock, nothing chosen | Invalid uuid | Choose an option. |
| Login, empty email and password | Invalid email / Required | Required |
| Login, email "abc" | (browser bubble only) | Enter a valid email address. |
| Borrow, quantity 0 | Number must be greater than 0 | Enter a number greater than 0. |
| Requisition, negative price | Number must be greater than or equal to 0 | Enter 0 or more. |
| Settings, threshold -5 | Number must be greater than or equal to 0 | Enter 0 or more. |
| Change password, empty | String must contain at least 4 character(s) | Use at least 4 characters. |
| Attach a `.exe` | Upload failed. Try again. | That file type is not accepted. Attach a PNG, JPEG or PDF. |
| Attach 6 MB | That file is too large. Maximum size is 5 MB. | That file is too large. The most you can attach is 5 MB. |
| Duplicate department | That change conflicts with the current state. | A department with that name already exists. |
| Duplicate room | That change conflicts with the current state. | A room with that name already exists. |
| Duplicate user email | That change conflicts with the current state. | Another account already uses that email address. |
| Deactivate a user (one click) | (nothing; it just happened) | Deactivate Gina General? They will not be able to sign in, and any session they have open ends. You can activate the account again later. |
| Reject a borrow (one click) | (nothing; the reservation was released) | Reject this request? The reservation is released and the request is closed. |

The Add-to-inventory Storage ID message is
covered by component tests, not by this probe, because it needs a purchased requisition.
Not driven by the probe: the signature upload (the profile page had no file input for that user).

## How it was checked

- **Read all 1,850 lines of `en.ts`** and the error pipeline (`lib/error-message.ts`,
  `i18n/zod-error-map.ts`), and compared the 69 `ErrorCode` members with their copy (all covered).
- **Provoked 38 scenarios in the running app** with `scripts/playwright-audit/messages.js` as logged-out
  user, General, IM and Admin, and recorded what appeared (toast, inline, alert).
- **Replayed four unclear cases against the real HTTP response** to see what the server said versus
  what the screen said. Those four are marked *verified against the response*.
- Anything marked *code only* was read in the source and not clicked.
- **Probe side effects:** scenario A6 saved the real expense threshold as `0` (the app accepted it);
  I restored it to **15,000** and confirmed. It also created a stray project named "New project" and a
  BOM for requisition D, from my own script. All in the local demo database.

## Findings, worst first

### M1. A wrong current password says "You do not have permission to do that." Misleading.
*Verified against the response.* Change password with a wrong current password: the server answers
`403 FORBIDDEN` with the clear `"Current password is incorrect"`. The screen shows
**"You do not have permission to do that."** The user thinks they are locked out of the feature, not
that they mistyped. Cause: `messageForError` maps by code, `FORBIDDEN` has one generic sentence, and
the server's message is never shown. Also a security-flavoured message on an ordinary typo.

### M2. Raw validation text. Technical, and sometimes wrong.
Cause: the web app's zod error map ([i18n/zod-error-map.ts](../apps/web/src/i18n/zod-error-map.ts)) rewrites only
the empty-string case (`min(1)` -> "Required"). Of **395** validators in `packages/shared/src/contracts`,
**4** carry their own message. Everything else shows zod's English, in forms and in server replies.

| Where | What the user reads | Better |
|---|---|---|
| New project, empty or 1 letter | `String must contain at least 2 character(s)` | "Give the project a name of at least 2 characters." |
| New user, empty form | `String must contain at least 2 character(s)` (name, designation), `Invalid email`, `String must contain at least 4 character(s)` | one sentence per field |
| Change password, empty | `String must contain at least 4 character(s)` | "Use at least 4 characters." |
| **Receive stock, nothing chosen** | **`Invalid uuid`** | "Choose a room, zone and compartment." |
| Borrow, quantity 0 | `Number must be greater than 0` | "Enter a quantity of 1 or more." |
| Requisition, quantity 0 / negative price | `Number must be greater than 0`, `Number must be greater than or equal to 0` | name the field |
| Settings, threshold -5 | toast: `Number must be greater than or equal to 0` | "The threshold cannot be negative." |
| Void BOM, empty reason (seen in the earlier audit) | `String must contain at least 3 character(s)` | "Give a reason of at least 3 characters." |
| Add to inventory (new product), Storage ID empty | toast `String must contain at least 1 character(s)`; field not marked required | mark it required, say which field |
| Login, empty email | `Invalid email` (beside "Required" for the password) | "Enter your email address." |

`Invalid uuid` and "character(s)" tell a user nothing and read as a bug.

### M3. Specific server messages are replaced by generic ones. 3 cases.
*Verified against the response.* The server writes good sentences; the UI overrides them by code.

| Action | Server said | Screen said |
|---|---|---|
| Duplicate department | `A department with that name exists` | "That change conflicts with the current state." |
| Duplicate room / duplicate email on a new user | names the clash (zone case: `A zone called "Zone-A" already exists in <room>`) | the same generic conflict sentence |
| Attach a `.exe` | `That file type is not accepted. Upload a PNG, JPEG or PDF.` | **"Upload failed. Try again."** (trying again cannot work) |

Fix direction: where a code carries a deliberate server sentence (`CONFLICT`, `FORBIDDEN`,
single-issue `VALIDATION_FAILED`), show it, or add specific codes the way `DUPLICATE_PROJECT_NAME` does.

### M4. Internal words in user-facing copy.
| Text | Where | Issue |
|---|---|---|
| "Bounced — over the tolerance", "This BOM will bounce…", "Bounce this requisition back…", "…over budget and bounced" | `boms.bouncedBanner`, `bounceWarning`, `sendBackHint`, `errors.BOM_OVER_BUDGET` | slang; the feature itself is named "Send back for revision" |
| **"PDF cached."** | `boms.renderToast` | an implementation word; the user wants "PDF ready." |
| **"From bin"** | issue-from-stock dialog | "bin" is used nowhere else; everywhere else it is *compartment* |
| "For revise" | requisition status tag | not a phrase; "For revision" |
| "Storage ID" vs "product code" | column and field say Storage ID; search placeholder says "Search by name or **product code**" | two names for one thing |
| "(s)": `unit(s)`, `purchase(s)` | 4 strings | use real plurals, the file already has a pattern for it |
| "Un-verifying", "Un-tick", "Purchase un-verified" | funds, BOM | hyphenation reads awkward; "undo verification", "untick" |
| "This screen crashed" | `states.crashTitle` | blunt; "This screen stopped working" |
| "inactive" / "deactivated" / "archived" | slots, users, categories, products | three words for one idea |

### M5. Inconsistent wording and punctuation. Low.
- **Success toasts end with a full stop in most places and not in these:** "Project created",
  "Project accepted", "Project not accepted", "Removed from this project", "Receipt voided",
  "Purchase voided", "Purchase un-verified", "Taken back from Accounts", "Signature saved",
  "Signature removed". (Also the error "Could not load notifications".)
- Mixed forms for the same step: "Marked as sent to Accounts." vs "Taken back from Accounts".
- One contraction ("categories you don’t count", `categories.trackableSub`) in a file that writes
  "does not" and "cannot" everywhere else.
- Title Case in a few labels ("Total Money Requested") against sentence case everywhere else.

### M6. Destructive actions ask inconsistently. Medium-low.
- **Asks first (good):** revoke API key, deactivate service account, reject a project (reason),
  void a BOM (reason), send back, undo money stages.
- **Does not ask:** reject a borrow (*verified live*: one click, immediate, "Rejected. The reservation
  has been released."), and, *code only* ([UsersPage.tsx:171-173](../apps/web/src/features/admin/pages/UsersPage.tsx#L171-L173),
  LocationsPage, DepartmentsPage), deactivate a user, a compartment or a department.
  Deactivating a user ends their access, so it deserves the same prompt a service account gets.

### M7. Some messages give no next step. Low.
"Something went wrong on the server." (`INTERNAL`) and "Cannot reach the server." (`NETWORK`) as toasts
say what happened but not what to do. The full-page versions do ("Check your connection, then try
again."). "Upload failed. Try again." is wrong advice when the file is the problem (M3).

### M8. A placeholder can show as literal braces. Risk, *code only*.
[lib/error-message.ts:48-54](../apps/web/src/lib/error-message.ts#L48-L54) fills `{max}`, `{unspent}`, `{attempted}` from `details`. When `details`
is absent it returns the template unfilled, e.g. "Shrink it to {max} or less." 12 error codes use
placeholders. I did not trigger one, so whether the server always sends the details is unchecked.

### M9. Error toasts are announced politely. Low (accessibility).
Toasts live in an `aria-live="polite"` region; inline errors use `role="alert"`. An error toast that
should interrupt a screen reader is announced when it is idle. Probe showed no `role=alert` while an
error toast was on screen.

### M10. Limits written into copy. Low.
"Maximum size is 5 MB", "PNG or JPEG, up to 2 MB", "within seven seconds" and "At least 4 characters."
are literals in `en.ts`; if the limit changes in config the text lies. (The 4-character rule is
an operator decision, OQ-17; the point is only that the number is typed twice.)

### M11. Behaviour the copy exposes. For the owner.
- **Expense threshold accepts `0`** and saves with "Setting saved." Every requisition would then
  need the higher approver count. A minimum of 1 looks right; it is a product decision.
- **Generate BOM succeeds with vendor left empty.** Maybe intended.
- Brand: the page title and login subtitle still say "Southern IoT" / "IOT — Innovation of
  Technology" (known).

## What is done well

- **Reversal refusals name the step to undo first** ("Void that receipt before taking it back off the
  Accounts queue").
- **Specific, actionable errors:** "This purchase would spend more than has been funded. Lower a unit
  cost, or record a further fund receipt first." Seen live and read well.
- **Inline duplicate for categories:** `“Laptops” already exists at the top level.` is the model the
  other duplicate cases (M3) should copy.
- **D-015** ("Your work was kept as a draft…") and the sub-threshold-approver refusal tell an admin
  exactly where to go. The one-time API-key reveal, the revoke confirmation and the rate-limit message
  ("Too many attempts. Wait a few minutes and try again.") are clear and calm.
- No `window.alert`/`confirm`/`prompt` anywhere; no native browser bubbles on 21 of 22 forms
  (`noValidate`). The exception is the service-account field ([NewServiceAccountField.tsx](../apps/web/src/features/admin/components/NewServiceAccountField.tsx)).

## What each scenario showed

Full output in `playwright-shots/audit/messages.json` (gitignored). Condensed:

| # | Action | What appeared |
|---|---|---|
| L1 | Login, both empty | `Invalid email` / `Required` |
| L3 | Login, unknown user | `Email or password is incorrect.` |
| G1–2 | New project, empty / 1 char | `String must contain at least 2 character(s)` |
| G4–6 | Borrow, qty 0 / huge / no date | `Number must be greater than 0`; `An expected return date is required` |
| G7 | Requisition, empty submit | toast `Fill in the highlighted fields before submitting.` + `Required.` per field |
| G8 | Requisition, bad qty/price | `Number must be greater than 0` / `…or equal to 0` |
| G10 | 6 MB attachment | `That file is too large. Maximum size is 5 MB.` |
| G12–13 | Change password | `Required`, `String must contain at least 4 character(s)`; `The two passwords do not match.` |
| G14 | Wrong current password | `You do not have permission to do that.` (M1) |
| G15 | Unknown address | `Page not found — That page does not exist, or you do not have access to it.` |
| G16 | `/admin/users` as General | `Not allowed — Your account does not have permission to view this page.` |
| I1 | New product, empty | `Required` |
| I2 | Receive stock, nothing chosen | `Invalid uuid` / `Required` |
| I3 | Adjust beyond stock | `There is not enough stock in that compartment.` |
| I5 | Room name taken | `That change conflicts with the current state.` |
| I7 | Category already exists | `“Laptops” already exists at the top level.` |
| A1–2 | New user, empty / bad | `String must contain at least 2 character(s)`, `Invalid email`, `String must contain at least 4 character(s)` |
| A3 | Email taken | `That change conflicts with the current state.` |
| A5 | Department name taken | `That change conflicts with the current state.` |
| A6–7 | Threshold 0 / -5 | `Setting saved.` (0 accepted) / `Number must be greater than or equal to 0` |
| A8–9 | API key / service account empty | `Required` |

## Not reviewed

Server-written notification text (the bell messages), the BOM and expense PDFs and CSVs, the Python
client's messages, signature-upload errors (the profile page had no file input for this user),
password-reset dialog, delegation errors, import errors (feature is off), and any message that only
appears under a failure I could not provoke. Non-English text: there is none (English only by design).
