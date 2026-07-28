## 1. What I understood (story replay)

Let me play back the story in my own words so we catch misunderstandings now, not in sprint 3.

**Saad needs an Arduino.**

1. He logs into his portal. He sees a switch: **Inventory** | **Make Requisition**, plus a third tab **My Requisitions**.
2. In **Inventory** he searches "Arduino". It exists and it's in stock. He presses **Borrow**, picks (or creates) a **project**, says how many he needs, and says whether the item is **returnable or consumable**.
3. The Inventory Manager (IM) gets an instant popup, approves it. Stock quantity updates automatically. Saad physically collects the item.
4. A log row is written against that product: *Name · Borrow date · Return date · Project · Purpose*. Newest first. Because a product can have quantity > 1, several people can hold the same product at once — so the log is per-borrow, not per-product.
5. When Saad returns it, the IM marks it returned and stock goes back up.

**Saad needs something that isn't in stock (or isn't in the catalogue at all).**

1. He goes to **Make Requisition**. He types in a search box that is also a dropdown, fed from the inventory catalogue.
2. If he picks an existing product, a **green hint** appears: *"Already available — 2 in Meta / 1A"*. He can still add it (out of stock, or he needs 5 and we only have 2).
3. If the product doesn't exist at all, he types a free-text name.
4. Per line he sets **quantity** and **unit amount (BDT)**; line total and request total are calculated. Added lines appear as a list under the search box.
5. Request-level fields: urgency, approval deadline, reason, department, project.
6. He presses **Proceed**. It goes to the **Inventory Manager first** — the IM's approval means *"confirmed, we really don't have this, go ahead"*.
7. Then it goes to the approvers (2 of them above the expense threshold, no fixed order).
8. In **My Requisitions** he watches a live tracker:
   `Requisition made ✓ → IM Approved ✓ → Approver 1 ✓ → Approver 2 ⏳ → BOM created ⏳ → Sent to Accounts ⏳ → Money Received ⏳ → Products Bought ⏳`
   Green = done, ash = pending, red ✗ = rejected. On a rejection a **"See why"** link reveals the rejection note.
9. Any approver who clicks by mistake can **withdraw** their approval.

**Inventory Manager** runs the warehouse: full CRUD on inventory, categories and locations; moves stock between locations including **partial moves** (move 30 of 70 — same product, now shown as two location chips in different colours); handles borrow approvals and returns; generates the BOM on company letterhead with every approver's name and designation stamped on it.

**Admin** creates users, assigns one of the three roles, names the approvers and their positions, and can change the expense threshold without a code change.

### 1.1 Gaps I found while replaying it

These are things the story implies but never states. I've made a decision for each (Section 2) so you can just say "yes" or "no, do X instead".

| # | Gap | My call |
|---|-----|---------|
| G1 | Story ends at "Buy Products" — bought items never enter inventory | Added a final stage: **Received & Stocked** |
| G2 | Requester enters an *estimated* price; BOM has IM's *actual* unit cost. They will differ | Two separate fields; over-budget rule in §2 |
| G3 | Below the 15,000 BDT threshold, how many approvers? | 1 approver (Q1) |
| G4 | Nothing says stock is held between "borrow requested" and "IM approved" | Reservation model, §4.2 |
| G5 | "Return date" in the borrow table is ambiguous — expected vs actual | Store both |
| G6 | Partial returns (took 5, returned 3) | Supported |
| G7 | Withdraw approval after the BOM is printed? | Blocked after BOM generation (Q4) |
| G8 | Who are Approver 1 and Approver 2 — fixed people or per-department? | Global default, per-department override (Q2) |
| G9 | Laptops: do we need to know *which* laptop Saad has? | Optional serial tracking, off by default (Q3) |

---
