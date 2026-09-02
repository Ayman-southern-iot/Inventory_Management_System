# IMS — Happy Path Test

A walk through the system as five different people, doing the things they are actually there to
do, in the order the business does them. Not an edge-case hunt: this asks whether an ordinary
month of work completes end to end without anyone getting stuck.

**Written:** 2026-09-01
**Build under test:** `8dc2195` + uncommitted `PDF_MARGIN_TOP_MM` 45 → 20 (OQ-34)
**Run against:** the Docker stack (`docker-compose.yml`) on port 8173, not a dev server
**Status:** complete — every section executed.

---

## 0. Environment, measured before starting

Queried from `ims-db-1` directly, not assumed:

| Fact | Value |
|---|---|
| Users | 5, all active |
| Approver slot 1 | Ayesha Approver (`approver1@ims.local`) |
| Approver slot 2 | Farhan Finance (`approver2@ims.local`) |
| Sub-threshold approver | Ayesha Approver |
| Approver slots ≥ threshold | 2 |
| Approver slots < threshold | 1 |
| `EXPENSE_THRESHOLD_BDT` | 15,000 |
| Departments | Engineering, Operations, Accounts |
| Products | LAP-0001, GPU-0001, CBL-0001, FRN-0001 (all `pcs`) |
| Requisitions | **0** |
| BOMs | **0** |
| Migrations | 0001–0030 applied |
| API `PDF_MARGIN_TOP_MM` | 20 — confirmed inside the running container |

A clean transactional slate on a fully configured system. Every number this test produces is
therefore attributable to this test.

### Accounts

| Person | Email | Roles |
|---|---|---|
| System Administrator | `admin@ims.local` | ADMIN, GENERAL |
| Imran Manager | `im@ims.local` | INVENTORY_MANAGER, GENERAL |
| Ayesha Approver | `approver1@ims.local` | APPROVER, GENERAL |
| Farhan Finance | `approver2@ims.local` | APPROVER, GENERAL |
| Gina General | `general@ims.local` | GENERAL |

### Known blocker at time of writing

Windows has reserved TCP 5154–5753, which covers **5173** (the app), **5433** and **5434** (the
dev and test databases). The proxy cannot bind and the integration suite cannot reach its
database. `RUNBOOK.md` §7 has the fix. For this test the app is published on a port outside the
reserved range instead, which changes nothing about the software under test.

---

## How to read the result of each step

| Mark | Meaning |
|---|---|
| ✅ | Behaved as the step expects |
| ⚠️ | Worked, but something about it is worth raising |
| ❌ | Did not work |
| ⏭️ | Not reached, because an earlier step blocked it |

Every ❌ and ⚠️ gets its own entry in **§12 Findings** with what was clicked, what was expected,
and what actually happened. A step with no evidence recorded did not happen.

---

## 1. Admin — the system is set up

Signed in as `admin@ims.local`.

| # | Step | Expected |
|---|---|---|
| 1.1 | Sign in | Lands on the dashboard, not an error |
| 1.2 | Dashboard | Requisitions / Borrowing / Money cards render; all figures 0 or empty |
| 1.3 | Admin → Users | All five users listed with their roles |
| 1.4 | Admin → Departments | Engineering, Operations, Accounts |
| 1.5 | Admin → Settings | Threshold 15,000; approver slots 1 and 2 filled; sub-threshold approver set |
| 1.6 | Admin → Audit log | Shows the login just performed |
| 1.7 | Inventory | Four products listed under the name **Inventory** (not "Products") |
| 1.8 | Projects | Create a project — used later to tag a requisition |

**Why this first:** everything downstream depends on the approver chain being resolvable. A
requisition raised before slots are assigned fails at submit with an error naming the missing
setting, and that failure would be misread as a bug in the requisition form.

---

## 2. Gina (general user) — raise a requisition above the threshold

Signed in as `general@ims.local`.

| # | Step | Expected |
|---|---|---|
| 2.1 | New requisition, submit empty | Blocked. Required fields highlighted in red, not just a message |
| 2.2 | Fill: reason, department, project, needed-by | Fields accept input; highlight clears as each is filled |
| 2.3 | Add 3 item lines with quantities and estimated costs, total **> 15,000** | Line totals and the requisition total compute live |
| 2.4 | Save as draft | Appears under My requisitions as DRAFT |
| 2.5 | Reopen the draft and edit it | Edits persist |
| 2.6 | Submit | Status → **IM_REVIEW**. Requisition number is `REQ-{serial}-GINA` |
| 2.7 | Read the detail page | Raised by / Department / Project / Submitted on / Needed by / Reason all clearly visible |
| 2.8 | Check the approved-amount area | **No "approved amount" shown** — nothing is approved yet |
| 2.9 | Progress rail | IM waiting; approvers not reached |

