# Phase 07 — QA round 2 defect burndown

**Opened:** 2026-08-26 · **Source:** `IMS_QA_Test_Plan.xlsx` (186 cases, 31 defect rows)
**Scope:** the 21 items still outstanding after reconciling the workbook against git.

The workbook's Status column was written against `f68ff53` (the deployed instance) and is stale:
it shows 29 Open, but 10 of those are fixed locally and 2 are partly fixed. This file is the
authority for what is left, not the spreadsheet.

## Baseline for this phase — measured 2026-08-26, before the first edit

```
pnpm typecheck                      exit=0, clean
pnpm lint                           20 errors   (compare against 20, not zero)
pnpm test                           shared 13 · api 58 · web 132, all pass
pnpm --filter @ims/api test:int     516 pass / 1 fail (517 tests, 42 files)
                                    the 1 fail is P-21 below, a real defect
```

`NOW.md`'s 497/1 and web 126 are superseded: `67d8397` and `10d6283` landed after that snapshot.

## Already fixed — do not re-open

| Defect | Sev | Landed in |
|---|---|---|
| D-014 cumulative date shift | Critical | `532a4ba` |
| D-022 approve more than requested | Critical | `59b28f4` (`APPROVED_EXCEEDS_REQUESTED`) |
| D-020 rejected counted as approved money | High | `5075895` + `10d6283` |
| D-023 delegate not implemented | High | `9f84f24` |
| D-028 BOM quantity clamp | High | `052f850` |
| D-030 audit "Unknown actor" | High | `28b0ae8` + `c62a6e0` |
| D-001 no sub-threshold submit | Medium | pre-existing |
| D-016 drafts show 0 | Medium | `67d8397` |
| D-021 phantom "revised" caption | Medium | `67d8397` |
| D-032 raw config as settings label | Low | `9c562a1` |
| D-024 expenses CSV/PDF returned the SPA shell | High | `93597b7` (its EX-02 half survives as P-01) |

D-007 is closed as **Not a defect**: at or above the threshold means 2 approvers, per `OQ-01`.

## Tracking ledger

Status values: `TODO` · `IN PROGRESS` · `DONE` (gate green, handoff block issued) · `BLOCKED`.

| # | Item | Sev | SPEC | Status | Commit |
|---|---|---|---|---|---|
| P-01 | EX-02 inventory records export | High | REQUIRED §10 | TODO | |
| P-02 | D-002 picker truncates past 100 | Medium | NO-BASIS (shipped surface) | TODO | |
| P-03 | D-003 past deadline accepted server-side | Medium | NO-BASIS (shipped surface) | TODO | |
| P-04 | D-004 draft edit drops Department/Project | Medium | NO-BASIS (shipped surface) | **DONE** | `2bb58d2` |
| P-05 | D-005 raw zod string shown to user | Low | NO-BASIS (shipped surface) | **DONE** | `a44050f` |
| P-06 | D-006 request-level fields all optional | Medium | DERIVED (ruling 2026-08-26) | **DONE** | `8ab180d` |
| P-07 | D-009 dashboard "arrive in later phases" | Cosmetic | NO-BASIS (shipped surface) | **DONE** | `6ab88f9` |
| P-08 | D-010 Products nav vs Inventory heading | Cosmetic | NO-BASIS (shipped surface) | **DONE** | `6ab88f9` |
| P-09 | D-011 three date formats | Cosmetic | NO-BASIS (shipped surface) | TODO | |
| P-10 | D-012 every page shares a browser title | Cosmetic | NO-BASIS (shipped surface) | TODO | |
| P-11 | D-013 per-role authorisation unverified | Medium | REQUIRED §2 (verification) | TODO | |
| P-12 | D-015 failed submit silently drafts | Medium | NO-BASIS (shipped surface) | TODO | |
| P-13 | D-017 totals shown from invalid input | Low | NO-BASIS (shipped surface) | **DONE** | `2bb58d2` |
| P-14 | D-018 Reason labelled NOTE | Cosmetic | REQUIRED §3 (field name) | **DONE** | `6ab88f9` |
| P-15 | D-019 list re-sorts with no indicator | Low | NO-BASIS (shipped surface) | **DONE** | `d4a3864` |
| P-16 | D-025 funding validation has no feedback | Medium | NO-BASIS (shipped surface) | TODO | |
| P-17 | D-026 BOM preview totals never recompute | Medium | NO-BASIS (shipped surface) | TODO | |
| P-18 | D-027 linked project absent from web BOM | Medium | REQUIRED §9 | TODO | |
| P-19 | D-029 BOM history repeats one event | Cosmetic | NO-BASIS (shipped surface) | TODO | |
| P-20 | D-031 settings audit has no before/after | Medium | DERIVED (§11 control) | TODO | |
| P-21 | oversized JSON body returns 500 not 413 | Medium | NO-BASIS (shipped surface) | **DONE** | `4efbf75` |
| P-22 | no project means personal development | n/a | DERIVED (ruling 2026-08-26) | **DONE** | `5d5eef6` |

