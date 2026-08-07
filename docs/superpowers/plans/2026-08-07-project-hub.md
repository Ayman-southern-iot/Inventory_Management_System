# Project Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user a Project Hub that shows what each project has borrowed (tagged in use / returned, filterable, with quantities) and what it has requisitioned — and let a requisition be submitted with no project selected.

**Architecture:** The item list is *derived*, not stored: `borrow_requests` already carries `project_id`, `product_id`, `quantity`, `returned_qty` and `status`, so there is no migration and no new table. `ProjectsService` moves out of `modules/borrowing/` into its own module with the hub's read endpoints plus a detach endpoint. "Removing" an item sets `project_id = NULL` — the borrow, the stock ledger and the borrow history are never touched.

**Tech Stack:** NestJS + Kysely + Postgres 16, React 18 + TypeScript (strict) + TanStack Query + React Hook Form + Tailwind design tokens, Vitest + React Testing Library.

## Global Constraints

- **No migration in this plan.** Nothing here needs a schema change. If you think you need one, stop and escalate.
- **Only `StockService` writes stock.** Detach touches `borrow_requests.project_id` and nothing else. Write no `stock_ledger` row.
- **No user-visible string literals in JSX.** All copy from `apps/web/src/i18n/en.ts`.
- **No hex colours, no arbitrary Tailwind values.** Semantic tokens only: `text-ink`, `text-ink-muted`, `text-ink-subtle`, `text-success`, `text-pending`, `bg-surface`, `bg-surface-muted`, `bg-brand-subtle`, `text-brand`, `border-border`, `rounded-[--radius-control]`, `rounded-[--radius-panel]`, `shadow-[--shadow-panel]`.
- **No route URL literals.** All paths from `apps/web/src/routes/paths.ts`.
- **Zod at the controller boundary**, types inferred with `z.infer`, never declared twice.
- **The actor is always `req.user.id`.** Never trust a client-supplied user id.
- **`@Roles()` for coarse checks**; ownership/state checks live in the service.
- Every list endpoint paginated. Every data screen handles loading · empty · error-with-retry · loaded.
- Props explicitly typed. No `React.FC`, no implicit `any`.
- Conventional commits: `feat(projects): …`, `fix(requisitions): …`, `refactor(web): …`.
- Tests: scope every assertion to an id you created. `resetData` cannot delete requisitions, departments or users, so the test DB accumulates them — never assert "exactly one row" or "it is on page one".
- Integration runs take ~90s and have **8 pre-existing failures** in `demo-accounts`, `login-backoff`, `reports`, `throttling`. Those are not yours. Redirect output to a file and grep; do not stream.

**Commands** (from repo root):
- `pnpm typecheck` · `pnpm lint` · `pnpm test`
- `pnpm --filter @ims/api test:int` — integration, real Postgres
- `pnpm --filter @ims/web test -- <pattern>` — one web test file
- `pnpm db:up` first if Docker was restarted; `docker info` to check the daemon is alive

---

### Task 1: A requisition submits with no project

The backend already accepts `projectId: null` — verified, `POST /requisitions` returns 201 and `submit` returns 200. The blocker is the form: `<option value="">` yields `""`, which fails `z.string().uuid().nullable()` because `""` is neither `null` nor a UUID, and `.default(null)` only fires for `undefined`. `departmentId` has the identical defect.

**Files:**
- Modify: `apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx` (the two `SelectField` registrations, ~lines 164 and 173)
- Create: `apps/web/src/features/requisitions/pages/RequisitionFormPage.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/requisitions/pages/RequisitionFormPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/i18n/en';
import { RequisitionFormPage } from './RequisitionFormPage';

const createSpy = vi.fn();

vi.mock('../api', () => ({
  useRequisition: () => ({ data: undefined, isPending: false }),
  useCreateRequisition: () => ({
    mutateAsync: (input: unknown) => {
      createSpy(input);
      return Promise.resolve({ id: 'req-1' });
    },
    isPending: false,
  }),
  useUpdateRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/admin/api', () => ({
  useDepartments: () => ({ data: { items: [] }, isPending: false }),
}));

vi.mock('@/features/borrowing/api', () => ({
  useProjects: () => ({ data: [], isPending: false }),
}));

vi.mock('@/features/inventory/api', () => ({
  useProducts: () => ({ data: { items: [] }, isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RequisitionFormPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RequisitionFormPage', () => {
  it('saves with a null project when the user picks "No project"', async () => {
    createSpy.mockClear();
    const user = userEvent.setup();
    renderForm();

    // Selecting the empty option EXPLICITLY is what reproduces the bug. The form's
    // defaultValues already hold null, and React Hook Form keeps values in its own state — so a
    // test that never touches the select would pass against the unfixed code and prove nothing.
    // The change event is what puts '' into form state, which is what zod rejects.
    await user.selectOptions(screen.getByLabelText(t.requisitions.project), '');
    await user.selectOptions(screen.getByLabelText(t.requisitions.department), '');

    // One item is the minimum the schema accepts.
    await user.type(screen.getByLabelText(t.requisitions.itemName), 'Test widget');
    await user.type(screen.getByLabelText(t.requisitions.quantity), '2');
    await user.type(screen.getByLabelText(t.requisitions.unitPrice), '100');

    await user.click(screen.getByRole('button', { name: t.common.saveDraft }));

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[0]).toMatchObject({ projectId: null, departmentId: null });
  });
});
```

Both selects must be exercised, because both carry the defect. If `selectOptions` cannot find an
option with value `''`, the empty option's value is not `''` — read the JSX and use whatever it
actually is rather than changing the component to suit the test.

The three field labels and the button label must match `en.ts` exactly. Before running, confirm the real keys:

Run: `grep -nE "itemName:|quantity:|unitPrice:|saveDraft:" apps/web/src/i18n/en.ts`

If a key differs (for example the draft button is `t.requisitions.saveDraft`, not `t.common.saveDraft`), use the real one — do not invent a key, and do not add one.

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `pnpm --filter @ims/web test -- RequisitionFormPage`
Expected: FAIL — `createSpy` was not called, because zod rejected `projectId: ""`.

**If it PASSES here, stop.** A passing test before the fix means the bug was not reproduced and the
test is worthless. The usual cause is that the `selectOptions` calls did not fire a change event, so
form state kept its `null` default. Fix the test until it fails for the right reason before touching
the component. If it fails on a missing label instead, correct the label to the real i18n key and
re-run until the failure is the assertion, not the query.

- [ ] **Step 3: Coerce the empty option to null**

In `apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx`, add the helper just above the component:

```tsx
/**
 * A `<select>` cannot hold null, so its "none" option carries `''`. The shared schema is the
 * API contract and correctly rejects that — `''` is neither a uuid nor null, and `.default(null)`
 * only fires for `undefined`. Coerce at the boundary where the empty string is produced.
 */
const emptyToNull = { setValueAs: (value: string) => (value === '' ? null : value) };
```

Then pass it to both registrations:

```tsx
<SelectField label={t.requisitions.department} {...form.register('departmentId', emptyToNull)}>
```