**2.8 is a regression guard.** Showing a sanctioned figure before anyone sanctioned anything was
a reported defect; the figure must not appear until an approval exists.

---

## 3. Imran (IM) — review

Signed in as `im@ims.local`.

| # | Step | Expected |
|---|---|---|
| 3.1 | Approvals queue | Gina's requisition is listed |
| 3.2 | Open it | The approving view renders — the reworked layout, not the congested one |
| 3.3 | Item search on the form | Typing `a` narrows to items containing `a`; `ap` narrows further. Nothing shown before typing |
| 3.4 | Approve | Status → **AWAITING_APPROVAL**; Imran's node turns green in the rail |
| 3.5 | Dashboard | Total Money Requested reflects the requisition |

---

## 4. Ayesha (approver 1) — approve with a revised amount

Signed in as `approver1@ims.local`.

| # | Step | Expected |
|---|---|---|
| 4.1 | Approvals queue | The requisition is listed |
| 4.2 | Revise amount | The field appears behind a **button**, not always on screen |
| 4.3 | Approve at an amount **below** what was requested | Recorded; her node green; the revised figure is what carries forward |
| 4.4 | Status | Still AWAITING_APPROVAL — slot 2 has not acted |

**Why revise:** this is the case the office actually runs — a requisition is approved for less
than it asked, and the BOM must then be built down to that number. Approving at the full amount
would skip the constraint this test most wants to exercise.

---

## 5. Farhan (approver 2) — approve

Signed in as `approver2@ims.local`.

| # | Step | Expected |
|---|---|---|
| 5.1 | Approve | Status → **APPROVED** |
| 5.2 | Progress rail | Every node green |
| 5.3 | Approved amount | Now visible, showing Ayesha's revised figure |
| 5.4 | Rejection revert | Reject a *second*, throwaway requisition and then revert it — the revert must restore the chain |

---

## 6. Imran — generate the BOM

The step that ties the money rules together.

| # | Step | Expected |
|---|---|---|
| 6.1 | On the approved requisition, the progress rail ends with a link to generate the BOM | Present for IM; **absent** for Gina and for the approvers |
| 6.2 | Follow it | The builder opens with this requisition **already ticked** and its lines loaded |
| 6.3 | Leave the total above the approved amount | Generate is **disabled**, with the overspend shown |
| 6.4 | Adjust quantity and unit cost so `adjusted total + transportation ≤ approved` | Generate enables |
| 6.5 | Generate | BOM created; number is `BOM-{serial}-GINA`; requisition → **BOM_GENERATED** |
| 6.6 | Open the BOM | Shows **only the approved money** — no requested figure to confuse it |
| 6.7 | Download the PDF | Logo present; total in words; signatures not overlapped |
| 6.8 | Count items per page | **Five items on one page** at the 20mm margin |
| 6.9 | "Open the requisition" on the BOM | Navigates back to the source |

---

## 7. Money — accounts, funds, purchase

| # | Step | As | Expected |
|---|---|---|---|
| 7.1 | Send to accounts | IM | Status → SENT_TO_ACCOUNTS |
| 7.2 | Record funds received, in full | IM | Status → FUNDS_RECEIVED |
| 7.3 | Open Record a purchase | IM | Per-line quantity, unit cost, line total; transportation field |
| 7.4 | Watch **Left to spend** | IM | Recomputes live as quantity/cost/transportation change; **never negative** |
| 7.5 | Push the total past the funded amount | IM | Submit blocked while Left to spend is negative |
| 7.6 | Record a purchase that fits exactly | IM | Left to spend reads **0**; submit succeeds; status → PURCHASED |
| 7.7 | Attach invoice and verify | IM | Status → PURCHASE_VERIFIED |
| 7.8 | Receive to stock | IM | Status → STOCKED; stock levels rise by the received quantity |

**7.4 and 7.6 are the reported defect.** "Left to spend" showed a wrong figure where zero was
correct. Both the number and the block on negative are being checked, not just the number.

---

## 8. The two skip rules

Neither of these existed until recently; both change who is asked to approve.

| # | Step | Expected |
|---|---|---|
| 8.1 | Imran raises his own requisition (> threshold) | **Skips IM review** — straight to AWAITING_APPROVAL. Both approvers still required |
| 8.2 | Ayesha raises her own requisition (> threshold) | IM reviews it; **her own slot is skipped**; Farhan still required |
| 8.3 | Each completes to APPROVED | No requisition is stuck waiting on its own author |

---

## 9. Sub-threshold requisition

