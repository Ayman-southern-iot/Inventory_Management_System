# Playwright role audit

First full audit of the web app, driven through the real UI as each role.
**Run:** 2026-10-04, against the local demo stack (`docker-compose.yml`, `http://localhost:5173`) with
demo mode switched **off**. **Not run against the VM or `infra/`.**
**Method and how to repeat it:** `.claude/skills/playwright-audit/SKILL.md`. Scripts: `scripts/playwright-audit/`.
**Copy and message review:** `docs/message_audit.md`.

## Result

One complete end-to-end run (`audit.js`, run id `kkdez`): **exit 0, 0 failed, 104 operations.**
"WARN" means the step worked but something logged an error while it ran (a 4xx, a console error).

| Role | Operations | Pass | Warn | Fail |
|---|---|---|---|---|
| General (Gina) | 27 | 18 | 9 | 0 |
| Inventory Manager (Imran) | 42 | 39 | 3 | 0 |
| Approver (Ayesha = Approver 1 and sub-threshold, Farhan = Approver 2) | 17 | 11 | 6 | 0 |
| Admin | 18 | 15 | 3 | 0 |

Every role passed 10+ operations in a **single connected story** that used real state handed between
roles: General proposes a project, the IM accepts it, General borrows and raises four requisitions,
the IM approves the borrows and reviews the requisitions, the approvers approve or reject, the IM
builds a BOM and takes requisition A through every money stage to **In stock**, voids a second BOM,
and the admin finishes with users, departments, API keys and the audit log.

Most WARNs are the same two findings (F2 on requisition pages, F4 on the login page). The real
defects are below; **none was fixed**, because the ask was an audit.

## Findings

Ranked. Severity is my judgement. "Verified" means I reproduced it and read the response or the
code, not that I inferred it.