```tsx
<SelectField label={t.requisitions.project} {...form.register('projectId', emptyToNull)}>
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @ims/web test -- RequisitionFormPage`
Expected: PASS, 1 test.

- [ ] **Step 5: Verify types and lint**

Run: `pnpm typecheck`
Run: `npx eslint apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx apps/web/src/features/requisitions/pages/RequisitionFormPage.test.tsx --max-warnings 0`
Expected: both exit 0. Do **not** run `pnpm lint` for this task's gate — see Global Constraints on the pre-existing failures. (`pnpm lint` should be green; if it reports anything in a file you did not touch, leave it.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx \
        apps/web/src/features/requisitions/pages/RequisitionFormPage.test.tsx
git commit -m "fix(requisitions): submit with no project or department selected"
```

---

### Task 2: Shared contracts for the hub

**Files:**
- Create: `packages/shared/src/contracts/projects.ts`
- Modify: `packages/shared/src/index.ts` (one export line)
- Modify: `packages/shared/src/contracts/requisitions.ts` (add `projectId` to the list query)

Existing `projectSchema` and `createProjectSchema` stay in `contracts/borrowing.ts`. Everything is re-exported through the barrel, so consumers importing from `@ims/shared` cannot tell the difference — moving them would be churn with no consumer benefit.

**Interfaces:**
- Produces, consumed by Tasks 3–6:
  - `ProjectUsage` — `{ IN_USE: 'IN_USE', RETURNED: 'RETURNED' }` const object plus matching type
  - `projectUsageSchema` — `z.enum`
  - `ProjectItem` — the derived row type (fields listed below)
  - `ListProjectItemsQuery` — `{ page, limit, usage?: ProjectUsage }`
  - `ProjectDetail` — `Project` plus `inUseCount` and `returnedCount`
  - `ListRequisitionsQuery.projectId?: string`

- [ ] **Step 1: Write the contracts**

Create `packages/shared/src/contracts/projects.ts`:

```ts
import { z } from 'zod';
import { paginationQuerySchema } from './common.js';

/**
 * What a project is currently doing with a borrowed item. Derived from `borrow_requests.status`,
 * never stored: RETURNED means the borrow is closed, IN_USE means units are still out.
 */
export const ProjectUsage = {
  IN_USE: 'IN_USE',
  RETURNED: 'RETURNED',
} as const;
export type ProjectUsage = (typeof ProjectUsage)[keyof typeof ProjectUsage];

export const projectUsageSchema = z.enum(
  Object.values(ProjectUsage) as [ProjectUsage, ...ProjectUsage[]],
);

/**
 * One borrow, as it appears under a project. One row per borrow rather than per product,
 * because the tag is a property of the borrow: the same product can be part returned and
 * part still out, and a single row could not carry both truthfully.
 */
export const projectItemSchema = z.object({
  borrowRequestId: z.string().uuid(),
  borrowNo: z.string(),
  productId: z.string().uuid(),
  productCode: z.string(),
  productName: z.string(),
  /** As borrowed. */
  quantity: z.number().int(),
  returnedQty: z.number().int(),
  /** quantity - returnedQty. The number that matters when hunting for the item. */
  outstandingQty: z.number().int(),
  usage: projectUsageSchema,
  borrowerName: z.string(),
  purpose: z.string().nullable(),
  expectedReturnDate: z.string().nullable(),
  issuedAt: z.string().nullable(),
  returnedAt: z.string().nullable(),
});
export type ProjectItem = z.infer<typeof projectItemSchema>;

export const listProjectItemsQuerySchema = paginationQuerySchema.extend({
  /** Absent means both. Filtering server-side keeps it correct across pages. */
  usage: projectUsageSchema.optional(),
});
export type ListProjectItemsQuery = z.infer<typeof listProjectItemsQuerySchema>;

export const projectDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  inUseCount: z.number().int(),
  returnedCount: z.number().int(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
```

- [ ] **Step 2: Export it from the barrel**

In `packages/shared/src/index.ts`, add after the `borrowing` line (the file uses `.js` extensions — keep that):

```ts
export * from './contracts/projects.js';
```

- [ ] **Step 3: Add the requisition filter**

In `packages/shared/src/contracts/requisitions.ts`, add one line inside `listRequisitionsQuerySchema`:

```ts
export const listRequisitionsQuerySchema = paginationQuerySchema.extend({
  status: requisitionStatusSchema.optional(),
  search: z.string().trim().max(160).optional(),
  /** Scopes the list to one project — powers the Project Hub's requisitions section. */
  projectId: z.string().uuid().optional(),
  /** The requester's own list. Forced on for callers with no approval role. */
  mine: queryBoolean(false),
  /** The approver/IM queue: things waiting on *me* right now. */
  awaitingMe: queryBoolean(false),
});
```

- [ ] **Step 4: Build shared and typecheck**

Run: `pnpm --filter @ims/shared build && pnpm typecheck`
Expected: both exit 0. `@ims/api` and `@ims/web` consume the built `dist`, so the build must run before their typecheck sees the new types.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/contracts/projects.ts packages/shared/src/index.ts \
        packages/shared/src/contracts/requisitions.ts
git commit -m "feat(shared): contracts for project items and the requisition project filter"
```

---

### Task 3: The projects module

`ProjectsService` moves out of `modules/borrowing/` and gains the hub's reads plus detach. The old `GET`/`POST /borrowing/projects` routes are removed — two routes for one resource is how the next person calls the wrong one.

**Files:**
- Create: `apps/api/src/modules/projects/projects.module.ts`
- Create: `apps/api/src/modules/projects/projects.controller.ts`
- Create: `apps/api/src/modules/projects/projects.repository.ts`
- Move: `apps/api/src/modules/borrowing/projects.service.ts` → `apps/api/src/modules/projects/projects.service.ts` (use `git mv`)
- Modify: `apps/api/src/modules/borrowing/borrowing.module.ts` (drop `ProjectsService`)
- Modify: `apps/api/src/modules/borrowing/borrowing.controller.ts` (delete the two project routes and their imports)
- Modify: `apps/api/src/app.module.ts` (register `ProjectsModule`)
- Modify: `apps/api/src/modules/borrowing/borrowing.errors.ts` — leave `DuplicateProjectNameError` where it is; the moved service imports it from `../borrowing/borrowing.errors`
- Create: `apps/api/test/projects.int-spec.ts`
- Modify: `docs/state/OPEN-QUESTIONS.md` (add OQ-23)
- Modify: `docs/state/DECISIONS.md` (record detach-not-delete)

**Interfaces:**
- Consumes from Task 2: `ProjectUsage`, `projectUsageSchema`, `ProjectItem`, `listProjectItemsQuerySchema`, `ListProjectItemsQuery`, `ProjectDetail`; plus existing `createProjectSchema`, `CreateProjectInput`, `Project`, `Paginated`.
- Produces, consumed by Tasks 5–6:
  - `GET /projects` → `Paginated<Project>`
  - `POST /projects` → `Project`
  - `GET /projects/:id` → `ProjectDetail`
  - `GET /projects/:id/items?page&limit&usage` → `Paginated<ProjectItem>`
  - `DELETE /projects/:id/items/:borrowRequestId` → 204, roles `INVENTORY_MANAGER` and `ADMIN`

- [ ] **Step 1: Move the service**

```bash
git mv apps/api/src/modules/borrowing/projects.service.ts apps/api/src/modules/projects/projects.service.ts
```

Then fix its three relative imports, which are now one level differently placed. They currently read `'../../database/database.module'`, `'../../database/create-db'`, `'../../common/errors'`, `'../audit/audit.service'`, `'../audit/audit-context'` — those depths are unchanged, so leave them. Only the errors import moves:

```ts
import { DuplicateProjectNameError } from '../borrowing/borrowing.errors';
```

- [ ] **Step 2: Write the failing integration test**

Create `apps/api/test/projects.int-spec.ts`. Read `apps/api/test/borrowing.int-spec.ts` first and copy its bootstrapping verbatim — the `createTestApp`, `httpClient`, `login`, `createUser` and borrow-creation helpers already exist in `./app` and `./factories`, and re-inventing them is how a suite becomes flaky.

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectUsage, Role } from '@ims/shared';
import { createTestApp, httpClient, type HttpClient, type TestApp } from './app';
import { createUser, login, resetData } from './factories';

