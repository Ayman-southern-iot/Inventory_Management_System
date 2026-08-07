# Signature Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Inventory Manager and approvers a findable place to manage the signature they apply to BOMs, by mounting the already-working `SignaturePanel` on a real account page reachable from the header.

**Architecture:** Frontend only. The signature API (`GET`/`POST`/`DELETE /api/v1/me/signature`), the role gate, the frozen-snapshot data model and the BOM PDF rendering are all built and working — none of it is touched. This plan adds a route, a page that composes the existing `SignaturePanel`, a link in the avatar dropdown, and removes the duplicate mount from the change-password screen so the setting has exactly one home.

**Tech Stack:** React 18, TypeScript (strict), React Router v6, TanStack Query, Tailwind with design tokens, Vitest + React Testing Library.

## Global Constraints

- **No user-visible string literals in JSX.** All copy comes from `apps/web/src/i18n/en.ts`.
- **No hex colours and no arbitrary Tailwind values.** Semantic tokens only (`text-ink`, `text-ink-muted`, `text-ink-subtle`, `bg-surface-muted`, `rounded-[--radius-control]`).
- **No route URL string literals.** Every path comes from `apps/web/src/routes/paths.ts`.
- **Props explicitly typed.** No `React.FC`, no implicit `any`.
- **Do not modify** `SignaturePanel.tsx`, `features/profile/api.ts`, any API code, any migration, or anything under `apps/api`.
- **Do not change** the existing `ROUTES.changePassword` key — `ProtectedRoute` depends on it for the forced-password-change redirect.
- Commands run from the repo root: `pnpm --filter @ims/web test`, `pnpm typecheck`, `pnpm lint`.
- Conventional commits: `feat(web): …`, `refactor(web): …`.

**Already present — do not re-add:** `t.nav.account` (`'My account'`) exists in `en.ts` and is currently unused. Use it; do not create a second key.

---

### Task 1: The account page

**Files:**
- Modify: `apps/web/src/routes/paths.ts` (add `account` block after `admin`, before the closing `} as const;`)
- Modify: `apps/web/src/i18n/en.ts` (add `account` block immediately before the existing `signature: {` block)
- Create: `apps/web/src/components/UserIdentity.tsx`
- Create: `apps/web/src/features/profile/ProfilePage.tsx`
- Create: `apps/web/src/features/profile/ProfilePage.test.tsx`
- Modify: `apps/web/src/App.tsx` (import + one route)

**Interfaces:**
- Consumes: `SignaturePanel` from `@/features/profile/SignaturePanel` (no props); `useAuth()` from `@/features/auth/auth-context` returning `{ user: AuthUser | null, hasRole: (...roles: Role[]) => boolean }`.
- Produces: `ROUTES.account.profile` (string `'/account/profile'`) used by Task 2; `t.account.title` and `t.account.changePassword`; exported component `ProfilePage` (no props); exported component `UserIdentity` with props `{ user: AuthUser }`, **also consumed by Task 2**.

`UserIdentity` lives at `components/UserIdentity.tsx`, not under `components/ui/` — that directory is
shared primitives only, and this knows about `AuthUser` and roles. `components/ErrorBoundary.tsx` is
the precedent for a shared non-primitive at that level.

- [ ] **Step 1: Add the route constant**

In `apps/web/src/routes/paths.ts`, insert the `account` block after the `admin` block and before `} as const;`:

```ts
  admin: {
    users: '/admin/users',
    departments: '/admin/departments',
    settings: '/admin/settings',
    auditLog: '/admin/audit-log',
  },
  /** Per-user settings. `changePassword` stays top-level: ProtectedRoute redirects to it. */
  account: {
    profile: '/account/profile',
  },
} as const;
```

- [ ] **Step 2: Add the copy**

In `apps/web/src/i18n/en.ts`, insert this block immediately **before** the existing `signature: {` block:

```ts
  account: {
    title: 'My account',
    changePassword: 'Change your password',
  },
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/features/profile/ProfilePage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ProfilePage } from './ProfilePage';

let currentUser: AuthUser | null = null;

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    user: currentUser,
    hasRole: (...roles: Role[]) => roles.some((role) => currentUser?.roles.includes(role)),
  }),
}));

// What is under test is whether the panel is mounted, not what it fetches.
vi.mock('@/features/profile/api', () => ({
  useMySignature: () => ({ data: { signature: null }, isPending: false }),
  useUploadSignature: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSignature: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function userWithRoles(roles: Role[]): AuthUser {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'person@ims.local',
    fullName: 'Test Person',
    designation: 'Engineer',
    departmentId: null,
    departmentName: null,
    roles,
    mustChangePassword: false,
  };
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  it('shows the signature panel to an inventory manager', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.INVENTORY_MANAGER]);
    renderPage();
    expect(screen.getByRole('heading', { name: t.signature.title })).toBeInTheDocument();
  });

  it('shows the signature panel to an approver', () => {
    currentUser = userWithRoles([Role.GENERAL, Role.APPROVER]);
    renderPage();
    expect(screen.getByRole('heading', { name: t.signature.title })).toBeInTheDocument();
  });

  it('hides the signature panel from a general user', () => {
    currentUser = userWithRoles([Role.GENERAL]);
    renderPage();
    expect(screen.queryByRole('heading', { name: t.signature.title })).not.toBeInTheDocument();
  });

  it('offers the way to change password to everyone', () => {
    currentUser = userWithRoles([Role.GENERAL]);
    renderPage();
    expect(screen.getByRole('link', { name: t.account.changePassword })).toBeInTheDocument();
  });

  it('renders nothing when there is no user rather than crashing', () => {
    currentUser = null;
    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @ims/web test -- ProfilePage`
Expected: FAIL — `Failed to resolve import "./ProfilePage"`.

- [ ] **Step 5a: Write the shared identity block**

Create `apps/web/src/components/UserIdentity.tsx`. It returns a fragment so each call site owns its
own container — the dropdown is a narrow popover, the account page a padded panel.

```tsx
import type { AuthUser } from '@ims/shared';
import { Badge } from '@/components/ui/primitives';
import { t } from '@/i18n/en';

/**
 * Who the signed-in user is: name, email, designation, roles. Rendered both in the header dropdown
 * and on the account page, which must not drift apart — a role badge showing in one place and not
 * the other reads as a permissions bug rather than a markup one.
 */
export function UserIdentity({ user }: { user: AuthUser }) {
  return (
    <>
      <p className="text-sm font-medium text-ink">{user.fullName}</p>
      <p className="text-xs text-ink-muted">{user.email}</p>
      <p className="mt-1 text-xs text-ink-subtle">{user.designation}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {user.roles.map((role) => (
          <Badge key={role} tone="info">
            {t.roles[role]}
          </Badge>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 5b: Write the page**

Create `apps/web/src/features/profile/ProfilePage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Role } from '@ims/shared';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { UserIdentity } from '@/components/UserIdentity';
import { t } from '@/i18n/en';
import { useAuth } from '@/features/auth/auth-context';
import { ROUTES } from '@/routes/paths';
import { SignaturePanel } from './SignaturePanel';

/**
 * The signed-in user's own account: who they are, the signature applied when they approve, and
 * the way to their password.
 *
 * The route is deliberately not role-gated — everyone has an account. The signature panel gates
 * itself, because the API refuses a non-signer and showing a control that 403s is worse than not
 * showing it at all.
 */
