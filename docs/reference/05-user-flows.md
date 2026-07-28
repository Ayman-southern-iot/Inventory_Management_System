## 5. User flows

### 5.1 Borrow flow (General → IM)

```
General user                    System                        Inventory Manager
─────────────────────────────────────────────────────────────────────────────────
Search "Arduino"          →  catalog search, returns
                             per-location availability
Sees: 70 available
  Meta/2A · 40   Nvidia/1C · 30

Press "Borrow"            →  modal opens
  qty: 2
  project: [select | + new]
  returnable? ● Yes ○ No (consumable)
  expected return: 2026-08-10
  purpose: "sensor prototype"

Submit                    →  validate available ≥ 2
                             reserve 2
                             status = PENDING
                             ──────────────────────→  🔔 popup + badge +1
                                                       (dismissible, stays in list)

                                                       Reviews row in
                                                       "Product Borrowing Approvals"
                                                       [Approve] [Reject]

                          ←──────────────────────────  Approve
                             qty −2, reserved −2
                             ledger: ISSUE
                             status = ISSUED
                             row now shows "Approved ✎"
🔔 "Approved — collect it"
                                                       (✎ Edit = revert within
                                                        the undo window, Q7)

...later, hands it back                                Search product → [Return]
                                                       qty returned: 2
                          ←──────────────────────────  Confirm
                             qty +2, ledger: RETURN
                             status = RETURNED
                             actual_return_date = today
```

**Borrow log** (per product, newest first — this is the table from your story):

| Borrower | Project | Qty | Borrowed | Expected back | Returned | Purpose | Status |
|----------|---------|-----|----------|---------------|----------|---------|--------|
| Saad | Falcon | 2 | 27 Jul | 10 Aug | — | sensor prototype | **Out** |
| Rima | Atlas | 1 | 20 Jul | 25 Jul | 24 Jul | demo | Returned |
| Nabil | Falcon | 3 | 12 Jul | — | — | soldering wire | Consumed |

Overdue rows (expected back < today, not returned) render red. Consumables never show a return date.

**IM's Product Borrowing Approvals screen:** searchable table, filter chips `All | Pending | Out | Returned | Overdue`, columns *Product · Taken By · Taking date · Return date · Project · Status · Action*. Approve/Reject inline; after approving, the buttons collapse to "Approved ✎".

---

### 5.2 Requisition flow — state machine

```
                          ┌──────────┐
                          │  DRAFT   │
                          └────┬─────┘
                               │ submit  (freeze approver count from threshold)
                          ┌────▼─────────┐
                          │  IM_REVIEW   │──reject──┐
                          └────┬─────────┘          │
                               │ IM approves        │
                               │ "confirmed not in  │
                               │  inventory"        │
                          ┌────▼─────────┐          │
                          │ AWAITING_    │          │
                          │ APPROVAL     │          │
                          │  A1 ⏳ A2 ⏳  │──either──┤
                          │  (parallel)  │  rejects │
                          └────┬─────────┘          │
                               │ all required       │
                               │ approvals in       │
                          ┌────▼─────────┐          │
                          │  APPROVED    │          │
                          └────┬─────────┘          │
                               │ IM generates BOM   │
                          ┌────▼─────────┐          │
                          │ BOM_GENERATED│          │
                          └────┬─────────┘          ▼
                               │ IM marks sent  ┌──────────┐
                          ┌────▼─────────┐     │ REJECTED │ (terminal,
                          │ SENT_TO_     │     └──────────┘  carries note)
                          │ ACCOUNTS     │
                          └────┬─────────┘
                               │ IM logs fund receipt(s)
                          ┌────▼──────────────┐
                          │ FUNDS_PARTIAL ⇄   │  (loops until sum = BOM total)
                          │ FUNDS_RECEIVED    │
                          └────┬──────────────┘
                               │ IM records purchase
                          ┌────▼─────────┐
                          │  PURCHASED   │
                          └────┬─────────┘
                               │ IM receives into stock  ← G1: this closes the loop
                          ┌────▼─────────┐
                          │   STOCKED    │ → CLOSED
                          └──────────────┘
```

