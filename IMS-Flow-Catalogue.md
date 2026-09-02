# IMS — Complete Flow Catalogue

Every flow the system can take: the happy ones, the refused ones, the reversals, the boundaries
and the abuse. Built by reading the code — 22 controllers, ~110 endpoints, 54 error codes and
every validation bound in `packages/shared/src/contracts` — not from memory of the UI.

**Compiled:** 2026-09-02 · against `8dc2195`
**Companion:** `IMS-Happy-Path-Test.md` records what has actually been *run*. This document is
what *exists*. The two are deliberately separate: one is evidence, this is scope.

**620 cases, numbered TC-001 to TC-620**, contiguous with no gaps. 581 are written out
individually; the other 39 sit inside a range on one row — the permission matrix and the
state-machine table, where the case is the same shape repeated over a list of routes or statuses.

Each case has an id (`TC-###`). Where a case expects a refusal it names the `ErrorCode` the API
should return, because the SPA selects its message by that code — a wrong code is a silent
mistranslation, not a visible bug.

---

## Part 0 — The vocabulary every flow uses

### Roles

`GENERAL` · `APPROVER` · `INVENTORY_MANAGER` · `ADMIN`

A user may hold several. Every seeded user also holds `GENERAL`, so "an approver" in practice
means "an approver who is also a general user".

### Requisition status — 14

`DRAFT` · `IM_REVIEW` · `AWAITING_APPROVAL` · `APPROVED` · `REJECTED` · `BOM_GENERATED` ·
`SENT_TO_ACCOUNTS` · `FUNDS_PARTIAL` · `FUNDS_RECEIVED` · `PURCHASED` · `PURCHASE_VERIFIED` ·
`STOCKED` · `CLOSED` · `CANCELLED`

### Borrow status — 6

`PENDING` · `REJECTED` · `ISSUED` · `PARTIALLY_RETURNED` · `RETURNED` · `CANCELLED`

### Approval — stage × action

Stage: `INVENTORY_MANAGER` · `APPROVER`
Action: `PENDING` · `APPROVED` · `REJECTED` · `WITHDRAWN`

### Stock movement — 6

`RECEIPT` · `MOVE` · `ISSUE` · `RETURN` · `ADJUST` · `DISPOSE`

### Return condition — 4

`GOOD` · `PARTIALLY_DAMAGED_USABLE` · `DAMAGED` · `NOT_WORKING`

### Urgency — 4

`LOW` · `NORMAL` · `HIGH` · `CRITICAL`

### The 54 error codes

| Group | Codes |
|---|---|
| Generic | `VALIDATION_FAILED` `NOT_FOUND` `CONFLICT` `FORBIDDEN` `INTERNAL` `PAYLOAD_TOO_LARGE` `RATE_LIMITED` |
| Auth | `UNAUTHENTICATED` `INVALID_CREDENTIALS` `TOKEN_EXPIRED` `TOKEN_REUSE_DETECTED` `SESSION_REVOKED` `ACCOUNT_DEACTIVATED` |
| Settings | `UNKNOWN_SETTING` |
| Stock | `INSUFFICIENT_STOCK` `STOCK_VERSION_CONFLICT` `STOCK_RESERVED` `CATEGORY_NOT_TRACKABLE` |
| Borrowing | `BORROW_INVALID_TRANSITION` `BORROW_ALREADY_DECIDED` |
| Projects | `DUPLICATE_PROJECT_NAME` |
| Requisition | `REQUISITION_INVALID_TRANSITION` `REQUISITION_INCOMPLETE` `APPROVAL_DEADLINE_IN_PAST` `CANNOT_SEND_BACK_FOR_REVISION` |
| Approval | `APPROVAL_ALREADY_ACTED` `NOT_YOUR_APPROVAL` `APPROVER_SLOT_UNASSIGNED` `SUBTHRESHOLD_APPROVER_UNASSIGNED` `SELF_APPROVAL_NO_SUBSTITUTE` `SELF_APPROVAL_FORBIDDEN` `APPROVED_EXCEEDS_REQUESTED` `DELEGATION_ALREADY_LIVE` `SIGNATURE_NOT_UPLOADED` |
| BOM | `BOM_REQUISITION_NOT_APPROVED` `BOM_ALREADY_ON_LIVE_BOM` `BOM_ALREADY_VOID` `BOM_OVER_BUDGET` `BOM_EXCEEDS_APPROVED_AMOUNT` `BOM_SPANS_MULTIPLE_REQUESTERS` `BOM_QUANTITY_EXCEEDS_SOURCE` `ALL_BOM_LINES_REMOVED` |
| PDF | `PDF_RENDER_FAILED` `PDF_DOWNLOAD_TOKEN_INVALID` |
| Money | `PURCHASE_EXCEEDS_FUNDED` `FUNDING_EXCEEDS_APPROVED` `RETURN_EXCEEDS_UNSPENT` `RECEIVE_EXCEEDS_PURCHASED` `INVOICE_MISSING` `MONEY_ROW_NOT_FOUND` |
| Money reversals | `CANNOT_UNVERIFY_WITH_RETURNS` `CANNOT_UNDO_SEND_WITH_RECEIPTS` `CANNOT_VOID_RECEIPT_WITH_PURCHASES` `CANNOT_VOID_RECEIVED_PURCHASE` |

**Every one of these 54 is a flow.** A code that can never be produced is either dead or a gap;
a code the SPA has no copy for renders as a blank or a fallback.

### Validation bounds worth testing at the edge

| Field | Rule |
|---|---|
| `itemName` | trim, 1–200 |
| `items[]` | 1–200 lines |
| `estimatedUnitPrice`, `unitCost`, `approvedAmount`, `transportationCost` | ≥ 0, ≤ 1,000,000,000 |
| `quantity` (requisition/borrow) | int, > 0, ≤ 1,000,000 |
| `quantity` (receive/stock) | int, > 0, ≤ 100,000 |
| `bom lines[]` | 1–500 · `purchase lines[]` 1–500 · `receive lines[]` 1–200 |
| `vendor` | trim, 1–200 (purchase) / ≤ 200 nullable (BOM) |
| `invoiceNo` | ≤ 120 |
| `note` | ≤ 500 / ≤ 1000 / ≤ 2000 depending on surface; rejection note min 3 |
| `description` | ≤ 2000 |
| `name`, `productCode` | 1–200 / 1–64 |
| `unit` | 1–24 or 1–32 |
| `password` | 4–128 |
| `page` | 1–10,000 · `limit` 1–100 (default 25) |
| `search` | ≤ 160 |
| `delta` (adjust) | int, non-zero |
| uploads | `UPLOAD_MAX_IMAGE_BYTES`, `UPLOAD_MAX_DOCUMENT_BYTES` (config) |

---

## Part 1 — Authentication and session · TC-001–TC-034

Applies to everyone, signed in or not.