describe('projects hub', () => {
  let app: TestApp;
  let im: HttpClient;
  let general: HttpClient;

  beforeAll(async () => {
    app = await createTestApp();
    await resetData(app);
    const imUser = await createUser(app, { roles: [Role.GENERAL, Role.INVENTORY_MANAGER] });
    const generalUser = await createUser(app, { roles: [Role.GENERAL] });
    im = httpClient(app, await login(app, imUser));
    general = httpClient(app, await login(app, generalUser));
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists a project and derives IN_USE for an issued borrow', async () => {
    const project = await general.post('/projects', { name: `Hub ${Date.now()}` });
    expect(project.status).toBe(201);

    // Borrow 5, issue them, return 2 -> PARTIALLY_RETURNED, still IN_USE with 3 outstanding.
    const borrow = await createIssuedBorrow(im, general, project.body.id, 5);
    await im.post(`/borrowing/${borrow.id}/return`, { quantity: 2, condition: 'GOOD' });

    const items = await general.get(`/projects/${project.body.id}/items`);
    expect(items.status).toBe(200);
    const row = items.body.items.find((i: { borrowRequestId: string }) => i.borrowRequestId === borrow.id);
    expect(row).toMatchObject({
      usage: ProjectUsage.IN_USE,
      quantity: 5,
      returnedQty: 2,
      outstandingQty: 3,
    });
  });

  it('excludes a pending borrow, because it has not reached the project (OQ-23)', async () => {
    const project = await general.post('/projects', { name: `Pending ${Date.now()}` });
    const pending = await createPendingBorrow(general, project.body.id, 1);

    const items = await general.get(`/projects/${project.body.id}/items`);
    expect(
      items.body.items.some((i: { borrowRequestId: string }) => i.borrowRequestId === pending.id),
    ).toBe(false);
  });

  it('filters to RETURNED only', async () => {
    const project = await general.post('/projects', { name: `Filter ${Date.now()}` });
    const open = await createIssuedBorrow(im, general, project.body.id, 1);
    const closed = await createIssuedBorrow(im, general, project.body.id, 1);
    await im.post(`/borrowing/${closed.id}/return`, { quantity: 1, condition: 'GOOD' });

    const returned = await general.get(
      `/projects/${project.body.id}/items?usage=${ProjectUsage.RETURNED}`,
    );
    const ids = returned.body.items.map((i: { borrowRequestId: string }) => i.borrowRequestId);
    expect(ids).toContain(closed.id);
    expect(ids).not.toContain(open.id);
  });

  it('refuses detach to a general user and allows it to the IM, without touching stock', async () => {
    const project = await general.post('/projects', { name: `Detach ${Date.now()}` });
    const borrow = await createIssuedBorrow(im, general, project.body.id, 1);

    const ledgerBefore = await countLedgerRows(app, borrow.productId);

    expect((await general.del(`/projects/${project.body.id}/items/${borrow.id}`)).status).toBe(403);
    expect((await im.del(`/projects/${project.body.id}/items/${borrow.id}`)).status).toBe(204);

    // Gone from the project, still a borrow, and stock history untouched.
    const items = await general.get(`/projects/${project.body.id}/items`);
    expect(
      items.body.items.some((i: { borrowRequestId: string }) => i.borrowRequestId === borrow.id),
    ).toBe(false);
    expect((await im.get(`/borrowing/${borrow.id}`)).status).toBe(200);
    expect(await countLedgerRows(app, borrow.productId)).toBe(ledgerBefore);
  });

  it('404s when the borrow belongs to a different project', async () => {
    const a = await general.post('/projects', { name: `A ${Date.now()}` });
    const b = await general.post('/projects', { name: `B ${Date.now()}` });
    const borrow = await createIssuedBorrow(im, general, a.body.id, 1);

    expect((await im.del(`/projects/${b.body.id}/items/${borrow.id}`)).status).toBe(404);
    // Still attached to A.
    const items = await general.get(`/projects/${a.body.id}/items`);
    expect(
      items.body.items.some((i: { borrowRequestId: string }) => i.borrowRequestId === borrow.id),
    ).toBe(true);
  });
});
```

`createIssuedBorrow`, `createPendingBorrow` and `countLedgerRows` are helpers you write at the bottom of this spec file. Model them on how `borrowing.int-spec.ts` creates a product, a placement and a borrow, then has the IM approve it — do not duplicate stock logic, call the same endpoints the app does. Every project name carries `Date.now()` because the test database accumulates rows.

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @ims/api test:int > /tmp/int.log 2>&1; grep -E "projects hub|Tests " /tmp/int.log | tail -8`
Expected: the `projects hub` tests fail — `/projects` does not exist yet (404).

- [ ] **Step 4: Write the repository**

