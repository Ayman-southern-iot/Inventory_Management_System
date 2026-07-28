## 9. BOM generation

Triggered by the IM once status = `APPROVED`. Auto-filled from the requisition; the IM fills in **unit cost** and **vendor** per line.

**One BOM, one or more requisitions.** Requirements §9 says the BOM is auto-filled from "the originating request form submission(s)". The default is one BOM per requisition, but the IM can select several approved requisitions and batch them onto a single BOM to hand Accounts one document instead of five. Rules:

- Only requisitions in status `APPROVED` are selectable.
- A requisition can sit on at most one live BOM (unique index, §7.2).
- Each BOM line carries its own **purpose** and **linked project**, inherited from its source requisition — so a batched BOM stays legible line by line.
- Funds are still logged **per requisition**, not per BOM (requirements §6 is explicit that receipts go against the specific procurement request). If Accounts releases one lump sum against a batched BOM, the IM allocates it across the source requisitions; the dialog pre-fills a pro-rata split.
- Voiding a batched BOM returns every source requisition to `APPROVED`.

At generation time the system takes an immutable **approval snapshot** per source requisition into `bom_requisitions.approval_snapshot`:

```json
[
  {"stage":"INVENTORY_MANAGER","name":"Tanvir Alam","designation":"Inventory Manager","acted_at":"2026-07-22T10:14:00+06:00"},
  {"stage":"APPROVER","slot":1,"name":"Kamrul Hasan","designation":"Head of Operations","acted_at":"..."},
  {"stage":"APPROVER","slot":2,"name":"Farhana Akter","designation":"Chief Financial Officer","acted_at":"...","on_behalf_of":null}
]
```

Snapshotting matters: if Admin later changes someone's designation or that person leaves, a BOM printed in July must still show what was true in July. Never render the BOM PDF by joining live to `users`.

**Other PDF exports.** The requirements doc also asks for **inventory records** to be exportable as PDF for the accounts department. Same rendering pipeline, different template: current stock by product with location breakdown, plus filtered variants (by category, by zone, by project, borrow ledger for a date range). Landscape A4, company pad header, generated on demand rather than stored.

The BOM PDF is rendered from an HTML template that carries your company pad as a background layer, with the footprints block at the bottom (name over designation over date, one column per approver — and one footprints block per source requisition on a batched BOM). Rendered once, stored in S3, served by signed URL. Regeneration voids the old BOM and issues a new number — no silent overwrites.

---
