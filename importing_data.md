# Plan — CSV product import

**Opened:** 2026-09-22 · **Source:** Ayman, 2026-09-22 · **Status:** built, parts A–G and I–L.
H is optional and deliberately unbuilt. Two config values ship unmeasured — see §15.

An Import button on the inventory screen takes a CSV. The file is the desired state of the
catalogue: products, their categories, which shelf they sit on and how many are on each shelf.
Its columns are identical to an export, so the working loop is **export → hand to Claude → add or
amend → import**. Every import first snapshots what it is about to replace, so any of them can be
rolled back. A companion Claude skill turns loose product data into that exact shape.

**§13 and §16 are two review passes that between them changed eleven things**, and the build
changed more: §4.1 gained the blast-radius carve-out, §5.5 step 4 was corrected against what
`StockService` already knew, §11.6 resolved OQ-IMP-1, and the confirm-time re-validation turned
§5.5 step 5 into a backstop. Read every section as written, not as originally drafted.

---

## 1. Decisions

Ayman, 2026-09-22:

| # | Decision | Consequence |
|---|---|---|
| I1 | A product present in the system but absent from the file is **deactivated** | Not deleted — the database makes deletion impossible (§3.2). History, ledger and borrows survive; the product leaves every list and picker, and can be switched back on. |
| I2 | Import writes **catalogue *and* stock**, behind a mandatory **confirm step** | Every quantity change becomes an `ADJUST` ledger row. Nothing is written until a human approves a diff. |
| I3 | An unknown room, zone or compartment **rejects the import** and is named. A location may be **blank only when the quantity is blank or zero** | No location is ever invented. A catalogue entry with no stock needs no shelf. |
| I4 | `description` is **not mandatory** | |
| I5 | Every import **snapshots the previous state** before applying. Snapshots are browsable, one-click restorable, and deletable | §10. The snapshot is itself a round-trip file, so restoring is just an import — no second format, no second code path. |
| I6 | Volume is unknown — "maybe 5000 or more, maybe less than 500" — and **must not crash the system** | §11 is the research answer, and it changed the design. |

Taken by me, stated so they can be overruled:

| # | Decision | Why |
|---|---|---|
| I7 | The apply phase is **one transaction** | "Overwrite everything" with no undo makes a half-applied file the worst possible outcome. §5.5 and §11.3 cover what that costs. |
| I8 | Import may create **categories**, never locations | Categories are cheap to merge and rename; a wrong shelf sends someone to the wrong aisle. |
| I9 | A read-only column that was edited produces a **warning, not an error** | Silently discarding somebody's typing is worse than telling them it was ignored. |
| I10 | **No per-adjustment audit row.** One `import.apply` audit row, and the ledger carries the detail | §11.2. Five thousand `stock.adjust` rows for one human action would swamp the audit log and cost a third of the import's runtime. |
| I11 | **Re-running the same file is a no-op.** Idempotence is a guaranteed property, not an accident | Falls out of declarative desired-state semantics, and §15 tests it. Worth relying on: a failed import can simply be re-run. |

---

## 2. What the brief asked for that the system cannot do

Three collisions with how this database works, all confirmed by reading the schema.

### 2.1 `in use` and `total` cannot be imported

`in_use` is **not a column**. It is computed per request from `borrow_requests` — the sum of
`quantity − returned_qty` over `ISSUED` and `PARTIALLY_RETURNED` (`products.repository.ts:25-32`).
A CSV cannot create a loan, so it cannot set this. `total` (`totalOwned`) is `on_hand + in_use`,
also derived; so are `available`, `reserved` and `quarantined`.

**The only writable quantity is on-hand, per shelf.** The rest are exported for information and
ignored. This is a good thing: a spreadsheet that could set `in_use` would let a typo claim eleven
laptops are with staff who never took one.

> "If any counting value is null … count as 0" applies to the one column it can: a blank `on_hand`
> means zero at that shelf. A blank read-only column is ignored.

### 2.2 Nothing can be deleted

Every foreign key to `products.id` is `ON DELETE RESTRICT` — `stock_placements`, `stock_ledger`,
`borrow_requests`, `requisition_items`, `bom_items` — and `stock_ledger` is append-only by trigger.
One movement and the product row is permanent, by design:

```
/** Soft delete: history must keep resolving to a real product row. */
.addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
```

"Overwrite everything" is therefore **reconcile to the file**: create, update, deactivate (I1).

### 2.3 There is no undo at the database level

`stock_ledger`, `requisition_events`, `audit_log` and `borrow_holder_changes` each carry a
`BEFORE UPDATE OR DELETE OR TRUNCATE` trigger raising `restrict_violation`, for every role
including the one the app connects as.

This is why I5's snapshots matter and why they are **compensating, not reversing**: restoring a
snapshot writes new `ADJUST` rows that move the numbers back. The original movements stay in the
ledger forever, which is correct — they happened.

### 2.4 "No grammatical error and wrong name will be accepted"

No system knows that `Lenovo ThinkPda T14` is a typo. Pretending otherwise ships a feature that
lies. The honest split:

- **The importer enforces** structure: non-empty after trimming, no control characters, length
  caps, collapsed internal whitespace, no duplicate codes.
- **The importer warns** on near-duplicates using `pg_trgm`, already installed
  (`0001_init.ts:12`): *"Row 14 'Lenovo ThinkPad T-14' is 0.91 similar to 'Lenovo ThinkPad T14'"*.
  Warnings surface in the diff; they never block.
- **The Claude skill does the semantic work** (§9), and the server trusts none of it.

---

## 3. What the codebase forces

### 3.1 Stock writes

`StockService.adjust(input, context, auditContext?, existingTx?)` is the vehicle — signed delta,
one `ADJUST` ledger row. Read from the code:

- **It creates the placement** when the delta is positive (`lockOrCreatePlacement`). `receive`
  would be wrong: it writes a `RECEIPT`, claiming goods physically arrived.
- **`delta === 0` throws.** A row matching current stock is skipped, not passed through.
- **It accepts `existingTx`**, so the file shares one transaction.
- **It deletes the placement at zero**, nulling `borrow_requests.placement_id` (that FK is
  `ON DELETE SET NULL`). This loses nothing: `borrow_requests.compartment_id` is a separate
  `NOT NULL … ON DELETE RESTRICT` column (`0007_borrowing.ts:60-62`), so which shelf a historical
  borrow came from is durably recorded independently of the placement pointer.
- **It does not check the compartment is active.** `receive` and `move` do; `adjust` does not. The
  importer must, or a CSV can stock a decommissioned shelf.
- It refuses a product whose category is `is_trackable = false`.

The delta must be computed from a **locked** read. Reading a quantity, computing `target −
current`, then calling `adjust` applies that delta to whatever the row holds at lock time — the
exact bug `rules/40-database.md` exists to prevent.

### 3.2 Constraints that reject rows

`quantity >= 0` · `reserved_qty <= quantity` · `quarantined_qty + reserved_qty <= quantity` ·
`UNIQUE (product_id, compartment_id)`.