Create `apps/api/src/modules/projects/projects.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  BorrowStatus,
  ProjectUsage,
  type ListProjectItemsQuery,
  type ProjectItem,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';

/**
 * A borrow only counts as the project's once it has actually been handed over. PENDING has not
 * been approved, and REJECTED and CANCELLED never happened — listing them would put items in a
 * project that nobody can find on a shelf.
 *
 * OPEN QUESTION: OQ-23 — whether a pending borrow should appear, greyed, so a requester can see
 * their request against the project. Excluded for now as the smaller, defensible default.
 */
const VISIBLE_STATUSES = [
  BorrowStatus.ISSUED,
  BorrowStatus.PARTIALLY_RETURNED,
  BorrowStatus.RETURNED,
] as const;

@Injectable()
export class ProjectsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private itemsBase(projectId: string) {
    return this.db
      .selectFrom('borrow_requests as br')
      .innerJoin('products as p', 'p.id', 'br.product_id')
      .innerJoin('users as u', 'u.id', 'br.requester_id')
      .where('br.project_id', '=', projectId)
      .where('br.status', 'in', [...VISIBLE_STATUSES]);
  }

  async listItems(
    projectId: string,
    query: ListProjectItemsQuery,
  ): Promise<{ items: ProjectItem[]; total: number }> {
    const offset = (query.page - 1) * query.limit;
    const usageFilter = (qb: ReturnType<ProjectsRepository['itemsBase']>) =>
      query.usage === ProjectUsage.RETURNED
        ? qb.where('br.status', '=', BorrowStatus.RETURNED)
        : qb.where('br.status', 'in', [BorrowStatus.ISSUED, BorrowStatus.PARTIALLY_RETURNED]);

    const rows = await this.itemsBase(projectId)
      .$if(query.usage !== undefined, usageFilter)
      .select([
        'br.id as borrow_request_id',
        'br.borrow_no',
        'br.product_id',
        'p.product_code',
        'p.name as product_name',
        'br.quantity',
        'br.returned_qty',
        'br.status',
        'u.full_name as borrower_name',
        'br.purpose',
        'br.expected_return_date',
        'br.issued_at',
        'br.returned_at',
      ])
      // Newest first: the log is read to find what is out right now.
      .orderBy('br.created_at', 'desc')
      .limit(query.limit)
      .offset(offset)
      .execute();

    const counted = await this.itemsBase(projectId)
      .$if(query.usage !== undefined, usageFilter)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return {
      items: rows.map((r) => ({
        borrowRequestId: r.borrow_request_id,
        borrowNo: r.borrow_no,
        productId: r.product_id,
        productCode: r.product_code,
        productName: r.product_name,
        quantity: Number(r.quantity),
        returnedQty: Number(r.returned_qty),
        outstandingQty: Number(r.quantity) - Number(r.returned_qty),
        usage:
          r.status === BorrowStatus.RETURNED ? ProjectUsage.RETURNED : ProjectUsage.IN_USE,
        borrowerName: r.borrower_name,
        purpose: r.purpose,
        expectedReturnDate: r.expected_return_date,
        issuedAt: r.issued_at?.toISOString() ?? null,
        returnedAt: r.returned_at?.toISOString() ?? null,
      })),
      total: counted?.count ?? 0,
    };
  }

  async countsByUsage(projectId: string): Promise<{ inUse: number; returned: number }> {
    const rows = await this.itemsBase(projectId)
      .select(['br.status'])
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .groupBy('br.status')
      .execute();

    let inUse = 0;
    let returned = 0;
    for (const row of rows) {
      if (row.status === BorrowStatus.RETURNED) returned += Number(row.count);
      else inUse += Number(row.count);
    }
    return { inUse, returned };
  }

  /**
   * Conditional on the current project, not read-then-write: two IMs on the same screen is the
   * normal case, and zero rows updated is how the loser finds out instead of both "succeeding".
   */
  async detachItem(projectId: string, borrowRequestId: string): Promise<number> {
    const result = await this.db
      .updateTable('borrow_requests')
      .set({ project_id: null })
      .where('id', '=', borrowRequestId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  async listProjects(query: { page: number; limit: number }) {
    const offset = (query.page - 1) * query.limit;
    const rows = await this.db
      .selectFrom('projects')
      .select(['id', 'name', 'is_active', 'created_at'])
      .where('is_active', '=', true)
      .orderBy('name')
      .limit(query.limit)
      .offset(offset)
      .execute();

    const counted = await this.db
      .selectFrom('projects')
      .where('is_active', '=', true)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return { rows, total: counted?.count ?? 0 };
  }

  async findById(id: string) {
    return this.db
      .selectFrom('projects')
      .select(['id', 'name', 'is_active', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirst();
  }
}
```

If Kysely complains that `sql` is unused, delete the import — do not leave it to satisfy the snippet.

- [ ] **Step 5: Add the hub methods to the service**

Append to `apps/api/src/modules/projects/projects.service.ts` (and add `ProjectsRepository` to its constructor, plus the imports the new code needs):

```ts
  async listPaged(query: { page: number; limit: number }): Promise<Paginated<Project>> {
    const { rows, total } = await this.repo.listProjects(query);
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        isActive: row.is_active,
        createdAt: row.created_at.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async detail(id: string): Promise<ProjectDetail> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('Project');
    const counts = await this.repo.countsByUsage(id);
    return {
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      inUseCount: counts.inUse,
      returnedCount: counts.returned,
    };
  }

  async items(id: string, query: ListProjectItemsQuery): Promise<Paginated<ProjectItem>> {
    const exists = await this.repo.findById(id);
    if (!exists) throw new NotFoundError('Project');
    const { items, total } = await this.repo.listItems(id, query);
    return { items, page: query.page, limit: query.limit, total };
  }

  /**
   * Detach, not delete. `borrow_requests` drives stock issue and return, so removing the row
   * would orphan `stock_ledger` and break SUM(ledger) == SUM(placements). Clearing the project
   * changes attribution only — no stock moved, so no ledger row is written.
   */
  async detachItem(
    projectId: string,
    borrowRequestId: string,
    context: AuditContext,
  ): Promise<void> {
    const project = await this.repo.findById(projectId);
    if (!project) throw new NotFoundError('Project');

    const updated = await this.repo.detachItem(projectId, borrowRequestId);
    if (updated === 0) throw new NotFoundError('Project item');

    await this.audit.record(
      {
        action: 'project.item.detach',
        entityType: 'project',
        entityId: projectId,
        entityRef: project.name,
        summary: `Removed a borrow from project ${project.name}`,
        metadata: { borrowRequestId },
      },
      context,
    );
  }
```

- [ ] **Step 6: Write the controller**

Create `apps/api/src/modules/projects/projects.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  Role,
  createProjectSchema,
  listProjectItemsQuerySchema,
  paginationQuerySchema,
  type CreateProjectInput,
  type ListProjectItemsQuery,
  type Paginated,
  type Project,
  type ProjectDetail,
  type ProjectItem,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { ProjectsService } from './projects.service';

@AuthenticatedThrottle
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** The hub is everyone's: no @Roles here, deliberately. */
  @Get()
  async list(
    @Query(zodPipe(paginationQuerySchema)) query: { page: number; limit: number },
  ): Promise<Paginated<Project>> {
    return this.projects.listPaged(query);
  }

  /** Anyone raising a borrow or a requisition may create the project it is charged to. */
  @Post()
  async create(
    @Body(zodPipe(createProjectSchema)) body: CreateProjectInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Project> {
    return this.projects.create(body, actor.id, ctx);
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<ProjectDetail> {
    return this.projects.detail(id);
  }

  @Get(':id/items')
  async items(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listProjectItemsQuerySchema)) query: ListProjectItemsQuery,
  ): Promise<Paginated<ProjectItem>> {
    return this.projects.items(id, query);
  }

  /**
   * Removes a borrow from a project. Only the IM, who owns stock accuracy — one user quietly
   * detaching another's outstanding item would hide a liability.
   */
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Delete(':id/items/:borrowRequestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async detachItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('borrowRequestId', ParseUUIDPipe) borrowRequestId: string,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<void> {
    await this.projects.detachItem(id, borrowRequestId, ctx);
  }
}
```