### F1. Requisition stays "Approved" after its BOM is generated or voided (until reload). Medium.
After the IM generates a BOM and returns to the requisition inside the same session, the page still
shows **Approved** and the **"Generate the BOM for this requisition"** link, and there is no
**Send to Accounts** button. A full page reload shows **BOM generated** and the button. Reproduced
by a dedicated probe (before the BOM, back via the SPA, after a reload) and again in every full run since.
**Cause (verified in code):** `useBomMutation.onSuccess` in [apps/web/src/features/boms/api.ts:81-84](../apps/web/src/features/boms/api.ts#L81-L84)
invalidates only `queryKeys.boms.lists()` and sets the BOM detail. It never invalidates
`queryKeys.requisitions.detail(id)`, `requisitions.lists()` or `boms.byRequisition(id)`, but both
generate and void change each source requisition's status. `useGenerateBom` and `useVoidBom` share it.
**Effect:** the IM sees the wrong status and the wrong next action; pressing the stale link again
should fail on the one-live-BOM rule. Workaround: reload.
The audit records this each run (IM step 31, "DEFECT").

### F2. Every requisition page opened by a requester or approver fires a 403. Medium-low.
`GET /api/v1/boms/by-requisition/:id` returns **403** for General and Approver on every requisition
detail page. [FundsPanel.tsx:47](../apps/web/src/features/funds/components/FundsPanel.tsx#L47) calls
`useBomForRequisition` with no role check, but the endpoint is IM/Admin only
([boms.controller.ts:104-111](../apps/api/src/modules/boms/boms.controller.ts#L104-L111), with a comment saying
it is gated on purpose so a general user cannot enumerate BOMs).
**Effect:** a failed request and a console error per page view. I saw nothing visibly broken, so the
panel seems to tolerate the 403; I did not check whether the query retries. The gate is right; the
client should not ask. Accounts for 10 of the 21 audit WARNs; F4 accounts for 11.

### F3. Raw library validation text reaches users, and one required field is not marked. Low-medium.
| Where | What the user sees |
|---|---|
| New project, empty or one-character name | `String must contain at least 2 character(s)` |
| Void BOM, empty reason | `String must contain at least 3 character(s)` |
| Add to inventory → "It is a new product", **Storage ID left empty** | a toast, `String must contain at least 1 character(s)`, with no field named |

The Storage ID case is the worst: the server answers **400** `VALIDATION_FAILED` on
`lines.0.newProduct.productCode` (verified: request body and response captured), but the form does
not mark the field required and shows no inline error, only the toast. Elsewhere the app writes real
copy ("An expected return date is required", "This is more than has been funded...").
The project rule is that user copy comes from `apps/web/src/i18n/en.ts`.

### F4. The sign-in page requests an endpoint that 404s whenever demo mode is off. Low.
`GET /api/v1/auth/demo-accounts` returns **404** `Demo accounts not found` on every load of the login
page, and again whenever a signed-out page renders. It is the WARN on every "Sign in" step. This is
what the **production** (`infra/`, demo off) login page will do on every visit: a console error and
a failed request. Cosmetic, but it makes real errors harder to spot in the console.

### F5. Login lockout is keyed by client address, not account. Risk, to confirm with the owner.
Five failed attempts for an email that **does not exist** were answered `401`; the sixth and later
were `429 RATE_LIMITED` with `retryAfterSeconds: 900`. A **valid** login for a real account from the
same browser right afterwards was also refused: "Too many attempts. Wait a few minutes and try again."
(verified). So one person mistyping five
times locks out **everyone behind the same address for 15 minutes**.
`ASSIST.md` lists a self-tripped login limit as working as designed, so this is **not** filed as a
defect. It matters because `NOW.md` records that the real client IP behind Cloudflare is
unresolved: if every user arrives as the proxy's address, this becomes an office-wide lockout.
The limiter is in memory; restarting the API container clears it.

### F6. The plain rate-limit answer leaks an internal class name. Low.
Past 10 requests a minute on the auth tier, the API answers
`{"code":"RATE_LIMITED","message":"ThrottlerException: Too Many Requests"}` with **no `Retry-After`
header**. The login limiter's 429 is better (`details.retryAfterSeconds`). The UI hides both behind
friendly copy, so this is for API clients. Engineering standard: user-facing messages never leak
internals.

### F7. BOM detail shows raw enum names and raw UTC timestamps. Low.
The "Approval chain (frozen at generation)" table shows `INVENTORY_MANAGER` / `APPROVER` and
`2026-10-04T06:47:40.389Z`, where the rest of the app shows names and Dhaka times
("Oct 4, 2026, 12:47 PM"). Seen on the BOM detail page of a voided BOM.

### F8. A duplicate zone says only "That change conflicts with the current state." Low.
The server's answer names the clash (`A zone called "Zone-A" already exists in <room>`); the toast
does not. The user is told something conflicts, not what.

### F9. Escape does not close the notification panel. Low (accessibility).
`Escape` closes the room, zone and compartment dialogs but not the notification panel;
a second click on the bell does. The project's own accessibility floor says popovers and dialogs close
on Escape. Exception, **by design**: the "Copy your key now" dialog ignores Escape until you press
"I have copied it", which is right for a one-time secret.

### Notes, not defects
- **Borrow Approve and Reject are single clicks** with no confirmation and no reason; Reject
  releases the reservation at once ("Rejected. The reservation has been released."). Consistent with
  `docs/reference/05-user-flows.md` §5.1; worth a product decision on whether a reject should ask why.
- **Fresh install cannot submit a requisition below the threshold.** The Settings screen's
  *Sub-threshold approver* starts "Not assigned" and the submit is refused: "No approver is set for
  requests below the expense threshold. An administrator must choose one in Settings -> Sub-threshold
  approver." The message is clear and the requisition is kept as a draft (D-015 works). It still
  means an admin step is required before the first requisition. On this database Approver 1 and
  Approver 2 were already assigned (Ayesha, Farhan); expense threshold 15,000.
- **A proposed project is "Awaiting acceptance"** and is not offered in the borrow or requisition
  forms; the borrow dialog does not say a pending project exists. Intended.
- **Creating a product opens its page with Receive stock already open.** Intended; scripts must
  follow it.
- **The app still says "Southern IoT"** (page title, header, login subtitle "IOT — Innovation of
  Technology"). Known: the company is SIOT, Southern Innovation of Technology.
- **Bulk import** shows "Coming soon" on `/inventory/imports` (committed in `3af754d`). The sidebar
  link remains and the import API routes still answer.
- **A one-off "Cannot reach the server." at the very first login** of one run, with the API healthy,
  no restart, no OOM and nothing in the API or proxy logs. **Not reproduced and not explained.**
  Every later request in that run was fine.

## Demo mode

The local demo compose file hardcodes `DEMO_ACCOUNTS_ENABLED: 'true'`.
- **On:** `GET /api/v1/auth/demo-accounts` is **unauthenticated** and returns every persona **and
  the shared password** in JSON; the login page lists five clickable accounts with the password
  printed on each. Deliberate for a demo.
- **Off** (recreated the local `api` container with an override file kept outside the repo):
  that endpoint returns 404, the login page shows only the email and password form, and the same
  five accounts sign in with the real form; a wrong password returns a clean `401
  INVALID_CREDENTIALS`. A new admin-created user lands on `/account/password` first.

**The VM still runs demo mode on**, per `NOW.md` (the root demo stack at `9f4176d`, operator, 2026-09-27).
There authentication is effectively absent. I did not touch the VM; switching it is the `infra/`
migration in `docs/RUNBOOK.md` §0 and needs IT.

## Operations covered

**General (27):** sign in; inventory search; in-stock filter; product detail; propose project; open
project; borrow dialog hides unaccepted project; save draft requisition; Drafts tab; notifications;
`/admin/users` refused ("Not allowed"); sign out; second sign-in; borrow against the project; borrow
without a project; My borrowings Pending; submit requisitions A, B, C, D; tracker shows the IM
stage; borrow now Out; project page shows the borrowed product; rejected requisition shows the
approver's note; lifecycle of A; sign out.

**Inventory Manager (42):** accept project; add category; create room, zone, compartment; create
product; receive stock; adjust stock with reason; move stock; export inventory CSV and PDF; bulk
import shows "Coming soon"; approve two borrows; Out tab; search; record a return; review
requisitions (approve A, B, D; reject C with note); Rejected tab; generate BOM; BOM totals; BOMs
Live list; Send to Accounts; record money received; over-spend refused ("more than has been
funded"); record purchase; verify purchase; add to inventory as a new product; lifecycle reaches
In stock; render BOM PDF; generate and void a BOM; Voided list; expenses report and CSV.

**Approver (17):** waiting list; rejected-at-IM item is absent; approve A; reject B with a note;
approve D as Approver 1; Approved and Rejected tabs; expenses period filter and CSV; projects;
notifications; `/boms` refused; as Approver 2 only D is waiting, and approving D completes the chain.

**Admin (18):** read and set sub-threshold approver and defaults, and check they persist; users list,
search, create; the new user signs in and is forced to change password; create department; create
service account; issue a key and see the secret once; revoke it; audit log shows 25 rows and filters
by user; profile page.

## Traps that cost me time (not app bugs)

Each of these looked like a defect first. Check them before filing one.
1. **Full page reloads.** `GET /auth/me` is on the 10-per-minute auth tier and the SPA treats a 429
   as signed out. Seventeen `page.goto` calls in a minute logged the audit out. Navigate by clicking.
2. **Dialogs filled within milliseconds of opening** sometimes lost the value and then showed
   "Required". Not reproducible by a person. The harness uses `fillStable`, which re-fills and checks.
3. **Locators that match every ancestor.** `div.filter({ hasText: roomName }).last()` and "the first
   New zone button" both silently targeted the **wrong room**, which produced a correct 409. Use the
   nearest ancestor of the item's own name, or give every created thing a run-unique name.
4. **Dependent selects load late** (zone after room, compartment after zone); read options until
   one appears.
5. **Day buttons in the date picker** are the only buttons with `aria-pressed`; hour and minute are
   bare numbers too.
6. **Shared demo stock runs out.** Repeated runs consumed every free ThinkPad; the borrow button then
   did nothing. The audit now borrows its own product, created and stocked earlier in the same run.
7. **A toast can outlive its step.** A "Request submitted" toast on a failed requisition submit was
   left over from a borrow 20 seconds earlier; the code path was correct.
8. **The login limiter is shared and sticky.** Five failures cost 15 minutes. Use a non-existent email
   for negative tests and restart the local API container to clear it.

## Not checked

Phone-width layout; Firefox and WebKit (Chromium only); approval by signature (needs an uploaded
signature file); delegation; withdrawing an approval and "Take it back"; supporting-document and
invoice upload; multi-requisition (batched) BOMs; the content of the exported CSV and PDFs (only that
a file with the right extension downloads, and that the BOM PDF stops being "pending"); password
change; using a real API key and `POST /stock/take`; two users editing at once; production
(`infra/`) behind Cloudflare; accessibility beyond Escape; performance.

## State left behind

- The local demo database now holds many `AUD-*` projects, rooms, products, requisitions, BOMs, one
  `aud-*` user, department, service account and a revoked key. A `pg_dump` was taken first, to the
  session scratchpad only, so it is **not** kept; recreate the stack to reset.
- The local `api` container is running with demo mode **off** through an override file that is not in
  the repo. To go back: `docker compose up -d --no-deps --force-recreate api` from the repo root.
- Screenshots and `results.json` are in `playwright-shots/audit/` (gitignored). **They include one
  throwaway API-key secret from the local database, which was revoked; do not commit that folder.**
