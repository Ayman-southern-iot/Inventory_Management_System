## 11. Suggested build order

| Phase | Contents | Why here |
|-------|----------|----------|
| 0 | Auth, users, roles, departments, admin panel, settings | Everything else needs a user with a designation |
| 1 | Catalogue, zones/compartments, placements, ledger, move/split, IM inventory screens | Stock correctness is the foundation; get it right alone before workflows depend on it |
| 2 | Borrow → approve → issue → return, borrow logs, IM borrow screen | Smallest complete loop; ships real value in ~2 weeks |
| 3 | Requisition form, submit, IM review, parallel approvals, withdraw, delegation, tracker, notifications | The big one |
| 4 | BOM generation + letterhead PDF + approval snapshot | Depends on 3 being stable |
| 5 | Funds, purchases, receive-to-stock (closes the loop back into Phase 1) | |
| 6 | Reports, exports, audit UI, overdue dashboards | |

Phases 1 and 2 are shippable on their own — people can start using the borrow flow while the requisition engine is still being built.

---
