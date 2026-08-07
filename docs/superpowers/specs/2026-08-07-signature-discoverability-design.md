# Signature management — make the existing feature reachable

**Date:** 2026-08-07
**Status:** Approved, ready for implementation plan
**Scope:** `apps/web` only. No migration, no API change, no `@ims/shared` change.

---

## Problem

The request was "add a signature section for the Inventory Manager and approvers so they can add,
update and delete a signature, and use that signature on the BOM when they approve with signature."

**All of that already exists and works.** Verified live against the running dev stack on 2026-08-07:

| Capability | Where it lives | Verified |
|---|---|---|
| Read current signature | `GET /api/v1/me/signature` | Returns the IM's `sign.jpg` (24,458 bytes), uploaded 2026-07-31 |
| Add / update | `POST /api/v1/me/signature` | Same endpoint replaces; UI copy reads "Replace signature" |
| Delete | `DELETE /api/v1/me/signature` | `signature.service.ts#clear` |
| Role gate | `@Roles(APPROVER, INVENTORY_MANAGER, ADMIN)` on `profile.controller.ts` | General user `saad@` receives `403 FORBIDDEN` |
| "Approve with signature" | `en.ts:715`, `DecisionDialog.tsx` | Both signed and unsigned approval paths present |
| Signature printed on the BOM | `bom-pdf.template.ts:163` | Renders `<img class="signature-image">` per approver footprint |

The data model is already correct and should not be touched. `users.signature_file_id` is the
user's *current* signature; `requisition_approvals.signature_file_id` is a **snapshot frozen at the
moment of approval**, protected by
`CHECK (NOT signed_with_signature OR signature_file_id IS NOT NULL)`. Migration `0015_signatures`
explains why: reading the live user row at print time would let an approver who replaces their
signature silently alter every document they have ever signed — "a forged document by accident."

**The actual defect is discoverability.** `SignaturePanel` is mounted in exactly one place —
[`ChangePasswordPage.tsx:113`](../../../apps/web/src/features/auth/ChangePasswordPage.tsx) — and
`ROUTES` has no profile entry and no nav link anywhere. The only route to it is `/account/password`,
a screen users reach **only** when `ProtectedRoute` force-redirects them on first login. There is
currently no voluntary way to reach that screen at all.

So the feature is complete and invisible. This spec makes it reachable. It adds no capability.

## Goals

1. A signer can find and manage their signature at any time, from a predictable place.
2. One home for the setting, not two.
3. Fix the incidental gap that change-password is unreachable by choice.

## Non-goals

- Any change to signature upload, storage, validation, or BOM rendering. It works.
- Any schema or API change.
- Backfilling `SignaturePanel` unit tests (noted as debt below).
- Admin managing another user's signature.
- Draw-with-mouse signature capture.

## Design

### Placement

Avatar dropdown → **My account**, a new page at `/account/profile`.

Chosen over a sidebar entry because the sidebar is organised by domain function (Inventory,
Approvals, Admin) and a personal preference reads off-key there; and over simply linking the
existing password page, because permanently tying "manage my signature" to a password form is the
reason nobody found it.

```
Header:  [ Inventory ▾ ]
          ┌──────────────────────┐
          │ Inventory            │
          │ inventory@southern…  │
          │ Inventory Manager    │
          │ [GENERAL] [INV MGR]  │
          ├──────────────────────┤
          │ ✎  My account        │  ← new
          │ ⏻  Sign out          │
          └──────────────────────┘
```

### Changes

**1. `apps/web/src/routes/paths.ts`**
Add `account: { profile: '/account/profile' }`. Leave the existing `changePassword` key untouched —
`ProtectedRoute` depends on it for the forced-password-change redirect, and disturbing it risks that
flow for no benefit.

**2. `apps/web/src/features/profile/ProfilePage.tsx` (new)**
Three blocks:
- Identity summary: full name, email, designation, role badges — read from `useAuth()`, no new fetch.
- `<SignaturePanel />`, rendered only when
  `canSign = hasRole(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN)` — the same predicate
  `ChangePasswordPage` uses today. Showing a control that 403s is worse than not showing it.
- A link to `ROUTES.changePassword`.

**3. `apps/web/src/App.tsx`**
One route under `AppShell`, with **no role wrapper**:
`<Route path={ROUTES.account.profile} element={<ProfilePage />} />`.
Every user has an account page; the signature panel gates itself.

**4. `apps/web/src/components/layout/AppShell.tsx`**
A `NavLink` to `ROUTES.account.profile` inside the existing `role="menu"` dropdown, above Sign out,
carrying `role="menuitem"`, and calling `setMenuOpen(false)` on click so the menu does not hang over
the page it just navigated to.

**5. `apps/web/src/features/auth/ChangePasswordPage.tsx`**
Remove the embedded `<SignaturePanel />` and the now-unused `canSign` / `Role` import. The page goes
back to being only a password form. Two homes for one setting is the original defect.

The forced-change flow is unaffected: `ProtectedRoute` still pins `mustChangePassword` users to
`/account/password` and blocks navigation elsewhere, including to the new page. Those users set a
signature after clearing the password gate, which is the correct order.

**6. `apps/web/src/i18n/en.ts`**
`nav.account` (`'My account'`) **already exists and is referenced nowhere** — further evidence this
page was planned and never built. Reuse it for the menu label rather than adding a second key. Add
one new block for the page itself: `account.title`, `account.changePassword`. No user-visible
literal enters JSX (rule 1).

### Data flow

Unchanged. `SignaturePanel` already owns its own state via `useMySignature` / `useUploadSignature` /
`useDeleteSignature` in `features/profile/api.ts`, and fetches the preview as an authenticated blob
(a bare `<img src>` cannot carry the bearer token) with the object URL revoked on replace and
unmount. Moving the component does not touch any of that.

### Error handling

Inherited from `SignaturePanel`, which already routes failures through `messageForError` and the
toast system. No new failure modes are introduced — no new endpoint is called. `ProfilePage` renders
from `useAuth()` state that `ProtectedRoute` guarantees is present, so it has no loading or error
state of its own.

## Testing

| Test | Asserts | Fails without the change |
|---|---|---|
| `ProfilePage.test.tsx` | Signature panel renders for `INVENTORY_MANAGER`; absent for a `GENERAL`-only user | Yes — the page does not exist |
| `AppShell.test.tsx` (extend) | Dropdown exposes "My account" pointing at `ROUTES.account.profile` | Yes — the link does not exist |

Run `pnpm typecheck && pnpm lint && pnpm test` before calling it done.

## Known debt, deliberately out of scope

- **`SignaturePanel` has zero test coverage.** Upload, preview and remove are all untested. Real
  debt, but unrelated to discoverability; folding it in would widen a small fix.
- **The dropdown's Sign out button is not marked `role="menuitem"`** inside a `role="menu"`
  container. The new link will be correct; fixing the existing button is a one-line a11y cleanup
  available on request.
- **`AI_PLAYBOOK.md` §4.3 is stale** — its diagram shows `worker` and `redis` containers that
  `infra/docker-compose.yml` does not contain (5 services: `db`, `migrate`, `api`, `web`, `proxy`).
  Unrelated to this work; recorded so it is not lost.

## Definition of done

- Types check, lint passes, tests pass.
- Both new tests fail without the change.
- No hardcoded values introduced; all copy in `i18n/en.ts`.
- A signer reaches the signature manager from the avatar dropdown in two clicks.
- `SignaturePanel` is mounted in exactly one place.