Lowering on-hand below `reserved + quarantined` **fails at the database**. `adjust` pre-checks and
throws `InsufficientStockError`, so validation catches it as a readable per-row rejection — and
§5.5 re-checks it under lock, because validation's answer can go stale (§16.2).

### 3.3 Categories

Sibling names unique, case- and whitespace-insensitive, via two **partial** indexes
(`categories_root_name_key`, `categories_sibling_name_key`) — violations arrive as `23505` naming
the index. Depth capped at 3 and cycles refused by one trigger, both `check_violation` (`23514`)
with **different messages**, so the importer must surface the message text, not the code.
`products.category_id` is nullable since 0035.

### 3.4 Locations

`storage_id` (`MAI-MET-1A-0002`) is server-generated and **immutable by trigger** — which is
exactly what makes it usable as the stable key in §4.1. Its room and zone tokens are a snapshot of
the names at creation, so after a rename they legitimately diverge from the current names; the
resolution rule accounts for that. Compartments are deactivated, never deleted.

### 3.5 The timeout that shapes apply

```ts
statement_timeout: 60_000,
idle_in_transaction_session_timeout: 30_000,
```

Thirty seconds of idleness **inside an open transaction** kills the session. Parsing, file I/O or
awaiting anything non-database between statements counts. This does not forbid a long transaction
— it forbids one that waits. §5.5.

### 3.6 No realtime, no job framework

There is **no websocket**. `rules/30-frontend.md` claims one pushes invalidation signals; that
describes a design `DECISIONS.md` ruled out and which was never built. **That rule is stale and is
corrected as part of this work.** Every cron job is fire-and-forget with no persisted state. No
progress pattern, no queue, no full-screen blocking UI — all three are new.

### 3.7 Uploads

`FileStorageService` validates magic bytes and allows PNG, JPEG, PDF only. CSV needs new
`StoredFileKind` members, its own ceiling, and validation that copes with a format having no magic
bytes (§12 C22).

---

## 4. The file format

One row per **product per shelf**. A product on two shelves has two rows with its product columns
repeated — the only shape that can express reality. The current catalogue already splits a ThinkPad
7/3 across two compartments, and one-row-per-product would silently collapse that into a stock
movement nobody asked for. It also matches the existing report export, already one row per
placement.

### 4.1 The resolution rule — read this before the table

**Every reference in this file is carried twice: an immutable id, and a human-readable text path.**
Resolution is id-first, with the text as both fallback and cross-check:

| Situation | Outcome |
|---|---|
| Both resolve, to the same thing | Use it |
| Both resolve, to **different** things | **Error** — the file is ambiguous about intent |
| Id blank, text resolves | Use the text. *This is how you re-point a reference* |
| Id blank, text does not resolve | Create it where the column allows creation (I8), else error |
| Id resolves, text does not | Use the id, **warn**: renamed since the export |
| Id does not resolve | **Error.** Never fall back to the text — see the carve-out below |
| Both blank | The reference is empty, where that is allowed |

The second-to-last row is why **restoring a snapshot survives a rename**. Without it, a snapshot
taken before someone renamed a category would rebuild that category as a duplicate and file
products into it while the renamed one sat empty (§16.7).

This rule applies to `category_id`/`category_path` and to `storage_id`/`room`+`zone`+`compartment`
today, **and to any mutable-text reference added to this file later**. A new such column inherits
it rather than needing its own fix.

#### The carve-out: blast radius, not column type

The table above is safe for a *reference* — a column saying which existing thing this row points
at. Guess wrong about a shelf or a category and the row lands in the wrong place: visible in the
diff, visible on screen afterwards, one edit to correct. The cost of a wrong guess is bounded by
the row that made it.

**`product_id` and `product_code` are not references. They are the row's own identity, and a wrong
guess there corrupts a *different, unrelated record*.** Fall back from a blank `product_id` to a
`product_code` that happens to match, and a single mistyped code silently overwrites another
product's name, unit, category and shelves — a product nobody was editing, which appears nowhere
in the diff as a thing being changed, and which nobody will look at. So:

- **Blank `product_id`, `product_code` matches an existing product → error**, naming the product
  the code belongs to and saying to paste its `product_id` if an update was meant.
- **`product_id` present and unresolvable → error** (C29), never "treat as new".
- **Two blank-id rows sharing only a name → error** (§4.3, C4), never a name-match merge.

The governing question for any column added later is therefore **not** "is this an id or a text
path" but **"if the importer guesses wrong here, does the damage stay inside this row?"** If it
can reach a record the file was not otherwise touching, the answer is an error and a message, not
a fallback. Recorded in `DECISIONS.md` 2026-09-22.

### 4.2 Columns

| # | Column | Role | Blank allowed? | Notes |
|---|---|---|---|---|
| 1 | `product_id` | key | yes | UUID. **Blank means new.** |
| 2 | `product_code` | write | yes* | `LAP-0001`. Unique, case/space-insensitive. Blank on a new row → generated (0036). **\*Required when a new product spans more than one shelf** — §4.3. |
| 3 | `product_name` | write | **no** | Trimmed, whitespace collapsed. |
| 4 | `description` | write | yes | I4. |
| 5 | `unit` | write | **no** | `pcs`, `m`, `kg`… |
| 6 | `category_id` | key | yes | Per §4.1. |
| 7 | `category_path` | write | yes | `Electronics / Computers / Laptops`. Max 3 segments. Blank + blank id = uncategorised. Per §4.1; created if absent (I8). |
| 8 | `default_returnable` | write | **no** | `yes`/`no`. The borrow form's default. |
| 9 | `status` | write | **no** | `Active` / `Inactive`. |
| 10 | `storage_id` | key | yes | `MAI-MET-1A-0002`. Per §4.1. Never written — immutable by trigger. |
| 11 | `room` | text ref | **only if qty blank or 0** | Must already exist (I3). |
| 12 | `zone` | text ref | **only if qty blank or 0** | Must exist within that room. |
| 13 | `compartment` | text ref | **only if qty blank or 0** | The code, e.g. `1A`. Must exist within that zone. |
| 14 | `on_hand` | **write** | → 0 | **The only writable quantity.** Units on this shelf. |
| 15 | `reserved` | read-only | → 0 | Held by pending borrows. |
| 16 | `quarantined` | read-only | → 0 | Returned damaged; present but not takeable. |
| 17 | `available` | read-only | → 0 | `on_hand − reserved − quarantined`. |
| 18 | `in_use_total` | read-only | → 0 | Product-level. Out on loan. §2.1. |
| 19 | `owned_total` | read-only | → 0 | Product-level. `sum(on_hand) + in_use`. |

Product-level read-only columns repeat on each of a product's rows. Wrong for a pivot table, right
for a human editing in Excel — and this file is for editing. The report export at
`/reports/inventory/export.csv` stays as it is, for pivoting. Two files on purpose: one for people
and accounting, one a data interchange format with IDs. The brief's "import and export structure
will be the same" holds where it matters — between *this* export and *this* import.

### 4.3 What groups two rows into one product

For an existing product, `product_id`. For a **new** product the id is blank by definition, so
something else has to say that rows 14 and 15 are one product on two shelves rather than two
products that happen to share a name.