| # | Step | Expected |
|---|---|---|
| 9.1 | Gina raises a requisition **under 15,000** | Accepted |
| 9.2 | Chain | IM, then **one** approver only (the sub-threshold approver, Ayesha) |
| 9.3 | Complete it | Reaches APPROVED without Farhan |

---

## 10. Borrowing

| # | Step | As | Expected |
|---|---|---|---|
| 10.1 | Request to borrow an item | Gina | Appears in the IM's borrowing queue |
| 10.2 | Approve and issue | IM | Stock reserved, then issued |
| 10.3 | My borrowings | Gina | Shows the item as out |
| 10.4 | Return in good condition | IM | Stock returns to available |
| 10.5 | Dashboard borrowing card | Gina | "Where they are" and "How they came back" reflect the movement |

---

## 11. Reports and the dashboard, at the end

With one full requisition life and one borrow behind it, the reported figures must reconcile
against what this test actually did.

| # | Step | Expected |
|---|---|---|
| 11.1 | Dashboard money card | Four figures: Requested / Approved / In Purchasing / Transportation |
| 11.2 | Reconcile | Each matches the amounts entered above |
| 11.3 | Expenses report | Agrees with the dashboard — no third answer to "how much" |
| 11.4 | Admin → Audit log | Every action above appears, attributed to the right person |

---

## 12. What happened

Every line below was observed in the running app. Amounts are copied from the screen.

### 1. Admin

| # | Result | Evidence |
|---|---|---|
| 1.1 | ✅ | Signed in from the demo panel; landed on the dashboard |
| 1.2 | ✅ | Three cards render, all reading "Nothing yet." — correct for a clean slate |
| 1.5 | ✅ | Threshold 15,000 · slots ≥ threshold 2 · Approver 1 Ayesha · Approver 2 Farhan · sub-threshold Ayesha. Matches the database exactly |
| 1.7 | ✅ | Sidebar reads **Inventory**, not "Products" |
| 1.8 | ✅ | Project "Rooftop Solar Phase 2" created. Empty submit was blocked with a red border — see F-1 for the message |

### 2. Gina raises REQ-000001-GINA

| # | Result | Evidence |
|---|---|---|
| 2.1 | ✅ | Six fields flagged at once, `aria-invalid="true"`, border `oklch(0.55 0.19 27)`, message "Required." Submit blocked — still on `/requisitions/new` |
| 2.3 | ✅ | 12,000 + 8,000 + 2,000 = **22,000** live. The approver hint flipped from "1 approver needed" to "2 approvers needed. This is at or above the 15,000.00 threshold" as the total crossed |
| 2.3 | ✅ | Transportation 1,000 → **Requested 23,000** |
| 2.4 | ✅ | Saved as draft |
| 2.5 | ✅ | Edit reopened fully populated (qty, unit price, item name, transportation). See F-3 for the tab title |
| 2.6 | ✅ | Submitted → "With the Inventory Manager". Number **REQ-000001-GINA** — the requested format |
| 2.7 | ✅ | RAISED BY · DEPARTMENT · PROJECT · SUBMITTED ON · NEEDED BY · REASON all present and labelled |
| 2.8 | ⚠️ | No *figure* is shown — but the row "Approved amount —" is rendered. See F-4 |
| 2.9 | ✅ | "2 approvers required — threshold at submit was 15,000." IM waiting, both approvers not reached |

### 3. Imran reviews

| # | Result | Evidence |
|---|---|---|
| 3.1 | ✅ | Listed under "Waiting on me" with a **1** notification badge |
| 3.2 | ✅ | The reworked layout. Screenshot `im-approving-view.png` — facts grid, line items with "10 already in stock" per line, decision card, progress rail. Not congested |
| 3.3 | ✅ | Item search behaves as asked — see the table below |
| 3.4 | ✅ | → "Awaiting approval". Both approvers moved to "Waiting on" in parallel. A "Withdraw approval" button appeared for Imran |

Item search, typed one character at a time:

| typed | shown |
|---|---|
| *(nothing)* | no listbox at all |
| `a` | all four products |
| `ab` | USB-C to HDMI c**ab**le |
| `ch` | Office **ch**air |
| `cha` | Office chair |
| `lap` | Lenovo ThinkPad T14 — matched on the code `LAP-0001` |
| `usb` | USB-C to HDMI cable |
| `zzz` | "Nothing in the catalogue matches. It will be requested as a new item." |

Nothing before typing, narrowing as you go, free text still possible. This is the behaviour that
was asked for.

### 4. Ayesha revises down

