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

---