**Grouping is by `product_code`, never by name.** Name-matching splits one product in two on a
typo, and merges two genuinely distinct products that share a name — different SKUs from different
factories is not a hypothetical.

So: **a new product occupying more than one shelf must supply a non-blank `product_code`.** A
single-shelf new product may leave it blank and have one generated. A group of blank-id rows
sharing a name with no shared explicit code is a validation error naming every row involved
(§5.3 stage 4), not a silent merge or a silent split.

### 4.4 Header line

```
# ims-product-import v1 · exported 2026-09-22T10:00:00Z · schema 0038 · origin <deployment-id>
product_id,product_code,product_name,...
```

Checked on import (§12 C19). A file from another deployment has meaningless `product_id` values
and must be refused, not silently turned into 400 duplicates. A **restore** checks the schema
version but not the origin — it is this deployment's own file by construction (§10).

### 4.5 What a blank location means — the dangerous case

Under I3 a product may have a row with no shelf. Under I1 the file is the desired state. Put
together, there is one reading that must be spelled out:

> **A product's shelf rows in the file are the complete list of where it is.** A shelf the product
> currently occupies but the file does not mention is adjusted to **zero**.

So a product represented *only* by a blank-location row ends with no stock anywhere. That is
consistent with "overwrite everything", it is how you legitimately clear a shelf — and it is also
how somebody deletes their stock by tidying up a spreadsheet.

**This is what the confirm step is for.** The diff calls it out per product (§5.4).

---

## 5. The pipeline

Six stages. Nothing is written before stage 5.

```
1 Upload  →  2 Parse  →  3 Validate  →  4 Preview  →  5 Lock, snapshot, apply  →  6 Report
  stored     streamed    read-only     human gate    lockout → file → one tx     downloadable
```

### 5.1 Upload

`POST /inventory/imports` — multipart, IM/Admin only, one file, `fields: 0` as the existing upload
path does. Stored with a new `PRODUCT_IMPORT` kind. Creates an `import_jobs` row in `VALIDATING`.

### 5.2 Parse

Streamed, RFC 4180, hand-rolled to match the two existing exports — roughly 80 lines, against a
dependency that is a supply-chain decision. Streaming bounds memory and lets the row cap fail fast
(§11.1).

### 5.3 Validate — the whole file, read-only

Each stage collects **all** its failures before stopping. Fixing errors one round trip at a time is
what makes people abandon an importer.

1. **Structural** — fingerprint, encoding, headers known, row count within cap.
2. **Nulls** — the brief's first check. Every non-nullable blank collected as
   `row 14, column "unit" is empty`. Numeric blanks become 0 and are not errors. Location blanks
   are errors only when the quantity is non-zero (I3).
3. **Types and ranges** — integers, non-negative, `yes`/`no`, sane maxima.
4. **Internal consistency** — duplicate `product_id`; duplicate `product_code`; a product twice on
   one shelf; a product's rows disagreeing about its own name; **a name-matched group of blank-id
   rows spanning more than one shelf with no shared `product_code`** (§4.3).
5. **Referential** — every reference resolved per §4.1, including the ambiguity error and the
   renamed-since-export warning; rooms/zones/compartments active; category paths ≤ 3 deep.
6. **Domain** — on-hand not below `reserved + quarantined`; quantity on an untrackable category;
   a code colliding with a different product.
7. **Warnings** — near-duplicate names and categories; edited read-only columns; products about to
   be deactivated that still have units out on loan; **products losing all their shelves** (§4.5);
   **references whose text no longer resolves but whose id does** (§4.1).

Errors → `FAILED`, report attached, nothing written. The UI lists them and offers a CSV of
`row, column, value, problem`.

### 5.4 Preview — the human gate (I2)

Clean validation produces a diff; the job waits in `AWAITING_CONFIRMATION`:

```
   12 products created
   40 products updated        (6 renamed, 3 recategorised)
    3 products deactivated    ⚠ 1 still has 4 units out on loan
    5 categories created      Electronics / Sensors / Lidar, …
  200 units adjusted across 31 shelves   (+340 / −140)

  ⚠ Lenovo ThinkPad T14 — 10 units at Main Store / Meta / 1A will be removed
    (no shelf rows for this product in the file)
  ⚠ 4 locations were renamed since this file was exported — matched by their
    permanent shelf label, not by name. Main Store / Meta / 1A is now
    Central Store / Meta / 1A.
  ⚠ 1 category was renamed since this file was exported — "Laptops" is now
    "Notebooks"; products will be filed under "Notebooks".
```

The last two are the §4.1 fallback surfacing to the person approving a restore. A rule that only
lives in the validation layer is a rule nobody approving the change ever sees.

The file's hash is recorded at upload and rechecked at confirm — a job cannot be confirmed against
a file that changed underneath it.

### 5.5 Lock, snapshot, apply

**Order matters, and this is not the order it was first drafted in.**

1. **Engage the lockout** (§8). Before anything else, so nothing can write from here on.
2. **Take the snapshot** (§10) — outside the transaction, because it is file I/O and §3.5 forbids
   that inside one. Because the lockout is already up, the snapshot is a faithful pre-image of
   exactly what is about to be overwritten. Taking it before the lockout would leave a window in
   which a write lands between snapshot and lock, making the rollback file quietly wrong
   (§16.5). If the snapshot fails, the import stops (§12 C38).
3. **Open the transaction.** `SET LOCAL lock_timeout`.
4. **Lock every affected placement**, **ordered by id ascending** — the deadlock rule from
   `rules/40-database.md`. ~~One statement, not one per row.~~ **Corrected 2026-09-23: one
   statement is not sufficient, and this codebase already knew.** `StockService` documents it
   against `lockPlacementsInOrder`: *"A single `ORDER BY id ... FOR UPDATE` is not sufficient —
   the planner is free to lock in scan order before the sort is applied."* So the import follows
   the established pattern instead — pre-create the rows that need creating, read their ids, then
   take one lock per id in ascending order — in `StockService.lockPlacementsForImport`. It costs
   one round trip per changed shelf more than §11.2 budgeted, which the benchmark will measure.
5. **Re-check the domain constraints against the locked rows**, in memory, before any write. This
   costs microseconds and turns the one plausible late failure — a borrow raising `reserved_qty`
   while somebody read the diff — from a three-minute wasted transaction into an instant, precise
   rejection (§16.2).

   **What part G changed about this, and what part I will finish changing.** Building the plan at
   confirm — outside the transaction, as step 3's no-I/O rule requires — re-runs validation there,
   so the late borrow is now rejected *before* the transaction opens. That is the synchronous
   confirm-time check this section listed as "the next lever", arrived at for free. This step is
   therefore already a backstop rather than the primary guard, and its window is confirm-to-lock
   rather than preview-to-apply.

   **Once §8's lockout exists, expect that window to close almost entirely** — every other write
   is refused 503 from before the re-validation until after the commit, so the only request that
   can still slip through is one already past the entry check at the instant the flag flipped.
   **Do not spend part I or later trying to engineer an integration test for that race: the
   feature being built is what closes it.** The mechanism is covered directly instead, by
   `import-apply-checks.spec.ts`, which calls it with a fabricated locked row.