**Withdraw:** an approver may withdraw their own approval while status ∈ {AWAITING_APPROVAL, APPROVED}. Withdrawing from APPROVED pulls the requisition back to AWAITING_APPROVAL and notifies everyone. Once `BOM_GENERATED`, withdraw is blocked — the IM must void the BOM first, which is a logged, reason-required action.

**Cancel:** the requester may cancel their own requisition any time before `BOM_GENERATED`.

### 5.3 The live tracker (My Requisitions)

Nine nodes, driven off `requisition_events` — not off the status column, so the tracker is always historically accurate even if we add stages later.

| Node | Green ✓ when | Amber when |
|------|--------------|------------|
| Requisition made | always | — |
| Inventory Manager | IM approved | — |
| Approver 1 — *Kamrul Hasan, Head of Ops* | approved | — |
| Approver 2 — *Farhana Akter, CFO* | approved | — |
| BOM created | BOM exists | — |
| Sent to Accounts | IM marked sent | — |
| Money Received | full amount logged | partial: "30,000 / 50,000 BDT" |
| Products Bought | purchase recorded | partially purchased |
| Received & Stocked | all lines stocked | some lines stocked |

States: **green ✓** done · **ash ○** pending · **red ✗** rejected · **amber ◐** partial · **grey ⊘** skipped (e.g. Approver 2 on a below-threshold request).

A red node renders a **"See why"** link → opens the rejection note, the rejector's name and designation, and the timestamp. A withdrawn approval renders as amber ↩ with a "See why" of its own.

### 5.4 Requisition form — field scope

Requirements §3 is precise about scope: some fields are captured **once per request** and apply to every item; others repeat **per line**. The form is therefore two halves, and the schema mirrors it exactly — per-request fields live on `requisitions`, per-line fields on `requisition_items`. Nothing crosses over.

| Field | Scope (req §3) | Stored on | Form position |
|-------|----------------|-----------|---------------|
| Item name | Per line | `requisition_items.product_id` or `.item_name` | Line repeater |
| Quantity | Per line | `requisition_items.quantity` | Line repeater |
| Unit amount (BDT) | Per line \* | `requisition_items.estimated_unit_price` | Line repeater |
| Urgency | Per request | `requisitions.urgency` | Header |
| Deadline for approval | Per request | `requisitions.approval_deadline` | Header |
| Reason | Per request | `requisitions.reason` | Header |
| Department | Per request | `requisitions.department_id` | Header |
| Project | Per request | `requisitions.project_id` | Header |

\* The only field not in the §3 table. It comes from your story — *"we also select the quantity how many we need and also amount in bd"* — and it is what makes the auto-calculated total and the threshold check possible. Everything else matches §3 one for one.

```
┌─ New Requisition ─────────────────────────────────────── REQ-2026-0087 ─┐
│                                                                          │
│  PER REQUEST · applies to every item below                               │
│  ─────────────────────────────────────────────────────────────────────   │
│  Department  [ R&D              ▾ ]   Project  [ Falcon    ▾ ] [ + New ] │
│                                                                          │
│  Urgency     ( ) Low   (•) Normal   ( ) High   ( ) Critical              │
│                                                                          │
│  Deadline for approval  [ 05 Aug 2026  📅 ]                              │
│      ⓘ approvers who haven't acted by this date are reminded (§8)        │
│                                                                          │
│  Reason                                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Sensor rig for the Falcon prototype demo.                          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  PER LINE · one or more items                                            │
│  ─────────────────────────────────────────────────────────────────────   │
│  🔍 ardu                                                                 │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Arduino Uno R3                                    70 in stock      │  │
│  │ Arduino Nano                                       0 in stock      │  │
│  │ ─────────────────────────────────────────────────────────────────  │  │
│  │ ➕ Add "ardu" as a new item                                         │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Selected: Arduino Uno R3                                                │
│  ✓ Already available — 40 in Meta / 2A, 30 in Nvidia / 1C                │
│                                                                          │
│  Quantity [  5 ]   Unit amount (BDT) [ 1,200 ]  = 6,000      [ Add ]     │
│                                                                          │
│  Items in this requisition                                     2 lines   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Arduino Uno R3      5 × 1,200 =  6,000   ⚠ 70 in stock          🗑 │  │
│  │ ESP32-S3  (new)    10 ×   900 =  9,000   new item                🗑 │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Total  15,000 BDT · above the 15,000 threshold → 2 approvers required   │
│                                        [ Save draft ]      [ Proceed ▸ ] │
└──────────────────────────────────────────────────────────────────────────┘
```