| # | Result | Evidence |
|---|---|---|
| 4.2 | ✅ | "Revise the approved amount" is a **button**; clicking it reveals the field plus "Leave blank to approve the full requested amount. (23,000)" and a "Cancel revision" button. Correctly **absent** for the IM |
| 4.3 | ✅ | Approved at 18,000 → "Approved amount / An approver revised this down from the requested amount. / 18,000". Her note is shown in the rail |
| 4.4 | ✅ | Still "Awaiting approval" — Farhan had not acted |

### 5. Farhan approves

| # | Result | Evidence |
|---|---|---|
| 5.1 | ✅ | → **Approved** |
| 5.2 | ✅ | All three nodes carry "Approved by · <timestamp>" |
| 5.3 | ✅ | Approved amount 18,000 |
| 5.4 | ⏭️ | Not reached — see §13 |

### 6. The BOM

| # | Result | Evidence |
|---|---|---|
| 6.1 | ✅ | "Generate the BOM for this requisition" → `/boms/new?requisition=8358efc6-…` for Imran. **Absent** for Farhan on the same page |
| 6.2 | ✅ | Builder opened with the requisition already ticked (first checkbox `true`) and all three lines loaded |
| 6.3 | ✅ | Generate BOM `disabled: true`, with the full explanation shown |
| 6.4 | ✅ | Adjusted to 17,000 + 1,000 → variance 0 (0.0%), warning cleared, Generate enabled |
| 6.5 | ✅ | **BOM-000001-GINA** created; requisition → "BOM generated" |
| 6.6 | ✅ | Approved total 18,000 · items 17,000 · transportation 1,000 · variance 0. **The 23,000 requested figure appears nowhere** |
| 6.7 | ✅ | PDF rendered — see below |
| 6.8 | ⏭️ | Not reached with 5 items — this BOM has 3. See §13 |
| 6.9 | ✅ | "Open the requisition" present on the BOM page |

At 6.3 the builder showed, all at once:

```
APPROVED TOTAL  18,000     BOM SUBTOTAL  22,000
TRANSPORTATION   1,000     BOM TOTAL     23,000
VARIANCE  5,000 (27.8%)

This BOM commits more than was approved
REQ-000001-GINA: 23,000 committed against 18,000 approved — 5,000 over.
Lower a quantity or a unit cost until it fits. Transportation counts towards the approved amount.
```

**The PDF** (`BOM-000001-GINA.pdf`, pulled out of the API container and opened in the browser):

- **1 page** — counted from the PDF bytes, not estimated
- Southern IoT logo and address block ✅
- `APPROVED AMOUNT  BDT 18,000.00` in its own banner ✅
- Items table, `Items subtotal BDT 17,000.00`, `Transportation BDT 1,000.00`, `Grand total BDT 18,000.00` ✅
- **`In words: Taka Eighteen Thousand Only`** ✅
- Signature row well clear of the totals — no overlap ✅ — but see F-5

### 7. Money

| # | Result | Evidence |
|---|---|---|
| 7.1 | ✅ | → "Sent to Accounts", with a "Back" reversal offered |
| 7.2 | ✅ | Dialog pre-filled 18,000 and today, with "Still outstanding on this requisition: 18,000". → "Funded" |
| 7.3 | ✅ | Per-line quantity, unit cost and line total, each showing "Planned: n" from the BOM; transportation pre-filled at 1,000 |
| 7.4 | ✅ | **This purchase 18,000 · Funded 18,000 · Left to spend 0.** This is the reported defect, and it now reads correctly |
| 7.5 | ⚠️ | Raising a unit cost to 15,000 gave "Left to spend **-4,000**" and a warning. The submit **is** blocked — no request left the browser, no purchase was created. But Save stays enabled. See F-6 |
| 7.6 | ✅ | Recorded at exactly 18,000 → "Purchased". Spent 17,000 + Transportation 1,000, **Unspent 0.00** |
| 7.7 | ✅ | → "Purchase verified" |
| 7.8 | ✅ | → **Stocked**. Database confirms: cable 55→57, GPU 4→5, laptop 10→11 |

The full lifecycle ran end to end:

```
DRAFT → IM_REVIEW → AWAITING_APPROVAL → APPROVED → BOM_GENERATED
      → SENT_TO_ACCOUNTS → FUNDS_RECEIVED → PURCHASED → PURCHASE_VERIFIED → STOCKED
```

---

### 5.4 · Reverting a rejection

Run against REQ-000003-AYESHA, with Imran as the IM.

| Step | Result |
|---|---|
| The Reject dialog | ✅ It says so up front: "Rejecting ends the whole request — the other approvers will not be asked. **You can take your rejection back afterwards if you change your mind.**" |
| Reject with a note | ✅ → **Rejected**. IM node "Rejected by", Farhan **"Skipped"** — a rejection kills the chain, as it should. "See why" reveals the note |
| Take it back | ✅ → back to **"With the Inventory Manager"**, IM node "Waiting on", Farhan "Not reached yet", the withdrawal reason recorded in the rail, and Reject / Approve offered again |