| ID | Flow | Expect |
|---|---|---|
| TC-001 | Sign in with a correct email and password | Session created, land on dashboard |
| TC-002 | Sign in with a wrong password | `INVALID_CREDENTIALS` |
| TC-003 | Sign in with an email that does not exist | `INVALID_CREDENTIALS` — **identical** message, no user enumeration |
| TC-004 | Sign in to a deactivated account with correct password | `ACCOUNT_DEACTIVATED`, not a generic failure |
| TC-005 | Sign in with an empty email | `VALIDATION_FAILED` |
| TC-006 | Sign in with a malformed email (`not-an-email`) | `VALIDATION_FAILED` |
| TC-007 | Sign in with a 3-character password | `VALIDATION_FAILED` (min 4) |
| TC-008 | Sign in with a 129-character password | `VALIDATION_FAILED` (max 128) |
| TC-009 | Five failed attempts inside the window | `RATE_LIMITED` on the sixth |
| TC-010 | Wait out the window, try again with the right password | Succeeds — the lock expires by itself |
| TC-011 | While one email is locked, sign in as a different user | Succeeds — the lock is per-account, not global |
| TC-012 | Correct password *during* a lockout | Still `RATE_LIMITED` — the lock is not bypassed by being right |
| TC-013 | Demo mode on: open the login page | The five demo accounts are listed with a shared password |
| TC-014 | Demo mode off: open the login page | No account list, no shared password |
| TC-015 | Demo mode off, call `GET /auth/demo-accounts` directly | Refused or empty — the switch is server-side, not just hidden in the UI |
| TC-016 | An admin changes a demo account's password | That account no longer accepts the demo password |
| TC-017 | Refresh with a valid refresh token | New access token issued |
| TC-018 | Refresh with an expired token | `TOKEN_EXPIRED` |
| TC-019 | Refresh with a token already spent once | `TOKEN_REUSE_DETECTED` — and the whole session chain is revoked |
| TC-020 | Continue using the old access token after TC-019 | `SESSION_REVOKED` |
| TC-021 | Refresh after an explicit logout | `SESSION_REVOKED` |
| TC-022 | Access token expires mid-session while clicking around | Refreshed transparently; no visible interruption |
| TC-023 | `GET /auth/me` with no Authorization header | `UNAUTHENTICATED` |
| TC-024 | `GET /auth/me` with a malformed/garbage token | `UNAUTHENTICATED`, not `INTERNAL` |
| TC-025 | `GET /auth/me` with a token signed by the wrong key | `UNAUTHENTICATED` |
| TC-026 | Log out | Access and refresh both dead |
| TC-027 | Signed in on two browsers, log out of one | The other still works |
| TC-028 | Admin revokes a session while that user is active | Their next request fails; they are returned to login |
| TC-029 | Admin revokes **all** sessions for a user | Every device of theirs is signed out |
| TC-030 | Change password with the correct current password | Succeeds |
| TC-031 | Change password with the wrong current password | `INVALID_CREDENTIALS` |
| TC-032 | Change password to a 3-character one | `VALIDATION_FAILED` |
| TC-033 | Change password, then check other sessions | Other sessions revoked (verify the intent — if not, that is a finding) |
| TC-034 | An account flagged must-change-password signs in | Redirected to `/account/password` and held there until changed |

---

## Part 2 — GENERAL user · TC-035–TC-140

Everything a plain requester can do. They have five screens: Dashboard, Inventory (read-only),
My borrowings, My requisitions, Projects.

### 2.1 Raising a requisition — the form · TC-035–TC-078

| ID | Flow | Expect |
|---|---|---|
| TC-035 | Open New requisition | Empty form, one blank item line, Save draft and Submit both present |
| TC-036 | Submit completely empty | Blocked; Department, Approval deadline, Reason and the item fields all flagged red |
| TC-037 | Fill everything, submit | Accepted |
| TC-038 | Fill everything **except** department | Blocked, department flagged |
| TC-039 | Leave department as "No department" | Blocked — it is marked required |
| TC-040 | Omit the approval deadline | Blocked |
| TC-041 | Set an approval deadline **in the past** | `APPROVAL_DEADLINE_IN_PAST` |
| TC-042 | Set the deadline to today | Accepted (boundary — "today or later") |
| TC-043 | Set the deadline years out | Accepted, or a stated ceiling |
| TC-044 | Omit the reason | Blocked |
| TC-045 | Reason at exactly 280 characters | Accepted; counter reads 280/280 |
| TC-046 | Reason at 281 characters | Blocked or truncated at input |
| TC-047 | Reason of only spaces | Blocked — the field trims |
| TC-048 | Zero item lines (remove the only one) | Remove is disabled on the last line; API refuses with "Add at least one item" |
| TC-049 | 200 item lines | Accepted (max) |
| TC-050 | 201 item lines | `VALIDATION_FAILED` |
| TC-051 | Item with an empty name | Blocked |
| TC-052 | Item name of 200 characters | Accepted |
| TC-053 | Item name of 201 characters | `VALIDATION_FAILED` |
| TC-054 | Quantity 0 | Blocked — must be positive |
| TC-055 | Quantity −1 | Blocked |
| TC-056 | Quantity 1.5 | Blocked — integer only |
| TC-057 | Quantity 1,000,000 | Accepted (max) |
| TC-058 | Quantity 1,000,001 | `VALIDATION_FAILED` |
| TC-059 | Unit price 0 | Accepted — free items are legal (`nonnegative`) |
| TC-060 | Unit price −100 | Blocked |
| TC-061 | Unit price 1,000,000,000 | Accepted (max) |
| TC-062 | Unit price 1,000,000,001 | `VALIDATION_FAILED` |
| TC-063 | Unit price with three decimals (12.345) | Rounded or refused — decide which, then hold it |
| TC-064 | Unit price typed with a comma (`12,000`) | Handled or refused cleanly, never parsed as 12 |
| TC-065 | Line total recomputes as quantity or price changes | Live, correct |
| TC-066 | Total = Σ line totals | Live, correct |
| TC-067 | Turn transportation on, leave the amount blank | Treated as 0 or blocked — be consistent |
| TC-068 | Transportation −500 | Blocked |
| TC-069 | Transportation makes the total cross the threshold | The approver hint flips from 1 to 2 approvers live |
| TC-070 | Total exactly at the threshold (15,000) | **2** approvers — "at or above" |
| TC-071 | Total one paisa below the threshold | 1 approver |
| TC-072 | Pick a project | Saved and shown on the detail page |
| TC-073 | Leave project as "Personal development" | Accepted — project is optional |
| TC-074 | Create a project from inside the requisition flow | Available immediately in the dropdown |
| TC-075 | Each urgency: Low / Normal / High / Critical | All accepted and displayed |
| TC-076 | Item search: type nothing | No list shown |
| TC-077 | Item search: type a fragment | Narrows as characters are added; matches name **and** product code |
| TC-078 | Item search: type something not in the catalogue | Offered as a new free-text item |

### 2.2 Draft lifecycle · TC-079–TC-092

| ID | Flow | Expect |
|---|---|---|
| TC-079 | Save draft | Appears in My requisitions as Draft |
| TC-080 | Reopen a draft | All values repopulated |
| TC-081 | Edit a draft and save | Changes persist |
| TC-082 | Edit a draft: add a line | Persists |
| TC-083 | Edit a draft: remove a line | Persists |
| TC-084 | Edit a draft down to zero lines | Refused |
| TC-085 | Submit from the edit screen | Goes straight to review |
| TC-086 | Cancel a draft | → `CANCELLED` |
| TC-087 | Edit a **submitted** requisition | Refused — `REQUISITION_INVALID_TRANSITION`; amounts are fixed at submit |
| TC-088 | Edit someone else's draft | `FORBIDDEN` / `NOT_FOUND` |
| TC-089 | Submit a draft twice (double-click) | One submission; the second is refused, not duplicated |
| TC-090 | Submit with no approver slots assigned | `APPROVER_SLOT_UNASSIGNED`, naming which slot |
| TC-091 | Submit sub-threshold with no sub-threshold approver set | `SUBTHRESHOLD_APPROVER_UNASSIGNED` |
| TC-092 | Submit when no active Inventory Manager exists | Chain skips IM, or a clear refusal — not a 500 |

### 2.3 After submitting · TC-093–TC-112

