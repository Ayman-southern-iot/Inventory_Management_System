# Phase 09 — location hierarchy, shelf IDs, category taxonomy, custody and project governance

**Opened:** 2026-09-20 · **Source:** Ayman, 2026-09-20 (six asks + three user-review items)
**Baseline commit:** `9f4176d` (plus this session's uncommitted fix work — see "Before anything")
**Companion spec:** `category-taxonomy-spec.md` (Ayman, 2026-09-20) — authoritative for Part C.

Nine asks. They are **not** independent: #1 cannot start before #3, #6 cannot start before #5,
and #2 is trivial only after #5 settles what the product form looks like. This plan puts them in
dependency order and lands the cheap independent ones first so the phase produces value before
the first migration.

**This is more than one session's work.** `CLAUDE.md` says one phase per session; that rule is
about not drifting into the *next* phase, not about pretending this fits in one. Parts land in
order, each with its own gate and its own handoff.

## Baseline for this phase — measured 2026-09-20, before the first edit of the phase

```
pnpm typecheck                      exit=0, clean
pnpm lint                           20 errors   (compare against 20, not zero)
pnpm test                           shared 25 · api 83 · web 332, all pass
pnpm --filter @ims/api test:int     695 pass / 0 fail (51 files)
guard-hardcoding.sh --scan-all      8            (documented baseline 7)
```

Note the drift from `NOW.md`, which still records 20/83/318 and 685/50. Correct it at handoff.

## Before anything

22 files from the upload/signature fix work are uncommitted (F-5, F1 orphan-upload quota, F2
multipart limits, F4 parse-ordering). **Commit those first**, in their natural split, so this
phase starts from a clean tree. Starting a structural change on top of unrelated modified files
means any revert here picks apart work that has nothing to do with it.

---

## The decisions that shaped this plan

Recorded here because they were made in conversation and are not derivable from the code.

| # | Decision | Consequence |
|---|---|---|
| D1 | The auto-generated Storage ID names a **shelf slot**, not a product and not a unit | It lives on `storage_compartments`, not `products`. `product_code` is untouched. |
| D2 | Product name is therefore **not** part of the Storage ID | A slot holds different products over its life; a product name baked into a slot ID is wrong the first time the slot is reused. This drops one element Ayman originally listed — flagged, not silently omitted. |
| D3 | Category stays a **single tree, one category per product** | Per `category-taxonomy-spec.md` §0/§1. No `product_categories` join table. Cross-cutting grouping is Projects' job. |
| D4 | Category becomes **optional** | `products.category_id` goes nullable. Blocking save on categorisation is what produces junk categories. |
| D5 | Custody reassignment is a **borrow-record** change, not a stock movement | Issued stock has already left the shelf; who holds it is not a placement fact. No `StockService` call, no ledger row. See Part E. |
| D6 | Projects become **propose-then-approve** rather than IM-only | Ayman's choice over a hard restriction. Keeps the capability, stops the pile-up. |

### What the research found that changes the asks

- **#8 is half a non-issue.** `POST /products` is already `@Roles(INVENTORY_MANAGER, ADMIN)`, and
  every caller of `ProductsService.createWithin` (the requisition-line promotion path) is behind
  the same roles — `recordReceipt` and `recordPurchase`. There is no non-IM path to create a
  product. Only `POST /projects` is genuinely open.
- **#4 is 80% built.** `POST /requisitions/:id/borrow-to-user` → `BorrowingService.issueOnBehalf`
  already issues to a named person in one transaction, notifies them
  (`borrowing.issued_to_you`), and audits with `actor_id ≠ requester_id`. Only two gaps remain.
- **#5's hierarchy already exists in the database.** `categories.parent_id`, the tree builder, and
  the sibling-unique partial indexes (`categories_root_name_key`, `categories_sibling_name_key`)
  are all present. Commit `516066b` removed only the UI picker.
- **Nothing anywhere parses a location string.** No `split('/')`, no regex. Location is only ever
  formatted for display. This is the single biggest reason Part A is survivable.

---

## Part A — Room above Zone  (ask #3)

**Why first:** #1 depends on it, and every stock screen renders location.

The current model is flat: `storage_zones` (globally unique name) → `storage_compartments`
(unique `(zone_id, code)`). Room is a new level *above* zone.

**The property that keeps this safe:** `stock_placements.compartment_id` and the append-only
`stock_ledger.from/to_compartment_id` keep pointing at the compartment. Compartment stays the
physical leaf. **No placement or ledger row changes.** Anything that proposes otherwise is a
multi-release column migration and is out of scope.

- [ ] **A.1** Migration `0031`: create `storage_rooms` (`id`, `name`, `is_active`, timestamps),
      unique index on `lower(btrim(name))`, name-not-blank CHECK — mirroring `storage_zones`.
- [ ] **A.2** Same migration: add `storage_zones.room_id`, nullable at first; insert one room
      seeded from config (not a literal) to hold existing zones; backfill; then `SET NOT NULL`.
      Existing rows must survive — there is live data in the local stack and on the VM.
- [ ] **A.3** Same migration: drop `storage_zones_name_key`, create
      `UNIQUE (room_id, lower(btrim(name)))`. Two rooms may each have a "Shelf A".
- [ ] **A.4** `LocationsService` / repository: room CRUD, and zone create/update take a room.
- [ ] **A.5** `packages/shared` contracts: room schemas; zone schemas gain `roomId`. Rebuild
      `packages/shared/dist` or `pnpm typecheck` reads a stale contract.
- [ ] **A.6** `placementsForProduct` joins the room; the placement shape gains `roomId`/`roomName`.
- [ ] **A.7** `CompartmentPicker.tsx` becomes three-step (room → zone → compartment). Its existing
      test asserts the two-step behaviour and **will go red — that is the spec changing, not a
      regression.** Rewrite it to assert the three-step rule, including "changing room clears
      zone and compartment".
- [ ] **A.8** Display: `{room} / {zone} / {compartment}` everywhere `{zone} / {compartment}` is
      rendered today — `ProductDetailPage.tsx:55` PlacementChip first. One helper, not inline
      concatenation at each site.
- [ ] **A.9** `LocationsPage.tsx` gains the room level.
- [ ] **A.10** `stock-factories.ts`: `createRoom`, and `createZone` takes a room. Every stock
      integration spec builds fixtures through these — expect broad but mechanical churn.
- [ ] **A.11** i18n: room keys; revise the locations/compartmentPicker blocks.

**Gate for A:** full gate. Every `stock-*`, `borrowing*`, `reconciliation`, `inventory-report*`
spec runs through the factories and must stay green at 695+.

## Part B — Storage ID for a shelf slot  (ask #1, depends on A)

- [ ] **B.1** Migration `0032`: `storage_compartments.storage_id` text, unique on
      `lower(btrim(storage_id))`, plus a serial source for the numeric tail.
- [ ] **B.2** Generation rule, server-side only, at compartment creation:
      room token + zone token + compartment code + zero-padded serial. Token derivation and
      padding width come from config/`app_settings` — **not literals** (rule 10).
- [ ] **B.3** **Immutable once assigned.** Renaming a room must not rewrite existing storage IDs:
      the ID would then disagree with every label already stuck on a shelf, and with any audit
      row that quoted it. Renames change display names only.
- [ ] **B.4** Surface it on `LocationsPage`, the placement chip, and inventory search
      (`en.ts:310` already says "Search by name or storage ID" — today that means `product_code`;
      decide and state which one that search now means).
- [ ] **B.5** Tests: generation is deterministic, unique under concurrent creation, survives a
      room rename unchanged.

**Open:** what happens to the ~5 compartments that already exist. Generate on migration, or leave
null until edited? Generating is tidier; leaving null admits that a physical label does not exist
yet. Raise as an OQ before writing B.1.

## Part C — Category taxonomy  (ask #5, per `category-taxonomy-spec.md`)

The spec is authoritative. What follows is only the delta against the current schema.

- [ ] **C.1** Migration `0033`: `products.category_id` **DROP NOT NULL** (spec §1, D4).
- [ ] **C.2** Same migration: `BEFORE INSERT OR UPDATE` trigger on `categories` enforcing max
      depth 3 via a recursive CTE up `parent_id`. Spec §4 is explicit that a `CHECK` cannot do
      this, and it is right: Postgres `CHECK` cannot reference other rows.
- [ ] **C.3** Same trigger (or a sibling one) rejects a re-parent that would create a **cycle**.
      `updateCategorySchema` deliberately omits `parentId` today with the comment *"re-parenting
      needs cycle handling"* — that comment is the specification for this task. Do not add the
      field without the guard.
- [ ] **C.4** `updateCategorySchema` gains `parentId`; `CategoriesService.update` handles move.
- [ ] **C.5** Category create/rename/move/delete write `audit_log` rows (spec §4).
- [ ] **C.6** Delete rule (spec §8): block while products or children reference it; never cascade.
- [ ] **C.7** Seed the Section 2 tree through `pnpm db:seed`, idempotent, `ON CONFLICT DO NOTHING`.
      ~200 nodes — data, not code.
- [ ] **C.8** Re-add the parent picker to `CategoriesPage.tsx`. Its test
      `CategoriesPage.parent.test.tsx` asserts the picker is **absent** and will go red — again,
      the spec changing.
- [ ] **C.9** Product form: cascading picker, skippable levels, "no category" allowed.
- [ ] **C.10** Product detail: clickable breadcrumb; `Uncategorized` when null (spec §6).
- [ ] **C.11** Inventory screen: `Uncategorized` filter chip (`WHERE category_id IS NULL`).
- [ ] **C.12** Every read that assumes a non-null category must tolerate null —
      `products.repository.ts:36-37` joins categories and reads `category_name`; an INNER JOIN
      there would silently **hide uncategorised products from the list**. Audit every join.

**C.12 is the one that bites.** A nullable FK plus an existing inner join is how rows disappear
without an error.

## Part D — Inline category creation + post-create navigation  (asks #6 and #2)

- [ ] **D.1** "+ New Category" inside the picker, IM-only, calling the same API as the management
      screen (spec §4: one API, two entry points, so the tree cannot drift).
      Precedent to copy: `ReceiveToStockForm.tsx:319-333` already creates a **product** inline
      from within a dialog. Follow that shape rather than inventing a combobox pattern.
- [ ] **D.2** After a product is created, go straight to its detail page with the receive-stock
      dialog open. `ReceiveStockDialog` already exists on `ProductDetailPage`; this is navigation
      plus an initial-state flag, not a new screen.
- [ ] **D.3** Do **not** do this when the product was created inline from another flow
      (`ReceiveToStockForm`) — that caller is already mid-receipt and must not be navigated away.

## Part E — Custody: issue from shelf, and reassign  (ask #4)

Both gaps confirmed. Neither needs a new `StockService` method.

**E-a: issue-on-behalf from existing shelf stock.**
`issueOnBehalf` currently chains `receiveAndHold` + `issue`, because it assumes goods are arriving.
From shelf stock the movement is `reserve` + `issue` on an existing placement.

- [ ] **E.1** `POST /borrowing/issue-on-behalf`, `@Roles(INVENTORY_MANAGER, ADMIN)`: borrower,
      product, compartment, quantity, note.
- [ ] **E.2** Reuse the `issueOnBehalf` transaction shape exactly — one transaction covering
      reserve, borrow row, issue, audit. **G-14 landmine:** splitting it strands stock.
- [ ] **E.3** Same notification (`borrowing.issued_to_you`) and the same
      `borrowing.issue_on_behalf` audit action, so the proof trail is identical to the existing path.
- [ ] **E.4** Refuse issuing to a deactivated user — mirror the existing check and its test.

**E-b: reassign the holder of an issued borrow.**
Per D5 this touches **no stock**. The units already left the shelf when `issue` ran; who is
holding them is not a placement fact. `stock_ledger` is append-only by trigger and must not gain
a compensating pair for a custody correction that moved nothing.

- [ ] **E.5** Migration `0034`: `borrow_requests.current_holder_id` (FK users, NOT NULL, backfilled
      from `requester_id`), plus append-only `borrow_holder_changes`
      (`borrow_request_id`, `from_user_id`, `to_user_id`, `changed_by`, `reason`, `changed_at`).
      `requester_id` stays as written — it records who asked, and rewriting it would falsify history.
- [ ] **E.6** `POST /borrowing/:id/holder`, IM/Admin, ISSUED or PARTIALLY_RETURNED only.
- [ ] **E.7** Notify **both** parties — the new holder ("this is now recorded against you") and
      the previous one ("this is no longer against you"). Two new notification types + copy.
      The second is the half that makes it proof rather than paperwork.
- [ ] **E.8** Everything that reads "who has this" switches to `current_holder_id`:
      the borrowings list, the overdue job, `/myBorrowings`. **Miss one and the overdue reminder
      chases the wrong person.** Enumerate every read of `requester_id` before writing E.6.

## Part F — Projects: propose, then approve  (ask #8, per D6)

- [ ] **F.1** Migration `0035`: `projects.status` (`PROPOSED` / `ACTIVE` / `REJECTED`), existing
      rows → `ACTIVE`; `approved_by`, `approved_at`, `rejection_reason`.
- [ ] **F.2** `POST /projects` stays open to all, but creates `PROPOSED`.
- [ ] **F.3** `POST /projects/:id/decision`, IM/Admin.
- [ ] **F.4** Every project **picker** shows `ACTIVE` only; the management list shows all with a
      filter. A requisition already attached to a project must not break if it is later rejected —
      decide and state the rule.
- [ ] **F.5** Notify the proposer on decision.
- [ ] **F.6** Permission tests for `POST /projects` and the decision route. **None exist today** —
      this endpoint is currently untested as well as unguarded.

## Part G — The two small ones  (asks #9 and #10) — land these first

Independent of everything above, no migration, low risk. Doing them first puts something in
Ayman's hands while Part A is still in the database.

- [ ] **G.1** Pluralisation. `approverCountOne: '1 approver'` and `approverCountOther: '{n} approvers'`
      **already exist** in `en.ts:950-951` and are unused. The live string is
      `approverCountHint` at `RequisitionDetailPage.tsx:428`, hardcoded plural. Add one small
      `plural(n, one, other)` helper — there is none in the codebase — and route every count
      through it. Find every site, not just the detail page.
- [ ] **G.2** BOM footnote. `renderFooter()` at `bom-pdf.template.ts:294-296` currently prints only
      the company name. Add the digitally-approved line there. Template copy is inline strings by
      design and exempt from rule 10 — do not route it through `en.ts`.
- [ ] **G.3** Test the footnote in `boms-pdf.int-spec.ts` alongside the existing HTML assertions.

---

## Migrations this phase adds

`0031` rooms · `0032` compartment storage_id · `0033` category nullable + depth/cycle triggers ·
`0034` borrow custody · `0035` project status.

**Every one is a STOP under `.claude/rules/70-assist-handoff.md`** ("A schema change or new
migration"). Each gets the lead's sign-off before it is written, and its own gate — not a batch
gate, per the same rule.

## Tests that will go red, and why they are not regressions

| Spec | Asserts today | Why it changes |
|---|---|---|
| `CompartmentPicker.test.tsx` | two-step zone → compartment | A.7 makes it three-step |
| `CategoriesPage.parent.test.tsx` | the parent picker is **absent** | C.8 puts it back |
| `permissions*.int-spec.ts` | `POST /projects` unguarded (implicitly) | F.2 adds a status |
| every stock fixture spec | zones without rooms | A.10 changes the factories |

Rewrite each to the new rule. **None may be `.skip`ped or deleted** — that is a STOP.

## Open questions to file before the relevant part starts

- **OQ-A:** existing compartments and their storage IDs — generate on migration, or leave null? (B)
- **OQ-B:** does "Search by name or storage ID" now mean the slot ID, the product code, or both? (B)
- **OQ-C:** a requisition attached to a project that is later REJECTED — what happens? (F)
- **OQ-D:** `specs` text field on products — `category-taxonomy-spec.md` §7 recommends it but
  explicitly defers the decision. Out of scope here; file it rather than building it.

## Sequencing

```
G (small, independent)  →  A (rooms)  →  B (storage IDs)
                           C (categories)  →  D (inline create + nav)
                           E (custody)     — independent of A–D
                           F (projects)    — independent of A–E
```

A and C are both migrations and both touch wide surfaces; **do not run them in the same session.**
