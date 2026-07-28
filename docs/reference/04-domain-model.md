## 4. Domain model — the three ideas that carry the whole system

### 4.1 Product vs. Placement

```
Product (Arduino Uno, code PRD-0142)        ← one card, one ID, forever
   ├── Placement: Meta / 2A      qty 40     ← blue chip
   └── Placement: Nvidia / 1C    qty 30     ← purple chip
       total on hand: 70
```

Moving 30 of 70 = decrement one placement, upsert another, write one ledger row. The product ID never changes, which is exactly the behaviour you described. Placement colour is derived deterministically from the compartment ID, so the same location is always the same colour on every card.

Locations are two-level: **Zone** ("Meta", "Nvidia") → **Compartment** ("1A", "1B", "3C"). Both are free-form and admin/IM-creatable, so any naming scheme works.

**Trackable scope.** Per the requirements doc, only laptops and R&D hardware are tracked today; furniture is out of scope. This is modelled as an `is_trackable` boolean on **category**, not as hard-coded logic — turning furniture on later is a checkbox in the IM's category screen, not a migration. Untracked categories can still exist in the catalogue for reference without carrying placements or ledger rows.

### 4.2 On-hand vs. Reserved vs. Available

```
available = quantity − reserved
```

`reserved` covers the window between "Saad pressed Borrow" and "IM approved and handed it over". Without it, three people can borrow the last Arduino in the same minute and all three requests succeed.

| Event | quantity | reserved |
|-------|----------|----------|
| Borrow requested | — | +n |
| IM rejects / requester cancels | — | −n |
| IM approves & issues | −n | −n |
| Item returned | +n | — |
| Consumable issued | −n | −n (never comes back) |

### 4.3 The ledger

Every mutation appends one immutable row:

```
id | product | from_comp | to_comp | qty | type   | ref_type    | ref_id | actor | at
17 | PRD-0142| Meta/2A   | Nvid/1C | 30  | MOVE   | manual      | null   | u_im  | ...
18 | PRD-0142| Nvid/1C   | null    |  2  | ISSUE  | borrow      | b_88   | u_im  | ...
19 | PRD-0142| null      | Nvid/1C |  2  | RETURN | borrow      | b_88   | u_im  | ...
```

`SUM(ledger) == placements.quantity` is an invariant you can assert nightly. If it ever fails, you have a bug and you know it within 24 hours instead of never.

### 4.4 Requested vs. Approved vs. Funded

Requirements §6 asks the fund-logging screen to compare three figures. They are three genuinely different numbers and each is stored, not derived on the fly:

| Figure | Set by | When | Can change after? |
|--------|--------|------|-------------------|
| **Requested** `requisitions.requested_amount` | Requester (sum of line estimates) | Frozen at submit | No — it is the historical ask |
| **Approved** `requisitions.approved_amount` | The approval chain | On full approval | Only via withdraw → re-approve |
| **Funded** `SUM(fund_receipts.amount)` | Inventory Manager | Each receipt logged | Grows with each receipt |

`approved_amount` **defaults to the requested amount**. An approver may sanction a *lower* figure by typing it into the approve dialog — this is still an approval, so it does not contradict the approve/reject model in requirements §4, and it is what makes the three-way comparison meaningful. If you'd rather approvers had no amount field at all, it's a config flag (`allow_amount_revision`), and the column simply mirrors the request.

```
Requested  22,000 BDT
Approved   18,000 BDT   ▼ 4,000 revised down by Farhana Akter, CFO
Funded     10,000 BDT   ◐ 8,000 outstanding
```

The outstanding balance is displayed but **never** pings the IM — they check back manually (requirements §6). The over-budget rule (A6) compares the BOM total against *approved*, not requested.

---