The feature works completely. Two problems with how it is presented — F-10 and F-11.

### 8. The two skip rules

**8.1 — the IM raises his own requisition.** REQ-000002-IMRAN, 17,700, five lines.

```
Progress
2 approvers required — threshold at submit was 15,000.
  Approver 1   Ayesha Approver · Head of Operations   Waiting on
  Approver 2   Farhan Finance · Chief Financial Officer   Waiting on
```

✅ Status went straight to **"Awaiting approval"** and there is **no Inventory Manager node at
all** — the stage is not skipped-and-shown, it is not created. Both approvers still required.

**8.2 — an approver raises her own requisition.** REQ-000003-AYESHA, 62,000 — well above the
threshold, so it would normally need two approvers.

```
Progress
1 approvers required — threshold at submit was 15,000.
  Inventory Manager   Imran Manager      Waiting on
  Approver 1          Farhan Finance     Not reached yet
```

✅ The IM still reviews it — correct, Ayesha is not the IM. Her own slot is gone, Farhan is
promoted into the remaining slot, and the required count drops from 2 to 1. Exactly the rule
asked for: *"if it is approvers then they will auto sign or skip there part but other approves
will be needed"*.

### 9. Sub-threshold

REQ-000004-GINA, 2,400 — below the 15,000 threshold.

```
Progress
1 approvers required — threshold at submit was 15,000.
  Inventory Manager   Imran Manager       Waiting on
  Approver 1          Ayesha Approver     Not reached yet
```

✅ IM, then **one** approver — and specifically Ayesha, who is the configured sub-threshold
approver. Farhan is not involved. The form's own hint was correct before submit too: "1 approver
needed at this amount. At or above 15,000.00 it becomes 2 approvers."

### 10. Borrowing

Gina borrows two laptops for the Rooftop Solar project; Imran approves and later takes them back.

| # | Result | Evidence |
|---|---|---|
| 10.1 | ✅ | Borrow dialog offers the location (with per-location availability), quantity, project, "I will return this", expected-back and purpose. Submitting without a return date was blocked: "An expected return date is required" — see F-13 |
| 10.1 | ✅ | On request: **Available 11 → 9, Reserved 0 → 2, On hand still 11.** Held, not yet issued — which is right |
| 10.2 | ✅ | BR-000001 appeared in the IM's queue as Pending with Approve / Reject. Approving moved it to **Out** |
| 10.4 | ✅ | Return dialog allows a partial return, a destination compartment, and a condition (Good / Partially damaged but usable / Damaged / Not working). Returned 2 in Good condition → **Returned** |
| 10.4 | ✅ | Database after: `LAP-0001 qty 11, reserved 0`. Back exactly where it started |

The append-only ledger recorded it properly:

```
movement_type | count | sum
RECEIPT       |     8 |  73
ISSUE         |     1 |   2
RETURN        |     1 |   2
```

### 11. Dashboard and the audit trail

Gina's dashboard, after everything above:

```
Money
Total Money Requested      25,400.00
Total Money Approved       18,000.00
Total Money in Purchasing  17,000.00
Total Transportation        1,000.00
```

