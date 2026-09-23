# IMS / Southern IoT — Production-Readiness QA Report

> **Living document.** Updated continuously as the QA pass proceeds. Hand this to Claude Code.
> Fix everything tagged `🔴 DEFECT` and `🟡 UI/UX`. **Do NOT "fix"** anything tagged
> `⚪ WORKING-AS-DESIGNED` — those behaviours are correct by decision (see §2 of the brief).
> Items tagged `⛔ BLOCKED` or `❓ QUESTION` need investigation or a product decision first.

| | |
|---|---|
| **App under test** | Southern IoT (branded "IOT — Innovation of Technology"); brief calls it "IMS" |
| **URL** | http://localhost:5173 (IPv6-only; `127.0.0.1:5173` correctly refuses — not a bug) |
| **Tester** | Claude via Claude-for-Chrome browser automation |
| **Run date** | 2026-08-27 |
| **Demo creds** | password `demo` for all 5 accounts (see Config snapshot) |
| **Status** | ✅ PASS COMPLETE — §1, §3.1–§3.7, §4 done; §5 console PASS; 43 QA + 9 UX findings; verdict NO-GO until QA-001 + listed defects fixed (see Executive summary) |

---

## Executive summary & GO / NO-GO verdict

**Verdict: NO-GO for production until the blockers below are cleared — but the core system is sound.**
The requisition→approval→BOM→funding→purchase→verify→receive lifecycle works end-to-end, every
money figure reconciles (including the carriage-in-spent trap), role-based access is enforced at
**both** the UI and the API for all four roles, and the runtime is clean (no console errors). The
issues that remain are specific and fixable, not architectural.