6. Create categories (parents first, deduplicated across rows).
7. Create and update products.
8. Per shelf: `delta = target − lockedQuantity`; skip zero; `StockService.adjust(…, tx)` with
   reason `CSV import <job id>`.
9. Deactivate products absent from the file.
10. One `import.apply` audit row with the job id and the diff summary (I10).

**The constraint that makes this safe:** steps 3–10 perform *no* non-database work. No file reads,
no parsing, no network, no awaiting. Everything was resolved into a plan during stage 3. Without
that, `idle_in_transaction_session_timeout` kills the session mid-import.

Progress is written on a **separate connection** — a row written inside the transaction is
invisible until commit, which is when progress stops mattering.

Step 5 makes the failure cheap; it does not make it impossible. The operator still redoes
confirm→apply if a borrow landed during their coffee break. That is rare and now costs seconds. If
it turns out to recur at high import frequency, the next lever is a synchronous domain re-check the
moment Confirm is clicked, before the job starts — not built now.

### 5.6 Report

`COMPLETED`, diff stored on the job, downloadable. The audit log carries the summary; the ledger
carries one `ADJUST` per shelf that moved, each naming the job.

---

## 6. Schema

Migration 0038 — **a STOP under `rules/70-assist-handoff.md`; the block is printed before it is
written.**

```sql
create type import_job_status as enum
  ('VALIDATING','AWAITING_CONFIRMATION','APPLYING','COMPLETED','FAILED','CANCELLED');

create table import_jobs (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null,                        -- 'products'
  status               import_job_status not null,
  file_id              uuid not null references stored_files(id),
  file_sha256          text not null,                        -- the confirm gate, §5.4
  snapshot_file_id     uuid references stored_files(id),     -- §10, the pre-image
  snapshot_deleted_at  timestamptz,                          -- §10 retention
  restored_from_job_id uuid references import_jobs(id),      -- set when this job IS a rollback
  total_rows           integer,
  processed_rows       integer not null default 0,
  started_at           timestamptz,
  heartbeat_at         timestamptz,                          -- §8, the crash guard
  finished_at          timestamptz,
  estimated_finish_at  timestamptz,
  report               jsonb,                                -- errors, diff, warnings
  created_by           uuid not null references users(id),
  created_at           timestamptz not null default now()
);

-- At most one live job. The database refuses a second, so two admins racing is not a code path.
create unique index import_jobs_one_live on import_jobs (kind)
  where status in ('VALIDATING','AWAITING_CONFIRMATION','APPLYING');
```

No append-only trigger: the row *is* the progress and must be mutable. The permanent record is the
audit row and the ledger.

New `StoredFileKind.PRODUCT_IMPORT` and `PRODUCT_SNAPSHOT`. New config, **all of which must be
pinned in `TEST_ENV`** or `test-env.int-spec` fails (documented landmine):
`IMPORT_MAX_ROWS`, `IMPORT_MAX_FILE_BYTES`, `IMPORT_LOCKOUT_PADDING_MINUTES`,
`IMPORT_HEARTBEAT_TIMEOUT_SECONDS`, `IMPORT_SNAPSHOT_RETENTION_DAYS` (0 = forever, the default),
`IMPORT_FUZZY_MATCH_MAX_NEW_NAMES`.

---

## 7. Error codes

New `ErrorCode` members, each needing an `i18n/en.ts` entry because the SPA selects text by code:

`IMPORT_ALREADY_RUNNING` (409) · `IMPORT_VALIDATION_FAILED` (422, row/column list in `details`) ·
`IMPORT_FILE_CHANGED` (409) · `IMPORT_SNAPSHOT_DELETED` (409) ·
`SYSTEM_IMPORT_IN_PROGRESS` (503, what everyone else gets during apply).

---

## 8. The lockout

While a job is `APPLYING`, everyone else is refused `503 SYSTEM_IMPORT_IN_PROGRESS` and the SPA
shows a full-screen block:

> **Updating inventory**
> Please wait — expected to finish around 14:35.

The padding (`IMPORT_LOCKOUT_PADDING_MINUTES`) is added to the honest estimate, per the brief.

**Allow-listed, or the feature traps everybody including itself:**

- `GET /inventory/imports/:id` — how anyone sees progress at all
- `POST /auth/refresh` — tokens last 15 minutes; a 20-minute import would log the watching admin
  out mid-run
- `GET /health` — the container health check, which would otherwise restart the API mid-import
- `POST /inventory/imports/:id/abandon` — the manual release

Everything else 503s, including the importing admin's own other screens. Deny-by-default.

### 8.1 Two state stores, and keeping them in step

There are **two** pieces of lockout state, and every recovery path has to touch both:

| Store | What it gates | Cleared by |
|---|---|---|
| In-memory boolean in the API process | The 503 on every request | Process restart, or the heartbeat handler below |
| `import_jobs.status = 'APPLYING'` | What the UI shows, and the "one live job" index | The heartbeat handler below |

**Implementation of the boolean.** Single VM, single process — a database read per request would
be a query per request for a flag that is false 99.99% of the time. **Written down because it
breaks the day the API runs two instances.**

**The crash guard.** `heartbeat_at` is written every few seconds on the progress connection. A job
in `APPLYING` whose heartbeat is older than `IMPORT_HEARTBEAT_TIMEOUT_SECONDS` is dead, and the
handler **must clear both stores**: mark the job `FAILED` *and* flip the in-memory boolean false.

The two failure modes it covers are different, and only one of them is a crash (§16.3):

- **Process died.** The restart already cleared the boolean, so requests flow — but the job row
  still says `APPLYING`, so the UI shows a phantom import and the partial unique index blocks the
  next one. The heartbeat clears the row. Safe, because a dead process's transaction already
  rolled back.
- **Process alive, import task dead** — an unhandled rejection or a hung await. *Nothing* has been
  cleared: the boolean still 503s everyone and the row still says `APPLYING`. This is the case the
  heartbeat actually exists for, and it is why clearing the row alone would fix nothing.

Without this, one dead import locks the company out permanently. It is the most important
paragraph in this document.

### 8.2 To verify before building part I

The lockout is enforced per HTTP request. **Confirm no cron job writes to `stock_placements`,
`stock_ledger` or `borrow_requests`**, because a cron does not go through the router and would not
see the boolean. Present reading says none do — reconciliation reads and logs, the overdue job is
unwired per OQ-E, the upload sweep touches files — but that is a reading, not a check (§16.4).

Note this does not soften the ordered locking in §5.5 step 4. `rules/40-database.md` mandates it
for all stock writes unconditionally, and the lockout is application policy rather than a database
guarantee.

---

## 9. The Claude skill

`.claude/skills/ims-product-import/SKILL.md`, user-invocable. It turns loose product data into a
file this importer accepts.

It states, near the top and unmissably: **the skill is a convenience, not a gatekeeper. Every rule
it follows is enforced again server-side, and the server trusts nothing in the file.** A skill that
presents itself as validation produces files nobody checks.

