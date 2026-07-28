## 12. What I'd revisit as this grows

- **Serial-number tracking.** The moment finance asks "which laptop does Saad have", quantity-based stock stops being enough. `asset_units` is in the schema but dormant; turning it on later is a migration, not a rewrite.
- **Approval chains.** Right now it's a fixed 1-or-2 approver rule. If you ever need "> 200k needs the MD too", replace the frozen `required_approver_count` with a rules table. The `requisition_approvals` shape already supports N approvers.
- **Multi-warehouse.** Zones are flat today. A `warehouse` level above zone is a one-column addition.
- **Accounts integration.** `fund_receipts` and `purchases` are manual logs by design; they're shaped so an ERP sync can write to them later.

---