| ID | Flow | Expect |
|---|---|---|
| TC-093 | View own submitted requisition | Raised by / Department / Project / Submitted on / Needed by / Reason all visible |
| TC-094 | Approved amount before any approval | No figure shown |
| TC-095 | Approved amount after an approver revises it | Shows the revised figure, and says it was revised down |
| TC-096 | Progress rail before any decision | IM waiting, approvers not reached |
| TC-097 | Progress rail after the IM approves | Both approvers waiting **in parallel** |
| TC-098 | Cancel own requisition while in IM review | → `CANCELLED` |
| TC-099 | Cancel own requisition after full approval | Refused, or allowed with a documented rule — pick one |
| TC-100 | Cancel someone else's requisition | `FORBIDDEN` |
| TC-101 | Cancel an already-cancelled requisition | `REQUISITION_INVALID_TRANSITION` |
| TC-102 | Requisition number format | `REQ-{6-digit serial}-{FIRSTNAME}` |
| TC-103 | Requester with a one-word name | Token still produced |
| TC-104 | Requester with a non-Latin name (Bengali) | Falls back to the email local part; never empty, never mangled |
| TC-105 | Two requisitions by the same person | Serial increments; name token identical |
| TC-106 | Serial uniqueness under two simultaneous submits | No duplicate numbers |
| TC-107 | My requisitions list: filter by status | Correct subsets |
| TC-108 | My requisitions list: search | Matches reference, reason, project |
| TC-109 | My requisitions: pagination past the end | Empty page, no error |
| TC-110 | See the rejection reason after rejection | "See why" reveals the note |
| TC-111 | See an approver's note | Visible to the requester |
| TC-112 | Notification when the requisition is decided | Bell increments; entry links to the requisition |

### 2.4 Supporting document · TC-113–TC-126

Wholly untested today, and it touches storage and MIME handling.

| ID | Flow | Expect |
|---|---|---|
| TC-113 | Attach a PDF to a draft | Stored, shown on the detail page |
| TC-114 | Attach a JPG/PNG | Stored |
| TC-115 | Attach a file over `UPLOAD_MAX_DOCUMENT_BYTES` | `PAYLOAD_TOO_LARGE` |
| TC-116 | Attach at exactly the limit | Accepted |
| TC-117 | Attach a disallowed type (`.exe`, `.zip`) | Refused by type, not by extension alone |
| TC-118 | Attach a file renamed to `.pdf` but not a PDF | Refused on content sniffing, or an explicit accepted risk |
| TC-119 | Attach a 0-byte file | Refused |
| TC-120 | Replace an attached document | Old one gone or superseded; no orphan |
| TC-121 | Remove an attached document | Removed and audited |
| TC-122 | Attach to a **submitted** requisition | Allowed or refused — a stated rule either way |
| TC-123 | Download the document as the requester | Works |
| TC-124 | Download it as an approver on that chain | Works |
| TC-125 | Download it as an unrelated general user | `FORBIDDEN` |
| TC-126 | Guess another requisition's document id | `FORBIDDEN` / `NOT_FOUND` — never served |

### 2.5 Borrowing as a general user · TC-127–TC-140

| ID | Flow | Expect |
|---|---|---|
| TC-127 | Borrow from a product page | Request created, status Pending |
| TC-128 | On request, stock is **reserved** not issued | Available drops, on-hand unchanged, reserved rises |
| TC-129 | Borrow more than available | `INSUFFICIENT_STOCK` |
| TC-130 | Borrow exactly the available quantity | Accepted |
| TC-131 | Borrow quantity 0 or negative | Blocked |
| TC-132 | Borrow without an expected-back date, "I will return this" ticked | Refused: an expected return date is required |
| TC-133 | Borrow with an expected-back date in the past | Refused, or flagged overdue immediately — decide |
| TC-134 | Untick "I will return this" (a consumable) | No return date required; quantity leaves permanently |
| TC-135 | Borrow from a specific compartment | Reserved against that compartment only |
| TC-136 | Borrow a product with a not-trackable category | `CATEGORY_NOT_TRACKABLE` |
| TC-137 | Cancel own pending borrow | → `CANCELLED`, reservation released |
| TC-138 | Cancel own borrow after it is issued | Refused — return it instead |
| TC-139 | My borrowings filters: All / Pending / Out / Returned / Overdue | Correct subsets |
| TC-140 | Borrow attached to a project | Shows under that project's items |
---

## Part 3 — APPROVER · TC-141–TC-205

### 3.1 Deciding · TC-141–TC-172

| ID | Flow | Expect |
|---|---|---|
| TC-141 | Approvals queue shows what is waiting on me | Only requisitions where my approval is `PENDING` and reachable |
| TC-142 | Queue tabs: Waiting on me / All / Approved / Rejected | Correct subsets |
| TC-143 | Approve without a signature | Recorded; my node turns green |
| TC-144 | Approve **with** a signature, having uploaded one | Signature image stored on the approval and printed on the BOM |
| TC-145 | Approve with signature having uploaded none | Button disabled; API returns `SIGNATURE_NOT_UPLOADED` if called directly |
| TC-146 | Approve with a note | Note visible to the requester and the next approver |
| TC-147 | Note of 500 characters | Accepted |
| TC-148 | Note of 501 characters | `VALIDATION_FAILED` |
| TC-149 | Reject with a note | → `REJECTED`; the whole chain dies; other approvers marked Skipped |
| TC-150 | Reject with a 2-character note | `VALIDATION_FAILED` — rejection notes require 3+ |
| TC-151 | Reject with no note | Refused — a rejection must say why |
| TC-152 | Approve the same requisition twice | `APPROVAL_ALREADY_ACTED` |
| TC-153 | Approve an approval row that is not mine | `NOT_YOUR_APPROVAL` |
| TC-154 | Approve when an earlier stage has not acted | Refused — the IM comes first |
| TC-155 | Both approvers approve simultaneously | Both land, or one is cleanly refused; never a half-written chain |
| TC-156 | Approve a requisition already rejected by the other approver | `REQUISITION_INVALID_TRANSITION` |
| TC-157 | Approve a cancelled requisition | Refused |
| TC-158 | Last approver approves | → `APPROVED` |
| TC-159 | Only one approver required (sub-threshold), they approve | → `APPROVED` immediately |
| TC-160 | Revise the approved amount **down** | Recorded; that figure becomes the ceiling |
| TC-161 | Revise **up**, above the requested amount | `APPROVED_EXCEEDS_REQUESTED` |
| TC-162 | Revise to exactly the requested amount | Accepted |
| TC-163 | Revise to 0 | Accepted or refused — a stated rule; if accepted, no BOM can ever fit |
| TC-164 | Revise to a negative number | Blocked |
| TC-165 | Revise, then cancel the revision before submitting | Field clears; full amount approved |
| TC-166 | Leave the revise field blank | Full requested amount approved |
| TC-167 | Two approvers both revise | The **lower** figure governs (confirm the intended rule) |
| TC-168 | Revise above 1,000,000,000 | `VALIDATION_FAILED` |
| TC-169 | The revise control is absent for the IM stage | Only approvers revise |
| TC-170 | Approving after the approval deadline has passed | Still allowed; the deadline only drives reminders |
| TC-171 | An approver who is deactivated mid-chain | Their pending approval is handled — reassigned or clearly blocked, not silently stuck |
| TC-172 | Approver count frozen at submit | Changing the setting afterwards does not alter a live chain |

### 3.2 Withdrawing a decision · TC-173–TC-182

| ID | Flow | Expect |
|---|---|---|
| TC-173 | Withdraw my own approval | Chain returns to waiting on me |
| TC-174 | Withdraw my own **rejection** | Requisition leaves `REJECTED`; the skipped approvers become reachable again |
| TC-175 | Withdraw without giving a reason | Refused, or accepted — a stated rule |
| TC-176 | Withdraw someone else's decision | `NOT_YOUR_APPROVAL` |
| TC-177 | Withdraw after the requisition is fully `APPROVED` | Refused, or it un-approves — decide and hold it |
| TC-178 | Withdraw after a BOM exists | Must be refused: the BOM froze this chain |
| TC-179 | Withdraw after money has moved | Must be refused |
| TC-180 | Withdraw, then approve again | Allowed; both events in the history |
| TC-181 | Withdraw twice | Second refused |
| TC-182 | The withdrawal reason is recorded and shown | In the rail and the audit log |

### 3.3 Self-approval · TC-183–TC-192