- **The column contract** — §4.2's table verbatim, including which columns are read-only.
- **Ids travel untouched.** `product_id`, `category_id` and `storage_id` are copied through
  exactly. Clearing an id is how you re-point a reference (§4.1); inventing one is never correct.
- **A new product on more than one shelf needs a `product_code`** the skill chooses (§4.3).
- **Categories.** Three levels maximum, sibling names unique. *Before inventing one, search the
  exported list for a near match* — the failure mode is `Laptop` created beside `Laptops`, and once
  both exist a human merges them by hand. When unsure, leave it blank and say so; uncategorised is
  supported, a wrong category is a lie.
- **Locations are never invented.** A product with no location gets a row with the location columns
  blank and quantity 0, and is listed for the human: *"These 12 products need a location before
  their stock can be imported."* (I3.)
- **Never silently drop a shelf.** §4.5 makes an omitted shelf destructive. If the skill cannot
  place a product, it keeps the existing shelf rows unchanged rather than leaving them out.
- **Names.** Trim, collapse whitespace, strip control characters. Do **not** title-case — `USB-C`
  must not become `Usb-C`, model numbers must survive untouched. Flag suspected typos to the human
  rather than correcting them silently.
- **Quantities.** Only `on_hand` is writable. Never fabricate `in_use`, never compute `available`.
- **Excel hazards.** Always quote `product_code` and `storage_id` — otherwise `1-2` becomes a date
  and `0001` becomes `1` (§12 C23).
- **Output.** Same columns, same order, UTF-8, RFC 4180 quoting, fingerprint line preserved.
- **Report back**: what changed, what it could not decide, which rows need a human.

---

## 10. Snapshots, history and rollback (I5)

Every import writes a snapshot of the state it is about to replace, after the lockout engages and
before the transaction opens (§5.5 step 2).

**The snapshot is a round-trip export file.** Same nineteen columns, same fingerprint. That single
choice buys everything else: restoring is just an import of that file, so it reuses validation, the
diff, the confirm gate, the lockout, the progress bar and every test already written for them.
There is no second format and no second code path that could drift.

**A new screen** — Inventory → Import history — lists every job: when, who, how many rows, the diff
summary, and the snapshot. Per row: **Download snapshot**, **Restore this state**, **Delete
snapshot**.

**Restore** creates a *new* import job whose input is that snapshot, with `restored_from_job_id`
set. It runs the full pipeline, including the confirm step.

**Restore is exempt from the forward-import caps.** `IMPORT_MAX_ROWS` and `IMPORT_MAX_FILE_BYTES`
exist because a forward import is arbitrary user input; a snapshot is a state this system itself
produced and already held, so the risk that motivated the caps does not apply. Without this
exemption the caps produce a backup that silently cannot be restored the moment the catalogue
outgrows one import batch — worse than no backup, because you discover it only when you need it
(§16.6). The schema-version check still applies; the origin check does not.

Three things restore cannot do, stated in the UI rather than discovered:

- **Restoring undoes everything since.** Snapshot from import #4 plus imports #5 and #6 having
  happened means restoring #4 reverts all three. The confirm screen says *"This restores the
  catalogue as it was on 22 Sep 14:02. Every change since — 3 imports — will be undone."*
- **Categories created since are not removed**, only emptied. Deleting them is a separate,
  deliberate act on the Categories screen.
- **The ledger keeps both movements.** A restore is a compensating adjustment, not an erasure
  (§2.3). That is correct for an audited system: the stock really did move twice.

**Retention and deletion.** `IMPORT_SNAPSHOT_RETENTION_DAYS` defaults to `0` — keep forever,
matching "so that we have all the backups". Manual delete is available per snapshot and audited.
If a retention window is ever set, the existing daily sweep job pattern enforces it.

Deleting a snapshot **removes the file from disk and the `stored_files` row, and nulls
`import_jobs.snapshot_file_id`**, leaving `snapshot_deleted_at` set. The job row, its diff and its
history survive — only the restore point is gone. This is a hard delete of the file rather than a
soft one, because the point of deleting a backup is reclaiming the bytes; the audit record of it
having existed lives on the job row. Attempting to restore it returns `IMPORT_SNAPSHOT_DELETED`.

A 5,000-row snapshot is roughly 1.5 MB; a hundred imports is 150 MB, which is nothing on this VM —
but the number is worth knowing before somebody imports daily for three years.

---

## 11. Scale: how this does not fall over (I6)

Volume is unknown and could be 500 or 50,000. Rather than guess, here is where the cost actually
is, measured against the code.

### 11.1 Parse and validate — constant queries, not per-row

The naive importer queries per row: does this product exist, does this category, does this shelf.
Five lookups × 5,000 rows = 25,000 round trips before a single write — tens of seconds, for reads.

Instead: **bulk-load four maps once**, then validate in memory.

| Query | Loads |
|---|---|
| 1 | every product (id, code, name, category, active) |
| 2 | every category (id, parent, name) |
| 3 | every compartment (id, storage_id, room, zone, code, active) |
| 4 | every placement (product, compartment, qty, reserved, quarantined) |

Four queries regardless of file size, and validation becomes O(rows) in memory. At a hundred
thousand placements these four are still a few megabytes.

Parsing is **streamed**, so memory is bounded by the parsed plan rather than the file, and the row
cap fails fast instead of after reading 50 MB.

**The fuzzy near-duplicate check is the one superlinear step.** Comparing every new name against
every existing one is O(n·m). It runs as a single SQL query against the existing GIN trigram index,
and only when the number of *new* names is under `IMPORT_FUZZY_MATCH_MAX_NEW_NAMES`; above that it
is skipped **with a line in the report saying so**, since losing duplicate detection silently on
the largest imports is the opposite of what it is for.

### 11.2 Apply — the real cost, and how I10 cuts it

Counting the database round trips inside one `StockService.adjust` call: the trackable check, the
lock-or-create, the ledger insert, the audit insert, the product-ref lookup for that audit row, and
the delta update. **Roughly six per changed shelf.**

| Changed shelves | Round trips | Estimated apply |
|---|---|---|
| 500 | ~3,000 | ~1–2 s |
| 5,000 | ~30,000 | ~10–15 s |
| 20,000 | ~120,000 | ~40–60 s |
| 50,000 | ~300,000 | ~2–3 min |

Two of those six are avoidable, and I10 removes them: dropping the per-adjustment audit row also
drops the product-ref lookup that exists only to label it. The ledger already records every
movement with the job id, and one `import.apply` audit row records the human decision. That is
**a third of the apply cost** removed by not writing five thousand audit rows for one action.

A further reduction is available and **is a `StockService` change, not a bypass**: a batch-aware
entry point that hoists `assertProductIsTrackable` out of the loop, having checked each distinct
product once. It stays the only writer, still one ledger row per change. Recommended, and it gets
its own gate because it touches the stock module.

### 11.3 Is one transaction still right at 50,000 rows?

A three-minute transaction is a three-minute outage — but the lockout means it is an outage either
way, and the brief already accepts "+5–10 minutes". What one transaction buys is that a failure at
row 49,000 leaves *nothing* applied, rather than a catalogue half-overwritten with no undo.

