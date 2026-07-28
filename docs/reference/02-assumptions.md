## 2. Design decisions & assumptions

Numbered so you can reject them individually.

**A1 — Roles are additive, not exclusive.** Everyone can raise a requisition and borrow. An "Approver" is a General user *plus* approval rights; the IM is a General user *plus* warehouse rights. A user therefore holds a *set* of roles. Otherwise the IM could never borrow a screwdriver.

**A2 — Admin is a fourth, system-level role.** You said "role will be only these 3" — I read that as *the three roles the Admin can assign*. Admin is IT/ops, not part of the procurement workflow.

**A3 — Stock is quantity-based, not unit-based.** A product row holds a total; the total is split across *placements* (product × compartment). This is what makes "move 30 of 70" work and keeps the product card ID stable. Serial numbers are an optional layer on top.

**A4 — The stock ledger is append-only and is the source of truth.** Current quantities are a derived, cached number. Every change writes an immutable ledger row (RECEIPT / MOVE / ISSUE / RETURN / ADJUST / DISPOSE). This is how you get "error free" — if a number ever looks wrong you can replay the ledger and find the exact row that caused it.

**A5 — Threshold is evaluated on the requester's estimated total** at submit time, and the number of approvers is frozen onto the requisition at that moment. Changing the threshold later must not reshuffle in-flight requests.

**A6 — Over-budget rule.** If the IM's BOM total exceeds the **approved amount** by more than a configurable tolerance (default 10%), the requisition bounces back for re-approval instead of silently going to Accounts. (Q5 — you may not want this.)

**A12 — Three money figures are tracked separately**, per requirements §6: *requested* (the requester's estimate, frozen at submit), *approved* (the sanctioned figure at the end of the approval chain), and *funded* (the running sum of logged receipts). See §4.4.

**A13 — A BOM can draw from one or more requisitions**, per requirements §9 ("request form submission(s)"). The common case is one-to-one; batching several approved requisitions onto a single BOM for Accounts is supported. See §9.

**A7 — Approvals are parallel, rejection is immediate and terminal.** Approver 1 and Approver 2 both see it at once. First rejection kills the whole requisition. Line-level partial approval is **not** supported (Q6).

**A8 — Money and buying are logged, not integrated.** No accounting-system integration. The IM logs fund receipts manually and marks purchases done. Partial funding supported; no auto-notification when the remainder arrives (per the requirements doc).

**A9 — Everything is soft-deleted.** "IM can delete anything" cannot mean a hard `DELETE` on a product that appears in three years of BOMs. Delete = `is_active = false` + hidden from dropdowns, historical records intact.

**A10 — Single timezone, BDT only.** Asia/Dhaka. All money is `NUMERIC(14,2)` BDT. No multi-currency.

**A11 — Scale is small.** Assume < 500 users, < 50k products, < 100 requisitions/month. This justifies a modular monolith and rules out microservices, sharding, and caching layers. Revisit if any of those grow 20×.

---
