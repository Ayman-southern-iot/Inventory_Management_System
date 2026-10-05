---
name: playwright-audit
description: Drive the real web app through every role with Playwright, each doing 10+ real operations in one connected story, and record what breaks. Use before a release or go-live, after a large UI change, or when asked to "audit", "smoke test every role" or "check the app end to end". Not for what the server decides (use api-probe) and never against production.
argument-hint: "[roles or phases, default all]"
allowed-tools: Read Grep Glob Write Edit Bash
---

Auditing: **$ARGUMENTS**

A first audit (2026-10-04, 104 operations, 0 failed) and its findings are in
`docs/playwright_audit.md`. Read it before filing anything, so you do not report a known finding twice
or mistake a known trap for a bug. The scripts live in `scripts/playwright-audit/`.

Use `api-probe` for refusals, permissions and money arithmetic; the browser is for what a person
looks at and clicks. This skill is the browser half.

## Rules that are not optional

1. **Local demo stack only.** `docker-compose.yml` at `http://localhost:5173`. Never the VM, never
   `infra/`, never a database you cannot lose. The audit creates dozens of rows and a user.
2. **Back up first** (`docker exec ims-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup.dump`).
3. **Turn demo mode off for the audit.** Roles must sign in through the real form. Do it without
   editing a committed file (changing a config default is a STOP in `70-assist-handoff.md`): write an
   override outside the repo and recreate only `api`, so the one-shot `migrate` job does not re-seed.
   ```yaml
   # demo-off.override.yml  (kept in the scratchpad, not the repo)
   services:
     api:
       environment:
         DEMO_ACCOUNTS_ENABLED: 'false'
   ```
   `docker compose -f docker-compose.yml -f demo-off.override.yml up -d --no-deps --force-recreate api`
   Check: `GET /api/v1/auth/demo-accounts` is 404. Undo with the same command without the override.
4. **Never print an access token, a refresh cookie or an API-key secret.** The
   issue-key step shows a real secret on screen; screenshots of it stay in the gitignored
   `playwright-shots/`. Revoke the key (the script does) and do not commit that folder.
5. **Do not fix app bugs while auditing.** Record them in `docs/playwright_audit.md`.

## Run it

```bash
node scripts/playwright-audit/audit.js                 # everything, in order (~6 min)
node scripts/playwright-audit/audit.js im              # every phase of one role
node scripts/playwright-audit/audit.js general.b       # one phase
AUDIT_RESUME=playwright-shots/audit/results.json node scripts/playwright-audit/audit.js im.c
```
Playwright is resolved from `require('playwright')`, then the global `npm root -g`; override with
`PLAYWRIGHT_MODULE`. Other knobs: `AUDIT_BASE_URL`, `AUDIT_PASSWORD`, `AUDIT_HEADED=1`,
`AUDIT_STEP_TIMEOUT_MS`, `AUDIT_OUT_DIR`. Output: one line per step (`PASS`/`WARN`/`FAIL`), a
screenshot per failure, and `results.json`.

**Phases and why the order matters:** `general.a` (proposes a project) -> `im.a` (accepts it, builds
catalogue and stock) -> `admin.a` (sets the sub-threshold approver; without it no requisition below
the threshold can be submitted) -> `general.b` (borrows, raises requisitions A, B, C, D) -> `im.b`
(approves borrows, reviews requisitions) -> `approver.ayesha`, `approver.farhan` -> `im.c` (BOMs and
the money stages) -> `general.c` -> `admin.b`. A later phase alone needs the earlier ones to have run;
`AUDIT_RESUME` reuses a previous run's data.

**Pacing:** one sign-in per role phase. `POST /auth/login` and `GET /auth/me` share a 10-per-minute
tier, and five failed logins from one address lock **every** login from it for 900 seconds. If you
get locked out, restart the local `api` container (the limiter is in memory).

## Message catalogue (copy review)