So: keep it atomic, and make the ceiling explicit. `IMPORT_MAX_ROWS` defaults to **5,000**, which
the table above puts at 10–15 seconds. It is configurable, and **before raising it, measure** —
§15 makes benchmarking at 500 / 5,000 / 20,000 a build task, so the lockout estimate shown to users
comes from a measurement rather than this table's arithmetic.

Two guards regardless of the number:

- **Row cap checked during streaming**, before parsing completes, so an oversized file is refused
  in milliseconds rather than after a minute of work.
- **`SET LOCAL lock_timeout`** in the apply transaction. No lock timeout is configured today, so a
  row held by a straggler request would block up to the 60-second `statement_timeout`. Failing fast
  and reporting *which* row is contended beats a mystery stall.

### 11.4 What actually breaks first

Not memory, and not Postgres. **The HTTP request that starts the apply.** It cannot wait three
minutes for a response. Apply is therefore fire-and-forget: the endpoint returns `202` with the job
id immediately, and everything after is the progress endpoint.

### 11.5 After the first large imports

Zeroing a placement deletes the row and the rest are updated, so a 20,000–50,000-shelf import is a
large burst of dead tuples on `stock_placements` plus a large insert burst on `stock_ledger`. This
is not steady-state traffic and autovacuum is tuned for steady state. **Watch table bloat and
autovacuum behaviour on both tables after the first few large imports**, and consider an explicit
`VACUUM ANALYZE` as the last act of a large import rather than discovering the bloat a month later
as a slow product list.

### 11.6 The row cap contradicts I1 — named, unresolved, must be decided before part G

**This is a design constraint, not a tuning knob, and it is not a rare edge case.** It is the
general form of the snapshot-restore collision found in §16; exempting restore fixed one symptom
and left the cause standing.

I1 says the file is the **whole** desired state, and the only supported way to bulk-edit is
export-everything → hand to Claude → reimport-everything. `IMPORT_MAX_ROWS` caps that same file at
5,000 rows. The two cannot both hold: once the catalogue crosses the cap, every honest use of the
documented workflow is refused by the thing meant to be gating abuse of it. Growth alone gets you
there — no unusual file, no mistake.

Worse, it bites at the *export* first and sooner than the number suggests:

- `ProductExportService` passes `IMPORT_MAX_ROWS` as the ceiling on `products.listAll`, so the
  export throws once the **product** count passes 5,000 — and a file has one row *per product per
  shelf*, so a catalogue of 3,000 products across two shelves each is already a 6,000-row file
  that cannot be re-imported even though the export succeeded.
- Part D's lookup load is already exempt (OPEN #3): it must read every product or the deactivation
  sweep retires the ones it was never shown. That exemption is correct and is *evidence* — the cap
  is already being routed around wherever it meets the whole catalogue.

**The cap is measuring the wrong thing.** Three separate concerns are collapsed into one number:

| Concern | Right instrument | Status |
|---|---|---|
| Bounding memory while parsing | `IMPORT_MAX_FILE_BYTES` | Exists, already separate |
| Bounding what one apply transaction touches | **changed shelves**, not rows | Missing |
| Refusing an obviously wrong file | a sanity ceiling well above the catalogue | What the row cap should be |

Apply cost is driven by **changed** shelves, not rows read (§11.2). A 20,000-row reimport that
changes twelve shelves costs what a twelve-row one costs; C46 is precisely that file. Part D now
computes the changed-shelf count exactly, before anything is written and before the human gate —
so the meaningful limit can be checked where the number actually exists, with a message a person
can act on ("this would change 31,000 shelves in one transaction"), instead of a row count that
refuses a file which would have changed nothing.

**Proposed resolution, for the lead:** keep `IMPORT_MAX_FILE_BYTES` as the memory bound; raise
`IMPORT_MAX_ROWS` to a sanity ceiling rather than a policy gate; add the real gate against the
plan's changed-shelf count at the preview step. If that ceiling is ever genuinely reached, part H
(the batch-aware `StockService` entry point) stops being optional and the apply chunks — which is
a change to §5.5 and §11.3, not a config edit.

**Decided, 2026-09-23, and implemented.** `IMPORT_MAX_ROWS` and `IMPORT_MAX_FILE_BYTES` are
demoted to what they can honestly be — coarse ceilings bounding the *parse* phase and the memory
the four maps of §11.1 need. The gate that decides whether an apply is affordable is a new
`IMPORT_MAX_CHANGED_SHELVES`, checked against the **diff**, before a job is allowed to wait for
confirmation. A file that changes nothing passes a ceiling of zero; a file that would rewrite
forty thousand shelves is refused with a message naming the count rather than the row total,
which measures the wrong thing.

**A restore is not exempt from the new one.** It stays exempt from the two parse-phase caps,
because a snapshot is this system's own file rather than arbitrary input — but forty thousand
shelves cost the same to write whichever direction they came from, and I7's one-transaction
design exists to make that cost visible before it is paid.

The default is **arithmetic from §11.2, not a measurement**, and provisional in the same sense
`IMPORT_FUZZY_MATCH_THRESHOLD`'s 0.45 is: shippable, not yet trusted. §15 carries the benchmark
that replaces it.

**Lowered 10,000 → 5,000 on 2026-09-23, because part I revealed the binding constraint is not the
one it was set against.** The ceiling was chosen against `statement_timeout` (60 s).
`IMPORT_HEARTBEAT_TIMEOUT_SECONDS` is *also* 60 s, and part I's apply writes a heartbeat only
twice — before the snapshot and before the transaction — so an apply running longer than that has
no beat in flight. §8's guard would declare a healthy import dead, set its row `FAILED` **while
the transaction still holds row locks**, and, with the row no longer `APPLYING`,
`import_jobs_one_live` would stop blocking: **a second import could start and write against rows
the first is mid-way through changing.** The lockout lifting is the visible half; the one-live
guarantee dissolving is the half that corrupts stock.

10,000 was inside the range where that is possible. 5,000 is ~10–15 s by §11.2's table, 3–4×
clear of the timeout even allowing for the extra lock round trip §5.5 step 4's correction added
and that table does not include.

**This is temporary and tied to part J.** Progress ticks written on the separate connection are
what keep the heartbeat alive during a long apply; once they exist the ceiling can go back up,
and at that point it should be set from the benchmark rather than from either arithmetic.

**And it fixes only one of the two axes.** A changed-shelf ceiling bounds *apply*. It does nothing
to the four bulk-loaded maps of §11.1, which are deliberately uncapped — the deactivation sweep
has to read every product or it retires the ones it was never shown — and which therefore scale
with the **catalogue**, not with the file or with how much the file changes. Every import pays
that cost, including a zero-change reexport. Right at today's volumes and right for the reason
OPEN #3 gives, but it means validation-phase cost has no ceiling at all and is tied to a number
nobody is watching. **If the catalogue itself grows an order of magnitude, measure the lookup load
before anything else** — it is the axis this round did not touch.

---

## 12. Corner cases