| ID | Flow | Expect |
|---|---|---|
| TC-183 | An approver raises a requisition above the threshold | Their own slot is dropped; the other approver still required; count drops by one |
| TC-184 | An approver raises one below the threshold, and is the sub-threshold approver | No approver stage remains; IM only — verify the resulting status is sane |
| TC-185 | The **only** approver raises a requisition | 0 approvers required (migration 0030 permits it) — reaches `APPROVED` after the IM |
| TC-186 | That approver tries to approve their own anyway, via the API | `SELF_APPROVAL_FORBIDDEN` |
| TC-187 | An approver holding both slots | Both dropped; not double-counted |
| TC-188 | The IM raises their own requisition | No IM stage created at all; approvers unchanged |
| TC-189 | An IM who is also an approver raises one | Both their stages dropped |
| TC-190 | An admin raises a requisition | Normal chain — admin is not special here |
| TC-191 | The Lifecycle strip on a requisition with no IM stage | Should not show a stage that can never happen (**known: F-15**) |
| TC-192 | The frozen approver count is stored, not recomputed | Reopening later shows the same count |

### 3.4 Delegation · TC-193–TC-200

An endpoint set that has never been exercised: `GET/POST/DELETE /requisitions/delegations`.

| ID | Flow | Expect |
|---|---|---|
| TC-193 | Create a delegation to another approver | The delegate can act on my behalf |
| TC-194 | Create a second, overlapping delegation | `DELEGATION_ALREADY_LIVE` |
| TC-195 | Delegate to myself | Refused |
| TC-196 | Delegate to a non-approver | Refused |
| TC-197 | The delegate approves | Recorded with **on behalf of** naming the real approver |
| TC-198 | Revoke a delegation | The delegate can no longer act |
| TC-199 | Revoke a delegation already used | Past decisions stand |
| TC-200 | On-behalf-of shows the delegator, not a self-reference | **Known defect F-5** — self-reference prints today |

### 3.5 Send back for revision · TC-201–TC-205

| ID | Flow | Expect |
|---|---|---|
| TC-201 | Send an approved requisition back for revision | Returns to the requester, editable again |
| TC-202 | Send back one that is not in a sendable state | `CANNOT_SEND_BACK_FOR_REVISION` |
| TC-203 | Send back after a BOM exists | Refused |
| TC-204 | Send back without a reason | Refused |
| TC-205 | Requester edits and resubmits | A fresh chain, or the old one resumed — a stated rule |

---

## Part 4 — INVENTORY MANAGER · TC-206–TC-380

The biggest surface: review, BOMs, the whole money chain, stock and borrowing.

### 4.1 IM review · TC-206–TC-216

| ID | Flow | Expect |
|---|---|---|
| TC-206 | Approve at IM review | → `AWAITING_APPROVAL`; both approvers become reachable |
| TC-207 | Reject at IM review | → `REJECTED`; approvers never asked |
| TC-208 | Withdraw an IM approval | Back to `IM_REVIEW` |
| TC-209 | Withdraw an IM rejection | Back to `IM_REVIEW`, approvers reachable |
| TC-210 | The line items show current stock per item | "n already in stock" — the IM's whole reason for reviewing |
| TC-211 | An item already fully in stock | Shown clearly so the IM can reject or trim |
| TC-212 | Approve with a signature | Printed on the BOM |
| TC-213 | IM review on a sub-threshold requisition | Still required |
| TC-214 | Two IMs exist; either can act | Whoever gets there first |
| TC-215 | No active IM at submit time | Stage skipped or a clear refusal |
| TC-216 | The IM is the requester | No IM stage (see TC-188) |

### 4.2 Generating a BOM · TC-217–TC-258

| ID | Flow | Expect |
|---|---|---|
| TC-217 | Candidates list | Only `APPROVED` requisitions not already on a live BOM |
| TC-218 | Follow the link from an approved requisition | Builder opens with it pre-ticked, lines loaded |
| TC-219 | Follow a link for a requisition that is no longer a candidate | Opens with nothing ticked — no crash |
| TC-220 | Follow a link with a malformed id | Same — empty picker |
| TC-221 | Tick a requisition manually | Its lines load |
| TC-222 | Untick a pre-ticked requisition | It actually unticks and stays unticked |
| TC-223 | Generate with nothing ticked | Refused |
| TC-224 | Generate a BOM equal to the approved amount | Accepted (boundary) |
| TC-225 | Generate one paisa over | `BOM_EXCEEDS_APPROVED_AMOUNT`; Generate disabled |
| TC-226 | Generate one paisa under | Accepted |
| TC-227 | Transportation counts towards the ceiling | items + transport ≤ approved |
| TC-228 | Reduce a unit cost until it fits | Generate enables live |
| TC-229 | Reduce a quantity until it fits | Same |
| TC-230 | Raise a BOM quantity above the requisition's | `BOM_QUANTITY_EXCEEDS_SOURCE` |
| TC-231 | Set a BOM quantity to 0 | Line dropped, or refused |
| TC-232 | Drop every line from the BOM | `ALL_BOM_LINES_REMOVED` |
| TC-233 | Drop some lines | BOM totals recompute |
| TC-234 | Unit cost 0 on a BOM line | Accepted (free item) |
| TC-235 | Unit cost negative | Blocked |
| TC-236 | Vendor blank | Allowed on the BOM (nullable) — confirm intent |
| TC-237 | Vendor over 200 characters | `VALIDATION_FAILED` |
| TC-238 | Batch two requisitions from the **same** requester | Accepted |
| TC-239 | Batch two from **different** requesters | `BOM_SPANS_MULTIPLE_REQUESTERS` |
| TC-240 | Batch: each requisition's ceiling checked separately | One over-budget requisition blocks the whole BOM, and says which |
| TC-241 | Generate for a requisition already on a live BOM | `BOM_ALREADY_ON_LIVE_BOM` |
| TC-242 | Generate for a requisition that is not `APPROVED` | `BOM_REQUISITION_NOT_APPROVED` |
| TC-243 | Two IMs generate for the same requisition at once | One wins, the other gets `BOM_ALREADY_ON_LIVE_BOM` |
| TC-244 | BOM number format | `BOM-{serial}-{REQUESTER FIRST NAME}` |
| TC-245 | On success the requisition moves to `BOM_GENERATED` | Yes |
| TC-246 | The approval chain is frozen onto the BOM | Later withdrawals do not alter it |
| TC-247 | The BOM shows only approved money | No requested figure anywhere |
| TC-248 | 1 line | Renders |
| TC-249 | 5 lines | One page |
| TC-250 | 6 lines | Two pages, headings repeat, no row split |
| TC-251 | 50 lines | Pages correctly throughout |
| TC-252 | 500 lines | Max accepted |
| TC-253 | 501 lines | `VALIDATION_FAILED` |
| TC-254 | A very long item name | Wraps, does not overflow the column |
| TC-255 | Amount in words for 0 | Sensible, not blank |
| TC-256 | Amount in words with paisa | "…and Fifty Poisha Only" |
| TC-257 | Amount in words in lakh/crore range | Correct Bengali-English convention |
| TC-258 | Amount in words above the supported ceiling | Blank or a stated fallback, never wrong |

### 4.3 BOM PDF and voiding · TC-259–TC-276

| ID | Flow | Expect |
|---|---|---|
| TC-259 | Render the PDF | "PDF on file"; Download appears |
| TC-260 | Re-render | Replaces cleanly; same BOM number |
| TC-261 | Download through the app's own button | File arrives with the right name |
| TC-262 | Download URL after it expires | `PDF_DOWNLOAD_TOKEN_INVALID` |
| TC-263 | Download URL tampered with | `PDF_DOWNLOAD_TOKEN_INVALID` |
| TC-264 | Download someone else's BOM PDF as a general user | `FORBIDDEN` |
| TC-265 | Render when Chromium is unavailable | `PDF_RENDER_FAILED`, not a hang |
| TC-266 | Render times out (`PDF_RENDER_TIMEOUT_MS`) | `PDF_RENDER_FAILED` |
| TC-267 | Logo file missing | Renders without it; no broken image |
| TC-268 | Signature images present | Printed in the signature cells |
| TC-269 | Signatures absent | Cells still align; "Approved" still legible |
| TC-270 | On-behalf-of when nobody delegated | Should be blank (**known defect F-5**) |
| TC-271 | Void a BOM | Marked void; requisition returns to `APPROVED` |
| TC-272 | Void without a reason | Refused |
| TC-273 | Void an already-void BOM | `BOM_ALREADY_VOID` |
| TC-274 | Generate a new BOM after voiding | Allowed |
| TC-275 | Void a BOM after money has moved | Refused, or a documented cascade |
| TC-276 | The void banner appears on the PDF | Voided documents are visibly void |

