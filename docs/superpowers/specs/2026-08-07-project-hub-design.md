# Project Hub, and a requisition that needs no project

**Date:** 2026-08-07
**Status:** Approved, ready for implementation plan
**Scope:** `apps/api`, `apps/web`, `packages/shared`. No migration.

---

## Why

Projects exist in the database and every user can already create one, but there is no screen for
them — a project is only ever a dropdown inside the borrow dialog and the requisition form. Nobody
can answer "what does the Rover project currently have out?" without reading the borrow log of every
product in the catalogue.

Separately, a requisition that is not charged to a project cannot be submitted from the UI, which
blocks a legitimate everyday case.

## What already exists (verified, not assumed)

| Thing | State |
|---|---|
| `projects` table | `id, name, created_by, is_active, created_at, updated_at` |
| `GET`/`POST /borrowing/projects` | No `@Roles` — **any authenticated user** can list and create |
| `ProjectsService` | Lives inside `apps/api/src/modules/borrowing/projects.service.ts` |
| `borrow_requests` | Already carries `project_id`, `product_id`, `quantity`, `returned_qty`, `status`, `purpose`, `expected_return_date`, `returned_at` |
| `requisitions.project_id` | Nullable |
| Project UI | None. Only `useProjects()` in `features/borrowing/api.ts`, consumed by `BorrowDialog` and `RequisitionFormPage` |

**The item list needs no new table.** Everything the hub must show is already in `borrow_requests`.

## The bug, precisely

A requisition with `projectId: null` **and** `departmentId: null` submits successfully against the
API — confirmed by `POST /requisitions` returning 201 and `POST /requisitions/:id/submit` returning
200. The backend is fine.

The failure is in the form. Both selects render their empty option as `<option value="">`:

```tsx
<SelectField {...form.register('projectId')}>
  <option value="">{t.requisitions.noProject}</option>
```

The form validates with `zodResolver(saveRequisitionSchema)`, where
`projectId: z.string().uuid().nullable().default(null)`. An empty string is neither `null` nor a
UUID, and `.default(null)` only fires for `undefined` — so zod rejects it client-side and the
submit never leaves the browser. `departmentId` has the identical defect.

## Decisions taken

| Question | Decision |
|---|---|
| What "delete an item" does | **Detach** — set `borrow_requests.project_id = NULL`. The borrow, the ledger and the borrowing history are untouched. |
| Grouping | **One row per borrow.** Tags are per-borrow; the same product can be part returned and part still out. |
| Who may detach | **`INVENTORY_MANAGER` / `ADMIN` only.** |
| Scope of the hub | **Both** — borrowed items *and* requisitions charged to the project, in separate sections. |

Deleting the borrow row itself was rejected: `borrow_requests` drives stock issue and return, so
removing one would orphan `stock_ledger` rows and break the `SUM(ledger) == SUM(placements)`
invariant the nightly job alerts on.

## Design

### Part 1 — The no-project fix

`apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx` only. Register both selects with
a coercion at the form boundary:

```tsx
form.register('projectId', { setValueAs: (v) => (v === '' ? null : v) })
form.register('departmentId', { setValueAs: (v) => (v === '' ? null : v) })
```

The shared schema is the API contract and does not change — the fix belongs where the empty string
is produced. No API change; the backend already accepts null.

### Part 2 — A projects module

`ProjectsService` moves out of `borrowing` into `apps/api/src/modules/projects/`, following the
module shape in `.claude/rules/20-backend.md`: `projects.module.ts`, `projects.controller.ts`,
`projects.service.ts`, `projects.repository.ts`, `dto/`.

| Endpoint | Roles | Returns |
|---|---|---|
| `GET /projects` | any | `Paginated<Project>` |
| `POST /projects` | any | `Project` (behaviour unchanged, including the OQ-09 duplicate-name warning) |
| `GET /projects/:id` | any | `ProjectDetail` |
| `GET /projects/:id/items?usage=IN_USE\|RETURNED` | any | `Paginated<ProjectItem>` |
| `DELETE /projects/:id/items/:borrowRequestId` | `INVENTORY_MANAGER`, `ADMIN` | 204 |

The old `GET`/`POST /borrowing/projects` routes are removed, not left as aliases — two routes for
one resource is how the next person ends up calling the wrong one. Only `features/borrowing/api.ts`
consumes them, and its two callers move with it.

Requisitions are **not** a new endpoint. `listRequisitionsQuerySchema` gains
`projectId: z.string().uuid().optional()` and the repository filters on it, so the hub reuses the
list that already handles pagination, permissions and shaping.

### `ProjectItem` — derived, one row per borrow

```ts
{
  borrowRequestId, borrowNo,
  productId, productCode, productName,
  quantity, returnedQty, outstandingQty,   // outstanding = quantity - returnedQty
  usage: 'IN_USE' | 'RETURNED',
  borrowerName, purpose,
  expectedReturnDate, issuedAt, returnedAt,
}
```

`usage` derives from `borrow_requests.status`:

- `RETURNED` → `RETURNED`
- `ISSUED`, `PARTIALLY_RETURNED` → `IN_USE`
- `PENDING`, `REJECTED`, `CANCELLED` → **excluded from the list entirely**