**Behaviour notes**

- **Department** pre-fills from the requester's profile and stays editable — someone in R&D may legitimately raise a request against Operations' budget.
- **Project** is a combobox over existing projects with an inline *+ New*, exactly as in the borrow flow. Duplicate-name warning on create (Q10).
- **Urgency** affects sort order and badge colour in the approvers' queues. It does **not** change routing or the approver count — the requirements doc never asks it to, and making urgency skip approvals is how thresholds get quietly bypassed.
- **Deadline for approval** must be today or later. It is the sole trigger for the reminder job in §8, per requirements §5.
- **Proceed** stays disabled until every per-request field is filled *and* at least one line exists. The threshold banner recalculates live as lines are added, so the requester knows before submitting whether this needs one approver or two.
- **Save draft** keeps the requisition in `DRAFT`; nothing is visible to the IM and no approval records are created until Proceed.
- After Proceed the form is locked. To change anything the requester cancels and re-raises (allowed until `BOM_GENERATED`).

The green in-stock hint is **advisory, never blocking** — the story is explicit that "we have 2 but need 5" must still be addable. The stock snapshot at submit time is stored on the line so the IM sees what the requester was looking at.

**Not on this form:** returnable/consumable. It is not in requirements §3, and in your story it came up in the *borrowing* context — *"he can filter it return or not return item... some product may be not returnable so general user should mention that one"*. The general user does declare it, but on the **borrow** form (§5.1), not here, where nobody yet knows what the item will turn out to be. The catalogue carries `products.default_returnable`, set by the IM and pre-filled from the category; the borrow form defaults to it and stays editable per borrow.

### 5.5 Inventory Manager — stock move / split

```
Product: Arduino Uno R3 (PRD-0142)          Total on hand: 70
┌──────────────────────┐  ┌──────────────────────┐
│ ● Meta / 2A       40 │  │ ● Nvidia / 1C     30 │      [ Move stock ]
└──────────────────────┘  └──────────────────────┘
   (blue)                    (purple)
```

Move dialog: *From* placement → *To* compartment → *Qty* (max = available, not quantity — reserved units can't be moved out from under a pending borrow) → optional note. On confirm the server runs a single transaction; the UI refetches via socket invalidation and both chips update. A move of the full quantity removes the source chip.

### 5.6 Approver

Two screens only: **Pending Approvals** (badge count) and **Accepted Approvals** (with live tracker on click, newest first). Actions: Approve · Reject *(note mandatory)* · Withdraw. Each pending item shows **who else is assigned and whether they have responded yet** — "Farhana Akter · awaiting" — so neither approver sits waiting on the other in silence. Plus a **Delegate toggle** in their profile: pick a delegate and a date range; while active, the item appears in the delegate's pending list and the audit records *"Approved by Rima Chowdhury on behalf of Kamrul Hasan"*. The BOM footprint shows both names.

### 5.7 Admin

Users (create, deactivate, reset password, assign role set, set **designation** — this is what prints on the BOM), Approver configuration (who is Approver 1 / Approver 2, globally and per department), Departments, Settings (expense threshold, over-budget tolerance, reminder cadence, letterhead upload), and a read-only Audit log.

---