### 4.4 Money — the forward chain · TC-277–TC-312

| ID | Flow | Expect |
|---|---|---|
| TC-277 | Send to Accounts | → `SENT_TO_ACCOUNTS` |
| TC-278 | Send to Accounts before a BOM exists | Refused |
| TC-279 | Send to Accounts twice | Refused |
| TC-280 | Record funds equal to approved | → `FUNDS_RECEIVED` |
| TC-281 | Record funds **less** than approved | → `FUNDS_PARTIAL` |
| TC-282 | Top up a partial funding to the full amount | → `FUNDS_RECEIVED` |
| TC-283 | Record funds **more** than approved | `FUNDING_EXCEEDS_APPROVED` |
| TC-284 | Record funds of 0 | Refused |
| TC-285 | Record negative funds | Blocked |
| TC-286 | Two receipts summing over approved | Second refused |
| TC-287 | Receipt with a reference | Stored and displayed |
| TC-288 | Receipt with a future date | Allowed or refused — a stated rule |
| TC-289 | Record a purchase equal to funded | Accepted; Left to spend 0 |
| TC-290 | Record a purchase over funded | `PURCHASE_EXCEEDS_FUNDED`; UI shows Left to spend negative and blocks |
| TC-291 | Purchase under funded | Accepted; unspent balance remains |
| TC-292 | Purchase transportation counts against funding | Yes — items + carriage |
| TC-293 | Raise transportation until it overruns | Blocked the same way |
| TC-294 | Two purchases, together over funded | Second refused |
| TC-295 | Two purchases, together within funded | Both accepted |
| TC-296 | Purchase quantity above the BOM's planned quantity | Refused or flagged — a stated rule |
| TC-297 | Purchase with no vendor | Blocked (vendor min 1) |
| TC-298 | Purchase with an invoice number | Stored |
| TC-299 | Attach an invoice file to a purchase | Stored, downloadable |
| TC-300 | Attach an oversized invoice | `PAYLOAD_TOO_LARGE` |
| TC-301 | Verify a purchase with no invoice attached | Allowed (`INVOICE_MISSING` gate was deliberately removed) |
| TC-302 | Verify a purchase | → `PURCHASE_VERIFIED` |
| TC-303 | Verify with money going back to Accounts | Return recorded; unspent reduces |
| TC-304 | Return more than unspent | `RETURN_EXCEEDS_UNSPENT` |
| TC-305 | Return exactly unspent | Accepted; unspent 0 |
| TC-306 | Return 0 | Accepted — nothing goes back |
| TC-307 | Return without a reason | Refused if an amount is returned |
| TC-308 | Receive to stock | → `STOCKED`; stock rises by exactly the received quantity |
| TC-309 | Receive more than purchased | `RECEIVE_EXCEEDS_PURCHASED` |
| TC-310 | Receive less than purchased (partial) | Remainder still outstanding; status reflects it |
| TC-311 | Receive with no compartment chosen | Blocked |
| TC-312 | Receive a free-text item never in the catalogue | Creates or maps to a product — never silently dropped |

### 4.5 Money — every reversal · TC-313–TC-332

Wholly untested today. Each "Back" button is its own flow.

| ID | Flow | Expect |
|---|---|---|
| TC-313 | Undo Send to Accounts | → back to `BOM_GENERATED` |
| TC-314 | Undo Send to Accounts after a receipt exists | `CANNOT_UNDO_SEND_WITH_RECEIPTS` |
| TC-315 | Void a fund receipt | Funded drops by that amount |
| TC-316 | Void a receipt when a purchase exists | `CANNOT_VOID_RECEIPT_WITH_PURCHASES` |
| TC-317 | Void one of two receipts | Only that one reverses |
| TC-318 | **Void a purchase** | Spent drops by its total |
| TC-319 | **Void a purchase — does the carriage follow?** | Per OQ-32: yes, the carriage leaves with its purchase. **Decided and implemented this session, never run through the UI** |
| TC-320 | Void a purchase whose goods were received | `CANNOT_VOID_RECEIVED_PURCHASE` |
| TC-321 | Void the only purchase, then record a new one | Allowed |
| TC-322 | Void one of two purchases | Only that one's total and carriage leave |
| TC-323 | Funding panel after a void | Approved / Funded / Spent / Transportation / Unspent all still reconcile |
| TC-324 | Dashboard after a void | Agrees with the funding panel |
| TC-325 | Expenses report after a void | Agrees with both — no third answer |
| TC-326 | Unverify a purchase | → back to `PURCHASED` |
| TC-327 | Unverify when money was returned | `CANNOT_UNVERIFY_WITH_RETURNS` |
| TC-328 | Unverify after stock was received | Refused, or a documented stock reversal |
| TC-329 | A voided purchase stays visible in history | Append-only; never deleted |
| TC-330 | Reversals are audited with actor and reason | Yes |
| TC-331 | Reverse right back to `BOM_GENERATED` step by step | Each step legal in reverse order |
| TC-332 | Reverse out of order | Each refusal names its own code |

### 4.6 Borrowing as the IM · TC-333–TC-356

| ID | Flow | Expect |
|---|---|---|
| TC-333 | Pending queue and badge count | Matches reality |
| TC-334 | Approve a borrow | → `ISSUED`; reservation becomes an issue |
| TC-335 | Reject a borrow | → `REJECTED`; reservation released |
| TC-336 | Decide an already-decided borrow | `BORROW_ALREADY_DECIDED` |
| TC-337 | Approve when stock has since gone | `INSUFFICIENT_STOCK` |
| TC-338 | Full return in `GOOD` condition | → `RETURNED`; stock back to available |
| TC-339 | Partial return | → `PARTIALLY_RETURNED`; remainder still out |
| TC-340 | Several partial returns totalling the whole | → `RETURNED` |
| TC-341 | Return more than is out | Refused |
| TC-342 | Return 0 | Refused |
| TC-343 | Return `PARTIALLY_DAMAGED_USABLE` | Back to stock, flagged; dashboard damage counter rises |
| TC-344 | Return `DAMAGED` | Quarantined, not available |
| TC-345 | Return `NOT_WORKING` | Quarantined |
| TC-346 | Return to a **different** compartment | Allowed; ledger records the destination |
| TC-347 | Reverse a return | Quantity goes back out; ledger shows both |
| TC-348 | Reverse a return twice | Refused |
| TC-349 | Revert a borrow decision | `BORROW_INVALID_TRANSITION` where illegal |
| TC-350 | Cancel a borrow as the IM | Allowed where the state permits |
| TC-351 | Overdue: expected-back passes with stock still out | Marked overdue; the Overdue filter finds it |
| TC-352 | Overdue reminder job | Fires once, not repeatedly |
| TC-353 | Return an overdue borrow | Overdue flag clears |
| TC-354 | Borrow-to-user directly from a requisition | Goods issued to the requester instead of shelved |
| TC-355 | Borrow-to-user exceeding what was purchased | Refused |
| TC-356 | Issue on behalf of another user | Recorded against that user, actor logged |

### 4.7 Stock operations · TC-357–TC-380