Each is a test in §15.

| # | Case | Handling |
|---|---|---|
| C1 | Duplicate `product_code` in the file | Error, both rows named |
| C2 | `product_code` matches a *different* existing product | Error, readable message rather than a raw unique violation |
| C3 | Same `product_id` on two rows with different names | Error, "a product's rows disagree" |
| C4 | **New product on two shelves, no `product_code`** | Error naming every row in the group (§4.3) |
| C5 | New product on one shelf, no `product_code` | Allowed — generated |
| C6 | Same product twice on one shelf | Error — `UNIQUE (product_id, compartment_id)` |
| C7 | `category_path` four levels deep | Error, surfacing the trigger's own message |
| C8 | Intermediate category exists but is inactive | Error; reactivating is a human decision |
| C9 | Two rows create the same new category | Deduplicate, create once |
| C10 | New category collides with a sibling by case/whitespace | Reuse the existing one, warn |
| C11 | **`category_id` and `category_path` resolve to different categories** | Error — ambiguous intent (§4.1) |
| C12 | **`category_id` resolves, path does not (renamed since export)** | Use the id, warn, **surface in the preview** (§5.4) |
| C13 | Unknown room/zone/compartment with a non-zero quantity | Error, all of them listed (I3) |
| C14 | Compartment exists but is deactivated | Error — `adjust` would not catch this (§3.1) |
| C15 | Blank location with a non-zero quantity | Error (I3) |
| C16 | Blank location with zero/blank quantity | Allowed — catalogue-only row (I3) |
| C17 | Product's shelves omitted entirely → stock zeroed | Allowed, **prominent** diff warning (§4.5) |
| C18 | Negative or fractional `on_hand` | Error |
| C19 | File from another deployment | Error on the fingerprint; restore exempt from the origin check (§10) |
| C20 | `on_hand` below `reserved + quarantined` at validation | Error, naming the shortfall |
| C21 | **Same, but only true by apply time** (a borrow landed during confirm) | Caught by the re-check under lock, before any write (§5.5 step 5) |
| C22 | CSV has no magic bytes | Validate by extension + UTF-8 decode + header match |
| C23 | Excel mangles `0001` → `1`, `1-2` → a date | Skill quotes; importer warns on a code parsing as a date |
| C24 | BOM, CRLF, embedded newlines, quoted commas | Parser handles; fixtures cover each |
| C25 | Trailing blank rows from Excel | Ignored silently |
| C26 | Unknown extra column | Error — more likely a wrong file than a helpful addition |
| C27 | Quantity on an untrackable category | Error |
| C28 | `on_hand` equals current | Skipped — `adjust` throws on a zero delta |
| C29 | `product_id` not found (stale export) | Error; treating it as new would duplicate the product |
| C30 | `unit` changed on a product holding stock | Allowed, warned — the number now means something else |
| C31 | Product deactivated while units are out on loan | Allowed, warned prominently |
| C32 | Two admins import at once | Second refused by the partial unique index |
| C33 | Browser closed mid-apply | Job continues; reopening rejoins the progress view |
| C34 | **`storage_id` and room/zone/compartment resolve to different shelves** | Error — ambiguous intent (§4.1) |
| C35 | **`storage_id` resolves, path does not (location renamed)** | Use the id, warn, **surface in the preview** (§5.4) |
| C36 | Attempt to write a different `storage_id` | Ignored, warned — the trigger would abort the transaction |
| C37 | Empty file, or headers only | Error — would otherwise deactivate the entire catalogue |
| C38 | Snapshot generation fails (disk full) | Apply does not start. A backup you cannot take is a reason to stop, not continue. |
| C39 | Row count over `IMPORT_MAX_ROWS` | Refused during streaming (§11.3); restore exempt (§10) |
| C40 | **Catalogue larger than `IMPORT_MAX_ROWS`, snapshot taken** | Restorable — restore bypasses the cap (§10) |
| C41 | API crashes mid-apply | Transaction rolls back; heartbeat clears both stores (§8.1) |
| C42 | **Process alive, import task dead** | Heartbeat clears both stores — the case it exists for (§8.1) |
| C43 | Token expires mid-apply | `/auth/refresh` is allow-listed |
| C44 | Restore a snapshot whose file was deleted | `IMPORT_SNAPSHOT_DELETED` |
| C45 | Restore a snapshot older than later imports | Allowed; confirm screen states what it undoes (§10) |
| C46 | **Re-running an already-applied file** | No-op: zero deltas skipped, no products created, no rows deactivated (I11) |

---

## 13. First review pass

Twelve challenges; six changed the design.

**1. One transaction versus the 30-second idle timeout.** The timeout punishes idleness, not
duration. Kept atomic; §5.5 states the no-I/O rule as a hard constraint.

**2. Deactivating a product with units out on loan.** Still allowed; C31 and §5.4 surface it as a
prominent warning rather than a line in a count.

**3. A file from another deployment** would have created 400 duplicates. Added the fingerprint
(§4.4) and C19.

**4. Confirm-step staleness.** Added `file_sha256` and `IMPORT_FILE_CHANGED`.

**5. An empty file deactivates everything.** C37 refuses it.

**6. The lockout traps its own operator.** A 15-minute token and a 20-minute import; the health
check restarting the container. Both fatal, both fixed by the allow-list in §8.

**7. Progress inside the transaction is invisible.** Separate connection, §5.5.

**8. A blank location is destructive under reconcile semantics.** §4.5 exists for this.

**9. Snapshot inside or outside the transaction?** Outside — and §16.5 later moved it inside the
lockout, which is the part this pass missed.

**10. Five thousand audit rows for one human action.** I10.

**11. Fuzzy matching is O(n·m).** Capped and reported, §11.1.

**12. Should validation lock users out too?** No — read-only, and locking doubles the outage.

---

## 14. Open questions

**Q1 — restore as a snapshot's own act, or always a fresh import?** Currently restore creates a new
job, so history grows by one row per restore. Honest and auditable; the alternative reads more
cleanly but hides that a second write happened. Current plan: keep the extra row.

**Q2 — should a snapshot be taken on anything other than an import?** "Every time it updates new
inventory" is read as every import. A scheduled daily snapshot is a different, reasonable feature.
Out of scope unless wanted.

**Q3 — `IMPORT_MAX_ROWS` default.** 5,000, from §11.2's arithmetic. §15 benchmarks it before the
number is fixed.

---

## 15. Build order

| Part | What | Notes |
|---|---|---|
| A | Migration 0038, `StoredFileKind` members, config keys, error codes | **STOP block first** — schema change |
| B | The round-trip **export** (`GET /inventory/export`) | Ships first and alone: the skill's input, the snapshot format, useful on day one |
| C | Streaming CSV parser + fixtures for C22–C25 | Pure functions, unit-tested, no database |
| D | Validation (§5.3), the §4.1 resolution rule, bulk-loaded maps (§11.1) | The bulk of the work and the bulk of the tests |
| E | Preview/diff and the confirm gate, including the §5.4 rename warnings | |
| F | Snapshot capture and the history screen | Depends on B; independent of apply |
| G | Apply (§5.5) | **Touches `StockService` and the ledger — its own gate, `INVARIANT` non-empty** |
| H | Batch-aware `StockService` entry point (§11.2) | Optional; measure first |
| I | Lockout guard + heartbeat + abandon | **Touches auth surface — STOP.** Do §8.2's cron check first |
| J | Progress endpoint, the ring loader, the full-screen block | |
| K | Restore (§10) | Thin: an import of an existing file, exempt from the caps |
| L | The Claude skill | Independent of A–K; writable any time after B |