✅ Every figure reconciles against what this test actually did — 23,000 + 2,400 requested,
18,000 approved (Ayesha's revised figure), 17,000 purchased, 1,000 carriage. The four labels are
the ones that were asked for, word for word.

⚠️ The Requisitions card is less clear — see F-12.

**The audit log** captured the whole run, attributed correctly:

```
requisition.create 4 · requisition.submit 4 · requisition.approve 5 · requisition.reject 1
requisition.withdraw 1 · bom.generate 2 · bom.render 2 · requisition.sent_to_accounts 1
requisition.funds_received 1 · requisition.purchased 1 · requisition.purchase_verified 1
requisition.stocked 1 · borrowing.create 1 · borrowing.approve 1 · borrowing.return 1
project.create 1 · settings.update 1 · auth.login.success 17
```

Nothing this test did is missing from it.

---

## 13. Findings

**None of these stopped the happy path.** They are defects of polish, feedback and wording.

### F-1 · A raw Zod message reaches the user — Projects

**Where:** Projects → New project, Create with the name empty.

```
Project name*
String must contain at least 2 character(s)
```

The requisition form gets this right ("Required."), so the pattern exists — this dialog is not
using it. User-facing copy belongs in `apps/web/src/i18n/en.ts`; this string is coming straight
out of the schema.

### F-2 · A 403 on every requisition detail view, for anyone who cannot read BOMs

**Where:** Gina opens any requisition, including a **draft**.
**Actual:** `GET /api/v1/boms/by-requisition/<id> → 403 Forbidden`, on every visit.
**Why it matters:** the page asks for something it knows the viewer may not have, and on a draft
there cannot be a BOM at all. It is handled — the page renders — but it fills the browser console
and the server log with forbidden requests.

### F-3 · The edit page calls itself "New requisition"

`/requisitions/:id/edit` — the browser tab reads `New requisition · Southern IoT` while editing
an existing draft.

### F-4 · "Approved amount —" is rendered before anything is approved

No misleading *figure* appears, so the original complaint is addressed. Raising it only because
the row itself may still be noise on a requisition nobody has approved yet. A judgement call.

### F-5 · "for <their own name>" prints under every signature

**Where:** the BOM PDF signature block, and the "ON BEHALF OF" column on the BOM detail page.

```
Imran Manager
Inventory Manager
Approved
for Imran Manager          ← nobody acted on anyone's behalf
Date: 01-09-2026
```

All three cells do it. On-behalf-of should be blank when the approver acted for themselves. This
one is on the document that goes to Accounts, which is why it matters more than its size.

### F-6 · Save stays enabled when "Left to spend" is negative

**Where:** Record a purchase.
**Asked for (2026-08-31):** *"left to spend should not be negetive..so if it is negetive then it
will not sibmit able"*.
**Actual:** it genuinely cannot be submitted — clicking Save sends no request and creates
nothing. But the button does not *look* disabled, and clicking it produces no new feedback beyond
the warning already on screen, so the user cannot tell the click registered. The BOM builder
handles the identical situation by **disabling** Generate. The two screens should agree.

### F-7 · The requisition reason is repeated on every BOM line

BOM detail page, PURPOSE column — the same 130-character reason printed once per line. The PDF
has no PURPOSE column, so this is web-only.

### F-8 · Raw ISO timestamps in the frozen approval chain

BOM detail, "APPROVAL CHAIN (FROZEN AT GENERATION)": `2026-09-01T17:38:52.904Z` — UTC and
unformatted, while every other date on the same page reads "Sep 1, 2026, 11:42 PM" in
Asia/Dhaka.

### F-9 · A date-only value displays a time

Funding panel, RECEIPTS: `18,000.00 · CHQ-449120 / Sep 1, 2026, 12:00 AM`. The field is a date;
the midnight is an artefact of formatting it as a datetime. The borrowing table has the opposite
problem — `2026-09-30` raw where the rest of the app writes "Sep 30, 2026".

### F-10 · Reverting a **rejection** is labelled "Withdraw approval"

Imran rejected REQ-000003 and the button offered to him afterwards read **"Withdraw approval"**.
He did not approve anything. It should say withdraw *rejection*, or something neutral covering
both.

### F-11 · The withdrawal reason is collected with a native `window.prompt()`

Clicking that button raises a browser-native prompt:

```
Why are you withdrawing? (You can still approve or reject again afterwards.)
```

Every other confirmation in this app uses a styled dialog. A native prompt cannot be styled or
validated, looks foreign, and some browsers suppress it outright.

### F-12 · "Raised" is counted under "Still going on"

Gina's dashboard:

```
Requisitions — 2 raised in total.
STILL GOING ON     Raised 2 · Waiting for approval 1 · Not sent yet 0
FINISHED           Approved 1 · Rejected 0 · Cancelled 0
```

Only **one** of her two requisitions is still going on; the other is approved and counted under
Finished. "Raised 2" is a lifetime total sitting inside a group that reads as current work, and
the heading already says "2 raised in total". Removing the tile would make the group add up.

### F-13 · "Expected back" is required but not marked

The borrow dialog marks From, Quantity and Return condition with `*`. "Expected back" carries no
asterisk, yet submitting without it is refused with "An expected return date is required". It is
conditionally required — whenever "I will return this" is ticked, which is the default.

### F-14 · "1 approvers required"

The progress rail prints the frozen count without pluralising. The requisition form gets it right
("1 approver needed at this amount"), so only the tracker's line is wrong.

### F-15 · The lifecycle strip shows a stage that can never happen

On REQ-000002-IMRAN — raised by the IM, so it has no IM stage — the Lifecycle strip still shows
**IM review** between Submitted and Approved. It can never light up for that requisition.

---

## 14. A note on one thing that looked like a bug and was not

The five-item BOM (BOM-000002-IMRAN) shows its items as "Lenovo", "NVIDIA", "cable", "chair" —
the search text, not the product names. **That is an artefact of this test, not a defect.** I
drove those five lines with synthetic DOM events instead of real clicks, the option selection
never registered, and they fell through to free-text items named with whatever I had typed. The
database confirms it: those rows have `product_id` null, while REQ-000001 — driven with real
events — linked all three products correctly.

It does not affect the pagination result: five rows is five rows whatever they are called.

---

## 14b. Evidence on disk

| File | What it shows |
|---|---|
| `qa-evidence/im-approving-view.png` | The reworked approving view, full page |
| `qa-evidence/bom-pdf-page1.png` | BOM PDF head — logo, letterhead, approved amount |
| `qa-evidence/bom-pdf-bottom.png` | Totals, transportation, amount in words |
| `qa-evidence/bom-pdf-full.png` | The signature block, clear of the totals |
| `qa-evidence/bom-5items-onepage.png` | Five items on one page, viewer showing 1 / 1 |
| `qa-evidence/BOM-000002-IMRAN-5items.pdf` | The five-item PDF itself, straight out of the API container |

---
## 15. Result

**The happy path completes, end to end, for every role.**

A general user raised a requisition; the IM reviewed it; two approvers signed it, one of them
cutting the amount from 23,000 to 18,000; the BOM was refused until it fitted that reduced figure
and then generated; the PDF rendered on one page with the logo, the approved amount and the total
in words; Accounts funded it; the purchase was recorded and refused while it exceeded the funding;
the goods were verified and received into stock, and the stock levels moved by exactly the right
amounts. Separately, both skip rules, the sub-threshold chain, the rejection revert and a full
borrow-and-return cycle all behaved as specified. Every figure on the dashboard reconciles against
what was actually done, and the audit log has all of it.

**No step needed a workaround, and nothing had to be fixed to get to the end.**

Everything requested on 2026-08-31 and 2026-09-01 that this path touches was confirmed working:

| Asked for | State |
|---|---|
| `REQ-{serial}-{name}` and `BOM-{serial}-{name}` | ✅ REQ-000001-GINA, BOM-000002-IMRAN |
| Required fields highlighted red, submit blocked | ✅ six fields at once, `aria-invalid`, red border |
| Name / Reason / Project / Department / Date visible after submit | ✅ |
| "Approved amount", never "sanctioned", not shown early | ✅ wording changed; no figure before approval |
| BOM gated at `adjusted + transportation ≤ approved` | ✅ blocked at 23,000 vs 18,000, enabled at exactly 18,000 |
| BOM shows only approved money | ✅ the 23,000 requested figure appears nowhere |
| BOM from the template — logo, total in words, signature space | ✅ all three |
| Reworked approving view | ✅ no longer congested |
| Revise amount behind a button | ✅ and correctly absent for the IM |
| Google-style item search | ✅ nothing until you type, narrows as you go |
| Five items on one page | ✅ measured on the real PDF at 20mm |
| "Left to spend" correct, and never negative | ✅ reads 0; submit is blocked — but see F-6 |
| Rejections can be reverted | ✅ fully — but see F-10 and F-11 |
| IM's own requisition skips IM review | ✅ |
| Approver's own requisition skips their slot | ✅ |
| "Products" renamed "Inventory" | ✅ |

**Fifteen findings**, all cosmetic or feedback-level. The three worth doing first: **F-5**
("for <their own name>" on the printed BOM), **F-6** (disable Save instead of silently ignoring
the click) and **F-11** (the native `window.prompt`).

---

## 16. Closing the gaps in this plan

Four steps this document promised and had not done at first write-up. All now run.

| # | Step | Result |
|---|---|---|
| 1.3 | Admin → Users | ✅ All five, with designation, department, roles and status. Designation is what prints on the BOM |
| 1.4 | Admin → Departments | ✅ Accounts 1 · Engineering 1 · Operations 2 (the admin has no department, so 4 of 5) |
| 10.5 | Gina's borrowing card | ✅ "Borrowed 1 · Still with you 0 · Given back 1" — matches the cycle exactly |
| 11.3 | Expenses report | ✅ reconciles — see below |

**The expenses report**, company-wide, after everything this test did:

| Period | Reqs | Requested | Approved | Funded | Spent | On purchases | On transportation | Returned | Net cash |
|---|---|---|---|---|---|---|---|---|---|
| September 2026 | 4 | 105,100.00 | 35,700.00 | 18,000.00 | 18,000.00 | 17,000.00 | 1,000.00 | 0.00 | 18,000.00 |

23,000 + 17,700 + 62,000 + 2,400 = **105,100** ✓ · approved 18,000 + 17,700 = **35,700** ✓ ·
spent 17,000 + 1,000 = **18,000** ✓.

Worth understanding rather than reporting as a discrepancy: the report's **Spent 18,000** and the
dashboard's **Total Money in Purchasing 17,000** are different figures on purpose — Spent includes
the carriage, Purchasing does not, and the report breaks both out in adjacent columns. The
dashboard is also **per-user** ("Only you can see this"), while this report is company-wide.

**A permission boundary**, checked while switching accounts: Gina navigating directly to
`/admin/users` gets *"Not allowed — Your account does not have permission to view this page."* and
her sidebar carries only her five links. (The browser tab still reads "Users · Southern IoT" on the
refusal — cosmetic, F-17.)

### Two more findings from this pass

**F-16 · "0units"** — the dashboard borrowing card renders the unit suffix with no space:
"Came back partly damaged **0units**". Also "**1 items** borrowed in total", the same
pluralisation slip as F-14.

**F-17 · The denied page keeps the real page's title** — `/admin/users` refused to Gina still
sets the tab to "Users · Southern IoT".

---

## 17. What has NOT been tested

This was a **happy-path** run by design — the request was to walk the system as a user doing
normal work. Everything below is genuinely untested, listed so nobody mistakes this document for
full coverage.

### Blocked, not skipped

**The automated integration suite — 684 tests across 49 files — has not run since the
`PDF_MARGIN_TOP_MM` change.** It cannot: it needs port 5434, which is inside the Windows
reservation. This is the single largest untested area and it is waiting on the admin fix in
`RUNBOOK.md` §7, not on more manual testing.

### Reversals and undo — the whole "Back" family

Every money stage offers a **Back** button and none was exercised:

- Undo send-to-accounts · void a fund receipt · **void a purchase** · unverify a purchase
- **Void a BOM**, and generating a replacement afterwards
- Send back for revision from the BOM builder
- Cancel a requisition as the requester; withdraw an approval at the *approver* stage
  (only the IM stage was tested)
- Revert a borrow

**Void a purchase deserves priority.** OQ-32 — whether the carriage follows a voided purchase out
of `spent` — was decided and implemented *this session*, and has never been exercised through the
UI.

### File upload — never touched at all

- Supporting document on a requisition (attach, replace, remove)
- **Approve with signature** — every approval in this run used "Approve without signature", so the
  signature upload path and the signature image on the BOM PDF are both unproven
- Invoice attachment on a purchase (verification was done without one, which is the documented
  behaviour, but the attach path itself is untested)

Upload is the highest-risk untested surface: it touches storage, MIME handling and the PDF.

### Money paths beyond the simple one

- **Partial funding** (`FUNDS_PARTIAL`) — funding less than approved, then topping up
- Two or more purchases against one requisition
- Money **returned to Accounts** — every run here ended with unspent 0.00
- A purchase that comes in **under** the funded amount

### BOM cases

- Batching **several requisitions** into one BOM — only single-requisition BOMs were built
- The one-requester guard (`BomSpansMultipleRequestersError`) — never triggered
- Re-rendering a PDF; downloading through the app's own Download button (the PDFs here were read
  out of the container)