| ID | Flow | Expect |
|---|---|---|
| TC-357 | Receive stock directly (not via a requisition) | Ledger `RECEIPT`; placement created |
| TC-358 | Receive quantity 0 or negative | Blocked |
| TC-359 | Receive above 100,000 in one line | `VALIDATION_FAILED` |
| TC-360 | Receive 200 lines | Max accepted |
| TC-361 | Receive 201 lines | Refused |
| TC-362 | Move stock between compartments | Ledger `MOVE`; totals unchanged |
| TC-363 | Move more than is in the source | `INSUFFICIENT_STOCK` |
| TC-364 | Move reserved units | `STOCK_RESERVED` |
| TC-365 | Move to the same compartment | Refused or a no-op — decide |
| TC-366 | Adjust up | Ledger `ADJUST`, positive delta, reason required |
| TC-367 | Adjust down | Negative delta |
| TC-368 | Adjust by 0 | Refused — the delta must be non-zero |
| TC-369 | Adjust below zero on hand | Refused |
| TC-370 | Adjust without a reason | Refused |
| TC-371 | Dispose stock | Ledger `DISPOSE`; leaves on-hand permanently |
| TC-372 | Release from quarantine back to available | Ledger entry; available rises |
| TC-373 | Dispose from quarantine | Leaves for good |
| TC-374 | Resolve quarantine on something not quarantined | Refused |
| TC-375 | Two IMs adjust the same placement at once | `STOCK_VERSION_CONFLICT` — one wins |
| TC-376 | Stale `expectedVersion` on any stock write | `STOCK_VERSION_CONFLICT` |
| TC-377 | Every stock change writes exactly one ledger row | Append-only; no updates, no deletes |
| TC-378 | Ledger view filters by product, type, date | Correct |
| TC-379 | Stock write attempted outside `StockService` | Must not exist anywhere in the codebase |
| TC-380 | On-hand = Σ placements = ledger running total | Reconciles at all times (the nightly invariant job) |
---

## Part 5 — ADMIN · TC-381–TC-460

### 5.1 Users · TC-381–TC-404

| ID | Flow | Expect |
|---|---|---|
| TC-381 | Create a user with all fields | Created, appears in the list |
| TC-382 | Create with a duplicate email | `CONFLICT` |
| TC-383 | Create with a malformed email | `VALIDATION_FAILED` |
| TC-384 | Create with no roles | Refused, or defaults to `GENERAL` — a stated rule |
| TC-385 | Create with every role at once | Allowed |
| TC-386 | Create with a designation | It is what prints on the BOM signature block |
| TC-387 | Create without a designation | BOM still renders; no blank line |
| TC-388 | Create with no department | Allowed (the admin has none) |
| TC-389 | Create with a 201-character name | `VALIDATION_FAILED` |
| TC-390 | Edit a user's name / designation / department | Persists |
| TC-391 | Add the `APPROVER` role to someone | They become selectable for approver slots |
| TC-392 | Remove `APPROVER` from someone **currently in a slot** | Refused, or the slot is cleared — never a dangling slot |
| TC-393 | Remove `APPROVER` from someone with a pending approval | Their pending decision is resolved somehow, not orphaned |
| TC-394 | Remove `INVENTORY_MANAGER` from the only IM | Refused, or new requisitions skip IM — must not break submit |
| TC-395 | Remove `ADMIN` from the only admin | Must be refused — otherwise the system is unadministrable |
| TC-396 | Deactivate a user | They cannot sign in (`ACCOUNT_DEACTIVATED`) |
| TC-397 | Deactivate a user with a pending approval | The chain does not stall silently |
| TC-398 | Deactivate a user with stock out on loan | The loan is still tracked |
| TC-399 | Deactivate yourself | Refused |
| TC-400 | Reactivate a user | They can sign in again |
| TC-401 | Reset a user's password | They can sign in with the new one; old one dead |
| TC-402 | Reset forces a change at next login | If intended, verify it |
| TC-403 | "Show deactivated" toggle | Includes/excludes correctly |
| TC-404 | Search users | Matches name and email |

### 5.2 Departments · TC-405–TC-412

| ID | Flow | Expect |
|---|---|---|
| TC-405 | Create a department | Appears; selectable on requisitions |
| TC-406 | Create a duplicate name | `CONFLICT` |
| TC-407 | Rename a department | Reflected everywhere, including on old requisitions |
| TC-408 | Deactivate a department with members | Refused, or members detached — a stated rule |
| TC-409 | Deactivate an empty department | Allowed; no longer selectable |
| TC-410 | Member count is accurate | Matches active users |
| TC-411 | Per-department approver-slot override | Requisitions from that department use the override |
| TC-412 | Clear the override | Falls back to the company default |

### 5.3 Settings · TC-413–TC-432

Read but never changed in testing so far — so the central "takes effect immediately, without a
redeploy" claim is unverified.

| ID | Flow | Expect |
|---|---|---|
| TC-413 | Raise the expense threshold | New requisitions use it immediately; **live chains keep their frozen count** |
| TC-414 | Lower the threshold | Same |
| TC-415 | Threshold of 0 | Everything needs the higher approver count |
| TC-416 | Negative threshold | Refused |
| TC-417 | Non-integer threshold | `VALIDATION_FAILED` |
| TC-418 | Absurdly large threshold | Refused or accepted with a ceiling |
| TC-419 | Set approvers-at-or-above to 2 | Two slots required |
| TC-420 | Set it to 1 | One slot |
| TC-421 | Set it to 0 | Allowed since migration 0030 — a requisition can reach `APPROVED` on the IM alone |
| TC-422 | Set it to 3 | Refused — the CHECK caps it at 2 |
| TC-423 | Assign approver slot 1 | Saved; used by new requisitions |
| TC-424 | Assign the same person to both slots | Refused, or accepted and de-duplicated |
| TC-425 | Clear a slot, then submit a requisition | `APPROVER_SLOT_UNASSIGNED` |
| TC-426 | Assign a non-approver to a slot | Refused — only `APPROVER` role holders are offered |
| TC-427 | Set the sub-threshold approver | Used by sub-threshold requisitions |
| TC-428 | Clear it, then submit sub-threshold | `SUBTHRESHOLD_APPROVER_UNASSIGNED` |
| TC-429 | Change audit retention | The purge job honours it |
| TC-430 | Retention "Forever" | Nothing purged |
| TC-431 | Turn an audit action off | New occurrences stop being recorded; history stays |
| TC-432 | Write an unknown settings key via the API | `UNKNOWN_SETTING` |

### 5.4 Catalogue: products, categories, locations · TC-433–TC-452

| ID | Flow | Expect |
|---|---|---|
| TC-433 | Create a product | Appears in Inventory and in requisition search |
| TC-434 | Duplicate product code | `CONFLICT` |
| TC-435 | Product code over 64 characters | `VALIDATION_FAILED` |
| TC-436 | Unit over 24/32 characters | `VALIDATION_FAILED` |
| TC-437 | Edit a product's name | Reflected on new documents; historical BOMs unchanged |
| TC-438 | Archive a product with stock on hand | Refused, or archived-but-visible |
| TC-439 | Archive a product with an open borrow | Refused |
| TC-440 | Archive an unused product | Hidden from search; "Show archived" reveals it |
| TC-441 | Create a category | Selectable |
| TC-442 | Category marked not trackable | Products in it refuse stock operations (`CATEGORY_NOT_TRACKABLE`) |
| TC-443 | Move a product between categories | Allowed; stock unaffected |
| TC-444 | Deactivate a category with products | Refused, or products orphaned — a stated rule |
| TC-445 | Create a zone | Selectable as a parent for compartments |
| TC-446 | Create a compartment under a zone | Selectable when receiving/returning |
| TC-447 | Duplicate compartment name in one zone | `CONFLICT` |
| TC-448 | Deactivate a compartment holding stock | Refused |
| TC-449 | Deactivate an empty compartment | Allowed |
| TC-450 | Rename a zone | Reflected in the compartment labels ("Meta · 1A") |
| TC-451 | Deep zone nesting via `parentId` | Handled or capped |
| TC-452 | Locations list shows per-compartment availability | Matches placements |

### 5.5 Audit log and system health · TC-453–TC-460