**Landed: A–G and I–L.** Schema and vocabulary, the round-trip export, the parser, validation,
the issue-code enum and its severity ratchet, the near-duplicate pass, the diff, the job
lifecycle, the upload endpoint and its CSV branch in file storage, apply, the lockout and its
crash guard, progress on two clocks, the full-screen block, the ring, the import page, snapshot
history, restore, and the Claude skill.

**Not built: H** — the batch-aware `StockService` entry point. Optional by design, and now
measurable: apply exists, so the benchmark can say whether it is worth having before anybody
writes it.

**Still untrusted, and tracked in "Done means" below:** `IMPORT_FUZZY_MATCH_THRESHOLD` (0.45) and
`IMPORT_MAX_CHANGED_SHELVES` (5,000). Both ship working in shape and unmeasured in value.

### Done means

- Gate at baseline: typecheck 0, lint 20, integration green.
- A red test before every green one, per `rules/70`.
- A test for **every** row in §12 — including C46, idempotence (I11).
**Two numbers ship trusted in shape and untrusted in value. They are separate items on separate
schedules, and finishing one resolves nothing about the other.**

- **`IMPORT_MAX_CHANGED_SHELVES` — blocked on part G, then benchmarked.** Published timings for
  500 / 5,000 / 20,000 **changed shelves** through the real apply path, and the ceiling set from
  them rather than from §11.2's arithmetic. Rows are the wrong axis and the row cap is no longer
  the gate (§11.6). This cannot be done before G exists, because there is nothing to time.
- **`IMPORT_FUZZY_MATCH_THRESHOLD` — doable today, and independent of G.** One pass over real
  product names. It ships at 0.45, which separated the fixtures sensibly and has never met a real
  catalogue. Too high and the check says nothing on the day somebody re-adds a product that
  already exists; too low and it cries duplicate on every `Cable HDMI 2m` beside its 3m sibling.
  It is config, so revising it is cheap — but a number nobody has ever checked should not be
  presented as a working safeguard. **Nothing in G touches this**, so G landing must not be read
  as having settled it.
- End-to-end on the demo stack: export → edit → import → verify; one deliberately broken file; one
  crash during apply *and* one killed-task-live-process (C41 and C42 are different paths); one
  restore from a snapshot; one restore after renaming a category and a room (C12, C35).
- `DECISIONS.md` carries I1–I11; `OPEN-QUESTIONS.md` carries Q1–Q3.
- `AI_PLAYBOOK.md` §6/§8/§11/§16 updated; **`rules/30-frontend.md`'s websocket claim corrected**
  (§3.6).

---

## 16. Second review pass

A second reviewer went over §1–§15 as a design review. Seven items changed the document; one was
withdrawn. Recorded here because a reader should be able to see why §5.5's ordering and §4.1's
existence were not obvious first time.

**16.1 — New multi-shelf products had no correlation key.** *Raised and upheld.* With `product_id`
blank by definition and `product_code` blank-means-generate, nothing tied two rows of one new
product together; they would have become two products sharing a name, each holding half the stock,
silently. Not an edge case — "a shipment arrived onto two shelves" is an ordinary import.
**Changed:** §4.3, C4, C5, and validation stage 4.

**16.2 — Validation's stock check can go stale before apply.** *Raised and upheld.* `reserved_qty`
is not frozen across the confirm window (deliberately, §13.12), so a borrow landing while somebody
reads the diff can make a validated row fail `InsufficientStockError` at row 40,000 of 50,000,
rolling back minutes of work. The first pass claimed this window was "absorbed correctly", which
was true of quantity drift and false of reserved drift. **Changed:** §5.5 step 5 re-checks the
domain constraints against the locked rows before any write — microseconds, and it converts a
three-minute failure into an instant one. It does not remove the all-or-nothing outcome; the
operator still retries. C21.

**16.3 — The lockout's two state stores were not described as two.** *Raised and upheld.* The
heartbeat was written as if its job were the crash case, but a crash already clears the in-memory
boolean by restarting. Its real job is the *live process, dead task* case — where nothing is
cleared — and there it must flip the boolean as well as the row. **Changed:** §8.1, C41, C42, and
a second crash scenario in the done criteria.

**16.4 — Cron jobs bypass an HTTP-enforced lockout.** *Raised, softened to a verification task.*
Present reading says no cron writes stock, but that is a reading. **Changed:** §8.2. The reviewer's
further suggestion — that ordered locking is "mostly moot" if no cron writes — was not taken:
`rules/40-database.md` mandates it unconditionally, and application policy is not a database
guarantee.

**16.5 — Snapshot could precede the lockout.** *Raised and upheld.* The first draft put the
snapshot before the transaction without saying which side of the lockout it fell on. A write
landing in that gap makes the rollback file quietly wrong — a correctness bug in the one feature
whose entire purpose is a trustworthy pre-image. **Changed:** §5.5 now numbers the lockout as
step 1 and the snapshot as step 2.

**16.6 — A snapshot could exceed the cap that governs its own restore.** *Found during the second
pass, by neither reviewer's line items.* The moment the catalogue outgrows `IMPORT_MAX_ROWS`, every
import produces a backup the importer will refuse — worse than no backup, because it is discovered
only when needed. **Changed:** §10 exempts restore from both the row and byte caps, on the grounds
that a snapshot is not arbitrary user input but a state this system produced.

**16.7 — Category paths drift, breaking restore.** *Found during the second pass.* Categories were
identified by text path with no id column, so restoring a snapshot taken before a rename would
rebuild the old category as a duplicate and file products into it while the renamed one sat empty.
**Changed:** rather than patching categories alone, §4.1 states the general rule once — every
mutable-text reference carries its immutable id, resolved id-first — and both `category_id` (new
column 6) and `storage_id` follow it. C34's original phrasing ("storage_id disagrees with the path")
would itself have broken restore after a room rename, since `storage_id` legitimately keeps the old
name tokens; it is now about resolution, not text. C11, C12, C34, C35, and the preview warnings in
§5.4.

**16.8 — Withdrawn: historical borrows lose their shelf.** *Raised, checked, not upheld.* The
concern was that zeroing a placement nulls `borrow_requests.placement_id` and loses where a
historical borrow came from. It does not: `borrow_requests.compartment_id` is a separate
`NOT NULL … ON DELETE RESTRICT` column (`0007_borrowing.ts:60-62`), and the file's own docblock
explains the split — the placement pointer is for locking on issue, the compartment is the durable
fact. `borrow_returns.compartment_id` is the same. **No change**, beyond §3.1 now saying so, so the
question is not re-opened by the next reader.
