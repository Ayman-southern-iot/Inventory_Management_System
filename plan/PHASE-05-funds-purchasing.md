# Phase 05 — Funds and purchasing

**Goal:** close the loop — money in, goods bought, stock back in the register.

**Reference:** `docs/reference/04-domain-model.md` §4.4, `docs/reference/05-user-flows.md` §5.2

## Tasks

- [ ] **5.1 Fund receipts** — logged per requisition (never per BOM, per requirements §6): amount,
      date received, reference number, note. Multiple receipts per requisition.
      *Accept:* the three-figure view shows requested / approved / funded with the outstanding
      balance, and the IM is **not** notified when a remaining balance arrives.

- [ ] **5.2 Lump-sum allocation** — a single receipt against a batched BOM is split across its
      source requisitions with a pro-rata pre-fill the IM can override.
      *Accept:* allocations always sum exactly to the receipt; rounding never loses a taka.

- [ ] **5.3 Purchases** — vendor, invoice number, date, lines linked to BOM lines with actual cost.
      *Accept:* a purchase cannot exceed its BOM line quantity without an explicit override + note.

- [ ] **5.4 Receive to stock** — the loop closure. Each purchased line is received into a chosen
      compartment: creates the catalogue product if it was a new item, then calls
      `StockService.receive` with a RECEIPT ledger row referencing the requisition.
      *Accept:* a requisition for a brand-new item ends with that item searchable and borrowable.

- [ ] **5.5 Tracker completion** — the "Money Received", "Products Bought" and "Received & Stocked"
      nodes reflect partial states in amber with counts.
      *Accept:* a half-funded, half-purchased requisition renders honestly rather than as complete.

## Exit criteria

- A requisition can be walked end to end from submit to STOCKED, with the ledger reconciling
- Partial funding and partial receipt both render correctly on the tracker
- New items created through this path are indistinguishable from catalogue items created by the IM
