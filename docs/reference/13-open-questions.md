## 13. Open questions

I need answers to Q1–Q4 before writing any code; the rest can be decided during Phase 3.

*Two earlier questions are now closed, resolved in favour of the requirements doc: the BOM can draw from multiple requisitions (§9), and the approved amount is a stored figure that may be revised down at approval (§4.4). Both are behind config flags if you want the simpler behaviour.*

**Q1 — Below-threshold approvals.** The requirements doc only specifies that *above* 15,000 BDT needs exactly 2 approvers. Below it: 1 approver, or does IM approval alone suffice? I've assumed **1 approver**.

**Q2 — Who are Approver 1 and Approver 2?** Two fixed people company-wide, or different approvers per department? I've assumed a **global default with optional per-department override**. Also: does the *order* of the names matter on the BOM, or is slot 1/slot 2 arbitrary?

**Q3 — Do laptops need individual tracking?** Quantity-based ("we have 12 Dell Latitudes, 3 are out") is much simpler. Serial-based ("Saad has serial DL-88213") is what you'll want if these are capital assets that get audited. Which?

**Q4 — Withdraw window.** Should withdrawal be time-limited (e.g. 15 minutes after approving) or allowed until the BOM is generated? I've assumed **until BOM generation**. Same question for the IM's ✎ Edit on borrow approvals (Q7).

**Q5 — Over-budget BOM.** The requester estimates 1,200 BDT/unit; the IM's actual vendor quote is 1,900. Should the requisition bounce back for re-approval past some tolerance, or does the IM just proceed? I've assumed **bounce back above 10%**.

**Q6 — Partial approval.** A requisition has 5 line items and the approver only agrees to 3. Reject the whole thing, or approve line by line? I've assumed **whole-request only** — line-level approval roughly doubles the complexity of the approval engine.

**Q7 — Borrow approval "Edit".** After the IM approves a borrow and the item has physically left the building, what does ✎ Edit actually do? I've implemented it as **revert-to-pending, allowed only until the stock has been physically issued**, but tell me what you had in mind.

**Q8 — Self-approval.** What if the CFO raises their own requisition and is also Approver 2? I've assumed **skip and substitute**, but I need to know who the substitute is.

**Q9 — Consumables in the catalogue.** Wire, solder, tape: they're issued and never come back. Should they be a product flag (`is_consumable`) set by the IM on the product itself, rather than a per-borrow choice by the requester? A flag on the product is harder to get wrong.

**Q10 — Projects.** Any user can create a project on the fly during a borrow. Should projects have a code, an owner, or a budget, or is a name enough? Free-for-all creation tends to produce "Falcon", "falcon", "Falcon Project" within a month — I'd suggest at minimum a duplicate-name warning.

**Q11 — Email.** Is there an SMTP relay / Microsoft 365 account I can send from, or is in-app notification only for v1?

**Q12 — Letterhead.** Please send the company pad as a PDF or high-res PNG plus the exact margins, so the BOM template lines up with the printed stationery on the first try.


---
