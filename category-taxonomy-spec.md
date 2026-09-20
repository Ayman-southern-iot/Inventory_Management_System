# Product Category & Subcategory Taxonomy — Implementation Spec

**Purpose:** Reference document for implementing category/subcategory support on
products in the inventory system. Covers the data model rules, the full category
tree, governance, how to handle new/unlisted products, and UI requirements for
the product details page.

**Aligned to:** `AI_PLAYBOOK.md` (IMS — Southern IoT). This spec does not
introduce new architecture — it fills in the one gap the playbook leaves open:
what actually goes *in* the `categories` tree, who's allowed to change it, and
how the two known weak spots (cross-cutting grouping, in-category search at
scale) are handled without over-building for a 12-user system. Where this spec
and the playbook disagree, **the playbook wins** — flag it and update this file.

---

## 0. What's Already Solved Elsewhere (Don't Re-Solve Here)

Two things that look like "category problems" at first glance are already
handled by existing parts of the system — this spec deliberately does not
touch them:

- **Storage location.** Where a product physically sits (`storage_zones` →
  `storage_compartments`, via `stock_placements`) is fully separate from what
  a product *is* (`categories`). This mirrors the existing
  **Product ≠ Placement** split (§5.1 of the playbook): one product can have
  stock in two compartments; category answers "what is it," placement answers
  "where is it." Do not add a location field to the category table.
- **Cross-cutting grouping ("everything used in the CNC build").** This is
  what **Projects** already do. A borrow or requisition is attributed to a
  project regardless of the item's category, so "what's tied to Project X"
  is a project-filter query, not a second category axis. This spec keeps
  category as a strict single-parent tree (Section 1) specifically *because*
  Projects already cover the many-to-many case — adding a
  `product_categories` join table would duplicate a solved problem.

---

## 1. Data Model Rules

- **Tree levels only — one category per product.** A product belongs to
  exactly one node in `categories` via `products.category_id`. `categories`
  is self-referencing (`parent_id`), same shape as the existing table — no
  `product_categories` join table, no multi-category membership.
- **Category is OPTIONAL, not mandatory.** `products.category_id` stays
  nullable. Do not block product creation, editing, or import on category
  selection. Category assignment can happen later.
- **Max depth: 3 levels.**
  `Top-Level Category → Subcategory → Type`
  (e.g. `Electronics → Sensors → Motion/IMU`)
  A product can be assigned to a node at ANY level (1, 2, or 3) — it does not
  have to go all the way to a level-3 leaf if a more specific type doesn't
  apply or doesn't exist yet.