- [ ] **Step 7: Wire the module**

Create `apps/api/src/modules/projects/projects.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuditModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService],
})
export class ProjectsModule {}
```

In `apps/api/src/app.module.ts`, import it and add `ProjectsModule` to the `imports` array directly after `BorrowingModule`.

In `apps/api/src/modules/borrowing/borrowing.module.ts`, delete the `ProjectsService` import and its entry in `providers`.

In `apps/api/src/modules/borrowing/borrowing.controller.ts`, delete the whole `/* --- projects --- */` block (the `listProjects` and `createProject` methods), the `ProjectsService` import, the `private readonly projects: ProjectsService` constructor parameter, and the now-unused `createProjectSchema`, `CreateProjectInput` and `Project` imports. `pnpm lint` will name any you miss.

- [ ] **Step 8: Run the integration test**

Run: `pnpm --filter @ims/api test:int > /tmp/int.log 2>&1; grep -E "projects hub|Test Files|Tests " /tmp/int.log | tail -8`
Expected: all five `projects hub` tests pass. Total failures should still be **8**, in `demo-accounts`, `login-backoff`, `reports` and `throttling` only. Any new failing file is yours — most likely a borrowing test that called `/borrowing/projects`; point it at `/projects`.

- [ ] **Step 9: Record the decision and the open question**

Append to `docs/state/OPEN-QUESTIONS.md`:

```markdown
- **OQ-23** 🟡 Should a PENDING borrow appear in the Project Hub? Currently excluded: a borrow
  that has not been approved has not reached the project, and a rejected or cancelled one never
  will, so listing it would show an item nobody can find. Revisit if requesters ask to see their
  own pending requests against a project. Marked at the derivation site in
  `apps/api/src/modules/projects/projects.repository.ts`.
```

Append to `docs/state/DECISIONS.md`:

```markdown
- 2026-08-07 — Removing an item from a project **detaches** it (`borrow_requests.project_id = NULL`)
  rather than deleting the borrow. The borrow drives stock issue and return, so deleting it would
  orphan `stock_ledger` rows and break `SUM(ledger) == SUM(placements)` — the one invariant the
  nightly job exists to catch. Detach writes no ledger row, because no stock moved.
```

- [ ] **Step 10: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

```bash
git add apps/api/src/modules/projects apps/api/src/modules/borrowing apps/api/src/app.module.ts \
        apps/api/test/projects.int-spec.ts docs/state/OPEN-QUESTIONS.md docs/state/DECISIONS.md
git commit -m "feat(projects): projects module with derived hub items and detach"
```

---

### Task 4: Filter requisitions by project

**Files:**
- Modify: `apps/api/src/modules/requisitions/requisitions.repository.ts` (the list query)
- Modify: `apps/api/test/requisitions.int-spec.ts` (one added test)

**Interfaces:**
- Consumes from Task 2: `ListRequisitionsQuery.projectId`.
- Produces, consumed by Task 6: `GET /requisitions?projectId=<uuid>` returning only that project's requisitions.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/requisitions.int-spec.ts`, inside the existing top-level `describe`:

```ts
  it('scopes the list to one project when projectId is given', async () => {
    const mine = await general.post('/projects', { name: `ReqFilter ${Date.now()}` });
    const other = await general.post('/projects', { name: `ReqOther ${Date.now()}` });

    const inProject = await createDraft(general, { projectId: mine.body.id });
    const elsewhere = await createDraft(general, { projectId: other.body.id });

    const list = await general.get(`/requisitions?mine=true&projectId=${mine.body.id}`);
    expect(list.status).toBe(200);
    const ids = list.body.items.map((r: { id: string }) => r.id);
    expect(ids).toContain(inProject.id);
    expect(ids).not.toContain(elsewhere.id);
  });
```

`createDraft` is whatever helper that file already uses to create a requisition — reuse it rather than writing a new one. If it does not accept `projectId`, widen its options parameter.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @ims/api test:int > /tmp/int.log 2>&1; grep -E "scopes the list to one project|Tests " /tmp/int.log | tail -4`
Expected: FAIL — `elsewhere.id` is present, because the filter is ignored.

- [ ] **Step 3: Apply the filter**

In `apps/api/src/modules/requisitions/requisitions.repository.ts`, find the `list` method's query builder and add the filter beside the existing `status` one. It must be applied to **both** the row query and the count query, or the pagination total will disagree with the rows:

```ts
      .$if(query.projectId !== undefined, (qb) =>
        qb.where('requisitions.project_id', '=', query.projectId!),
      )
```

Read the surrounding code first: if that file builds rows and count from one shared helper, add it there once instead of twice.

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm --filter @ims/api test:int > /tmp/int.log 2>&1; grep -E "Test Files|Tests " /tmp/int.log | tail -2`
Expected: PASS. Failures still 8, same four files.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/requisitions/requisitions.repository.ts apps/api/test/requisitions.int-spec.ts
git commit -m "feat(requisitions): filter the list by project"
```

---

### Task 5: The hub — project list and create

**Files:**
- Create: `apps/web/src/features/projects/api.ts`
- Create: `apps/web/src/features/projects/pages/ProjectsPage.tsx`
- Create: `apps/web/src/features/projects/components/ProjectFormDialog.tsx`
- Create: `apps/web/src/features/projects/pages/ProjectsPage.test.tsx`
- Modify: `apps/web/src/features/borrowing/api.ts` (delete `useProjects` and `useCreateProject`)
- Modify: `apps/web/src/features/borrowing/components/BorrowDialog.tsx` (import from the new home)
- Modify: `apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx` (same)
- Modify: `apps/web/src/api/keys.ts` (project keys)
- Modify: `apps/web/src/routes/paths.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/i18n/en.ts`

**Interfaces:**
- Consumes from Tasks 2–3: `Project`, `ProjectDetail`, `CreateProjectInput`, `Paginated`, and `GET`/`POST /projects`.
- Produces, consumed by Task 6: `useProjects()`, `useCreateProject()`, `useProject(id)`, `ROUTES.projects.all`, `ROUTES.projects.detail(id)`.

- [ ] **Step 1: Routes and copy**

In `apps/web/src/routes/paths.ts`, add before the `admin` block:

```ts
  projects: {
    all: '/projects',
    /** The router pattern; the helper below builds links. */
    detailPattern: '/projects/:projectId',
    detail: (id: string) => '/projects/' + id,
  },
```

In `apps/web/src/i18n/en.ts`, add `projects: 'Projects'` to the `nav` block, and a new top-level block:

```ts
  projects: {
    title: 'Projects',
    subtitle: 'What each project has borrowed, and what it has asked for.',
    create: 'New project',
    nameLabel: 'Project name',
    createdOn: (when: string) => `Created ${when}`,
    empty: 'No projects yet.',
    emptyBody: 'Create one here, or from the borrow dialog when you take something out.',
    itemsHeading: 'Items in hand',
    itemsHint: 'Added automatically when someone borrows for this project.',
    itemsEmpty: 'Nothing borrowed for this project yet.',
    requestedHeading: 'Requested',
    requestedHint: 'Requisitions charged to this project.',
    requestedEmpty: 'No requisitions for this project.',
    filterAll: 'All',
    filterInUse: 'In use',
    filterReturned: 'Returned',
    tagInUse: 'In use',
    tagReturned: 'Returned',
    borrowedBy: 'Borrowed by',
    remove: 'Remove',
    removed: 'Removed from this project',
    removeHint: 'Removes it from this project. The borrowing record itself is kept.',
    outstanding: (out: number, total: number) => `${out} of ${total} still out`,
  },
