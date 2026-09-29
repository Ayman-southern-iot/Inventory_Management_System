## 10. Permissions matrix

| Action | General | Approver | Inv. Manager | Admin |
|--------|:-------:|:--------:|:------------:|:-----:|
| Browse inventory | ✓ | ✓ | ✓ | ✓ |
| Borrow / return own items | ✓ | ✓ | ✓ | ✓ |
| Raise requisition | ✓ | ✓ | ✓ | ✓ |
| Approve borrow · mark returned | | | ✓ | |
| CRUD products/categories/locations | | | ✓ | |
| Move / split stock | | | ✓ | |
| First-stage requisition approval | | | ✓ | |
| Second-stage approval · withdraw | | ✓ | | |
| Generate / void BOM | | | ✓ | |
| Log funds · record purchase · receive to stock | | | ✓ | |
| Create users · assign roles · set designations | | | | ✓ |
| Configure approvers & threshold | | | | ✓ |
| View audit log | | | | ✓ |

An approver cannot approve their own requisition — the system skips to the next configured approver and logs the substitution. (Q8.)

**API keys** (Phase 10, [ADR-0002](../adr/0002-api-keys-and-direct-take.md)) are not a column in
this matrix. A key reaches only routes that declare a scope it holds, and every other route
refuses it. A read-only key has no principal. A write key acts as its **service account**, which
holds GENERAL and INVENTORY_MANAGER, so the IM column's role checks still apply on top of the
scopes. Only an admin issues keys and service accounts, and never through a key.
`15-integration-api.md` lists the routes.

---