## Execution order and batching

Ordered so the suite goes green first, the cheap certain wins clear the board next, and the one
large feature lands last with a clean run behind it.

| Batch | Items | Gate |
|---|---|---|
| B1 | P-21 | own gate — restores a fully green integration suite |
| B2 | P-07, P-08, P-10, P-14 | shared gate — copy and i18n only |
| B3 | P-04, P-05, P-13, P-15 | shared gate — web display defects |
| B4 | P-16, P-17 | shared gate — web validation and reactivity |
| B5 | P-09 | own gate — cross-cutting, touches many components |
| B6 | P-03, P-12, P-02 | own gates — server behaviour |
| B7 | P-18, P-19 | shared gate — BOM read paths |
| B8 | P-20 | own gate — writes audit metadata |
| B9 | P-11 | own gate — permissions; a hole found here is a STOP |
| B10 | P-01 | own gate — new endpoint, new surface |
| — | P-06 | blocked pending ruling |

Per `.claude/rules/70-assist-handoff.md`: any block whose `INVARIANT` is non-empty, or whose
`NEWSURF` names stock, a migration or an `ErrorCode`, takes its own gate rather than riding a
batch. If a batch gate shows any delta from 516/1 and 20 lint, bisect the batch before shipping.

---

## The items

### P-01 · EX-02 — inventory records cannot be exported
**Sev** High · **SPEC** REQUIRED §10 · **Tests** EX-02

§10 requires that "Bill of Materials and inventory records can be exported as PDF for the
Inventory Manager to submit physical copies to the accounts department." The BOM half exists.
The inventory half was never built, and the workbook folded it under D-024 without its own
defect ID, which is how it stayed invisible. This is the only unimplemented REQUIRED obligation
in the build.

**Approach.** Follow `reports.controller.ts`, which already pairs `expenses/export.csv` and
`expenses/export.pdf` off one query contract. Add an inventory export beside it reading current
stock by product with its location breakdown. Reuse the existing PDF renderer and letterhead.
**NEWSURF** new endpoints, new i18n keys, probably a new report contract in `packages/shared`.
**Risk** it must read stock, never write it; no call into `StockService` mutators.

### P-02 · D-002 — the catalogue picker truncates past 100 products
**Sev** Medium · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** RF-08

`a6c1355` fixed the picker asking for 200 against a max of 100. It still stops at 100 silently,
so a catalogue larger than that hides items with no indication.

**Approach.** Give it the `fetchAllProjects` paging treatment. No ruling required (recorded
2026-08-23). **Red first** a web test with a stubbed client returning >100 products, asserting
the 101st is reachable.

### P-03 · D-003 — a past approval deadline is accepted server-side
**Sev** Medium · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** RF-N08

The field's own helper text says "Pick today or later" and the client enforces it; the server
does not. A requisition submitted with a past deadline is created already Overdue and can trip
the §5 reminder at the moment of submission. This is the UI promising something the API does not
keep, which is an internal inconsistency in shipped surface, not a new rule.

**Approach.** Refine the **submit** schema, not the draft-save schema: a draft is allowed to hold
an incomplete or stale deadline, and rejecting on save would break the draft flow. Compare
against the same configured clock `fe24745` standardised on, never `new Date()`.
**Red first** an integration test submitting a past deadline and expecting a 400.

### P-04 · D-004 — the draft edit form does not repopulate Department and Project
**Sev** Medium · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** RF-11

Values survive the save and the record header shows them, so this is display only. Both dropdowns
render "No department" / "No project" on edit. Most likely the form's default values are computed
before the async option lists resolve, so the select has no matching option at mount.

