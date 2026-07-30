# Phase 05 — Funds, purchasing, signatures and the finished BOM

**Goal:** close the loop. Money in, goods bought, invoice filed, stock back in the register — and
a BOM document that is fit to hand to Accounts.

**Supersedes** the original 5.1–5.5 task list (fund receipts / lump-sum allocation / purchases /
receive-to-stock / tracker completion). Those were written against a guessed flow; the operator
has since specified the real one, which is linear and IM-driven. The original intent survives
inside tasks 5.4–5.6 below. Lump-sum allocation across a batched BOM is **dropped** from this
phase — see OQ-21.

**Reference:** `docs/reference/04-domain-model.md` §4.4, `docs/reference/05-user-flows.md` §5.2

---

## What already exists (do not rebuild)

Checked against the code on 2026-07-30, so the next session does not re-derive it:

- `RequisitionStatus` **already declares** `SENT_TO_ACCOUNTS`, `FUNDS_PARTIAL`, `FUNDS_RECEIVED`,
  `PURCHASED`, `STOCKED`, `CLOSED`. Only `PURCHASE_VERIFIED` is missing. The Postgres enum needs
  the same values — verify it does before assuming.
- `requisitions` already carries everything the new BOM header needs: `requisition_no`,
  `requester_id`, `department_id`, `project_id`, `reason` (this is the user's "description"),
  `requested_amount`, `approved_amount`, `submitted_at`.
- `PDF_LETTERHEAD_PATH` and the PDF margin variables already exist in the config schema, and
  `boms/bom-pdf.template.ts` already accepts a `letterheadUri`.
- `StockService.receive` is the only legal way to add stock, and already takes `refType`/`refId`
  for provenance.
- `PdfSigningService` already mints short-lived HMAC download URLs bound to one entity id —
  reuse it for invoices and signatures rather than inventing a second scheme.
- **No file-upload path exists anywhere yet.** `@nestjs/platform-express` is installed so
  `FileInterceptor` is available, but `multer` / `@types/multer` are not direct dependencies.

---

## Ordering

Each task is shippable on its own and leaves the suite green. The order is chosen so nothing is
built twice:

```
5.0 password policy            (independent, ~20 minutes)
5.1 file-upload foundation     ← everything with an image or an invoice depends on this
5.2 digital signatures         ← needs 5.1
5.3 BOM document redesign      ← needs 5.2 for the signature block, plus the letterhead asset
5.4 lifecycle: to accounts → funds → purchased
5.5 invoice + money saved      ← needs 5.1 and 5.4
5.6 purchase verified → add to inventory
5.7 purchase verified → borrow to user
5.8 expense reporting          ← reads what 5.4–5.6 write, so it comes last
```

---

## Tasks

### 5.0 Password policy — minimum 4 characters, no composition rules

`packages/shared/src/contracts/auth.ts` currently sets `PASSWORD_MIN_LENGTH = 12` plus a `refine`
demanding upper case, lower case and a digit. Drop the minimum to `4` and delete the refine.

- That one file is the source of truth — the login form, the admin create-user form and the API
  all read it, so nothing else *should* need editing. **Verify that; do not assume.**
- Existing tests assert the old policy. Expect breakage in the auth and users specs; update the
  assertions to the new rule rather than deleting the tests.
- Seeded dev passwords stay valid.

*Accept:* a 4-character password with no digit and no capital is accepted on create-user, on
self-service change, and at login; a 3-character one is rejected with a clear message.

> **Said once, then built as asked.** Four characters with no composition rule is about 1.7 million
> combinations — instant to crack offline if the database is ever taken, and guessable online in
> minutes without a limiter. What makes it defensible here: internal tool, single VM, office
> network, `/auth/login` capped at 10 attempts per minute per IP, plus a per-email throttle on top.
> **Do not weaken either limiter and do not reduce the password hashing cost** — those are now the
> only things standing behind this. Recorded as OQ-17.

---

### 5.1 File-upload foundation

One boring shared upload path, built once, used by signatures (5.2) and invoices (5.5).

**Add:** `multer` + `@types/multer` as direct dependencies of `apps/api`.

**Service:** `FileStorageService` in a new `modules/files/`.

- Files land under the existing storage volume in a sibling directory (`FILE_STORAGE_DIR`,
  defaulting alongside `PDF_STORAGE_DIR`), never in the web root.
- Filenames are **server-generated** (`randomUUID()` + a validated extension). A client-supplied
  filename is display metadata stored in a column — never part of a path.
- Reuse `pdf-renderer.service.ts`'s `absolutePathFor` containment check verbatim; it already
  refuses a resolved path outside the storage root.
- Write-then-`rename`, as the PDF renderer now does, so a concurrent read never sees a partial file.
- **Validate by magic bytes, not `Content-Type`.** PNG `89 50 4E 47`, JPEG `FF D8 FF`,
  PDF `25 50 44 46`. A caller controls the header; they do not control the first four bytes.
- Size caps from config — `UPLOAD_MAX_IMAGE_BYTES` (~2 MB) and `UPLOAD_MAX_DOCUMENT_BYTES`
  (~10 MB). Two separate limits, both in config, no literals at the call site.
- Serving is **never** a static route. Downloads go through `PdfSigningService`-style signed,
  expiring, entity-bound URLs, so a leaked path on its own is useless.

**Table:** `stored_files(id, kind, relative_path, original_name, mime_type, size_bytes,
uploaded_by, created_at)`, `kind` an enum (`SIGNATURE`, `INVOICE`). Referencing rows point at
`stored_files.id` so provenance and cleanup live in one place.

*Accept:* a PNG renamed to `.pdf` is rejected; a 3 MB image is rejected against a 2 MB cap; a
path-traversal filename cannot escape the storage root; a stored file is unreachable without a
valid signed URL.

---

### 5.2 Digital signatures for approvers and the IM

**Upload.** `POST /users/me/signature` (multipart, PNG/JPEG, image cap). Any user holding
`APPROVER`, `INVENTORY_MANAGER` or `ADMIN` may upload **their own**; nobody may upload anyone
else's. `users.signature_file_id → stored_files.id`, nullable.

**Immutability matters here.** A new upload must **insert a new `stored_files` row** and repoint
the user — never overwrite the old file. A BOM printed in July has to keep rendering the signature
that was actually used; an overwrite would silently rewrite a signed document. Same
freeze-for-history rule the approval snapshot already follows.

**Approving.** `decideRequisitionSchema` gains `withSignature: boolean` (default `false`).
`requisition_approvals` gains:

- `signed_with_signature boolean not null default false`
- `signature_file_id uuid null references stored_files(id)` — **snapshotted at the moment of
  approval**, not read live from the user row at print time.

If `withSignature` is true and the approver has no signature on file, reject with a typed error
naming the fix. Do not silently approve without it.

**UI.** Two buttons on the approve action — "Approve with signature" / "Approve without
signature" — plus a signature panel on the profile screen showing the current image and its
upload date.

*Accept:* approving with a signature stores the file id on the approval row; the approver later
replacing their signature does **not** change what an already-generated BOM renders; a user can
neither upload nor read another user's signature.

---

### 5.3 BOM document redesign

The current document is congested: a meta table, a per-source section, a line table carrying
vendor/purpose/project, and a dense footprints table with stage/slot/designation/acted-at/
on-behalf-of. Replace with a clean one-page layout.

**Letterhead.**
- Copy `SIOT_logo_black (1).png` into the repo at a stable path — the space and parenthesis in
  that filename will break something eventually. Suggest `apps/api/assets/letterhead/siot-logo.png`.
- Company identity is **configuration, not literals** (rules/10): `COMPANY_NAME`,
  `COMPANY_ADDRESS_LINES`, `COMPANY_LOGO_PATH` in the config schema, seeded in `.env.example`.
  Seed values: `Southern IoT`, and `House 26, Road 13, Sector 14, Uttara, Dhaka - 1230, Bangladesh`.
- Embed the logo as a base64 data URI, as the letterhead already is — Chromium in the container
  must not depend on a filesystem path resolving at render time.

**Header block** — exactly these fields, in this order:

| Field | Source |
|---|---|
| BOM Number | `boms.bom_no` |
| Requisition From | requester's `full_name` |
| Date | BOM `generated_at` |
| Department | `requisitions.department_id → departments.name` |
| Project | `requisitions.project_id → projects.name` |
| Description | `requisitions.reason` — the text the user typed at submit |
| Total Money Requested | `requisitions.requested_amount` |
| Approved Money | `requisitions.approved_amount` |
| Remaining | **OQ-18 — do not guess** |

**Item list:** #, Item, Qty, Unit cost, Line total, then **Subtotal**. Drop vendor, purpose and
project from the printed table; that is per-line working detail, and it belongs on screen rather
than on the document Accounts signs.

**Signature block** — one cell per approver in chain order (IM first, then approvers by slot):

- the signature image when `signed_with_signature`, otherwise blank space of the *same height* so
  the layout does not jump between documents;
- the approver's **name** beneath it;
- the word **Approved** beneath the name — in both cases;
- the **date** they acted;
- a ruled line and "Date" for wet-signing wherever nobody signed digitally.

*Accept:* the document fits one page for a typical 5–10 line BOM; logo, company name and address
all render from config; an approval made without a digital signature still shows the name and
"Approved" above an empty signature area.

---

### 5.4 Lifecycle: Sent to Accounts → Money Received → Purchased

Extends the tracker past `BOM_GENERATED`. **Every transition is Inventory-Manager-only**, and each
writes the status change, a `requisition_events` row, an audit row and a notification — all in one
transaction, following the pattern already established everywhere else.

**Migration.** Add `PURCHASE_VERIFIED` to the `requisition_status` Postgres enum, and new event
types: `SENT_TO_ACCOUNTS`, `FUNDS_RECEIVED`, `FUNDS_RETURNED`, `PURCHASED`, `PURCHASE_VERIFIED`,
`STOCKED`, `BORROWED_OUT`, `CLOSED`.

> Adding a value to a Postgres enum **cannot be rolled back**, and on older servers cannot run in
> a transaction alongside other DDL. Write the `down` as an explicit no-op with a comment saying
> why, rather than pretending it reverses.

**State machine** — reject any other transition with a typed error naming the current state; never
silently allow one:

```
BOM_GENERATED ─→ SENT_TO_ACCOUNTS ─→ FUNDS_PARTIAL ⇄ FUNDS_RECEIVED ─→ PURCHASED
                                                                           │
                                                     PURCHASE_VERIFIED ←───┘
                                                             │
                                               STOCKED ←─────┴─────→ (borrowed out)
                                                             │
                                                          CLOSED
```

**Tables.**

- `fund_receipts(id, requisition_id, amount, received_at, reference, note, recorded_by, created_at)`
  — multiple per requisition. `FUNDS_PARTIAL` while `SUM(amount) < approved_amount`,
  `FUNDS_RECEIVED` once it reaches it. **Compute from the rows**; never keep a running-total
  column that can drift.
- `purchases(id, requisition_id, vendor, invoice_no, purchased_at, total_amount, note,
  recorded_by, created_at)`.
- `purchase_lines(id, purchase_id, requisition_item_id, bom_line_id, quantity, unit_cost)` — a
  purchase line may not exceed its BOM line quantity without an explicit override flag and a note.

*Accept:* a requisition walks BOM_GENERATED → CLOSED with every step on the tracker; partial
funding shows honestly as partial with the outstanding balance rather than as complete; skipping a
step is refused with a message naming the current state.

---

### 5.5 Invoice upload and money saved

At the verify-purchase step the IM uploads the invoice and, if the purchase came in under the
funded amount, records what went back to Accounts, with a note.

- `purchases.invoice_file_id → stored_files.id`, plus `invoice_uploaded_by` / `invoice_uploaded_at`.
- `fund_returns(id, requisition_id, amount, note, recorded_by, returned_at, created_at)` — a
  **separate table, not a negative `fund_receipts` row**. Keeping returns distinct is what lets the
  three-figure view and the expense report stay truthful about what was received versus what came
  back; a signed amount in one table turns every future `SUM` into a judgement call.
- The note is **required** whenever `amount > 0` — "money came back and nobody said why" is exactly
  the gap this feature exists to close.
- Guard: a return cannot exceed `SUM(fund_receipts) − SUM(purchases.total_amount)` for that
  requisition. Enforce in the service **and** as a database constraint wherever expressible.
- Invoice download goes through a signed URL; only the IM, Admin, the requester and that
  requisition's approvers may mint one.

*Accept:* verifying a purchase with an invoice moves the requisition to `PURCHASE_VERIFIED` and the
invoice is downloadable only by the permitted roles; recording savings writes a `fund_returns` row
with its note, and the tracker shows the returned amount.

---

### 5.6 Add to inventory

Once a purchase is verified, the IM can put the goods into stock from the same screen.

- Per purchased line: choose a compartment; if the requisition line was a free-text item with no
  `product_id`, create the catalogue product first (category, unit, code) and link it back to the
  requisition item.
- Then call **`StockService.receive`** — nothing outside `StockService` writes stock — with
  `refType: 'REQUISITION'` and `refId` the requisition id, so the ledger row traces back.
- Status → `STOCKED` once every line is received; a partial receipt stays honest and shows counts.

*Accept:* a requisition for a brand-new item ends with that item searchable, borrowable, and
carrying a ledger row pointing at the requisition. The nightly reconciliation still balances.

---

### 5.7 Borrow to user

The other exit: goods bought for one person go straight out to them instead of onto a shelf.

- The IM opens "Borrow to user" on the verified purchase, picks the user (defaulting to the
  requester), quantity and expected return date, and submits **on that user's behalf**.
- `BorrowingService.create` currently takes the actor as the requester. This needs an explicit
  on-behalf-of path where **actor ≠ requester**: the borrow row records the requester, the audit
  row records the IM as actor, the notification goes to the borrower.
- The borrow is created **and issued** in one operation — the IM is the approver, so routing it
  back to themselves for approval is theatre. It must still go through `StockService` (receive into
  a compartment, then issue) so the ledger and `reserved_qty` stay correct. Do **not** shortcut
  straight to "issued" without the stock movements.
- Event `BORROWED_OUT` on the requisition tracker.

*Accept:* the borrower sees it under "My borrowings" with a return date; the ledger shows a receipt
followed by an issue; the audit row names the IM as actor and the borrower as subject; stock
arithmetic reconciles.

> **Watch out:** G-14 is still open — `borrowing.decide` commits the status in one transaction and
> moves stock in another. Do not copy that shape here. Fix G-14 first, or build this path
> transactional from the start.

---

### 5.8 Expense reporting

Visible to `APPROVER`, `INVENTORY_MANAGER` and `ADMIN`. Not to `GENERAL`.

- `GET /reports/expenses?from=&to=&groupBy=month|department|project`
- Per bucket: **requested**, **approved**, **funded** (`SUM(fund_receipts)`), **spent**
  (`SUM(purchases.total_amount)`), **returned** (`SUM(fund_returns)`), and net
  (`funded − returned`). Six figures that must always reconcile against each other.
- Money is `NUMERIC` and arrives from pg as a string — keep it out of floats all the way to the
  formatter, as the rest of the codebase already does.
- Index `purchases(purchased_at)`, `fund_receipts(received_at)`, `fund_returns(returned_at)`.
- UI: a summary row, a month/range picker, a table. Charts are not required — do not add a
  charting dependency for this.

*Accept:* totals reconcile against the underlying rows for a hand-built fixture; a General user
gets 403; a range with no activity renders an empty state rather than zeros pretending to be data.

---

## Exit criteria

- A requisition walks submit → approve → BOM → Accounts → funded → purchased → verified →
  stocked **or** borrowed out → closed, with every step on the tracker and in the audit log.
- The BOM PDF carries the Southern IoT letterhead, the nine specified header fields, a clean line
  table, and a signature block that renders digital signatures where they were used.
- Expense totals reconcile: `funded − returned` matches the fund tables for any range.
- Uploads cannot escape the storage root, cannot be fetched without a signed URL, and cannot be
  read by someone they do not belong to.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm --filter @ims/api test:int` all green.

## Open questions raised by this phase

Recorded in `docs/state/OPEN-QUESTIONS.md` as OQ-17 … OQ-22. **OQ-18 blocks task 5.3** — the
document cannot print a "Remaining" figure until someone says which subtraction it is.
