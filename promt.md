Continue the IMS build. NOW.md is auto-injected — read it, don't re-derive.

Start with OQ-32, which phase 08 left open: transportation on a voided purchase.
The reversals (215b3cf) landed before the transportation fix (f7c7f72) and the two
were never reconciled. Voiding a purchase removes its own total from `spent`, but
whether the carriage follows it out is asserted nowhere.

1. Reproduce it first. In apps/api/test/money-audit.int-spec.ts, take the existing
   1,000-requested / 500-transportation / 250-purchased scenario, void the purchase,
   and assert what `spent` reads in GET /reports/expenses and GET /dashboard/me.
   Show me the numbers before you change any code — I want to see what it does now.
2. Then decide what it should do. My instinct is the carriage follows the last live
   purchase out, but make it a decision with a reason, not an accident of the
   EXISTS clause. Record it in DECISIONS.md.
3. Then the BOM PDF totals against the same scenario. Nothing else that prints a
   money figure went unchecked in phase 08; that one did.

After that, phase 06: task 6.2 (nightly invariant job, extended to reserved_qty per
G-14), then 6.3 (backup and restore drill).

Two standing things:
- lint is 20 pre-existing errors. Compare against 20, not zero.
- 146 commits exist on this machine only. Ask me before pushing.

Work as usual: red run before green, full gate before you call anything done, and a
handoff block per issue.
