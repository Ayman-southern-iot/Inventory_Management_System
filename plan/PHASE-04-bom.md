# Phase 04 — Bill of Materials

**Goal:** a printable BOM on company letterhead that Accounts will accept.

**Reference:** `docs/reference/09-bom.md`

**Blocked by:** OQ-11 — the letterhead asset and print margins. Build against a placeholder
template, keep the letterhead a swappable asset, and do not hardcode any measurement.

## Tasks

- [ ] **4.1 Schema** — `boms`, `bom_requisitions` (join, carrying the per-requisition
      `approval_snapshot`), `bom_lines` with `requisition_item_id`, unit cost, vendor, purpose,
      project.
      *Accept:* the partial unique index prevents a requisition sitting on two live BOMs.

- [ ] **4.2 Generation** — IM selects one *or more* APPROVED requisitions, fills unit cost and
      vendor per line; totals calculated; approval snapshot frozen at generation.
      *Accept:* changing a user's designation afterwards does not change an already-generated BOM.

- [ ] **4.3 Over-budget rule** — BOM total exceeding `approved_amount` by more than the configured
      tolerance sends the requisition back for re-approval instead of on to Accounts (OQ-05).
      *Accept:* the tolerance is read from settings, not a literal.

- [ ] **4.4 PDF rendering** — headless Chromium over an HTML template with the letterhead as a
      background layer and a footprints block per source requisition (name over designation over
      date). Rendered once, stored, served by signed URL.
      *Accept:* prints correctly on A4 against the physical company pad; margins come from config.

- [ ] **4.5 Void and regenerate** — voiding requires a reason, returns every source requisition to
      APPROVED, and issues a new BOM number. No silent overwrites.
      *Accept:* the voided PDF remains retrievable for audit.

- [ ] **4.6 Inventory record export** — the same pipeline, different template: stock by product
      with location breakdown, filtered by category, zone, project, or date range
      (requirements §10).
      *Accept:* exports for the accounts department render on the letterhead in landscape.

## Exit criteria

- A BOM generated from a single requisition and one generated from three batched requisitions both
  render correctly with the right footprints
- The approval snapshot is immutable under user edits
- Numbering has no gaps and no duplicates under concurrent generation