**Approach.** Locate the requisition edit form, confirm the cause before changing anything, then
either defer form initialisation until options load or key the form on the loaded data.
**Red first** a web test mounting the edit form with a saved department and project.

### P-05 · D-005 — a raw validation-library string reaches the user
**Sev** Low · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** RF-N01, UX-04

The Item field shows "String must contain at least 1 character(s)" while its neighbours correctly
show "Required". A zod default message is leaking because that field's schema has no explicit
message.

**Approach.** Give the schema an explicit message, sourced from `i18n/en.ts` rather than a
literal. Check whether other `.min(1)` schemas leak the same way and fix them together.
**NEWSURF** likely a new i18n key.

### P-06 · D-006 — Department, Project, Reason and Approval deadline are all optional
**Sev** Medium · **SPEC** NO-BASIS · **Status** BLOCKED · **Tests** RF-N12

§3 lists these as per-request fields but never says they are mandatory. §5's reminder flow cannot
function without a deadline, which is the strongest argument for requiring at least that one.

**This is a STOP.** Making a field required changes what the system decides, not merely what it
does by accident, and the requirements are silent. Per `70-assist-handoff.md` a NO-BASIS rule
change is not implemented without the lead.

**Question for the ruling.** Which of the four become mandatory at submit, and does the answer
differ for a draft? My recommendation: require **Department** and **Approval deadline** at submit
(department is the basis of every expenditure report; the deadline is what §5 runs on), leave
Project optional because not all work is project-linked, and leave Reason optional but consider
requiring it at or above the expense threshold.

### P-07 · D-009 — dashboard copy contradicts the build
**Sev** Cosmetic · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** UX-01

Reads "Inventory, borrowing, requisitions and BOM arrive in later phases" while all four are
live. **Approach** copy change in `i18n/en.ts`. **NEWSURF** an i18n key value.

### P-08 · D-010 — sidebar "Products" opens a page headed "Inventory"
**Sev** Cosmetic · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** UX-02

**Approach, after reading the nav.** The opposite of the first guess. The sidebar item sits in a
coherent triplet, Products / Categories / Locations, all pointing at `/inventory/*`. The nav is
right and the **page heading** was the outlier, so `t.inventory.title` becomes "Products". Its
sole usage is `InventoryPage.tsx:59`, so nothing else shifts.

### P-09 · D-011 — three date formats across the application
**Sev** Cosmetic · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** UX-06, AA-06

`2026-08-13`, `Aug 12, 2026`, and `8/13/2026, 1:57:26 PM` all appear. The third is a raw
`toLocaleString()`, which also means the rendered format follows the viewer's machine rather than
the configured Asia/Dhaka locale.

**Approach.** One `formatDate` / `formatDateTime` pair, used everywhere, honouring the configured
timezone. This is cross-cutting, so it takes its own gate. Not a token or copy change, so it does
not belong in the B2 batch.

### P-10 · D-012 — every page shares one browser title
**Sev** Cosmetic · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** UX-10

**Approach.** Per-route title, composed from an i18n key plus the product name so the tab reads
"Requisitions · IMS". Titles are copy and belong in `i18n/en.ts`, not in the route table.

### P-11 · D-013 — server-side per-role authorisation is unverified
**Sev** Medium · **SPEC** REQUIRED §2 · **Tests** AC-08, XX-08

Not a reported failure. QA established that the UI blocks and that anonymous requests get 401,
but never established that an **authenticated** user lacking a role is refused by the API. That
is the check that matters, and it is unproven rather than broken.

**Approach.** Read `permissions.int-spec.ts` first and map what it already covers. Fill the gaps
with table-driven tests: for each restricted route, a session holding only GENERAL expects 403.
**If a genuine hole is found, that is a STOP** — auth and permissions are on the STOP list, and
the finding gets reported before any fix is written.

### P-12 · D-015 — a failed submit silently becomes a draft and burns a reference
**Sev** Medium · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** XX-03

Submitting a below-threshold requisition with no sub-threshold approver configured surfaces only
the approver error, while a draft is created and a reference number consumed with no indication.

**Approach.** Keeping the work is the right behaviour; doing it silently is the defect. Tell the
user the draft was saved and give them the reference. This is a messaging fix, not a change to
what the system decides, so it stays out of STOP territory. Confirm the reference number is not
also consumed on a validation failure that creates nothing.

