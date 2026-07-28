---
paths:
  - apps/web/**
---

# Frontend rules (React + TypeScript)

## Data

- All server state goes through TanStack Query. No `useEffect` + `fetch`.
- Query keys are built by a typed factory in `src/api/keys.ts`, never inline string arrays.
- Mutations invalidate precisely. Invalidating everything on every write makes the app feel broken
  on a slow connection.
- The websocket pushes *invalidation signals*, not data. The server stays the single source of truth.

## Components

- Feature-first structure: `src/features/<feature>/{components,hooks,api}`.
- `src/components/ui/` is shared primitives only. A component used by one feature lives in that feature.
- Props are explicitly typed. No `React.FC`, no implicit `any`, no `{...rest}` spreading onto DOM
  elements without a typed pick.
- A component over ~150 lines is doing two jobs. Split it.

## Forms

React Hook Form + the **same zod schema the API uses**, imported from `packages/shared`. The schema
is written once. A validation rule that exists only on the client is a bug waiting to happen.

## States you must handle

Every screen that loads data handles all four, explicitly:
loading · empty · error (with retry) · loaded. "Empty" is not "loading forever".

## Styling

Tailwind with the project token set. No arbitrary values (`w-[437px]`), no inline `style` for
anything themeable, no hex codes in components. Status colours come from semantic token names
(`text-success`, `text-pending`, `text-danger`) so the tracker's green/ash/red is defined once.

## Copy

No user-visible string literals in JSX. Everything comes from `src/i18n/en.ts`. This is not about
translation — it is so that wording changes are one file, and so the QA checklist can diff copy.

## Accessibility floor

Labels tied to inputs, focus visible, dialogs trap focus and close on Escape, tables have headers.
This is an internal tool used every day by people who will keyboard through it.
