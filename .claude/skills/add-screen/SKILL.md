---
name: add-screen
description: Build a new UI screen or major component for this project. Use when adding a page, dialog, or feature view to the web app.
argument-hint: "[screen name — which role uses it]"
---

Screen: **$ARGUMENTS**

## Ground yourself first

Open `docs/reference/06-screen-map.md` for which role owns this screen, and the relevant part of
`docs/reference/05-user-flows.md` for the interaction. One file each. Do not read the whole
reference folder.

## Build order

1. **Contract** — import the zod types from `packages/shared`. If the endpoint doesn't exist yet,
   stop and build it first; do not mock a shape you will have to change.
2. **Query layer** — TanStack Query hook in `features/<feature>/api/`, key from the typed factory.
3. **The four states** — loading, empty, error-with-retry, loaded. Write them before the happy path
   looks good, or they will never get written.
4. **Component** — under 150 lines. Extract sub-components rather than growing one.
5. **Forms** — React Hook Form + the shared zod schema. Field-level errors, disabled submit while
   pending, no double-submit.
6. **Optimistic updates only where safe.** Never optimistic for anything stock-related — the
   server may reject on a lock conflict and the user must see the truth.
7. **Copy** — every string from `src/i18n/en.ts`.
8. **Tokens** — no hex codes, no arbitrary Tailwind values. Status colours from semantic tokens.

## Before you call it done

- Keyboard through the whole screen. Tab order sane, focus visible, Escape closes dialogs.
- Shrink the window to 1280×720 — the IM will be using a laptop.
- Kill the network in devtools and confirm the error state is honest rather than an empty table.
