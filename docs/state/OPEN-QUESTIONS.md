# Open questions

Anything not answered by the requirements doc or the design. **Never silently guess.** If you must
proceed, implement the smallest defensible default, mark it `// OPEN QUESTION: OQ-NN` in the code,
and record the assumption here.

Status: 🔴 blocking · 🟠 needed soon · 🟢 can wait

| ID | Status | Question | Working assumption | Blocks |
|----|--------|----------|--------------------|--------|
| OQ-01 | 🔴 | Below the 15,000 BDT threshold, how many approvers? | 1 approver | Phase 03 |
| OQ-02 | 🔴 | Are Approver 1 and 2 fixed company-wide, or per department? | Global default, per-department override | Phase 00 (admin), 03 |
| OQ-03 | 🟠 | Do laptops need serial-level tracking? | No — quantity-based; `asset_units` dormant | Phase 01 |
| OQ-04 | 🟠 | What does the IM's ✎ Edit on an approved borrow do once the item has left? | Revert to pending, only before physical issue | Phase 02 |
| OQ-05 | 🟢 | Should a BOM over the approved amount by >10% bounce back for re-approval? | Yes, tolerance configurable | Phase 04 |
| OQ-06 | 🟢 | Line-level partial approval of a requisition? | No — whole request only | Phase 03 |
| OQ-07 | 🟢 | Self-approval: CFO raises a request and is also Approver 2 | Skip and substitute; substitute undefined | Phase 03 |
| OQ-08 | 🟢 | Is consumable a product-level flag or a per-borrow choice? | Product default, overridable on the borrow form | Phase 01 |
| OQ-09 | 🟢 | Do projects need a code, owner, or budget? | Name only, with a duplicate-name warning | Phase 02 |
| OQ-10 | 🟢 | Is there an SMTP relay available? | No — in-app notifications only for v1 | Phase 03 |
| OQ-11 | 🟠 | Company letterhead asset and exact print margins | Placeholder template until supplied | Phase 04 |

## Resolved

_(move rows here with the answer inline when the user decides)_