export function ProfilePage() {
  const { user, hasRole } = useAuth();
  const canSign = hasRole(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t.account.title} />

      <Panel className="p-5">
        <UserIdentity user={user} />
      </Panel>

      {canSign && (
        <div className="mt-8">
          <SignaturePanel />
        </div>
      )}

      <Link
        to={ROUTES.changePassword}
        className="mt-8 flex items-center gap-2 text-sm text-ink-muted hover:text-ink"
      >
        <KeyRound aria-hidden className="size-4" />
        {t.account.changePassword}
      </Link>
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @ims/web test -- ProfilePage`
Expected: PASS — 5 tests.

- [ ] **Step 7: Register the route**

In `apps/web/src/App.tsx`, add the import next to the other feature page imports (near line 10, alongside `ChangePasswordPage`):

```tsx
import { ProfilePage } from '@/features/profile/ProfilePage';
```

Then add the route directly beneath the existing change-password route (line 69), inside the `<Route element={<AppShell />}>` block and **outside** any `ProtectedRoute` role wrapper:

```tsx
                    <Route path={ROUTES.changePassword} element={<ChangePasswordPage />} />
                    <Route path={ROUTES.account.profile} element={<ProfilePage />} />
```

- [ ] **Step 8: Verify types and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0, no warnings.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/routes/paths.ts apps/web/src/i18n/en.ts \
        apps/web/src/components/UserIdentity.tsx \
        apps/web/src/features/profile/ProfilePage.tsx \
        apps/web/src/features/profile/ProfilePage.test.tsx \
        apps/web/src/App.tsx
git commit -m "feat(web): account page hosting the signature manager"
```

---

### Task 2: The way in

**Files:**
- Modify: `apps/web/src/components/layout/AppShell.tsx:1-30` (add `UserRound` + `UserIdentity`, drop `Badge`), `:151-176` (dropdown body)
- Modify: `apps/web/src/components/layout/AppShell.test.tsx` (append one test to the existing `describe`)

**Interfaces:**
- Consumes: `ROUTES.account.profile`, `t.nav.account`, and `UserIdentity` (props `{ user: AuthUser }`, returns a fragment) from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('AppShell navigation', …)` block in `apps/web/src/components/layout/AppShell.test.tsx`. The dropdown renders only once opened, so the test clicks the trigger first — its accessible name is the user's full name.

```tsx
  it('offers My account in the user menu', async () => {
    currentUser = userWithRoles([Role.GENERAL]);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Test Person' }));

    const link = screen.getByRole('menuitem', { name: t.nav.account });
    expect(link).toHaveAttribute('href', ROUTES.account.profile);
  });
```

Add these two imports to the top of the same file:

```tsx
import userEvent from '@testing-library/user-event';
import { ROUTES } from '@/routes/paths';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ims/web test -- AppShell`
Expected: FAIL — `Unable to find an accessible element with the role "menuitem"`.

- [ ] **Step 3: Fix the imports**

In `apps/web/src/components/layout/AppShell.tsx`:

Add `UserRound` to the existing `lucide-react` import block (it is alphabetical — place it after `Users`):

```tsx
  Users,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
```

Add the shared identity component:

```tsx
import { UserIdentity } from '@/components/UserIdentity';
```

**Delete** the now-unused `Badge` import (line 27). Step 4 removes its only use — the role-badge map
inside the dropdown. `NavBadge`'s `AwaitingApprovalBadge` / `PendingBorrowBadge` are unrelated and
stay.

```tsx
import { Badge } from '@/components/ui/primitives';   // ← delete this line
```

- [ ] **Step 4: Swap the identity block and add the link**

In the same file, inside the `role="menu"` div, **replace** the four inline identity elements
(`user.fullName`, `user.email`, `user.designation`, and the role-badge `<div>` — currently lines
156-166) with `<UserIdentity />`, then add the `NavLink` before the Sign out `<Button>`. The result:

```tsx
                <UserIdentity user={user} />
                {/* Closes the menu on navigate, or it hangs over the page it just opened. */}
                <NavLink
                  to={ROUTES.account.profile}
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="mt-3 flex items-center gap-2 rounded-[--radius-control] px-2 py-1.5 text-sm text-ink hover:bg-surface-muted"
                >
                  <UserRound aria-hidden className="size-4 text-ink-subtle" />
                  {t.nav.account}
                </NavLink>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  icon={<LogOut aria-hidden className="size-4" />}
                  onClick={() => void signOut()}
                >
                  {t.auth.signOut}
                </Button>
```

`NavLink` and `ROUTES` are already imported in this file.

- [ ] **Step 4b: Confirm the duplication is actually gone**

Run: `grep -n "t.roles\[role\]" apps/web/src`
Expected: exactly one hit — `apps/web/src/components/UserIdentity.tsx`. A hit in `AppShell.tsx` or
`ProfilePage.tsx` means the swap was additive rather than a replacement.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @ims/web test -- AppShell`
Expected: PASS — 5 tests (4 existing + 1 new).

- [ ] **Step 6: Verify types and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/layout/AppShell.tsx \
        apps/web/src/components/layout/AppShell.test.tsx
git commit -m "feat(web): reach My account from the user menu"
```

---

### Task 3: One home for the signature

**Files:**
- Modify: `apps/web/src/features/auth/ChangePasswordPage.tsx:1-15` (imports), `:31-32` (unused predicate), `:108-116` (panel block)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

Two mounts of the same setting is the defect this whole plan exists to fix. With Task 1 shipped, the copy on the change-password page is the duplicate, so it goes.

- [ ] **Step 1: Remove the panel block**

In `apps/web/src/features/auth/ChangePasswordPage.tsx`, delete these lines entirely (they currently sit between the closing `</Panel>` and the closing `</div>`):

```tsx
      {/* Only people who actually sign things get the panel — the API refuses everyone else
          anyway, and showing a control that 403s is worse than not showing it. */}
      {canSign && (
        <div className="mt-8">
          <SignaturePanel />
        </div>
      )}
```

The component now ends:

```tsx
        </form>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 2: Remove what is now unused**

Delete this line (was line 14):

```tsx
import { SignaturePanel } from '@/features/profile/SignaturePanel';
```

Delete the `canSign` line (was line 32) and drop `hasRole` from the destructure:

```tsx
  const { user, adoptSession } = useAuth();
```

Drop `Role` from the `@ims/shared` import, leaving:

```tsx
import { changePasswordSchema, type LoginResponse } from '@ims/shared';
```

- [ ] **Step 3: Verify nothing else referenced it**

Run: `grep -rn "SignaturePanel" apps/web/src --include=*.tsx`
Expected: exactly two hits — its own definition `features/profile/SignaturePanel.tsx` and the mount in `features/profile/ProfilePage.tsx`. No hit in `features/auth/`.

- [ ] **Step 4: Run the full web suite**

Run: `pnpm --filter @ims/web test`
Expected: PASS, no failures. `DecisionDialog.test.tsx` mocks `@/features/profile/api` directly and is unaffected by this move.

- [ ] **Step 5: Verify types and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0. Lint catches a leftover unused `Role` or `hasRole` import — if it reports one, remove it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/auth/ChangePasswordPage.tsx
git commit -m "refactor(web): single home for the signature manager"
```

---

## Manual verification

The dev stack is already running (`pnpm dev`, api on 3000, web on 5173). Note `localhost:5173` works and `127.0.0.1:5173` does not — the dev server binds IPv6 only.

1. Open `http://localhost:5173`, sign in as `inventory@southerniot.net` / `demo`.
2. Click the name in the top-right → **My account** appears in the dropdown → click it.
3. The page shows name, email, designation, role badges, and the **Signature** panel. `sign.jpg` should already be on file, uploaded 2026-07-31.
4. Press **Replace signature**, pick a PNG or JPEG under 2 MB → toast reads "Signature saved", preview updates.
5. Press **Remove** → toast reads "Signature removed", the panel falls back to "No signature uploaded yet."
6. Re-upload so the demo data is not left degraded.
7. Sign out, sign in as `saad@southerniot.net` / `demo` (General only) → **My account** still appears, page renders, **no** Signature panel.
8. Sign in as `prithu@southeriot.net` / `demo` (Approver) → open a pending requisition → the **Approve with signature** button is enabled, and the BOM generated from it carries the signature image in the footprints block.

## Definition of done

- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @ims/web test` all pass.
- Both new tests fail without their change (verified at Task 1 Step 4 and Task 2 Step 2).
- `SignaturePanel` is mounted in exactly one place.
- No new user-visible literal in JSX; no new route string outside `paths.ts`.
- Three commits, one per task.

## Out of scope — do not do these here

- Writing unit tests for `SignaturePanel` itself (upload/preview/remove are untested; real debt, separate change).
- Marking the existing Sign out button `role="menuitem"` (one-line a11y fix, separate change).
- Correcting the stale `worker`/`redis` diagram in `AI_PLAYBOOK.md` §4.3.