That exclusion is an assumption, not a stated requirement: a pending borrow has not reached the
project, and a rejected or cancelled one never will. Per non-negotiable #5 it is recorded as a new
entry in `docs/state/OPEN-QUESTIONS.md` as **OQ-23** and marked `// OPEN QUESTION: OQ-23` at the
derivation site rather than silently decided. (OQ-22 is the current highest.)

A `PARTIALLY_RETURNED` borrow is one row tagged `IN_USE`, showing both figures — 5 borrowed, 2
returned, 3 still out — because the outstanding quantity is the number that matters to whoever is
looking for the item.

### Detach

```sql
UPDATE borrow_requests SET project_id = NULL
WHERE id = :borrowRequestId AND project_id = :projectId
```

Conditional on the current project so two IMs on the same screen cannot double-act; zero rows
updated is a clean `NOT_FOUND` rather than a silent success. Audit-logged as `project.item.detach`.

It writes **no** `stock_ledger` row, and that is correct: nothing about stock changed, only the
project a borrow is attributed to. `StockService` is not involved, so non-negotiable #2 is not
engaged.

### Part 3 — The hub screens

`apps/web/src/features/projects/`, following the structure standardised in `84c52d1`:

```
features/projects/
├── pages/ProjectsPage.tsx        the hub: every user sees the list, and can create
├── pages/ProjectDetailPage.tsx   items in hand + requisitions
├── components/ProjectFormDialog.tsx
├── components/UsageTag.tsx       IN_USE -> text-pending, RETURNED -> text-success
└── api.ts                        query hooks + keys
```

Routes `ROUTES.projects.all` (`/projects`) and `ROUTES.projects.detail` (`/projects/:projectId`),
registered under `AppShell` with no role wrapper — every user sees the hub. A nav entry sits in the
first, unroled group alongside Dashboard and Products.

**Project detail** has two sections:

1. **Items in hand** — filter pills All / In use / Returned, driving the `usage` query parameter so
   filtering stays correct under pagination rather than filtering one page in the browser. Columns:
   item (name + code), quantity, borrower, purpose, tag, and a Remove action visible only to an IM
   or admin.
2. **Requested** — requisitions charged to this project, from `GET /requisitions?projectId=`, showing
   number, status and amount.

Both sections handle all four states: loading, empty, error-with-retry, loaded. "No items yet" is a
distinct, explained state, not an empty table.

Tag colours come from semantic tokens (`text-pending`, `text-success`), never hex.

### Part 4 — The requisition form, made premium

Visual only; no behaviour change beyond Part 1. Within the existing token set:

- Section headers with real hierarchy and breathing room instead of thin bordered strips
- Panel elevation via `--shadow-panel`, consistent radius via `--radius-panel`
- Item rows aligned on a proper grid, with the line total right-aligned and the unit clear
- A totals bar that reads as a summary rather than a table footer
- A sticky action footer so Submit is reachable on a long form
- Inline guidance where the form is currently silent (what "Not in the catalogue" means)

Constraints that bound this: no hex, no arbitrary Tailwind values, no user-visible literal in JSX.
Anything that cannot be expressed in the token set is out of scope for this change.

## Testing

**API (integration, real Postgres):**

- `usage` derivation for each of the six borrow statuses, including that `PENDING`, `REJECTED` and
  `CANCELLED` are absent from the list
- A `PARTIALLY_RETURNED` borrow appears once, tagged `IN_USE`, with correct `outstandingQty`
- `?usage=IN_USE` and `?usage=RETURNED` each return only their own rows
- Detach nulls `project_id`, leaves the borrow and `stock_ledger` untouched, and writes an audit row
- Detach as `GENERAL` and as `APPROVER` → 403; as `INVENTORY_MANAGER` → 204
- Detaching a borrow that belongs to another project → 404, nothing modified
- `GET /requisitions?projectId=` returns only that project's requisitions

Scope every assertion by an id created in the test: `resetData` cannot delete requisitions,
departments or users, so the test database accumulates them and "exactly one row" would flake.

**Web (unit):**

- `ProjectsPage` renders the list and the create action for a `GENERAL`-only user
- `ProjectDetailPage` filter pills change the query parameter
- `UsageTag` maps both statuses to the right token
- Remove action is absent for `GENERAL`, present for `INVENTORY_MANAGER`
- **The requisition form submits with "No project" selected** — this test fails before Part 1

## Definition of done

- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; integration suite shows no new failures against
  the 8 pre-existing ones in `demo-accounts`, `login-backoff`, `reports`, `throttling`
- Each new behaviour has a test that fails without its change
- No hardcoded values: copy in `i18n/en.ts`, colours from tokens, routes from `paths.ts`
- The `PENDING`/`REJECTED`/`CANCELLED` exclusion is recorded as OQ-23 and marked in code
- Detach is proven not to touch `stock_ledger`
- `docs/state/DECISIONS.md` records the detach-not-delete decision with its reasoning

## Out of scope

- Any migration. Nothing here needs a schema change.
- Editing or archiving projects, and project budgets or spend rollups.
- Showing requisition items individually in the hub — the requisitions section lists requisitions,
  not their lines.
- Changing how borrowing itself works. The hub only reads and re-attributes.
- `SignaturePanel` test coverage, the dropdown ARIA gap, and the stale `AI_PLAYBOOK.md` §4.3
  diagram — recorded debt from earlier work, still deliberately deferred.
