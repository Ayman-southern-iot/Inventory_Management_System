# User manual

`IMS-User-Manual.pdf` — the manual handed to staff. 19 pages, A4, four parts (everybody,
approvers, Inventory Manager, administrator) plus three reference lists.

## Regenerating the PDF

```bash
node docs/manual/build-pdf.js
```

Edit `manual.html` and re-run. It renders through the same Chromium the API uses for BOM
documents, so there is one browser to keep working rather than two, and nothing extra to install.

## Keeping it true

Every button name, field name and status word in the manual was read off the running application
or out of `apps/web/src/i18n/en.ts`. **It is not paraphrased from memory, and a revision should
not be either.** Before changing a described behaviour, check it:

```bash
node docs/manual/verify/dump.js > /tmp/screens.txt   # every screen's visible text, per persona
node docs/manual/verify/preview.js 0 "The money trail"   # print-size preview of a section
```

`dump.js` needs the app running on `http://localhost:5173` with demo accounts enabled — override
with `MANUAL_BASE_URL` and `MANUAL_DEMO_PASSWORD`. It paces its logins: `/auth/login` allows ten a
minute per IP, and a sweep that trips the limit quietly starts reading the login page instead of
the screen it asked for.

## What the manual deliberately leaves out

- **Partial funding** and **revising the approved amount** are off for this release
  (`ALLOW_PARTIAL_FUNDING`, `ALLOW_APPROVED_AMOUNT_REVISION`). The manual documents the shipped
  behaviour: Accounts pays the whole outstanding amount, and an approver approves in full or
  rejects. If either flag is turned back on, sections 13 and 20 need revisiting.
- **Approval delegation** — the copy exists in `en.ts` and the API supports it, but no screen
  uses it, so it is not a user-facing feature yet.
