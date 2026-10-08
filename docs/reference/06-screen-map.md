## 6. Screen map

| Role | Screens |
|------|---------|
| **General** | Inventory (browse/search/borrow) · Make Requisition · My Requisitions (tracker) · My Borrowings · Notifications |
| **Inventory Manager** | Inventory (full CRUD, categories, zones/compartments, moves) · Pending Approvals ⁽ᵇᵃᵈᵍᵉ⁾ · Accepted Approvals · Product Borrowing Approvals · BOM workspace · Funds & Purchases · + all General screens |
| **Approver** | Pending Approvals ⁽ᵇᵃᵈᵍᵉ⁾ · Accepted Approvals · Delegate settings · + all General screens |
| **Admin** | Users · Roles & Approvers · Departments · Settings · Audit log |

A **lab panel** at `/panel` sits outside the role table: any signed-in account may open it, and the
lab's wall kiosk runs it as the GENERAL account `lab-panel`. Full screen, no shell, read-only: a
cabinet map and a part search fed by `GET /catalogue`, never showing who holds anything
(OQ-P1, OQ-P2, OQ-P3).

---