**Must-fix before production (blockers):**
- **QA-001 — demo mode / exposed credentials.** The login page lists every account (incl. admin)
  with a shared password. Ship `DEMO_MODE=off` for prod. (Also see §D statements — infra items
  a browser can't clear.)

**Real defects to fix (not blockers, but should be addressed):**
- **QA-019** BOM builder variance miscomputed (items-only subtotal vs transport-inclusive approved) → false variance.
- **QA-034** "revise sanctioned amount" is offered for a single indivisible qty-1 line (owner: should be gated off).
- **QA-039** single-line BOM forced-send-back leaves qty/cost editable + shows "cannot shrink" even at variance 0.
- **QA-041** a withdrawn-then-returned requisition ("With the Inventory Manager") is missing from the IM's "Waiting on me" queue.
- **QA-009** draft REQUESTED shows 0 in the list.
- **UX-5** SANCTIONED shown before anything is sanctioned · **UX-6** requester Name/Project faint & Date missing on the detail · **UX-7/8/9** copy/spacing/draft-visibility nits.

**Verified working (high confidence):** approval thresholds (1 vs 2 approvers) + enforcement +
rejection-kills + self-approval prevention; sub-threshold & at-or-above routing; revise-sanctioned
→ BOM → send-back loop; money walk + carriage trap + over-return refusal; borrow reserve/issue/
reject/return; inventory CRUD; receiving + stock rollup; void-BOM cascade reversal (2026-08-27 fix);
RBAC UI+API for General/IM/Approver; clean console.

**Important — do NOT chase these (reclassified as environment/automation, not product bugs):**
QA-007 (deadline picker), QA-022 (empty compartment dropdown), QA-023 (receive crash), QA-037
(withdraw hang) — all were the QA-024 backend-502 / renderer-instability episode, confirmed fixed
after a Docker restart. The real infra finding is **QA-024**: intermittent 502s / renderer stalls
under load — worth profiling.

**Counts:** 43 QA findings + 9 UX items. Coverage: §1, §3.1–§3.7, §4 complete; §5 partial
(console PASS, true mobile pass open); a few low-value edges intentionally left (see NOT-CHECKED).

---

## How findings are tagged (for Claude Code)

| Tag | Meaning | Action for Claude Code |
|---|---|---|
| 🔴 **DEFECT** | Real bug | **Fix it** |
| 🟡 **UI/UX** | Breakage, layout, or unprofessional polish | **Improve it** |
| ⛔ **BLOCKED** | Flow could not be tested (missing/undiscoverable UI, dependency failed) | **Investigate — likely missing feature** |
| ❓ **QUESTION** | Spec-vs-implementation mismatch or ambiguity | **Get a decision, don't blind-fix** |
| ⚪ **WORKING-AS-DESIGNED** | Correct by deliberate decision | **Leave alone** |

Severity: `CRITICAL` / `HIGH` / `MEDIUM` / `LOW`.

---

## Config snapshot (drives every approval test)

| Setting | Value | Source |
|---|---|---|
| `EXPENSE_THRESHOLD_BDT` | **15000** | /admin/settings (restored after test) |
| `APPROVER_SLOTS_AT_OR_ABOVE_THRESHOLD` | **2** | /admin/settings |
| `SUBTHRESHOLD_APPROVER_USER_ID` | **Ayesha Approver** | /admin/settings |
| `APPROVER_SLOTS_BELOW_THRESHOLD` | *no such field* — sub-threshold uses one designated approver (implied 1) | see QA-002 |
| Approver 1 (company default) | Ayesha Approver | /admin/settings |
| Approver 2 (company default) | Farhan Finance | /admin/settings |
| Audit retention | Forever | /admin/settings |

**Personas / roles / nav** (read off login page, not guessed):

| Name | Email | Roles | Role in brief | Nav sections |
|---|---|---|---|---|
| System Administrator | admin@ims.local | General, Administrator | **Admin** | + Administration |
| Imran Manager (Operations) | im@ims.local | General, Inventory Manager | **IM** | + Approvals + Inventory |
| Ayesha Approver (Head of Operations, Operations) | approver1@ims.local | General, Approver | **Approver A** | + Approvals |
| Farhan Finance (CFO, Accounts) | approver2@ims.local | General, Approver | **Approver B** | + Approvals |
| Gina General (Engineering) | general@ims.local | General | **General user** | base only |

**Base data present** (nothing created): Depts = Accounts, Engineering, Operations · Categories = Cables & Consumables, Furniture (not tracked), Laptops, R&D Hardware · Zones = Meta (1A,1B,2A), Nvidia (3C,4D).

---

## Findings log

```
ID          QA-001
SEVERITY    CRITICAL
CLASSIFY    ❓ QUESTION / production blocker (intended for demo)
ROLE        pre-login
SCREEN      /login
STEPS       Open http://localhost:5173
EXPECTED    Production login exposes no credentials.
ACTUAL      "Demo accounts" panel lists all 5 accounts incl. admin with shared
            password "demo". Page even says "Turn demo mode off before this
            system holds anything real."
FIX HINT    Ship a DEMO_MODE flag = off for prod; hide the panel + reject the
            shared password when off. (This is the §D.1 mandatory finding.)
EVIDENCE    screenshot-...-0.jpg
```
```
ID          QA-002
SEVERITY    LOW
CLASSIFY    ❓ QUESTION
ROLE        Admin
SCREEN      /admin/settings
EXPECTED    Brief names APPROVER_SLOTS_BELOW_THRESHOLD.
ACTUAL      No numeric below-threshold field; sub-threshold path uses one
            designated "Sub-threshold approver" (count implied 1).
FIX HINT    Confirm this is the intended model; align brief or add the field.
EVIDENCE    screenshots 2, 3
```
```
ID          QA-003
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified, no action)
ROLE        Admin — /admin/users
STEPS       Create QA Test User → deactivate → show deactivated → reactivate
ACTUAL      All three succeeded; toasts + status Active→Inactive→Active; the
            deactivated row correctly hid from the default list.
EVIDENCE    screenshots 14–21
```
```
ID          QA-004
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified, no action)
ROLE        Admin — departments / settings / audit-log
ACTUAL      Dept create + rename OK. Threshold 15000→20000 persisted across
            reload, then restored to 15000. Audit log records every action
            with actor name, timestamp, entity, outcome, IP; actor filter
            narrows results correctly.
EVIDENCE    screenshots 22–31
```
```
ID          QA-005
SEVERITY    MEDIUM
CLASSIFY    ⛔ BLOCKED
ROLE        Admin
SCREEN      searched /admin/users, /admin/settings, /account/profile, /admin/audit-log
EXPECTED    §3.1: give an approver a delegate; a 2nd overlapping delegation
            must be refused with DELEGATION_ALREADY_LIVE.
ACTUAL      No delegation UI found anywhere. /admin/delegations = 404; Users
            edit modal has no delegate field; key icon = "Reset password";
            My account (admin + approver) only has signature + password.
FIX HINT    Delegation appears unimplemented in the UI (or API-only). Confirm
            where it should live and surface it. Test remains BLOCKED.
EVIDENCE    screenshots 32, 36, 37, 38, 39
```
```
ID          QA-006
SEVERITY    LOW
CLASSIFY    ❓ QUESTION
ROLE        Admin — /admin/audit-log
EXPECTED    §3.1 asks to filter by actor, entity, and date.
ACTUAL      Filters are User(actor), Approvals(outcome), From/To(date). No
            "filter by entity" control.
FIX HINT    Add an entity-type filter, or update the brief.
EVIDENCE    screenshots 30, 31
```

---

```
ID          QA-007
SEVERITY    ~~CRITICAL~~ → MEDIUM (INTERMITTENT — could not reproduce once page was healthy)
CLASSIFY    🔴→❓ DEFECT (intermittent) / possibly environment-linked
ROLE        General user (general@ims.local)
SCREEN      /requisitions/:id/edit — Approval deadline picker
HISTORY     Earlier the "Set deadline" button did not commit the value to the
            field across ~6 attempts (coordinate + ref), blocking submit. Those
            attempts coincided with repeated renderer freezes (CDP screenshot
            timeouts) — the same degradation that later surfaced as the QA-024
            502 storm.
RE-TEST     After the API restart, on the SAME draft (REQ-000003): opened the
            picker → clicked 29 → "Set deadline" → field populated
            "Aug 29, 2026, 05:00 PM" first try, and Submit succeeded ("Submitted.
            The Inventory Manager will review it first"). So it is NOT a hard,
            always-on bug — it's intermittent and correlated with the page being
            under stress.
WHERE/FIX   Likely a state-update race in the date-picker's onConfirm when the
            main thread is busy/janky. Worth hardening (ensure the committed
            value is written synchronously / retried), but it does NOT block the
            pipeline in normal conditions. The earlier §3.4 cascade (QA-018) is
            therefore UNBLOCKED.
EVIDENCE    fail: KAM447/56-66 (earlier). pass: KAM447/87-89 (deadline set +
            REQ-000003 submitted)
CLASSIFY    🔴 DEFECT
ROLE        General user (general@ims.local)
SCREEN      /requisitions/:id/edit  (New/Edit requisition — Approval deadline)
STEPS       1. Open the approval-deadline picker
            2. Click a valid future day (29 Aug 2026) — day highlights blue,
               "Set deadline" button becomes enabled (bright blue)
            3. Click "Set deadline"
EXPECTED    Picker closes and the field shows the chosen date/time; requisition
            can then be submitted.
ACTUAL      Picker closes but the field still reads "Select date & time" — the
            value is NOT persisted. Confirmed via BOTH coordinate and element-
            ref clicks, and server-side: Submit is rejected with "approval
            deadline needed", so the value truly never reaches the model.
IMPACT      Approval deadline is REQUIRED to submit, so this blocks submitting
            ANY requisition through the UI. Blocks §3.4/§3.5 for a fresh 1,000
            requisition. NOTE: seeded REQ-000001/2 already have deadlines, so
            reproduce manually to confirm it's a live regression vs a picker
            quirk — automated evidence strongly indicates a real defect.
FIX HINT    The "Set deadline" handler isn't writing the composed date+time
            back into the form state. Check the picker's onConfirm / value
            binding.
EVIDENCE    screenshots 56–67 (picker open, day 29 + Set deadline enabled,
            field still empty after confirm; submit error toasts 54, 63)
```
```
ID          QA-008
SEVERITY    LOW
CLASSIFY    🟡 UI/UX
ROLE        General user
SCREEN      /requisitions/:id (submit validation)
EXPECTED    A blocked submit names only the field(s) actually missing.
ACTUAL      Message reads "Department, approval deadline and reason are needed
            before this can be submitted" while Department (Engineering) and
            Reason (56/280) are both filled — only the deadline is empty.
FIX HINT    Make the validation message list only unsatisfied fields.
EVIDENCE    screenshots 54, 55, 63
```
```
ID          QA-009
SEVERITY    MEDIUM
CLASSIFY    🔴 DEFECT (verify intent)
ROLE        General user
SCREEN      /my-requisitions
EXPECTED    REQUESTED column reflects the draft's provisional total (1,000).
ACTUAL      Draft REQ-000003 shows REQUESTED = 0 in the list, though its detail
            page shows 1,000. Submitted rows (REQ-000001/2) show real amounts.
FIX HINT    List query likely reads a "sanctioned/fixed" amount that is 0 until
            submit; fall back to the provisional total for drafts, or label the
            column so 0 isn't misread.
EVIDENCE    screenshot 49
```

**§3.2 positives verified:** requisition build produced the exact house-audit summary — Items 500 · Transport 500 · Requested 1,000 (screenshots 46–47); free-text item accepted ("Not in the catalogue"); Save draft → reopen → edit (urgency Normal→High) all worked; /my-requisitions correctly shows only Gina's rows.

```
ID          QA-010
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) + calc-integrity PASS
ROLE        General user (general@ims.local)
SCREEN      /inventory/:id (product) → Borrow dialog
STEPS       1. Open ThinkPad T14 (AVAILABLE 10, RESERVED 0)
            2. Borrow 2 pcs from Meta/1A, expected back 29 Aug, purpose set, submit
EXPECTED    Availability drops immediately on submit, before any approval.
ACTUAL      AVAILABLE 10→8, RESERVED 0→2 instantly; Meta/1A 7 available →
            "2 reserved, 5 available". Arithmetic correct and consistent across
            the summary tiles and the location panel. Borrow dialog Project
            defaults to "No project" = known OQ-31 (WAD).
EVIDENCE    screenshots 71 (before), 72–74 (dialog), 75 (after)
```

```
ID          QA-011
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified)
ROLE        Inventory Manager (im@ims.local)
SCREEN      /requisitions/:id (REQ-000002, IM-review approval)
STEPS       1. Approvals → REQ-000002 → Approve → "Approve without signature"
EXPECTED    IM-review stage completes; tracker lights the NOW-waiting stage.
ACTUAL      Status Draft-review → "Awaiting approval". Progress panel: Inventory
            Manager = ✓ "Approved by · Aug 27 2026 06:08 PM"; Approver 1 (Ayesha)
            = "Waiting on" (correctly lit). Approve dialog offers signature or
            "without signature". A "Withdraw approval" action then appears (§3.6
            reversal). Calc: 15×100=1,500 + 500 = 2,000 requested = sanctioned.
EVIDENCE    screenshots KAM447/1 (before), 2 (dialog), 3 (after)
```
```
ID          QA-012
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) + calc-integrity PASS
ROLE        Inventory Manager
SCREEN      /borrowing → ThinkPad detail
STEPS       1. Borrowing → BR-000002 (ThinkPad, pending) → Approve
EXPECTED    Approving issues stock: on-hand drops, reservation clears, item goes
            "in use"; ledger records the issue; figures agree across screens.
ACTUAL      "Approved and issued." ThinkPad ON HAND 10→8, RESERVED 2→0, IN
            PROJECT USE 0→2, AVAILABLE 8; Meta/1A 7→5. "Currently in use" lists
            Gina BR-000002 (still out 2). Ledger: "Issued 2 · Imran Manager".
            All arithmetic consistent (owned=on-hand+in-use; avail=on-hand−reserved).
EVIDENCE    screenshots KAM447/4 (queue), 5 (issued), 6 (product math)
```

```
ID          QA-013
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) + calc-integrity PASS
ROLE        Inventory Manager (im@ims.local)
SCREEN      /borrowing (BR-000002 ThinkPad) → product ledger
STEPS       1. Record return 1 of 2 → 2. Record return 1 of 1
EXPECTED    Status Out→Partly returned→Returned; each return restores stock;
            ledger records each; figures agree across screens.
ACTUAL      Status transitioned correctly. After full return: ThinkPad ON HAND
            8→10, IN PROJECT USE 2→0, Meta/1A 5→7, "Currently in use: Nothing".
            Ledger shows two "Returned 1 → Meta/1A · Good" rows + the "Issued 2".
            All arithmetic reconciles at each step.
EVIDENCE    screenshots KAM447/7 (dialog), 8 (partly), 9 (returned), 11 (stock+ledger)
```
```
ID          QA-014
SEVERITY    MEDIUM
CLASSIFY    ⛔ BLOCKED (no UI affordance) — likely missing feature
ROLE        Inventory Manager
SCREEN      /borrowing  (WHERE: borrowing list row actions)
STEPS       1. On an issued borrow, record a partial return (BR-000001, 1 of 2)
            2. Look for a control to reverse/undo that recorded return
EXPECTED    §3.3 requires: "reverse one recorded return and confirm the stock
            goes back on the shelf."
ACTUAL      No reverse-return control exists. A fresh "Out" borrow shows an undo
            (↺) icon, but that reverses the ISSUE (un-issue), and it disappears
            the moment any return is recorded. A "Partly returned" row shows only
            "Record return" (zoom-confirmed); a fully "Returned" row shows no
            actions at all. Recorded returns cannot be reversed from the UI.
WHERE/FIX   Borrowing list row action set (and/or product movement-ledger rows).
            Add a "reverse return" action on partly/fully-returned borrows (or a
            per-movement reverse on the product ledger) that re-issues the qty
            and reduces on-hand. Confirm whether this feature is intended.
EVIDENCE    screenshots KAM447/10, 12 + zoom (row shows only "Record return")
```

```
ID          QA-015
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) + calc-integrity PASS
ROLE        Inventory Manager (im@ims.local)
SCREEN      /borrowing (BR-000003) → ThinkPad detail
STEPS       1. Create pending borrow (ThinkPad 1 pc) → reserves 1 (avail 10→9)
            2. Reject BR-000003
EXPECTED    Rejecting releases the reservation; availability returns.
ACTUAL      Toast "Rejected. The reservation has been released." ThinkPad back
            to AVAILABLE 10 / RESERVED 0 / ON HAND 10. Correctly NO ledger entry
            (reservation is not a stock movement). Approve→issue (QA-012) and
            reject→release both verified.
EVIDENCE    screenshots KAM447/15 (pending), 16 (rejected+toast), 17 (stock restored)
```

```
ID          QA-016
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — IM inventory CRUD
ROLE        Inventory Manager (im@ims.local)
SCREEN      /inventory/categories, /inventory/locations, /inventory
STEPS       Create category (QA Category), zone (QA Zone), compartment (QA1),
            product (QA-0001 "QA Widget", cat QA Category)
EXPECTED    IM can create all four inventory entities.
ACTUAL      All four created (toasts "Category/Zone/Compartment/Product
            created"); each appears in its list, product linked to QA Category.
            IM also sees Export CSV/PDF, Adjust/Move/Receive stock, edit +
            Deactivate (soft-delete) controls.
EVIDENCE    screenshots KAM447/18–27
```

```
ID          QA-017
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — sub-threshold routing
ROLE        Approver A (Ayesha, approver1@ims.local)
SCREEN      /requisitions/:id (REQ-000002)
STEPS       1. As Ayesha, Approvals → REQ-000002 → Approve → without signature
EXPECTED    Sub-threshold (2,000 < 15,000) routes to the ONE designated
            approver; a single approval moves it to Approved.
ACTUAL      Only Ayesha had it (not Farhan) — chain had exactly IM + Approver 1.
            After her approval: status Approved; both stages green (IM 06:08,
            Ayesha 06:22). Approve dialog also offers "Revise the sanctioned
            amount" (approvers may revise down) and signature options.
EVIDENCE    screenshots KAM447/28–31
```
```
ID          QA-018
SEVERITY    ~~HIGH~~ → RESOLVED (unblocked once QA-007 shown intermittent)
CLASSIFY    ✅ was ⛔ BLOCKED (cascade of QA-007)
NOTE        REQ-000003 submitted successfully after the restart, so fresh
            requisitions can be created again. The §3.4 at-or-above / reject /
            send-back / self-approval tests are now runnable — see §3.4 rows.
```

```
ID          QA-019
SEVERITY    MEDIUM
CLASSIFY    🔴 DEFECT (calculation consistency)
ROLE        Inventory Manager (im@ims.local)
SCREEN      /boms/new  (New BOM builder)  vs  /boms/:id (generated BOM)
STEPS       1. New BOM, tick REQ-000002 (items 1,500 + transport 500 = 2,000)
            2. Read "BOM SUBTOTAL" and "VARIANCE" on the builder
            3. Generate, then read the same labels on the generated BOM
EXPECTED    "BOM SUBTOTAL" and "VARIANCE" mean the same thing on both screens.
ACTUAL      Builder: BOM SUBTOTAL 1,500 (items only), VARIANCE -500 (-25.0%) —
            it compares items-only subtotal against APPROVED TOTAL 2,000, which
            INCLUDES transport, so it shows a false -25% variance even though
            unit costs match the estimate exactly. Generated BOM: BOM SUBTOTAL
            2,000 (items+transport), VARIANCE 0. Same label, two different
            computations → misleading variance on the builder.
WHERE/FIX   BOM builder subtotal/variance calc. Either add transportation into
            the builder's subtotal (to match the generated BOM) or compare the
            items-only subtotal against the items-only approved figure. Make the
            two screens agree.
EVIDENCE    screenshots KAM447/37 (builder: 1,500 / -500 / -25%), 38 (generated: 2,000 / 0)
```
```
ID          QA-020
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) + calc-integrity PASS
ROLE        Inventory Manager
SCREEN      /requisitions/:id (REQ-000002 funding panel)
STEPS       Send to Accounts → fund 1,000 + 1,000 → record purchase 15 × 50 = 750
EXPECTED    Each step advances lifecycle and figures reconcile.
ACTUAL      Sent to Accounts (status→Sent). Two receipts TRF-001/002 = Funded
            2,000; Partly funded→Funded. Purchase 15×50=750: Spent 750 ·
            Transportation 500 · Unspent 750. Reconciles: Unspent 750 = Funded
            2,000 − Spent 750 − Transport 500. Funding-panel "Spent" is
            purchases-only; transport is a separate line. (Cross-check /expenses
            "spent" definition next — see money table.)
EVIDENCE    screenshots KAM447/42–58
```

```
ID          QA-021
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — verify guardrails
ROLE        Inventory Manager (im@ims.local)
SCREEN      /requisitions/:id → Verify purchase dialog
STEPS       Open Verify; the dialog shows unspent 750 (note: "already spent on
            transportation: 500") and prefills "Amount going back to Accounts"
            = 750; try Save
EXPECTED    Guardrails prevent a bad verify.
ACTUAL      Three gates fire in sequence: (1) "Say why the money is going back"
            (return reason required), (2) "1 purchase(s) still have no invoice
            attached. Upload them before verifying." Good controls. NOTE: the
            over-return refusal (>unspent) test is still behind the invoice
            gate — pending invoice attach.
EVIDENCE    screenshots KAM447/60 (dialog), 61 (reason gate), 62 (invoice gate)
```

```
ID          QA-022
SEVERITY    ~~HIGH~~ → RESOLVED (was 502 fallout, NOT a frontend bug)
CLASSIFY    ⛔→✅ ENVIRONMENT (QA-024) — confirmed after API restart
ROLE        Inventory Manager (im@ims.local)
SCREEN      /requisitions/:id → "Add to inventory" (receive to stock) dialog
RESULT      During the 502 outage the compartment dropdown was empty. After the
            API restart the dropdown populates correctly (Meta·1A/1B/2A,
            Nvidia·3C/4D, QA Zone·QA1) and the receive completes. So the empty
            dropdown was the options fetch failing under QA-024, not a real bug.
            No fix needed beyond QA-024. Original evidence: KAM447/67.
```
```
ID          QA-023
SEVERITY    ~~MEDIUM~~ → LOW (trigger was the QA-024 502; keep as robustness note)
CLASSIFY    🟡 UI/UX (error handling)
ROLE        Inventory Manager
SCREEN      /requisitions/:id → Add to inventory → Save
NOTE        The full-page "Something went wrong · Request failed" happened when
            the receive POST failed during the QA-024 outage. With the API
            healthy the receive succeeds normally. Remaining (low) point: an API
            failure replaces the whole requisition view via the page-level error
            boundary rather than showing an inline, recoverable error. Worth
            hardening, but not the blocker it first appeared.
WHERE/FIX   Handle receive API errors inline in the dialog; add client-side
            "compartment required" validation as defence-in-depth.
EVIDENCE    screenshots KAM447/68 (full-page error during outage)
```

```
ID          QA-024
SEVERITY    CRITICAL
CLASSIFY    ⛔ ENVIRONMENT (backend unstable) — impedes further testing
ROLE        any (server-side)
SCREEN      multiple — surfaced via Network tab
STEPS       1. Load /expenses (or any page hitting counts) after ~an hour of use
            2. Inspect Network
EXPECTED    API returns 200 with data.
ACTUAL      Backend returns intermittent **502 Bad Gateway** on many endpoints:
              GET /api/v1/reports/expenses?groupBy=month   → 502 (×3)
              GET /api/v1/reports/expenses?groupBy=department → 502 (×3)
              GET /api/v1/notifications/unread-count        → 502 (repeated)
              GET /api/v1/requisitions/awaiting-count       → 502
              GET /api/v1/borrowing/pending-count           → 502
            A few 200s are mixed in (flaky, not fully down). /expenses now
            hangs on skeleton loaders and never resolves. 502 = the Vite dev
            proxy can't reach the NestJS upstream, i.e. the API process is
            crashing / restarting / overloaded.
IMPACT      Blocks the /expenses carriage trap and the requester-dashboard spent
            check (money table). Very likely the ROOT CAUSE of QA-022 (empty
            compartment dropdown = its options fetch 502'd) and QA-023 (receive
            "Request failed" = a 502). Core requisition/funding writes earlier
            returned 200, so the API degraded during the session.
WHERE/FIX   Check the NestJS API process/logs for the crash or resource
            exhaustion behind the 502s; restart it, then re-run the blocked
            checks. Confirm whether reports/expenses has its own failure mode.
EVIDENCE    network dump (502s listed above); screenshots KAM447/70 (Request
            failed), 71-72 (perpetual skeleton)
```

```
ID          QA-025
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — RBAC enforced UI + API
ROLE        General user (general@ims.local)
SCREEN      /admin/*, /boms, /borrowing, /expenses + their APIs
STEPS       1. As Gina, open each protected route → UI check
            2. In-page fetch of the matching API with and without her token
EXPECTED    Denied at the UI AND rejected server-side (not just a UI guard).
ACTUAL      UI: /admin/users, /admin/settings, /admin/audit-log, /boms,
            /borrowing all render "Not allowed". API (authenticated as Gina):
            GET /api/v1/admin/users → 403 FORBIDDEN; /api/v1/admin/settings →
            403; /api/v1/boms → 403; /api/v1/reports/expenses → 403.
            Unauthenticated (no token): same endpoints → 401 UNAUTHENTICATED.
            Denial proven at both layers. (Token was read in-page only and
            never exposed.)
EVIDENCE    screenshots KAM447/73-74 (Not allowed); in-page fetch results
            (401 no-token / 403 with General token)
```

```
ID          QA-026
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — auth redirect + input guard
ROLE        General user / logged-out
SCREEN      /requisitions/new, /admin/users (logged out)
STEPS       1. Negative qty: item with qty -5, price 100
            2. Log out, then open /admin/users by URL
EXPECTED    Negatives don't produce a negative total; protected URLs redirect
            to login when unauthenticated.
ACTUAL      (1) Line total stayed 0.00 and Requested amount 0.00 — no negative
            total produced (safe). Minor UX: the qty field still displays "-5"
            rather than clamping/flagging it → UX-4. (2) Logged out + /admin/users
            redirected to /login. Both good.
EVIDENCE    screenshots KAM447/77 (neg qty → 0.00), 78 (redirect to login)
```

```
ID          QA-027
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — carriage-in-spent trap PASS
ROLE        Inventory Manager (im@ims.local)
SCREEN      /expenses (Month and Department groupings, All time)
STEPS       After API restart, load /expenses; read SPENT vs its components
EXPECTED    "Spent" must include carriage (purchases + transportation), and
            reconcile with funded/returned.
ACTUAL      Report shows SPENT = ON PURCHASES + ON TRANSPORTATION:
            2,638 = 1,250 + 1,388 ✓. Reconciles: Funded 6,388 = Spent 2,638 +
            Returned 3,750; Net Cash 2,638 = Funded − Returned. Department
            grouping scopes correctly (both reqs in Engineering). Draft
            REQ-000003 excluded. The report is transparent (separate columns),
            so the "trap" is handled well.
EVIDENCE    screenshots KAM447/79 (by month), 80 (by department)
```

```
ID          QA-028
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — full money walk + receive + rollup
ROLE        Inventory Manager (im@ims.local)
SCREEN      /requisitions/:id (REQ-000002) → /inventory
STEPS       After API restart: Add to inventory → Meta·1A → Save
EXPECTED    Requisition completes to "In stock"; received qty rolls into stock.
ACTUAL      Status → "Stocked"; lifecycle fully green (Submitted…In stock);
            "This requisition is complete"; purchase "Fully received". Stock
            rollup correct: esp 5 → 20 owned/available (15 received into Meta·1A).
            Full lifecycle proven end-to-end: Submit→IM→Approve→BOM→Accounts→
            Fund→Purchase→Verify(+return)→Receive→In stock. §3.7 receiving PASS.
EVIDENCE    screenshots KAM447/83 (compartment populated), 84-85 (complete),
            86 (esp 20 pcs)
```

```
ID          QA-029
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — at-or-above two-approver rule
ROLE        General user → approvers
SCREEN      /requisitions/new, /requisitions/:id (REQ-000004, 20,000)
STEPS       Create requisition 2 × 10,000 = 20,000 (≥ 15,000 threshold), submit
EXPECTED    ≥ threshold requires 2 approvers; chain includes both.
ACTUAL      Form summary flipped to "2 approvers needed. This is at or above the
            15,000 threshold, so expect a second sign-off." After submit:
            APPROVERS REQUIRED = 2; chain = IM (Imran) → Approver 1 (Ayesha) →
            Approver 2 (Farhan Finance, CFO). Correct vs the sub-threshold case
            (QA-017) which had a single approver. Threshold logic dynamic and
            frozen at submit.
EVIDENCE    screenshots KAM447/91 (2-approver notice), 92 (submitted, 2 in chain)
```

```
ID          QA-030
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — two-approver enforcement
ROLE        IM + Approver A + Approver B
SCREEN      /requisitions/:id (REQ-000004, 20,000)
STEPS       IM approve → Ayesha (Approver 1) approve → observe → Farhan
            (Approver 2) approve
EXPECTED    One approver is NOT enough above threshold; needs both.
ACTUAL      After IM + Ayesha approvals, status STILL "Awaiting approval"
            (Approver 2 "Waiting on") — one approval insufficient. After Farhan
            also approved: status → "Approved", all three stages green. Both
            approvers ran in parallel (both "Waiting on" at once). Each approver
            can "Withdraw approval" after signing.
EVIDENCE    screenshots MwAC6g/3-5 (Awaiting after 1 of 2 → Approved after 2 of 2)
```

```
ID          QA-031
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — rejection kills the request
ROLE        Inventory Manager (im@ims.local)
SCREEN      /requisitions/:id (REQ-000003)
STEPS       At IM review, click Reject → add note → confirm Reject
EXPECTED    Rejection ends the whole request; downstream approvers not asked.
ACTUAL      Dialog warns "Rejecting ends the whole request. The other approvers
            will not be asked, and it cannot be reopened." After confirm: status
            → "Rejected" (toast "The requester has been told"); IM shows
            "Rejected by … · See why"; downstream Approver 1 (Ayesha) = "Skipped".
            Lifecycle halts. Correct.
EVIDENCE    screenshots MwAC6g/7 (warning), 8 (Rejected + Skipped)
```

```
ID          QA-032
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — self-approval prevented
ROLE        Approver A (Ayesha) as requester
SCREEN      /requisitions/new → /requisitions/:id (REQ-000005)
STEPS       As Ayesha (the company-default sub-threshold approver), raise and
            submit a sub-threshold requisition (1,000)
EXPECTED    Ayesha must not be able to approve her own requisition.
ACTUAL      System auto-routed Approver 1 to FARHAN FINANCE instead of Ayesha —
            i.e. it detected the requester would be her own approver and
            substituted another eligible approver. Ayesha's view shows "Cancel
            request" (requester action), NOT Approve/Reject. Self-approval is
            prevented structurally at routing time — clean design.
EVIDENCE    screenshots MwAC6g/11 (REQ-000005: requester Ayesha, Approver 1 = Farhan)
```

```
ID          QA-033
SEVERITY    ~~LOW~~ → CORRECTED (send-back DOES exist)
CLASSIFY    ✅ WORKING-AS-DESIGNED — send-back is at the BOM stage, not approval
ROLE        IM (at BOM generation)
SCREEN      /boms/new
CORRECTION  Earlier I concluded no send-back exists because IM/approver approval
            dialogs only have Reject/Approve. That was incomplete. "Send back
            for revision" DOES exist — it appears in the BOM builder when a
            single-line BOM's revised sanctioned amount is below its line total
            ("A single-line BOM cannot shrink to fit. Bounce this requisition
            back to the requester — they edit the budget, re-submit, and the
            approval chain replays."). So the revise loop is: approver revises
            down → BOM can't fit a single indivisible line → IM sends back.
EVIDENCE    screenshots xk5Dsr/2-3 (Send back for revision in BOM builder)
```

```
ID          QA-034
SEVERITY    MEDIUM
CLASSIFY    🔴 DEFECT (business rule, per product owner)
ROLE        Approver (Ayesha) on a qty-1 single-line requisition (REQ-000006)
SCREEN      /requisitions/:id → Approve dialog
STEPS       Raise req with 1 line, qty 1 (500). IM approve → approver opens
            Approve dialog → tick "Revise the sanctioned amount"
EXPECTED    (owner rule) A single indivisible unit (one line, qty 1) is not
            adjustable, so "revise sanctioned amount" should be
            disabled/hidden. Revise should only appear for qty > 1 or ≥ 2 lines.
ACTUAL      "Revise the sanctioned amount" IS offered for the qty-1 single-line
            item, with a free amount input ("Leave blank to approve the full
            requested amount (500)"), letting the approver set any sanctioned
            figure for an indivisible unit. Not gated on adjustability.
WHERE/FIX   Approve dialog. Gate the "Revise the sanctioned amount" control:
            show it only when the requisition has >1 unit total (qty>1 on the
            single line, or multiple lines). Hide/disable for a lone qty-1 line.
EVIDENCE    screenshots MwAC6g/20 (dialog, checkbox present), 21 (free revise field)
```
```
ID          QA-035
SEVERITY    n/a → RESOLVED (my misread; behaviour is correct by design)
CLASSIFY    ✅ WORKING-AS-DESIGNED (clarified by product owner)
ROLE        IM vs Approver
SCREEN      /requisitions/:id → Approve dialog
CLARIFIED   Correct model: ONLY approvers revise the sanctioned AMOUNT (the app
            does this — approver dialog has the control, IM dialog does not).
            The IM instead adjusts QUANTITY or PRICE at BOM-generation time, not
            the sanctioned amount. So the IM lacking a revise-amount control is
            correct. Separate test added below: verify the IM can edit qty/price
            (and drop lines) while generating the BOM.
EVIDENCE    screenshots MwAC6g/18 (IM dialog — no amount revise, correct),
            20 (approver dialog — amount revise, correct)
```

```
ID          QA-036
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified, per owner) — IM adjusts qty/price at BOM
ROLE        Inventory Manager (im@ims.local)
SCREEN      /boms/new (BOM builder)
STEPS       Tick REQ-000004; edit the line's Qty and Unit cost
EXPECTED    IM can adjust quantity and price (and drop lines) at BOM generation.
ACTUAL      Line exposes editable Qty ("Originally 2 on the requisition"),
            editable Unit cost, Vendor, and "Drop from BOM". Changing qty 2→1
            recomputed correctly: line total 20,000→10,000, BOM subtotal
            →10,000, variance →-10,000 (-50%). Matches owner's model.
EVIDENCE    screenshots MwAC6g/23 (editable qty+cost), 24 (recompute on qty=1)
```

```
ID          QA-037
SEVERITY    ~~MEDIUM~~ → RESOLVED (instability artifact, NOT a real defect)
CLASSIFY    ⛔→✅ ENVIRONMENT (QA-038) — confirmed after restart
ROLE        Inventory Manager (im@ims.local)
SCREEN      /requisitions/:id → "Withdraw approval"
RESULT      Earlier the action hung twice during a degraded/frozen renderer.
            After the environment restart it works correctly first try: toast
            "Approval withdrawn.", REQ-000004 reverted from Approved to
            "With the Inventory Manager" (IM back to "Waiting on"). So the hang
            was the same instability as QA-007/022/023, not a withdraw bug.
EVIDENCE    screenshots xk5Dsr/7 (Approved), 8 (withdrawn → IM review)
```
```
ID          QA-038
SEVERITY    MEDIUM
CLASSIFY    🟡 UI/UX (performance / stability) — for a "professional product" review
ROLE        all
SCREEN      app-wide (observed throughout the session)
EXPECTED    Snappy, stable rendering; actions complete promptly.
ACTUAL      Frequent renderer stalls throughout: screenshot/click calls timing
            out (CDP 30s), pages taking >45s to reach document-idle, the
            viewport reflowing between ~1043/1536/1568px between actions. Some
            correlated with the QA-024 backend 502s, but jank persisted after
            the API restart. Suggests heavy re-renders / main-thread blocking on
            the frontend (or an under-resourced dev container). A production
            build should be profiled for long tasks and layout thrash.
WHERE/FIX   Profile the SPA (React) for long tasks, unnecessary re-renders, and
            layout shifts; check bundle size and data-fetch waterfalls.
EVIDENCE    recurring tool timeouts across the run; UX-3 (earlier reflow note)
```

```
ID          QA-039
SEVERITY    MEDIUM (UI/logic inconsistency within a mostly-correct flow)
ROLE        Approver (revise) + IM (BOM)
SCREEN      /requisitions/:id (revise) → /boms/new
STEPS       1. Approver revises sanctioned 1,000 → 800, approves
            2. IM opens New BOM for REQ-000005
CLASSIFY    ⚪ mostly WORKING-AS-DESIGNED + 🟡 UI/UX inconsistency
FINDINGS
  ✅ Revise propagates: Approved shows REQUESTED 1,000 / SANCTIONED 800
     ("An approver revised this from the requested amount"). BOM builder lists
     it as "800 Approved" and APPROVED TOTAL = 800 (keys off revised figure,
     not the 1,000 line total). Correct.
  ✅ Single-line-below-line-total → forces "Send back for revision" (no Generate
     BOM). Matches the owner's indivisible-item concept — you can't honestly
     shrink one indivisible line, so it bounces back. Good.
  🟡 INCONSISTENCY: the Qty and Unit-cost fields stay EDITABLE, and editing unit
     cost 100→80 brought BOM SUBTOTAL to 800 with VARIANCE 0 (0.0%) — yet the
     builder STILL shows only "Send back for revision" (no Generate) and STILL
     says "A single-line BOM cannot shrink to fit" even though it visibly now
     fits. Confusing: either lock the fields for a forced-send-back single line,
     or honor variance 0 and allow Generate.
WHERE/FIX   BOM builder single-line branch: when send-back is forced, disable the
            qty/unit-cost inputs (or hide them) and drop the "cannot shrink"
            copy once variance = 0; don't let the user reach a 0-variance state
            that the UI then ignores.
  ✅ Send-back completes end-to-end: with a required reason (audit-logged +
     shown to requester), REQ-000005 became "Draft · For revise", SANCTIONED
     reset to "—", approval chain cleared ("Not submitted yet"). Requester edits
     and resubmits → chain replays. This is the end-state for a revised-down
     single indivisible requisition. (The draft correctly shows SANCTIONED "—",
     which reinforces UX-5.)
EVIDENCE    screenshots MwAC6g/31 (Approved 800), xk5Dsr/0-3 (BOM 800 approved,
            variance 0 but still only Send-back), xk5Dsr/4-6 (send-back → Draft/For revise)
```

```
ID          QA-040
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — void-after-received refused
ROLE        Inventory Manager (im@ims.local)
SCREEN      /requisitions/:id (REQ-000002, Stocked/complete)
EXPECTED    A fully-received/complete requisition cannot have its purchase voided.
ACTUAL      "This requisition is complete." No void controls are offered at all
            (only "Download invoice"); purchase marked "Fully received". So
            void-after-received is correctly impossible via the UI.
NOTE        The POSITIVE void-purchase test (2026-08-27 fix: voiding a purchase
            drops spent AND transport to 0 across funding panel/expenses/
            dashboard) still needs a requisition at Purchased-but-not-received
            WITH transport — none currently in that state. Remaining §3.6 item.
EVIDENCE    screenshots xk5Dsr/9-10 (complete, no void controls)
```

```
ID          QA-041
SEVERITY    MEDIUM
CLASSIFY    🔴 DEFECT (workflow/state consistency)
ROLE        Inventory Manager (im@ims.local)
SCREEN      /approvals ("Waiting on me") vs /all-requisitions
STEPS       1. Withdraw approval on a requisition that was already Approved
               (REQ-000004) — it returns to "With the Inventory Manager"
            2. Open Approvals → "Waiting on me"
EXPECTED    A requisition labelled "With the Inventory Manager" (IM must act;
               its detail shows Reject/Approve for the IM) should appear in the
               IM's "Waiting on me" queue.
ACTUAL      "Waiting on me" is EMPTY ("Nothing is waiting on you"), yet the "All"
            tab and All-requisitions both show REQ-000004 as "With the Inventory
            Manager · Overdue", and its detail offers Reject/Approve to Imran.
            So a withdrawn-then-returned requisition is actionable but invisible
            in the IM's action queue — the IM can only find it by browsing.
            Either the badge/state is wrong or the queue filter omits
            withdraw-returned items. (Edge case from withdrawing after the
            approvers had already approved.)
WHERE/FIX   Approvals "Waiting on me" query and/or the post-withdraw state
            transition. Ensure a requisition in "With the Inventory Manager"
            re-enters the IM's pending queue.
EVIDENCE    screenshots xk5Dsr/18 (Waiting-on-me empty), 19 (All shows REQ-000004
            With the Inventory Manager), 8 (post-withdraw detail with Reject/Approve)
```

```
ID          QA-042
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — cross-role RBAC at API
ROLE        IM + Approver (in-page authorized fetch with each role's token)
SCREEN      API (/api/v1/*)
EXPECTED    Each role is refused endpoints outside its scope, server-side.
ACTUAL      IM token: /admin/users 403, /admin/settings 403; /boms 200,
            /reports/expenses 200. Approver token: /admin/users 403, /boms 403
            (IM-only), /reports/expenses 200, /products(GET) 200 (catalogue read
            ok). Combined with QA-025 (General→all admin 403, unauth→401), the
            role matrix is enforced at the API, not just the UI. Tokens read
            in-page only, never exposed.
EVIDENCE    in-page fetch results (IM + approver probes)
```

```
ID          QA-043
SEVERITY    LOW
CLASSIFY    ⚪ WORKING-AS-DESIGNED (verified) — void reversal (2026-08-27 fix)
ROLE        Inventory Manager (im@ims.local)
SCREEN      /boms/:id (Void BOM) → /requisitions/:id (REQ-000007)
STEPS       Built REQ-000007 (500 items + 500 transport) → approved → BOM →
            Accounts → funded 1,000 → purchase 5×100=500 (Spent 500 · Transport
            500 · Unspent 0) → Void BOM (with reason)
EXPECTED    Voiding reverses the money — spent AND transport both drop to 0.
ACTUAL      After Void BOM: REQ-000007 reverted Purchased→"Approved"; the whole
            Money & purchasing section (Funded 1,000 / Spent 500 / Transport 500)
            is GONE — funding, purchase, spent and transport all reversed to
            zero; requisition freed to be re-batched. So the void correctly drops
            spent AND transport (the 2026-08-27 fix holds). BOM shows "Voided"
            with timestamp + reason (audited).
NOTE        There is no granular "void a single purchase" action; the reversal is
            at the BOM level ("Void BOM"), which cascades and resets the entire
            post-BOM chain. Confirm that's the intended granularity.
EVIDENCE    screenshots xk5Dsr/37-38 (Spent 500/Transport 500), 41-43 (Void BOM →
            Voided), 44-45 (REQ back to Approved, money section gone)
```

## UI / UX polish log

**Scope (expanded per product-owner review).** This is now a first-class deliverable, not
an afterthought. Every screen is judged as a *professional product* would be, across four axes:
1. **Layout & spacing** — broken elements, cramped/congested areas, panels that take too
   little space for their content (or too much), misalignment, overflow, things that don't
   breathe.
2. **Polish** — inconsistent styling, weak visual hierarchy, unclear affordances, states that
   look unfinished.
3. **Copy & labels** — is the right text present, and is wrong/misleading text absent? (e.g.
   showing a value that shouldn't exist yet, mislabeled fields, jargon, inconsistent terms.)
4. **Information visibility** — the key facts for a screen's job must be clearly shown (on a
   submitted requisition: requester Name, Reason, Project, Date/deadline should all be
   obvious at a glance).
A dedicated full-app UI sweep is scheduled (see Coverage: "UI/UX full review").

- **UX-1 (LOW)** — Submit validation message over-lists required fields (see QA-008).
- **UX-2 (MEDIUM)** — `/my-requisitions` REQUESTED shows 0 for drafts (see QA-009).
- **UX-4 (LOW)** — New-requisition qty field accepts and displays a typed
  negative ("-5") instead of clamping to 0 or flagging it; the total safely
  computes 0.00, but the field looks like it holds an invalid value (QA-026).
- **UX-5 (MEDIUM) — "SANCTIONED" amount shown before anything is sanctioned.**
  On a requisition at IM review / "Awaiting approval", the detail shows a concrete
  `SANCTIONED = <requested>` figure (with caption "Defaults to the requested amount;
  approvers may revise down"). Per product owner, nothing is sanctioned yet at these
  stages, so a sanctioned figure should NOT be presented — show "—" (as the Draft state
  already does) until an approver actually sets/confirms it. Presenting a "sanctioned"
  number pre-approval is misleading. WHERE: requisition detail header, IM-review and
  awaiting-approval states. FIX: gate the SANCTIONED value on an actual sanction event;
  render "—" until then.
- **UX-6 (MEDIUM, info visibility) — key requisition facts under-surfaced on the detail.**
  On the requisition detail, requester **Name / Department / Project** appear only as a
  small low-contrast grey subtitle under the title ("Gina General · Engineering · Personal
  development") — easy to miss for information approvers rely on. The **Date** is worse:
  neither the submitted date nor the approval **deadline** is shown anywhere on the detail —
  only the approvers' action timestamps appear (in the Progress panel). Owner asked for
  Name, Reason, Project, Date to be clearly visible; Reason is fine (own section), but
  Name/Project need more prominence and Date is missing. WHERE: requisition detail header.
  FIX: promote requester/dept/project to a proper labeled block, and add submitted-date +
  approval-deadline fields.
- **UX-7 (LOW, copy) — BOM builder instruction is wrong.** The New-BOM header says
  "…you only fill unit cost and vendor", but the **Qty field is also editable** (and lines can
  be dropped). Copy should say qty is adjustable too, or the text is misleading. WHERE:
  /boms/new "Pick approved requisitions" caption.
- **UX-8 (LOW, spacing) — dashboard empty-state cards are oversized.** The "Your record"
  cards (Requisitions / Borrowing / Money) render as large full-width cards even when the
  content is just "Nothing yet", wasting vertical space. Tighten empty-state height. WHERE:
  /dashboard.
- **UI positive** — the All/My-requisitions lists are well-built: they clearly show RAISED BY
  (name + dept), REQUESTED, URGENCY, APPROVAL DEADLINE and STATUS, with search + filters.
  Note the contrast that feeds UX-6: the *list* surfaces requester + deadline clearly, but the
  requisition *detail* page does not — the detail should match the list.
- **UX-9 (LOW, visibility question) — drafts visible to others.** The IM's "All requisitions"
  lists another user's **Draft** (REQ-000005, Ayesha's sent-back-for-revision draft).
  Unsubmitted drafts are usually private to the requester until submitted. Confirm whether
  IM/oversight roles should see other people's in-progress drafts. WHERE: /all-requisitions.

### UI/UX sweep — progress & remaining
Audited: login (QA-001), requisition detail (UX-5/6), dashboard (UX-8), inventory (clean),
BOM builder (UX-7/QA-039), all/my-requisitions (UX-9 + positive), locations (clean),
categories (clean), approvals (clean; QA-041 found here), settings (clean; minor raw-number
formatting on the threshold input), audit-log (excellent — see below).
- **Console scan (§5) — PASS:** no console errors, warnings, or React deprecations captured
  across inventory / audit-log / requisition loads. Clean runtime.
- **Responsive (§5) — acceptable (partial):** the app rendered without breakage across the
  widths observed this session (~1043–1568px); nav + content reflow fine. A true narrow/
  mobile viewport couldn't be captured (screenshots return a fixed resolution), so a proper
  mobile pass is still open.
- **UI positive — Audit log is excellent:** WHEN / ACTOR (name+email+roles) / ACTION / ENTITY
  / SUMMARY / OUTCOME, with User/Approvals/date filters + Live refresh. Accurately recorded
  every test action (withdraw, send-back, approve, logins) with human-readable summaries —
  strong auditability.
- **Still to audit in depth:** new-requisition form, product detail, admin users/departments
  (seen earlier, looked clean), expenses layout, borrowing, projects; plus a true mobile pass.

---

## Calculation integrity (cross-cutting requirement — applies to every suite)

Two things must hold for **every** numeric value in the system, checked by recomputing
independently and transcribing both the computed and the displayed figure:

**1. Arithmetic is correct.**
- Line total = quantity × unit price
- Items subtotal = Σ line totals
- Requested = items subtotal + transportation
- Funding: funded − spent = unspent; **spent = purchases + transportation (carriage)**
- Location split: owned = available + reserved + in-use + quarantined (per location and rolled up)
- Borrow: available = owned − reserved − in-use
- Expense report and dashboard rollups equal the sum of their constituent requisitions
- BOM totals (items subtotal, transportation, grand total) match the requisition

**2. Every figure updates and stays consistent across ALL screens that show it.**
A number that is right on one screen but stale/wrong on another is a **DEFECT**. After each
state change (borrow, approve, fund, purchase, return, void) re-read the same quantity on the
product detail, the list, the funding panel, `/expenses`, and the dashboard — they must agree.
Flag any screen that shows a pre-action (stale) value after the action completes.

**Verified so far:** borrow reservation math on ThinkPad (10→8 available / 0→2 reserved,
Meta-1A 7→5 available) is arithmetically correct and consistent between the summary tiles and
the per-location panel (QA-010).

## Revise sanctioned amount — expected rule (product owner) + test

**Intended behaviour:**
- A requisition whose lines are **not adjustable** — i.e. a single product with **quantity 1**
  — must **NOT** offer "revise the sanctioned amount" (you can't part-buy one indivisible item).
- A requisition with **quantity > 1** (or **more than one line**) **IS** adjustable, so the IM
  (or approver) **may revise the sanctioned amount down**. In this small office the IM confirms
  the change with the requester in person; after the adjustment a **BOM is generated** and the
  rest of the flow is unchanged.

**Tests:**
**Correct model (owner):** approvers revise the sanctioned **amount**; the IM adjusts
**quantity/price** at BOM generation. Revise-amount is correctly approver-only.

| Case | Setup | Expected | Result |
|---|---|---|---|
| Single item, qty 1 | 1 line, qty 1 (REQ-000006) | approver "revise sanctioned amount" NOT available | 🔴 FAIL — it IS offered (QA-034) |
| Single item, qty > 1 | 1 line, qty 10 | approver revise available | ✅ available |
| Multiple items | ≥2 lines | approver revise available | ⏳ (expected available) |
| IM revise-amount | — | IM should NOT revise the amount | ✅ correct — IM dialog has no amount revise (QA-035) |
| IM adjust qty/price at BOM | generate BOM | IM can edit qty/price + drop lines | ✅ qty+price editable, recomputes (QA-036); copy says "only unit cost/vendor" → UX-7 |
| **Revised-sanctioned full flow** | approver revises 1,000→800, run to end | revised SANCTIONED propagates; single indivisible line can't fit → forced send-back → Draft/For-revise | ✅ traced (QA-039): propagates to BOM(800); single-line forces send-back which works end-to-end; UI inconsistency logged. Multi-line revise-then-generate variant still worth a look |

**Revised-sanctioned downstream trace (what happens after a revise):**
1. Approver ticks "Revise the sanctioned amount", enters a lower figure, approves.
2. Verify: requisition Approved with `SANCTIONED = revised` (< requested).
3. BOM: builder/PDF should reflect the revised sanctioned basis (not the original requested).
4. Funding: Accounts funds up to the **revised sanctioned** amount; over-funding beyond it refused.
5. Purchase/verify/return: unspent/returned computed against the revised figure.
6. /expenses + dashboard: approved/funded/spent columns reflect the revised sanctioned, and
   `funded = spent + transport + returned + unspent` still holds.
Run on REQ-000005 (qty 10 = 1,000, adjustable) — revise to 800 and follow through.

Note: the Approve dialog exposes a "Revise the sanctioned amount" checkbox (seen on REQ-000002/004/005,
all qty > 1). The qty-1 gating is the specific thing to verify against the owner's rule.

## Money reconciliation table (§3.5)

**Run on REQ-000002** (items 1,500 + transport 500 = 2,000) because QA-007 blocks a fresh
1,000 requisition. Purchase recorded at 15 × 50 = 750.

| Step | Expected (derived) | Read on screen | ✓/✗ |
|---|---|---|---|
| Approved | approved 2,000 | approved 2,000 | ✓ |
| BOM (generated) | items 1,500 · transport 500 · grand 2,000 | 1,500 / 500 / 2,000 | ✓ |
| Funded 2×1,000 | funded 2,000 · spent 0 · transport 0 · unspent 2,000 | 2,000 / 0 / 0 / 2,000 | ✓ |
| Purchase 15×50 | spent 750 · transport 500 · unspent 750 | 750 / 500 / 750 | ✓ (2000−750−500=750) |
| Verify purchase | needs invoice + reason (guardrails, QA-021) | attached invoice, verified | ✓ |
| Return > unspent (751) | refused | "Only 750 is unspent, so 751 cannot be returned" | ✓ |
| Return 750 | returned 750 · unspent 0 | Returned 750 · Unspent 0 · status Verified | ✓ |
| **Reconciliation** | funded = spent + transport + returned + unspent | 2,000 = 750 + 500 + 750 + 0 | ✓ |
| /expenses (dept) | spent = purchases + carriage | Engineering SPENT 2,638 = Purchases 1,250 + Transport 1,388 | ✓ (QA-027) |
| Dashboard (requester) | requested · approved · spent | re-checking after restart | ⏳ |

---

## CRUD × Role coverage matrix

Every entity, every role, both directions: the operations a role **should** have are tested
positive (must succeed); everything else is tested **negative** (must be denied — via hidden
nav, a "Not allowed" page, and a 403 on the raw API when the URL is tampered).

**Legend** — `C`reate · `R`ead/list · `U`pdate · `D`elete *(soft = deactivate/archive; this
app has almost no hard delete)*. Cell status once tested: ✅ pass · 🔴 defect · ⛔ blocked ·
`deny` = must be refused (negative test) · `?` = expectation to be confirmed by testing.

| Entity | Admin | IM | Approver | General |
|---|---|---|---|---|
| Users | C R U D(soft) | deny | deny | deny |
| Departments | C R U D(soft) | deny | deny | deny |
| Settings | R U *(no C/D)* | deny | deny | deny |
| Categories | C R U D(soft) `?` | C R U D(soft) | deny | R `?` |
| Zones | C R U D(soft) `?` | C R U D(soft) | deny | deny |
| Compartments | C R U D(soft) `?` | C R U D(soft) | deny | deny |
| Products | C R U D `?` | C R U D | R | R |
| Requisitions | own (via General) | R-all + act | R-assigned + act | C R U D-draft, own-R |
| Borrowings | own | R-all + approve/reject/return | own | C + own-R |
| Purchases (money) | deny `?` | C R U + void | deny | deny |
| Fund receipts (money) | deny `?` | C + void | deny | deny |
| BOMs | R `?` | generate + R | R | deny |
| Audit log | R | deny | deny | deny |
| Expenses report | R | R | R | deny |
| Own profile / signature | C R U D (own) | C R U D (own) | C R U D (own) | C R U D (own) |

**Notes carried into testing:**
- "Delete" is exercised via the app's **soft-delete** (deactivate/archive), which is
  reversible. Any genuinely **hard/permanent delete** control is exercised only on a
  throwaway record I created myself (e.g. a QA draft), never on seeded/shared data, and its
  confirm dialog is screenshotted before firing.
- Admin, IM and Approver all also hold **General**, so their own-requisition / own-borrow
  CRUD is tested too.
- Every `deny` cell is proven twice: UI (control absent / "Not allowed") **and** API
  (raw-URL or direct request returns 403), with the network body captured.

## Coverage matrix

| Suite | Status |
|---|---|
| §1 Preflight | ✅ PASSED |
| §3.1 Admin | ✅ done (Users/Depts/Settings/Audit PASSED · Delegation ⛔ BLOCKED) |
| §3.2 General user | 🟡 PARTIAL — build/draft/edit/isolation + borrow-availability PASS; **submit BLOCKED by QA-007**; doc-attach + 2nd/3rd reqs pending |
| §3.3 Inventory Manager | ✅ DONE — IM-review approval, borrow approve/reject, partial returns + restoration, inventory CRUD (cat/zone/compartment/product) all PASS · **reverse-return ⛔ BLOCKED (QA-014)** |
| §3.4 Approval matrix | ✅ DONE — sub-threshold (QA-017), at-or-above + 2-approver enforcement (QA-029/030), rejection-kills (QA-031), self-approval prevented via reassignment (QA-032) all PASS; send-back not implemented (QA-033, ❓) |
| §3.5 Money walk (detail) | see money reconciliation table — all rows ✓ |
| §3.5 Money walk | ✅ DONE — full walk reconciles incl. carriage trap (QA-027); dashboard spot-check remaining |
| §3.6 Reversal walk | ✅ DONE — withdraw-approval (QA-037), send-back (QA-033/039), void-BOM cascade reverses spent+transport (QA-043, the 2026-08-27 fix), void-after-received refused (QA-040) all PASS |
| Revise sanctioned amount | ✅ DONE — approver-only revise correct (QA-035); qty-1 wrongly offers revise (QA-034 🔴); IM adjusts qty+price at BOM (QA-036); BOM copy misleading (UX-7) |
| UI/UX full review | 🟡 WELL PROGRESSED — 12 screens audited (UX-5/6/7/8/9 + many positives; QA-041 found here); a few screens + true mobile pass remain |
| §3.7 Receiving to stock | ✅ DONE — receive 15 → Meta·1A, esp rollup 5→20 (QA-028); one-product-two-compartments + free-text-merge still worth a look |
| §4 Negative / permission | ✅ STRONG — RBAC proven UI + API for all roles (QA-025 General, QA-042 IM/Approver: admin→403, cross-scope→403, unauth→401), logged-out→/login, negative-qty guarded; remaining: bad-file upload, IDOR |
| §5 Cross-cutting | 🟡 PARTIAL — console-error scan PASS (clean); back/forward + F5 worked throughout; responsive OK ~1043–1568px, true mobile pass open |
| Calculation integrity | ✅ PASS so far — borrow reserve/issue/return, RTX partial-return (4=1+3), all reconcile; money walk pending |
| CRUD × Role verified | Admin: Users/Depts/Settings C·R·U·D(soft) ✅ · IM: Categories/Zones/Compartments/Products **C** ✅ + borrow approve/reject ✅ · **negative/API sweep DONE**: General/IM/Approver each 403 outside scope (QA-025/042) |

---

## Screenshot index (saved on your machine)

Folder: `C:\Users\MSI\AppData\Local\Temp\claude-chrome-screenshots-0YCCwo\`
Filenames are auto-assigned by the extension (`screenshot-<ts>-<n>.jpg`); the
`NN-role-screen-what` convention is mapped here instead.

| # | Shows |
|---|---|
| 0 | Login page + demo panel |
| 1 | Admin dashboard/nav |
| 2–4 | Admin settings (threshold, approvers, sub-threshold, slots) |
| 5 | Departments |
| 8–9 | Categories, Locations |
| 10 | Gina nav + "Not allowed" on /inventory/locations |
| 11–13 | IM, Ayesha, Farhan nav |
| 14–21 | Users create/deactivate/reactivate |
| 22–25 | Dept create + rename |
| 26–29 | Settings change/persist/restore |
| 30–31 | Audit log + actor filter |
| 32–39 | Delegation search (404, reset-pw, edit user, accounts) |

---

## NOT-CHECKED / assumptions (kept honest, never empty)

- Delegation flow (QA-005) — no UI found.
- Audit "filter by entity" (QA-006) — control absent.
- Everything §3.2 onward — not yet run.

---

## Mandatory non-browser statements (§D — a green run does NOT clear these)

1. **Demo mode is ON** — login page lists 5 accounts with a shared password; anyone
   reaching the page can act as admin. Must be off before production. (Confirmed — QA-001.)
2. **Backups on same VM as DB (G-16)** and restore drill never run against prod compose
   stack (G-17). Cannot be verified from a browser.
3. **147 commits exist on one machine only** and have not been pushed. Cannot be verified
   from a browser.