| ID | Flow | Expect |
|---|---|---|
| TC-453 | Every state-changing action appears | Actor, action, entity, summary, outcome, IP |
| TC-454 | Filter by user | Correct |
| TC-455 | Filter by approvals only / rejections only | Correct |
| TC-456 | Filter by date range | Correct, in Asia/Dhaka |
| TC-457 | Open a single audit entry | Full detail |
| TC-458 | The audit log cannot be edited or deleted | Append-only; no UI or API for it |
| TC-459 | System health endpoint | Reports database, storage, migrations |
| TC-460 | Failed actions are audited too | Not only successes |

---

## Part 6 — Cross-cutting

### 6.1 The permission matrix · TC-461–TC-500

For **each** protected route, three cases: the allowed role succeeds; a disallowed signed-in role
gets `FORBIDDEN`; no token gets `UNAUTHENTICATED`. Test at the **API**, not only by hiding menus.

| ID | Route group | Allowed | Must be refused for |
|---|---|---|---|
| TC-461–464 | `admin/users` (4 endpoints) | ADMIN | GENERAL, APPROVER, IM |
| TC-465–468 | `admin/settings`, `approver-slots` | ADMIN | everyone else |
| TC-469–470 | `admin/audit-log` | ADMIN | everyone else |
| TC-471–472 | `admin/system-health` | ADMIN | everyone else |
| TC-473–474 | `departments` write | ADMIN | GENERAL, APPROVER, IM |
| TC-475–478 | `boms` create/list/read/void | IM, ADMIN | GENERAL, APPROVER |
| TC-479–480 | `boms/:id/render`, `pdf-url` | IM, ADMIN | GENERAL, APPROVER |
| TC-481–486 | all `funds` write endpoints | IM, ADMIN | GENERAL, APPROVER |
| TC-487–490 | `stock/receive|move|adjust|quarantine` | IM, ADMIN | GENERAL, APPROVER |
| TC-491–492 | `products`, `categories`, `locations` write | IM, ADMIN | GENERAL, APPROVER |
| TC-493–494 | `reports/expenses`, `reports/inventory` | APPROVER, IM, ADMIN | GENERAL |
| TC-495–496 | `requisitions` list-all, `awaiting-count` | IM, APPROVER, ADMIN | GENERAL |
| TC-497–498 | `requisitions/delegations` | APPROVER, ADMIN | GENERAL, IM |
| TC-499 | `me/signature` | APPROVER, IM, ADMIN | GENERAL |
| TC-500 | `borrowing` decisions/returns | STOCK_ROLES | GENERAL |

Plus, for every one of the above:

| ID | Flow | Expect |
|---|---|---|
| TC-501 | Read another user's requisition as an unrelated GENERAL user | `FORBIDDEN` / `NOT_FOUND` |
| TC-502 | Read another user's borrow record | Same |
| TC-503 | Guess a UUID for any detail endpoint | `NOT_FOUND`, never a leak |
| TC-504 | A malformed UUID in any `:id` | `VALIDATION_FAILED`, never `INTERNAL` |
| TC-505 | Hidden menu items are also blocked server-side | The SPA hiding a link is not the control |
| TC-506 | A denied page does not leak the real page title | **Known defect F-17** |
| TC-507 | Role change takes effect without re-login, or forces one | Whichever — it must be defined |

### 6.2 State machine — every illegal transition · TC-508–TC-540

The rule: from each of the 14 requisition statuses, attempt every action that is not legal there
and confirm `REQUISITION_INVALID_TRANSITION` (or the specific code) rather than a 500 or a
silent no-op.

| ID | From status | Illegal attempts to make |
|---|---|---|
| TC-508 | `DRAFT` | approve · reject · generate BOM · send to accounts · fund · purchase · receive |
| TC-509 | `IM_REVIEW` | edit · generate BOM · send to accounts · fund · approver-approve before the IM |
| TC-510 | `AWAITING_APPROVAL` | edit · generate BOM · send to accounts · IM-approve again |
| TC-511 | `APPROVED` | edit · approve again · send to accounts before a BOM · fund |
| TC-512 | `REJECTED` | approve · generate BOM · send to accounts · submit |
| TC-513 | `BOM_GENERATED` | edit · approve · generate a second BOM · fund before sending |
| TC-514 | `SENT_TO_ACCOUNTS` | generate BOM · approve · purchase before funding |
| TC-515 | `FUNDS_PARTIAL` | verify · receive to stock |
| TC-516 | `FUNDS_RECEIVED` | verify before purchasing · receive before purchasing |
| TC-517 | `PURCHASED` | fund again beyond approved · receive before verifying (if that is the rule) |
| TC-518 | `PURCHASE_VERIFIED` | purchase again · undo send to accounts |
| TC-519 | `STOCKED` | any money action · void the purchase |
| TC-520 | `CLOSED` | everything |
| TC-521 | `CANCELLED` | submit · approve · generate BOM |
| TC-522–528 | Borrow statuses: from `PENDING`/`REJECTED`/`ISSUED`/`PARTIALLY_RETURNED`/`RETURNED`/`CANCELLED`, attempt each illegal action | `BORROW_INVALID_TRANSITION` |
| TC-529 | Replay any state-changing POST twice | Idempotent or cleanly refused; never double-applied |
| TC-530 | Send a stale `expectedVersion` on a conditional update | `STOCK_VERSION_CONFLICT` / `CONFLICT` |
| TC-531–540 | For each of the 54 error codes: produce it at least once | Every code reachable; every code has SPA copy |

### 6.3 Money arithmetic · TC-541–TC-566

Where the real damage would be. Every figure below must reconcile across the funding panel, the
dashboard and the expenses report — **no third answer to "how much"**.

| ID | Flow | Expect |
|---|---|---|
| TC-541 | Approved = requested (no revision) | All three surfaces agree |
| TC-542 | Approved < requested | Approved figure governs the BOM ceiling |
| TC-543 | Funded < approved | `FUNDS_PARTIAL`; unspent computed against funded |
| TC-544 | Funded = approved | Normal |
| TC-545 | Spent = purchases + transportation | Everywhere |
| TC-546 | Unspent = funded − spent | Never negative |
| TC-547 | Returned reduces unspent | And appears in the report's Returned column |
| TC-548 | Net cash = funded − returned | Report column correct |
| TC-549 | Void a purchase → spent drops by items **and** carriage | OQ-32 |
| TC-550 | Void a receipt → funded drops | Unspent recomputes |
| TC-551 | Amounts with paisa throughout | Two decimals held; no drift |
| TC-552 | 0.005 rounding | Consistent with `NUMERIC(14,2)`; never a half-paisa |
| TC-553 | A very large requisition (near 1,000,000,000) | No overflow; words still render |
| TC-554 | Many small lines summing to a round number | Exact, no floating-point tail |
| TC-555 | Transportation only, no items | Allowed? If so, the BOM must still make sense |
| TC-556 | Items only, no transportation | Normal |
| TC-557 | Requisition of total 0 | Allowed or refused — a stated rule |
| TC-558 | Two requisitions on one BOM | Each ceiling enforced separately |
| TC-559 | Dashboard per-user vs report company-wide | Different scopes, both correct — not a discrepancy |
| TC-560 | Report grouped by month | Totals match |
| TC-561 | Report grouped by department | Totals match |
| TC-562 | Report grouped by project | Totals match |
| TC-563 | Report date range boundaries | Requested/approved by submission date, money by movement date |
| TC-564 | Report CSV export | Same figures as the screen |
| TC-565 | Report PDF export | Same figures |
| TC-566 | Inventory report and its exports | Match the stock register |

### 6.4 Concurrency and integrity · TC-567–TC-580

