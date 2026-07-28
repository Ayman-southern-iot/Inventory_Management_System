## 8. Notifications

| Trigger | Recipient | Channel |
|---------|-----------|---------|
| Borrow request raised | Inventory Manager | socket popup + badge + bell |
| Borrow approved / rejected | Requester | bell (+ email) |
| Item overdue | Borrower + IM | daily job |
| Requisition submitted | Inventory Manager | popup + badge |
| IM approved | Approver 1 & 2 (or delegates) | badge + email |
| Approval deadline passed, still pending | Assigned approver | job, repeats every 24h until acted |
| Rejected at any stage | Requester (note attached) | bell + email |
| Approval withdrawn | Requester + IM + other approver | bell |
| BOM generated | Requester | bell |
| Funds received (partial or full) | Requester | bell |

Deliberately absent per your requirements doc: **the Inventory Manager is never pinged when the remaining balance of a partially funded request arrives** — they check the request back manually — and there is no low-stock alerting. The requester-facing "funds received" bell above fires only as a side effect of the IM logging a receipt; it is not a poll or a watcher. Both omissions are easy to reverse later — the job scaffolding is already there.

**Login popup:** on socket connect the server pushes any `PENDING` items for that user. The IM sees the modal, can dismiss it, and the items remain in Pending Approvals with the badge count. Dismissal is per-session, not permanent.

---