- More than five items — the point where it genuinely pages, and whether headings repeat

### Borrowing conditions

- Rejecting a borrow request
- **Partial return** — returning 1 of 2 and leaving the rest out
- Returns in **Damaged / Not working** condition, and whether they land in quarantine
- A consumable (unticking "I will return this")
- Overdue behaviour and the reminder job
- Issue on behalf of someone else

### Inventory operations

None of the stock-editing operations were run: adjust, move between compartments, dispose,
release from quarantine. Nor product/category/zone/compartment creation or archiving — the
catalogue used here came from the seed.

### Administration

- Creating or editing a **user**, assigning roles, resetting a password, deactivating an account
- Creating a department, and the per-department approver-slot override
- **Changing a setting and observing the effect** — the threshold and the approver slots were read
  but never changed, so the "takes effect immediately, without a redeploy" claim is unverified
- Audit log filters (the log was read unfiltered), and the retention/purge job

### Elsewhere in the app

- **Notifications** — the bell showed a badge and was never opened
- Change password, account profile
- Project detail page; All-requisitions page beyond a glance
- Expenses **CSV and PDF download**
- Login failures and the rate-limit lockout
- Deadline reminders and any other scheduled job

### Non-functional

Responsive/mobile layout, accessibility beyond the `aria-invalid` wiring seen here, concurrent
edits by two users, and performance under realistic data volumes.

### Suggested order, if this continues

1. **Unblock and run the integration suite** — 684 tests beats any amount of clicking.
2. **Void a purchase**, to exercise this session's own OQ-32 fix.
3. **Approve with signature**, and the supporting-document upload.
4. **Partial funding and money returned to Accounts** — the money paths most likely to hide an
   arithmetic error, since every figure here happened to land on zero.
5. **Damaged returns → quarantine.**
6. **Admin CRUD and a live settings change.**