| ID | Flow | Expect |
|---|---|---|
| TC-567 | Two approvers decide at the same instant | One consistent result |
| TC-568 | Two IMs generate a BOM for the same requisition | One wins; the other gets `BOM_ALREADY_ON_LIVE_BOM` |
| TC-569 | Two purchases recorded simultaneously, together over funded | The second is refused |
| TC-570 | Two borrows of the last unit | One gets `INSUFFICIENT_STOCK` |
| TC-571 | Borrow and adjust-down racing | Stock never goes negative |
| TC-572 | Two receipts into the same compartment | Both land; total correct |
| TC-573 | Reserve then release under load | Reserved returns to 0 |
| TC-574 | Every stock write uses `SELECT … FOR UPDATE` | One writer at a time |
| TC-575 | A failed transaction leaves nothing behind | No half-written ledger row |
| TC-576 | Ledger, placements and product totals reconcile | The nightly invariant job passes |
| TC-577 | `reserved_qty` reconciles against open borrows | Per G-14 |
| TC-578 | Kill the API mid-transaction | On restart, no partial state |
| TC-579 | Append-only triggers cannot be bypassed | Update/delete on ledger, events, audit all refused |
| TC-580 | Restore from backup | The drill actually runs (G-17) |

### 6.5 Notifications · TC-581–TC-592

Never opened in any test so far.

| ID | Flow | Expect |
|---|---|---|
| TC-581 | Requisition submitted → the IM is notified | Bell increments |
| TC-582 | IM approves → both approvers notified | |
| TC-583 | Fully approved → the requester notified | |
| TC-584 | Rejected → the requester notified | With the reason reachable |
| TC-585 | Borrow requested → the IM notified | |
| TC-586 | Borrow decided → the borrower notified | |
| TC-587 | Overdue borrow → a reminder | Once, not repeatedly |
| TC-588 | Approval deadline passes → approvers reminded | Once |
| TC-589 | Mark one notification read | Count decrements |
| TC-590 | Mark all read | Count zero |
| TC-591 | Notification links to the right record | Deep link works |
| TC-592 | No notification when the balance arrives | Documented as intended — do not "fix" |

### 6.6 Files and signatures · TC-593–TC-604

| ID | Flow | Expect |
|---|---|---|
| TC-593 | Upload a signature image | Stored; "Approve with signature" enables |
| TC-594 | Upload an oversized signature | `PAYLOAD_TOO_LARGE` |
| TC-595 | Upload a non-image as a signature | Refused |
| TC-596 | Replace a signature | New one used on later approvals; **earlier BOMs keep the old image** |
| TC-597 | Delete a signature | "Approve with signature" disables again |
| TC-598 | Approve with signature, then delete it | The BOM already rendered still shows it |
| TC-599 | Read another user's signature | `FORBIDDEN` |
| TC-600 | A GENERAL user uploads a signature | `FORBIDDEN` (approver/IM/admin only) |
| TC-601 | Signature renders at the right size on the PDF | Not stretched, not clipped |
| TC-602 | Upload path traversal in a filename (`../../etc/passwd`) | Sanitised |
| TC-603 | Upload with a doubled extension (`x.pdf.exe`) | Refused |
| TC-604 | Stored files are not publicly reachable without auth | Direct URL guess fails |

### 6.7 Non-functional · TC-605–TC-620

| ID | Flow | Expect |
|---|---|---|
| TC-605 | Every screen at 360px wide | Usable; no horizontal page scroll |
| TC-606 | Every table on a narrow screen | Scrolls inside its own container |
| TC-607 | Keyboard-only: raise and submit a requisition | Possible end to end |
| TC-608 | Keyboard-only: approve | Possible |
| TC-609 | Focus moves to the first invalid field on a failed submit | Yes |
| TC-610 | Screen reader: required fields announced | `aria-invalid` plus a described-by message |
| TC-611 | Colour is not the only error signal | Text accompanies the red |
| TC-612 | Dark mode / high contrast, if supported | Legible |
| TC-613 | 500 requisitions in a list | Pagination holds; no slow page |
| TC-614 | 10,000 audit rows | Filters still fast |
| TC-615 | A BOM with 500 lines | Renders without timing out |
| TC-616 | Browser back/forward through the flows | State stays correct |
| TC-617 | Refresh mid-form | Either recovered or cleanly lost — not corrupt |
| TC-618 | Two tabs open on the same requisition | Second reflects the first's change on refresh |
| TC-619 | Session expiry mid-form | Prompted to sign in; work not silently discarded |
| TC-620 | All timestamps in Asia/Dhaka, all money in BDT | Consistent; **known defects F-8, F-9 break this** |

---

## Part 7 — CRUD matrix

Read across: which roles may Create / Read / Update / Delete-or-deactivate each entity. Every
cell that is a "no" is a `FORBIDDEN` test; every "yes" is a happy-path test.

| Entity | Create | Read | Update | Delete / deactivate |
|---|---|---|---|---|
| User | ADMIN | ADMIN | ADMIN | ADMIN (deactivate only) |
| Department | ADMIN | all | ADMIN | ADMIN (deactivate) |
| Setting | — | ADMIN | ADMIN | — |
| Approver slot | ADMIN | ADMIN | ADMIN | ADMIN (clear) |
| Product | IM, ADMIN | all | IM, ADMIN | IM, ADMIN (archive) |
| Category | IM, ADMIN | all | IM, ADMIN | IM, ADMIN (deactivate) |
| Zone / Compartment | IM, ADMIN | IM, ADMIN | IM, ADMIN | IM, ADMIN (deactivate) |
| Project | any signed-in | all | ? | detach items: IM, ADMIN |
| Requisition | any signed-in | own + chain + IM/APPROVER/ADMIN | own draft only | cancel only |
| Requisition item | with the requisition | — | draft only | draft only |
| Supporting document | requester | requester + chain | replace | requester |
| Approval | system, at submit | chain + requester | decide / withdraw | never deleted |
| Delegation | APPROVER, ADMIN | own | — | revoke |
| BOM | IM, ADMIN | IM, ADMIN | — (immutable) | void only |
| BOM PDF | IM, ADMIN | IM, ADMIN | re-render | — |
| Fund receipt | IM, ADMIN | chain | — | void only |
| Purchase | IM, ADMIN | chain | — | void only |
| Invoice file | IM, ADMIN | IM, ADMIN | replace | — |
| Stock placement | via StockService only | all | via StockService only | never directly |
| Stock ledger row | via StockService only | all | **never** | **never** |
| Borrow request | any signed-in | own + STOCK_ROLES | decide / return | cancel only |
| Borrow return | STOCK_ROLES | STOCK_ROLES | — | reverse only |
| Notification | system | own | mark read | — |
| Audit entry | system | ADMIN | **never** | purge job only |
| Signature | APPROVER, IM, ADMIN | own | replace | own |

**The four "never" rows are the integrity spine.** Any route, migration or script that can update
or delete a ledger row, a requisition event or an audit entry is a defect regardless of what it
was for.

---

## Part 8 — How to prioritise 620 cases

Not all of these are worth the same. If this is being worked through by hand:

**Do first — money and integrity, where a bug costs real taka**
TC-277–TC-332 (the whole money chain and every reversal) · TC-541–TC-566 (arithmetic
reconciliation) · TC-567–TC-580 (concurrency and the append-only spine). **TC-319 above all** —
voiding a purchase and the carriage that follows it was decided and built this session and has
never been run.

**Do second — the surfaces never touched at all**
TC-113–TC-126 and TC-593–TC-604 (upload and signatures) · TC-193–TC-200 (delegation) ·
TC-357–TC-380 (stock operations) · TC-413–TC-432 (changing a setting and seeing it take effect).

**Do third — permissions**
TC-461–TC-507. Cheap to automate, and the one class of bug that is invisible from the UI because
the menu is already hidden.

**Do fourth — boundaries**
TC-035–TC-078 and the validation rows throughout. Tedious by hand, trivial as an API test loop.

**Do last — non-functional**
TC-605–TC-620.

**Coverage today:** `IMS-Happy-Path-Test.md` covers roughly 60 of these 620, all from Parts 1–5's
happy branches. The 684-case automated integration suite covers a large but unmeasured slice of
the API-level cases — running it is still the cheapest coverage available.