```

- [ ] **Step 2: Query keys**

In `apps/web/src/api/keys.ts`, replace the existing `projects` entry (it currently has only `all`) with:

```ts
  projects: {
    all: () => ['projects'] as const,
    list: (query: { page: number; limit: number }) => ['projects', 'list', query] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    items: (id: string, query: ListProjectItemsQuery) =>
      ['projects', 'items', id, query] as const,
  },
```

Add `ListProjectItemsQuery` to the type-only import block at the top of the file.

- [ ] **Step 3: The api hooks**

Create `apps/web/src/features/projects/api.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProjectInput,
  ListProjectItemsQuery,
  Paginated,
  Project,
  ProjectDetail,
  ProjectItem,
} from '@ims/shared';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { toSearchParams } from '@/api/search-params';

const ALL_PROJECTS = { page: 1, limit: 200 } as const;

/** The dropdowns want every project in one go; the list is small at this scale. */
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list(ALL_PROJECTS),
    queryFn: ({ signal }) =>
      api.get<Paginated<Project>>(`/projects${toSearchParams(ALL_PROJECTS)}`, signal),
    select: (page) => page.items,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: ({ signal }) => api.get<ProjectDetail>(`/projects/${id}`, signal),
    enabled: id.length > 0,
  });
}

export function useProjectItems(id: string, query: ListProjectItemsQuery) {
  return useQuery({
    queryKey: queryKeys.projects.items(id, query),
    queryFn: ({ signal }) =>
      api.get<Paginated<ProjectItem>>(`/projects/${id}/items${toSearchParams(query)}`, signal),
    enabled: id.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<Project>('/projects', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() }),
  });
}