`node scripts/playwright-audit/messages.js` provokes about 38 error, validation and refusal scenarios as
a logged-out user, General, IM and Admin and records exactly what appears (toast, inline, alert) in
`playwright-shots/audit/messages.json`. Findings: `docs/message_audit.md`.

- **It is not read-only.** It saved the real expense threshold as `0` once (restore it to 15000), made
  a project named "New project" and a BOM. Run it on the local demo stack only, and check `Settings`
  afterwards.
- Compare what the screen says with what the server said: replay the odd ones with `page.on('response')`.
  Three of the worst messages were the app replacing a good server sentence with a worse one.
- Ignore its `browser:` lines: they read `validationMessage` of invalid inputs even where `noValidate`
  means no bubble is shown. A message already on screen from the previous scenario is not repeated.

## How the harness behaves (`lib.js`)

- **Navigate by clicking the sidebar (`nav`)**, never `page.goto` between screens. A reload calls
  `/auth/me`; a 429 there makes the SPA think you are signed out and everything after it fails. Use
  `goto` only when you deliberately want a fresh load (a negative permission test).
- **`step(session, name, fn, { expect4xx, observe })`** records console errors, page errors and
  4xx/5xx API answers during the step. A step that passes but logged any becomes `WARN`. Use
  `expect4xx: true` when the server saying no is the pass condition.
- **`audit.observe(text)`** writes a finding that is not a failure (a defect you detected, a design
  fact worth recording). The stale-requisition defect is recorded this way every run.
- **`fillStable(locator, value)`** for the first field of a dialog that has just opened.
- **`pick(scope, label, which)`** waits for a `<select>`'s options to load before choosing.
- A failed step presses Escape twice so one failure does not leave a dialog covering the next.

## Triage: script bug or app bug? Do this before writing anything down

Most failures in the first audit were the script, not the app. For every `FAIL` or odd `WARN`:
1. **Open the screenshot** (`playwright-shots/audit/<ROLE>-<n>-fail.png`) and read what is on screen
   and in the toasts.
2. **Replay that one step alone** in a small probe script with logging (`inputValue()` after `fill`,
   the dialog's own text, `page.on('response')` with the body for 4xx).
3. **Read the response body** of any 4xx/5xx; `code`, `message`, `details` usually say which.
4. Only then classify. A real finding needs: what the user sees, the request and response, the file
   and line if you can find it, and a reproduction. Check `docs/playwright_audit.md` "Traps".

Known traps, all of which looked like bugs first: projects are "Awaiting acceptance" and not
selectable until the IM accepts; creating a product opens Receive stock; the key-secret dialog ignores
Escape on purpose; a locator filtered by text matches every ancestor and clicks the first room's
button; options of dependent selects load late; shared demo stock runs out (the audit borrows its own
product); a toast from one step can still be on screen in the next.

## Extending it

- One file per role in `roles/`, exporting phase functions `(audit, state)`. Register them in the
  `SEQUENCE` array in `audit.js`. Put data later phases need into `state`.
- **Name everything with `state.run`** (`AUD-<run>-...`). Lead with it where a code is built from the
  first letters of a name. Run-unique names are what make repeat runs safe.
- Find labels and buttons from the real screen first (open the dialog in a probe and dump its
  fields) or from `apps/web/src/i18n/en.ts`. Do not guess; the app has icon buttons with only an
  `aria-label` (`Approve BR-000007`, `Revoke <key name>`).
- Every role needs 10+ operations. Include at least one **negative** permission check
  (`expect4xx: true`) and one **refusal** (an over-spend, a required field).
- Regexes written through a shell heredoc lose their backslashes. Write role files with the file
  tools, and after any scripted edit grep for `/s+/` and `\d`.

## Report

Update `docs/playwright_audit.md`: result table, ranked findings (severity, evidence, cause with
`file:line`, effect), notes that are not defects, what you did **not** check, and what you left
behind (data, containers, override files). Say plainly which findings you verified and which you
only inferred. If `NOW.md` or `ASSIST.md` carries a test baseline that changed, run `/handoff`.