### P-13 · D-017 — totals are computed from invalid input
**Sev** Low · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** XX-05

Quantity −5 and unit price −1000 display a line total of 5,000.00, because two negatives multiply
to a positive. 99,999,999,999 is likewise totalled before submit rejects it.

**Approach.** Suppress the total while any operand fails its own field validation, rather than
special-casing the sign. Both the line total and the requisition total.

### P-14 · D-018 — "Reason" is labelled "NOTE" on the detail page
**Sev** Cosmetic · **SPEC** REQUIRED §3 (the field is named Reason) · **Tests** XX-06

**Approach.** i18n key change on the requisition detail page.

### P-15 · D-019 — the list re-sorts with no sort indicator
**Sev** Low · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** XX-07

An edited draft jumps to the top; headers show no sort state and are not clickable.

**Approach.** The smallest honest fix is to show the sort that is actually applied. Making the
headers sortable is a feature, not this defect. Indicate "Last updated, newest first" and stop
there unless the lead asks for more.

### P-16 · D-025 — funding validation gives no usable feedback
**Sev** Medium · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** AA-01, FL-06, FL-07

The refusal itself is correct. The feedback is a toast reading "Please correct the highlighted
fields" with nothing highlighted, no `aria-invalid`, no inline message and no `max` on the input.

**Approach.** Map the server's field errors onto the inputs the way `25a8f3d` did elsewhere, set
`aria-invalid`, and render the reason inline. The toast should stop promising a highlight it does
not deliver. Check whether the funds panel bypasses the shared error-mapping helper.

### P-17 · D-026 — BOM preview subtotal and variance never recompute
**Sev** Medium · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** AA-02

Line totals update; the header figures stay frozen at their initial values. The generated document
is correct, so this is preview only, but it is the figure the IM approves before committing.

**Approach.** The header is almost certainly reading a value captured once at mount instead of
deriving from the live line state. Derive it. **Red first** a web test editing a line and
asserting the header follows.

### P-18 · D-027 — linked project is absent from the web BOM
**Sev** Medium · **SPEC** REQUIRED §9 · **Tests** BM-02

§9's field table requires Linked project, auto-filled from the request. The PDF carries it; the
web BOM header shows department only and the line table has no project column. The data is
present, since the New BOM candidate list renders "Engineering · Test".

**Approach.** Render it in the web view. A batched BOM draws from several requisitions, so the
project belongs on the **line**, not only in the header, matching how `09-bom.md` says purpose and
project are inherited per line.

### P-19 · D-029 — BOM history repeats the same event three times
**Sev** Cosmetic · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** AA-07

Three identical `BOM_GENERATED` entries, same timestamp and actor, apparently one per source
requisition with nothing to distinguish them.

**Approach.** A **display** fix. `requisition_events` is append-only and the rows are legitimate,
one per source requisition, so nothing is deleted or merged in the database. Either label each
with its source requisition or collapse them in the view.
**INVARIANT** append-only `requisition_events`; this change must not delete or rewrite a row.

### P-20 · D-031 — settings audit entries record no before/after
**Sev** Medium · **SPEC** DERIVED (§11 makes the threshold a runtime control) · **Tests** BB-02

The entry reads only "Updated setting EXPENSE_THRESHOLD_BDT". Neither value is captured, so the
log cannot reconstruct what a financial control was set to at a past date, which is most of the
reason to audit a settings change at all.

**Approach.** Capture old and new into the audit row's metadata at write time, matching how
`28b0ae8` resolved the actor at write time rather than at read time. **NEWSURF** audit metadata
shape. **INVARIANT** the audit log is append-only, and `settings.update` is in the always-on set,
so this must not make the write fallible: a failure to read the old value must not block the
settings change.

### P-21 · oversized JSON body returns 500 instead of 413
**Sev** Medium · **SPEC** NO-BASIS (defect in shipped surface) · **Tests** `throttling.int-spec.ts`

The one red test in the suite, and a real defect rather than a flaky expectation. The body parser
rejects the payload, but the resulting error reaches the global filter as an unmapped 500 instead
of a 413.

**Approach.** Map the parser's `entity.too.large` onto a 413 in the global exception filter.
**Red first** already exists, and it is red for the right reason. **NEWSURF** possibly a new
`ErrorCode` member, which if added needs its `i18n/en.ts` copy entry in the same commit and takes
its own gate.