- **`is_trackable` precedent stays on category, not product.** The category
  table already carries at least one behavioral flag (`is_trackable`, for
  optional serial tracking — see playbook §5.1/G9). Any future per-category
  behavior (e.g. "this branch requires a specs field") should follow the same
  pattern: a flag on the category row, not a hardcoded list of category names
  in application code (playbook non-negotiable #1).
- **Extensibility is built into the model, not hardcoded.** New categories at
  any level are added via normal CRUD on `categories` (Section 4) — never a
  schema change or code deploy for a new subcategory or leaf.
- **Seeding goes through `pnpm db:seed`, not inline code.** The tree in
  Section 2 is idempotent reference data (`ON CONFLICT DO NOTHING`, per
  playbook §10.3 seeding convention), the same way other reference tables are
  seeded — not a hardcoded array in a service file.

---

## 2. Full Category Tree

> Categories below are the initial seed set for `pnpm db:seed`. Treat this as
> a starting point, not a closed list — see Section 5 for how new products
> that don't fit are handled, and Section 4 for who's allowed to extend it.

### Electronics

```
Electronics
├── Passive Components
│   ├── Resistors
│   ├── Capacitors
│   ├── Inductors
│   └── Potentiometers / Trimmers
│
├── Semiconductors
│   ├── Diodes & Rectifiers
│   ├── Transistors & MOSFETs
│   ├── Optocouplers
│   └── ICs (general)
│
├── Electromechanical
│   ├── Relays
│   ├── Switches
│   └── Buzzers / Fans
│
├── Microcontrollers & Processors
│   ├── ESP32 / ESP8266
│   ├── Arduino / AVR
│   ├── STM32 / ARM (incl. Nucleo boards)
│   └── Raspberry Pi / SBC
│
├── Sensors
│   ├── Temperature & Humidity
│   ├── Motion / IMU
│   ├── Proximity & Distance
│   ├── Current / Voltage
│   └── Optical / Imaging
│
├── Breakout Boards & Modules
│   ├── Communication (Wi-Fi, BLE, LoRa/LoRaWAN, RAK modules, GSM/RF)
│   ├── Power Modules (regulators, converters)
│   ├── Driver Modules (relay/optocoupler/MOSFET driver boards)
│   └── Display Modules (LCD, OLED, TFT, e-ink, 7-segment, LED matrix)
│
├── Motor Drivers & Power Electronics
│   ├── Stepper Drivers
│   ├── DC Motor Drivers / H-Bridges
│   └── Servo Drivers / ESCs
│
├── Custom & Assembled PCBs
│   ├── Custom Fabricated PCBs (blank)
│   └── Assembled Boards (e.g. Jacquard controller circuits, other in-house boards)
│
├── Connectors & Cables
│   ├── Board Connectors (JST, headers — male/female, screw terminals)
│   ├── Jacks (DC barrel jacks, audio jacks)
│   ├── Antennas & RF Accessories
│   ├── Cables (jumper wire, ribbon cable, hookup/normal wire)
│   └── Industrial Connectors (M12, DIN, aviation connectors)
│
├── Prototyping
│   ├── Vero Board / Stripboard
│   ├── Breadboards
│   └── Blank PCBs / Perfboard
│
└── Tools & Test Equipment
    ├── Measurement (multimeters, oscilloscopes, logic analyzers)
    ├── Soldering & Assembly (soldering irons, iron tips, solder wire/leads,
    │       flux, desoldering tools, hot air stations, glue guns)
    └── Bench Supplies (power supplies, function generators)
```

### Mechanical & Structural

```
Mechanical & Structural
├── Fasteners
│   ├── Screws & Bolts
│   ├── Nuts & Washers
│   └── Standoffs / Spacers
│
├── Motion Components
│   ├── Bearings
│   ├── Shaft Couplers
│   ├── Lead Screws / Rods
│   ├── Linear Rails / Guides
│   └── Pulleys / Belts / Gears
│
├── Structural
│   ├── Aluminum Extrusion
│   ├── Brackets & Plates
│   └── Enclosures
│
├── Actuators
│   ├── DC Motors
│   ├── Stepper Motors
│   └── Servo Motors
│
└── Hand & Mechanical Tools
    ├── Striking Tools (hammers, mallets)
    ├── Screwdrivers & Wrenches
    ├── Pliers & Cutters
    └── General Hand Tools (misc.)
```

### Machines & Equipment

```
Machines & Equipment
├── CNC & Laser Equipment
│   ├── CNC Routers (machines)
│   ├── Router Bits (by size/degree/flute type)
│   ├── Laser Machines (cutters/engravers)
│   ├── Laser Modules / Diodes
│   └── Laser Accessories (lenses, mirrors, nozzles)
│
├── 3D Printing
│   ├── 3D Printers
│   ├── Hotends / Extruders
│   ├── Filament (PLA, PETG, ABS, etc.)
│   └── Print Beds / Build Surfaces
│
├── Robotics & Drones
│   ├── Robot Kits / Chassis
│   ├── Robot Arms
│   └── Drones / Drone Kits
│
├── Networking & Communication Equipment
│   ├── Wi-Fi Routers / Gateways
│   └── Access Points / Networking Hardware
│
└── Lab / Bench Equipment
    ├── Workbenches
    ├── Fume Extractors
    └── Storage Bins
```

### Consumables & Misc

```
Consumables & Misc
├── Wires & Heat Shrink
│   ├── Hookup / Normal Wire
│   ├── Jumper Wires
│   └── Heat Shrink Tubing / Wire Loom
│
├── Adhesives & Tapes
│   ├── Tapes (Kapton, double-sided, insulation, masking)
│   └── Glue Gun Sticks / Adhesives
│
└── Batteries & Power Supplies
    ├── Li-ion / LiPo
    ├── AA / AAA / Coin Cell
    └── Wall Adapters / Chargers
```

---

## 3. Governance — Who Can Change the Tree

Per the existing roles matrix (playbook §2), **CRUD on categories is an
Inventory Manager permission** — same row as CRUD products/locations. General
users and Approvers browse and select from the tree; only the IM (and by
extension a second IM, per the go-live checklist recommendation) creates,
renames, moves, or deletes category nodes. Admin does not get a separate
category-management surface — this is warehouse operation, not system
configuration, same as the rest of the CRUD-products/categories/locations row.

This keeps the tree small enough to stay clean without adding new
role-checking logic: it reuses the permission check that already gates
product and location CRUD, it doesn't hand category creation to all 12 users
(which is what actually causes duplicate/near-duplicate categories over
time), and it doesn't require Admin sign-off for routine additions like a new
component type. No new role or permission enum value is needed.

**Naming collisions:** creating a category should do a case-insensitive
uniqueness check against **siblings only** (same `parent_id`), not the whole
tree — `Antennas` can exist under both `Connectors & Cables` and, if it's
ever needed, `Networking & Communication Equipment`, since they mean
different things in context. Reject an exact duplicate name under the same
parent with a clear error rather than silently creating a second identical
node.

---

## 4. Category Tree Management (Standalone, Not Tied to a Product)

Beyond the inline "add category while adding a product" flow (Section 5),
there must be a dedicated way to manage the category tree itself — e.g. a
screen under the IM's Inventory area where someone can go add a new
subcategory like `X` under `Microcontrollers` without having a product in
front of them at all.

### Required capabilities

- **Create a category node anywhere in the tree.**
  Pick any existing node as the parent (or none, for a new top-level
  category) and add a new child under it — e.g. select `Microcontrollers`,
  add child `X`. This works the same whether `X` ends up at level 2 or
  level 3 — the UI shouldn't care, it just needs a parent and a name.
- **Rename a node.** Changes display name only; the category's ID and all
  product assignments (`products.category_id`) are untouched.
- **Move a node** (re-parent it). E.g. move `X` from under `Microcontrollers`
  to under `Breakout Boards & Modules`. All products and any child nodes
  under `X` move with it automatically since they reference `X`'s ID, not a
  hardcoded path.
- **Reorder siblings** (optional, cosmetic) — display order among children
  of the same parent, if the UI lists categories in a custom order rather
  than alphabetically.
- **Delete a node** — see the delete rule in Section 6 (block, or require
  reassigning/orphaning products first; never cascade-delete products).
- **Depth guard, enforced in the database via a trigger — not a `CHECK`
  constraint.** Per playbook non-negotiable #4 ("DB constraints are the real
  guarantees"), the 3-level cap must be enforced in the database, not only in
  the UI. A plain `CHECK` constraint can't do this: Postgres does not support
  `CHECK` constraints that reference table data other than the row being
  written, and depth requires walking up `parent_id` to count ancestors — a
  cross-row lookup. The correct implementation is a `BEFORE INSERT/UPDATE`
  trigger on `categories` that runs a recursive CTE up the ancestor chain and
  raises an error if the new row would land at depth 4. This still follows
  the existing append-only-by-trigger precedent in this schema (`stock_ledger`,
  `requisition_events`, `audit_log`) — it's the same tool, applied to a
  different invariant. A direct API call must go through this trigger the
  same as the UI; the UI-side check is a convenience, not the guarantee.
- **Audit trail.** Category create/rename/move/delete should write an
  `audit_log` row, the same append-only-by-trigger pattern already used for
  `stock_ledger` and `requisition_events` (playbook §3, rule #4). This is
  what makes a mid-month re-parent traceable later if a category-based report
  looks different from what was expected — Admin can already view the audit
  log (playbook §2 roles matrix), so this adds no new screen, just new rows.

### What this enables for a genuinely new product type

Once category management is standalone, adding support for a new kind of
product (call it "Product X") never requires a code change or a developer:

1. The IM goes to Category Management, picks the closest existing parent
   (e.g. `Microcontrollers`), and adds `X` as a child. Takes seconds.
2. The new product is then added normally, with `X` selectable immediately
   in the category picker described in Section 7.
3. If it later turns out `X` should really live somewhere else in the tree
   (e.g. it's not a microcontroller type at all), re-parent it with the
   "move a node" action — no product data is lost or needs re-entry, since
   products point at `X`'s ID, not its position in the tree.

This is the same underlying operation as Section 5's inline creation — the
difference is just where the entry point lives (a dedicated management
screen vs. inline in the product form). Both call the same
create/rename/move/delete API so the tree never drifts out of sync, and both
are gated by the same IM-only permission from Section 3.

---

## 5. Handling New / Unlisted Products (Decision Flow)

A product must NEVER be blocked from being added because a perfect category
doesn't exist yet. Apply this order of preference when a new product type
shows up (e.g. "Product X"):

1. **Fits an existing level-2 subcategory?**
   → Add it as a new level-3 leaf under that subcategory (Section 4). IM-only,
   no separate approval step beyond the existing IM permission.
2. **Fits an existing top-level category, but no subcategory matches?**
   → Add a new level-2 subcategory under that top-level category.
3. **Doesn't fit any existing top-level category?**
   → This is rare. Either it's genuinely a new top-level branch, or — more
   likely — it belongs in a `Miscellaneous` catch-all so data entry is never
   blocked. Each top-level category should have a `Miscellaneous` leaf for
   this purpose.
4. **User doesn't want to categorize right now?**
   → Leave `category_id` as `NULL`. This is a fully valid, supported state
   (see Section 1). The product must still be fully usable (searchable,
   editable, listable) with no category set.
5. **Genuinely ambiguous — doesn't clearly resolve by the rule in Section 6's
   worked examples?**
   → Per playbook non-negotiable #5 ("never invent a requirement, do not
   silently guess"), don't leave this to individual judgment on the spot.
   Land it in `Miscellaneous` or `NULL` for now, and log it as an entry in
   `docs/state/OPEN-QUESTIONS.md` so the placement gets a real answer instead
   of quietly drifting based on whoever entered that particular product.

Implementation requirement: the "Add Category" action should be reachable
**inline** from the product create/edit form (e.g. a "+ New Category" option
in the category picker itself, IM-only), not require navigating away to a
separate screen mid-entry.

---

## 6. Product Details Page — Display Requirements

- The assigned category path must be shown on the product details page as a
  **breadcrumb-style label**, e.g.:
  `Electronics > Breakout Boards & Modules > Communication`
- If the product is assigned at level 1 or 2 only (no deeper level chosen),
  show only the levels that are actually set — do not show empty/placeholder
  segments.
- If `category_id` is `NULL`, show a neutral state (e.g. `Uncategorized`) —
  never show an error, blank crash, or force a redirect to "add category
  first."
- The breadcrumb should be clickable: each segment links to a filtered list
  of all products in that category/subcategory (standard tree-browse
  behavior).
- **Uncategorized as a first-class filter, not a cleanup job.** Give the IM's
  Inventory screen an "Uncategorized" filter chip/view (query
  `WHERE category_id IS NULL`), the same way other status-style filters
  already work in that screen. This makes clearing the backlog something the
  IM can do in a spare five minutes, rather than requiring a new cron job or
  scheduled report — consistent with playbook §21.1 (no queue server, no
  work invented beyond what 12 users need).
- The category picker on the create/edit form should:
  - Be a searchable dropdown or cascading select (Top-Level → Subcategory →
    Type), not a flat list of every leaf.
  - Allow leaving all levels unset.
  - Allow stopping at level 1 or 2 without forcing a level-3 pick.
  - Allow inline creation of a new node at any level (see Section 5),
    IM-only.

---

## 7. In-Category Search at Scale (Specs, Not New Categories)

Category answers "what type of thing is this," not "what are its specs" —
size, tolerance, voltage, and similar variation within a leaf (e.g.
`Resistors`, `Router Bits`) should stay out of the tree (a new category per
resistance value would explode the tree for no benefit) and instead be
searchable text on the product itself.

**Recommendation, flagged as an open question rather than a firm decision**
(per playbook non-negotiable #5, this isn't answered by any existing spec):
add a nullable `specs` **plain text** field on `products` — e.g.
`"10kΩ, 1/4W, 5%"` — not `jsonb`. `pg_trgm` (the extension behind the
existing `gin_trgm` search, playbook §21.1) indexes text columns; it does not
efficiently index `jsonb` — matching against a `jsonb` column cast to text
(`specs::text % 'term'`) works but bypasses the index, so it wouldn't
actually speed up the "find the right resistor without scrolling a 200-item
leaf" case it's meant to solve. A plain text field slots directly into the
same trigram index approach already in use. `jsonb` only becomes worth the
extra complexity if there's a real need to query by a specific structured
key later (e.g. `specs->>'resistance'`) — and even then it would need a
separate generated text column or expression index to keep trigram search
working, not something to add speculatively now. Raise this in
`docs/state/OPEN-QUESTIONS.md` before building it, since it's a schema change
outside what this taxonomy spec alone can decide.

---

## 8. Edge Cases & Worked Examples

| Case | Handling |
|---|---|
| Product could logically fit two categories (e.g. a stepper motor used mainly in CNC builds) | Pick the category describing **what the product physically is**, not where it's used or which project consumes it — cross-cutting "used in Project X" grouping is already handled by Projects (Section 0), not by category. |
| Stepper motor | `Mechanical & Structural > Actuators > Stepper Motors` — regardless of whether it ends up in a CNC, a Jacquard rebuild, or a drone. |
| 12V wall power adapter | `Consumables & Misc > Batteries & Power Supplies > Wall Adapters / Chargers` — it's a power-delivery consumable, not an electronic component in the PCB sense. |
| A finished product made in-house (e.g. Jacquard controller board) | `Electronics > Custom & Assembled PCBs > Assembled Boards`, not under raw component categories. |
| RAK module used for LoRaWAN | `Electronics > Breakout Boards & Modules > Communication` — categorize by function (comms module), not by brand. |
| Bulk import / CSV upload of many products at once | Category column is optional in the import template. Unmatched category text should NOT fail the row — import with `category_id = NULL` and let the "Uncategorized" filter (Section 6) surface it for later categorization; never reject the whole row. |
| Renaming a category | Does NOT change the category's ID — only the display name. All products under it stay assigned (Section 4). |
| Merging two categories into one | Reassign all products from the source category's ID to the target's, then delete the now-empty source. Never leave orphaned products. Log as an `audit_log` entry (Section 4). |
| Deleting a category that still has products in it | Block hard delete, or require reassigning/orphaning (`NULL`) products first — never silently delete products along with their category. |
| A product doesn't fit any subcategory and nobody wants to decide right now | Use the top-level category's `Miscellaneous` leaf, or leave `category_id = NULL` — both acceptable; genuinely unclear cases go to `docs/state/OPEN-QUESTIONS.md` (Section 5, step 5) instead of being silently guessed. |
| Multiple sizes/variants of the same base part (e.g. router bits of many sizes/angles, resistors of many values) | Stay as **separate products** under the same category/subcategory — size/value/angle is a `specs` attribute on the product (Section 7), not a new category. |

---

## 9. Summary for Claude Code

- Category is **optional** on the product model — `products.category_id`
  stays nullable, no required-field validation.
- Category is a **single self-referencing tree** (`categories.parent_id`,
  same shape as today), max 3 levels deep, no multi-category join table —
  cross-cutting grouping is Projects' job, not category's (Section 0).
- Seed the category table with the tree in Section 2 via `pnpm db:seed`
  (idempotent, `ON CONFLICT DO NOTHING`) — not hardcoded in application code.
- **Category CRUD is Inventory-Manager-only**, reusing the existing
  CRUD-products/categories/locations permission row (Section 3) — no new
  role or permission enum needed.
- Enforce the 3-level depth cap with a `BEFORE INSERT/UPDATE` trigger (a
  recursive CTE up `parent_id`) — **not** a `CHECK` constraint, since Postgres
  `CHECK` constraints can't reference other rows (Section 4).
- Category create/rename/move/delete writes an `audit_log` row, consistent
  with the existing append-only audit pattern (Section 4).
- Product details page shows category as a clickable breadcrumb, tolerant of
  partial (level 1/2 only) or missing (`NULL`) assignment; an "Uncategorized"
  filter view lets the IM clear the backlog without a scheduled job
  (Section 6).
- Category picker in the create/edit form supports cascading selection,
  skipping levels, and inline "add new category" at any level (IM-only).
- Build category create/rename/move/delete as a standalone API (Section 4) —
  used both by the inline picker and by a dedicated category-management
  screen, so the tree never drifts out of sync between the two.
- New/unmatched products default to `NULL` or a `Miscellaneous` leaf — never
  block save. Genuinely ambiguous cases go to `docs/state/OPEN-QUESTIONS.md`
  (Section 5) rather than being guessed ad hoc.
- A `specs` **text** field (not `jsonb`) on `products` for in-category search
  (sizes, values, tolerances) is a recommended follow-up, not decided here —
  `jsonb` wouldn't ride the existing `pg_trgm` index. Raise it as an open
  question before building it (Section 7).