/** Detach, not delete: the borrowing record is kept, it just leaves this project. */
export function useRemoveProjectItem(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (borrowRequestId: string) =>
      api.del<void>(`/projects/${projectId}/items/${borrowRequestId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() }),
  });
}
```

`useProjects` now returns `Project[]` via `select`, exactly as the old hook did, so `BorrowDialog` and `RequisitionFormPage` need only their import path changed.

- [ ] **Step 4: Move the old hooks' callers**

Delete `useProjects` and `useCreateProject` from `apps/web/src/features/borrowing/api.ts`, plus any imports left unused (`CreateProjectInput`, `Project`).

In `apps/web/src/features/borrowing/components/BorrowDialog.tsx` change:

```tsx
import { useCreateBorrow } from '../api';
import { useCreateProject, useProjects } from '@/features/projects/api';
```

In `apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx` change:

```tsx
import { useProjects } from '@/features/projects/api';
```

Run `grep -rn "useProjects\|useCreateProject" apps/web/src` and fix every hit.

- [ ] **Step 5: Write the failing test**

Create `apps/web/src/features/projects/pages/ProjectsPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ProjectsPage } from './ProjectsPage';

let currentUser: AuthUser | null = null;

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    user: currentUser,
    hasRole: (...roles: Role[]) => roles.some((role) => currentUser?.roles.includes(role)),
  }),
}));

vi.mock('../api', () => ({
  useProjects: () => ({
    data: [{ id: 'p-1', name: 'Rover', isActive: true, createdAt: '2026-08-01T00:00:00.000Z' }],
    isPending: false,
    isError: false,
  }),
  useCreateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsPage', () => {
  it('shows the projects and the create action to a general user', () => {
    currentUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'gina@ims.local',
      fullName: 'Gina General',
      designation: 'Engineer',
      departmentId: null,
      departmentName: null,
      roles: [Role.GENERAL],
      mustChangePassword: false,
    };
    renderPage();

    expect(screen.getByRole('heading', { name: t.projects.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rover/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.projects.create })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm --filter @ims/web test -- ProjectsPage`
Expected: FAIL — `Failed to resolve import "./ProjectsPage"`.

- [ ] **Step 7: Build the page and the dialog**

Create `apps/web/src/features/projects/components/ProjectFormDialog.tsx`. Read
`apps/web/src/features/admin/components/UserFormDialog.tsx` first and follow its Dialog + React
Hook Form shape exactly — same `Dialog` primitive, same submit/cancel footer, same error handling
through `messageForError` and the toast. It takes `{ open, onClose }`, one `TextField` bound to
`createProjectSchema`'s `name`, and calls `useCreateProject().mutateAsync({ name, allowDuplicateName: false })`.
On a `DUPLICATE_PROJECT_NAME` error, surface the message and offer a second submit that sends
`allowDuplicateName: true` — a duplicate is a warning, not a block (OQ-09).

Create `apps/web/src/features/projects/pages/ProjectsPage.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { useProjects } from '../api';
import { ProjectFormDialog } from '../components/ProjectFormDialog';

/**
 * The hub. Deliberately open to every role: a project is shared context, and anyone who can
 * borrow for one can see what it holds.
 */
export function ProjectsPage() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t.projects.title}
        subtitle={t.projects.subtitle}
        action={
          <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
            {t.projects.create}
          </Button>
        }
      />

      <QueryBoundary query={projects}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title={t.projects.empty} body={t.projects.emptyBody} />
          ) : (
            <Panel>
              <ul className="divide-y divide-border">
                {items.map((project) => (
                  <li key={project.id}>
                    <Link
                      to={ROUTES.projects.detail(project.id)}
                      className="flex items-center justify-between px-4 py-3 hover:bg-surface-muted"
                    >
                      <span className="font-medium text-ink">{project.name}</span>
                      <span className="text-xs text-ink-subtle">
                        {t.projects.createdOn(formatDateTime(project.createdAt))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )
        }
      </QueryBoundary>

      <ProjectFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
```

Check `QueryBoundary`'s and `EmptyState`'s real props in `apps/web/src/components/ui/states.tsx`
before relying on this shape, and match them. If `QueryBoundary` does not take a render-prop child,
use whatever the other pages use — `BomsPage.tsx` is the closest example.

- [ ] **Step 8: Register the route and the nav entry**

In `apps/web/src/App.tsx`, import `ProjectsPage` and add inside the `AppShell` block, with **no** role wrapper:

```tsx
                    <Route path={ROUTES.projects.all} element={<ProjectsPage />} />
```

In `apps/web/src/components/layout/AppShell.tsx`, add to the **first** (unroled) `NAV` group so every
role sees it, after `myRequisitions`:

```tsx
      { label: t.nav.projects, to: ROUTES.projects.all, icon: FolderKanban },
```

Add `FolderKanban` to the `lucide-react` import block, alphabetically. Verify it exists first:

Run: `node -e "console.log(typeof require('./apps/web/node_modules/lucide-react/dist/cjs/lucide-react.js').FolderKanban)"`
Expected: `object`. If it prints `undefined`, use `Folders` and verify that instead.

- [ ] **Step 9: Run the test and the suite**

Run: `pnpm --filter @ims/web test -- ProjectsPage`
Expected: PASS.
Run: `pnpm --filter @ims/web test`
Expected: all green. `BorrowDialog` and requisition-form tests exercise the moved hooks — if one fails on an unresolved `../api` mock, point its `vi.mock` at `@/features/projects/api`.

- [ ] **Step 10: Verify and commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add apps/web/src/features/projects apps/web/src/features/borrowing \
        apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx \
        apps/web/src/api/keys.ts apps/web/src/routes/paths.ts apps/web/src/App.tsx \
        apps/web/src/components/layout/AppShell.tsx apps/web/src/i18n/en.ts
git commit -m "feat(projects): project hub listing, reachable by every role"
```

---

### Task 6: Project detail — items, tags, filter, requisitions

**Files:**
- Create: `apps/web/src/features/projects/components/UsageTag.tsx`
- Create: `apps/web/src/features/projects/pages/ProjectDetailPage.tsx`
- Create: `apps/web/src/features/projects/pages/ProjectDetailPage.test.tsx`
- Modify: `apps/web/src/App.tsx` (the detail route)

**Interfaces:**
- Consumes from Tasks 2–5: `ProjectItem`, `ProjectUsage`, `ListProjectItemsQuery`, `useProject`, `useProjectItems`, `useRemoveProjectItem`, `ROUTES.projects.detailPattern`, and `GET /requisitions?projectId=`.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: The tag**

Create `apps/web/src/features/projects/components/UsageTag.tsx`:

```tsx
import { ProjectUsage } from '@ims/shared';
import { Badge } from '@/components/ui/primitives';
import { t } from '@/i18n/en';

/**
 * `pending` for in use and `success` for returned: an item still out is an open obligation,
 * a returned one is settled. Tones come from the token set so the tracker's colours are
 * defined once.
 */
export function UsageTag({ usage }: { usage: ProjectUsage }) {
  return usage === ProjectUsage.RETURNED ? (
    <Badge tone="success">{t.projects.tagReturned}</Badge>
  ) : (
    <Badge tone="pending">{t.projects.tagInUse}</Badge>
  );
}
```

Confirm `Badge`'s tone union includes `pending` and `success`:

Run: `grep -n "BadgeTone\|tone" apps/web/src/components/ui/primitives.tsx | head -5`

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/features/projects/pages/ProjectDetailPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectUsage, Role, type AuthUser } from '@ims/shared';
import { t } from '@/i18n/en';
import { ProjectDetailPage } from './ProjectDetailPage';

let currentUser: AuthUser | null = null;
const itemsQuerySpy = vi.fn();

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    user: currentUser,
    hasRole: (...roles: Role[]) => roles.some((role) => currentUser?.roles.includes(role)),
  }),
}));

vi.mock('../api', () => ({
  useProject: () => ({
    data: {
      id: 'p-1',
      name: 'Rover',
      isActive: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      inUseCount: 1,
      returnedCount: 1,
    },
    isPending: false,
    isError: false,
  }),
  useProjectItems: (_id: string, query: { usage?: string }) => {
    itemsQuerySpy(query);
    return {
      data: {
        items: [
          {
            borrowRequestId: 'b-1',
            borrowNo: 'BRW-1',
            productId: 'pr-1',
            productCode: 'PRD-1',
            productName: 'Arduino Uno',
            quantity: 5,
            returnedQty: 2,
            outstandingQty: 3,
            usage: ProjectUsage.IN_USE,
            borrowerName: 'Gina General',
            purpose: 'Prototype',
            expectedReturnDate: null,
            issuedAt: null,
            returnedAt: null,
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      },
      isPending: false,
      isError: false,
    };
  },
  useRemoveProjectItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/requisitions/api', () => ({
  useRequisitions: () => ({
    data: { items: [], page: 1, limit: 20, total: 0 },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function renderPage(roles: Role[]) {
  currentUser = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'person@ims.local',
    fullName: 'Test Person',
    designation: 'Engineer',
    departmentId: null,
    departmentName: null,
    roles,
    mustChangePassword: false,
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/projects/p-1']}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectDetailPage', () => {
  it('shows the item with its quantity and an in-use tag', () => {
    renderPage([Role.GENERAL]);
    expect(screen.getByText('Arduino Uno')).toBeInTheDocument();
    expect(screen.getByText(t.projects.tagInUse)).toBeInTheDocument();
    expect(screen.getByText(t.projects.outstanding(3, 5))).toBeInTheDocument();
  });

  it('hides Remove from a general user and shows it to the inventory manager', () => {
    renderPage([Role.GENERAL]);
    expect(screen.queryByRole('button', { name: t.projects.remove })).not.toBeInTheDocument();

    renderPage([Role.GENERAL, Role.INVENTORY_MANAGER]);
    expect(screen.getAllByRole('button', { name: t.projects.remove }).length).toBeGreaterThan(0);
  });

  it('sends the usage filter to the server when a pill is chosen', async () => {
    itemsQuerySpy.mockClear();
    const user = userEvent.setup();
    renderPage([Role.GENERAL]);

    await user.click(screen.getByRole('button', { name: t.projects.filterReturned }));

    expect(itemsQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({ usage: ProjectUsage.RETURNED }),
    );
  });
});
```

Before writing the page, confirm the requisitions list hook's real name and signature:

Run: `grep -n "export function use" apps/web/src/features/requisitions/api.ts`

If it is not `useRequisitions(query)`, change the mock and the page to match. Do not invent a hook.

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @ims/web test -- ProjectDetailPage`
Expected: FAIL — `Failed to resolve import "./ProjectDetailPage"`.

- [ ] **Step 4: Build the page**

Create `apps/web/src/features/projects/pages/ProjectDetailPage.tsx`. Requirements, all of which the
tests above pin down:

- Read `projectId` from `useParams`.
- `PageHeader` titled with the project's name, subtitled with the in-use / returned counts.
- **Items in hand** panel: heading `t.projects.itemsHeading`, hint `t.projects.itemsHint`, and three
  filter pills — All / In use / Returned — copied from the pattern in
  `apps/web/src/features/boms/pages/BomsPage.tsx` lines 81-100 (`role="group"`, `aria-pressed`,
  `bg-brand-subtle font-medium text-brand` when active). Selecting a pill sets `usage` in the query
  passed to `useProjectItems` and resets `page` to 1 — server-side, so it stays right across pages.
- One row per item: product name and code, `t.projects.outstanding(outstandingQty, quantity)` when
  `returnedQty > 0` else the plain quantity, borrower, purpose, `<UsageTag />`, and a Remove button
  rendered only when `hasRole(Role.INVENTORY_MANAGER, Role.ADMIN)`. Remove calls
  `useRemoveProjectItem(projectId).mutateAsync(borrowRequestId)`, then toasts
  `t.projects.removed`; failures go through `messageForError`. Give it `title={t.projects.removeHint}`
  so it is clear the borrowing record survives.
- Empty state `t.projects.itemsEmpty`, plus loading and error-with-retry — use `QueryBoundary` the
  way the other list pages do.
- **Requested** panel: heading `t.projects.requestedHeading`, hint `t.projects.requestedHint`, fed by
  the requisitions list hook with `{ page: 1, limit: 20, projectId }`. Show requisition number,
  status and requested amount, reusing whatever status badge `RequisitionsPage.tsx` already uses
  rather than inventing one. Empty state `t.projects.requestedEmpty`.
- `Pagination` under the items panel when `total > limit`, matching the other pages.

Keep the file under ~150 lines; if it grows past that, lift each panel into
`components/ProjectItemsPanel.tsx` and `components/ProjectRequisitionsPanel.tsx`.

- [ ] **Step 5: Register the route**

In `apps/web/src/App.tsx`, import `ProjectDetailPage` and add directly after the projects list route,
with no role wrapper:

```tsx
                    <Route path={ROUTES.projects.detailPattern} element={<ProjectDetailPage />} />
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @ims/web test -- ProjectDetailPage`
Expected: PASS, 3 tests.
Run: `pnpm --filter @ims/web test`
Expected: all green.

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add apps/web/src/features/projects apps/web/src/App.tsx
git commit -m "feat(projects): project detail with usage tags, filter and requisitions"
```

---

### Task 7: The requisition form, made premium

Visual only. No behaviour changes — Task 1 already fixed the submit.

**Files:**
- Modify: `apps/web/src/features/requisitions/pages/RequisitionFormPage.tsx`
- Modify: `apps/web/src/features/requisitions/components/ItemRow.tsx`
- Modify: `apps/web/src/i18n/en.ts` (only if you add guidance copy)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

- [ ] **Step 1: Read the tokens you are allowed to use**

Run: `sed -n '1,80p' apps/web/src/styles/tokens.css`

Everything below must come from this file. **No hex, no `w-[437px]`-style arbitrary values, no inline
`style` for anything themeable.** If an effect cannot be expressed in these tokens, leave it out —
that is the constraint, not a limitation to work around.

- [ ] **Step 2: Lift the section hierarchy**

Both panels currently open with a thin bordered strip. Give each a header with real weight and
spacing, and put the panel on the elevation token instead of a flat border:

```tsx
<Panel className="shadow-[--shadow-panel]">
  <header className="border-b border-border px-5 py-4">
    <h2 className="text-base font-semibold text-ink">{t.requisitions.detailsHeading}</h2>
    <p className="mt-0.5 text-sm text-ink-muted">{t.requisitions.detailsHint}</p>
  </header>
  <div className="grid gap-5 p-5 sm:grid-cols-2">
```

Apply the same treatment to the Items panel header, keeping its `Add item` button in the header row.

- [ ] **Step 3: Align the item rows on a grid**

In `ItemRow.tsx`, replace the current inline flow with an explicit grid so the columns line up down
the list, and right-align the money. Item name takes the remaining space; quantity and unit price are
fixed and narrow; the line total is a right-aligned figure, not a label-above-value pair:

```tsx
<div className="grid grid-cols-[1fr_5rem_8rem_7rem_2.5rem] items-start gap-3 px-5 py-4">
```

Use `text-right tabular-nums` on the quantity, unit price and line total so digits do not jitter as
they change. Keep every existing `label` prop — the labels are what the Task 1 test queries by, and
removing one breaks it.

- [ ] **Step 4: Make the total read as a summary**

Replace the current footer row with a clear summary band:

```tsx
<div className="flex items-baseline justify-between border-t border-border bg-surface-muted px-5 py-4">
  <span className="text-sm font-medium text-ink-muted">{t.requisitions.total}</span>
  <span className="text-2xl font-semibold tabular-nums text-ink">{formatMoney(total)}</span>
</div>
```

Use whatever money formatter `apps/web/src/lib/format.ts` already exports — check with
`grep -n "export function" apps/web/src/lib/format.ts` and reuse it rather than calling
`toLocaleString` inline.

- [ ] **Step 5: Stick the actions to the bottom**

The form is long enough to scroll, so Submit should stay reachable:

```tsx
<div className="sticky bottom-0 z-10 mt-6 flex items-center justify-between gap-3 rounded-[--radius-panel] border border-border bg-surface px-5 py-4 shadow-[--shadow-panel]">
  <p className="text-xs text-ink-subtle">{t.requisitions.frozenHint}</p>
  <div className="flex gap-2">{/* existing Save draft + Submit buttons, unchanged */}</div>
</div>
```

- [ ] **Step 6: Prove nothing behavioural moved**

Run: `pnpm --filter @ims/web test`
Expected: all green, including `RequisitionFormPage` from Task 1. That test is the guard: if a label
or the draft button's accessible name changed, it fails.

- [ ] **Step 7: Look at it**

Run: `pnpm db:up && pnpm dev` (or `docker compose stop` first if the container stack holds 5173).
Open `http://localhost:5173` — **`localhost`, not `127.0.0.1`; the dev server binds IPv6 only.**
Sign in as `im@ims.local` / `demo`, go to New requisition, and check with your own eyes:

- The two panels read as distinct sections with real hierarchy
- Item columns line up down the list; money is right-aligned and does not jitter while typing
- The total reads as a summary, not a table footer
- The action bar stays visible while scrolling
- **Selecting "No project" and submitting works** — the Task 1 fix, in the real app
- Nothing has a hard-coded colour: toggle the OS to dark mode and confirm the form still reads

The suite cannot catch layout: `vitest.config.ts` sets `css: false`, so jsdom applies no Tailwind at
all. A green suite says nothing about whether this looks right. Open the page.

- [ ] **Step 8: Verify and commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add apps/web/src/features/requisitions apps/web/src/i18n/en.ts
git commit -m "refactor(web): premium layout for the requisition form"
```

---

## Definition of done

- `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass
- `pnpm --filter @ims/api test:int` shows **8** failures, in `demo-accounts`, `login-backoff`,
  `reports` and `throttling` only — the pre-existing set, no new files
- Every new behaviour has a test that fails without its change
- No migration was written
- Detach is proven by test not to touch `stock_ledger`
- OQ-23 recorded in `docs/state/OPEN-QUESTIONS.md` and marked in the repository
- The detach-not-delete decision recorded in `docs/state/DECISIONS.md`
- No hex, no arbitrary Tailwind values, no user-visible literal in JSX, no route literal
- The requisition form was opened in a browser and looked at, not just tested

## Out of scope

- Editing, renaming or archiving projects; project budgets or spend rollups
- Listing requisition *lines* in the hub — the requisitions panel lists requisitions
- Changing how borrowing works. The hub reads and re-attributes, nothing else
- `SignaturePanel` test coverage, the dropdown `role="menuitem"` gap, the stale `AI_PLAYBOOK.md`
  §4.3 diagram — earlier recorded debt, still deferred
