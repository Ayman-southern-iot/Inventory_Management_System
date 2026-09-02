# IMS — MVP readiness

A single end-to-end pass over every workflow the business runs on a normal day, plus the launch
blockers. Run 2026-09-02 against the Docker stack.

---

## Verdict

**The software is ready. The deployment is not.**

Every workflow works end to end — 28 of 28 checks, no failures, no workarounds. But the running
instance has **two hard blockers** that have nothing to do with the code, and one of them means
the system currently has no authentication at all.

Do §1 and §2 below, and it can launch today.

---

## 1. HARD BLOCKER — demo mode is on in production

```
$ docker compose exec api sh -c 'echo $DEMO_ACCOUNTS_ENABLED; echo $NODE_ENV'
true
production

$ curl -s http://localhost:5173/api/v1/auth/demo-accounts
{"password":"demo","accounts":[{"email":"approver1@ims.local", ... }
```

**That `curl` carried no authentication.** The endpoint hands anyone who can reach the login page
every account's email address and the shared password — including `admin@ims.local`. Whoever opens
the page can act as System Administrator: approve their own requisitions, change the expense
threshold, reset anyone's password.

Until this is off, there is effectively no authentication.

**Fix — two minutes:**

```bash
# .env
DEMO_ACCOUNTS_ENABLED=false

docker compose up -d --force-recreate api
curl -s http://<host>:5173/api/v1/auth/demo-accounts   # must NOT list accounts
```

Then **reset the password on all five seeded accounts** (Admin → Users → Reset password). The demo
password was known to everyone who has seen the login page.

## 2. HARD BLOCKER — the work exists on one machine

158 commits ahead of `main`, never pushed. Every requirement round, every fix and this entire
build live on one laptop. A disk failure loses all of it.

```bash
git push origin <branch>
```

Push before launch, not after.

## 3. Before the first real requisition

A fresh install accepts nothing until an admin sets all four — the seed creates none of them, and
submit fails naming the one that is missing:

- Sub-threshold approver · Approver 1 · Approver 2 (Admin → Settings)
- At least one user holding **Inventory Manager**
- At least one **department**

Also confirm the **expense threshold** (seeded 15,000 BDT). The approver count is frozen onto each
requisition at submit, so changing it later does not correct anything already in flight.

## 4. Backups are not running

`pg_dump` on a schedule, written somewhere other than this machine. Until that exists the database
has the same single point of failure as the repository. Not a blocker for day one, but do not let
a week pass.

---

## What was verified — 28 / 28

### The full requisition lifecycle

| | Check | Result |
|---|---|---|
| MVP-01 | A general user raises a requisition | ✅ |
| MVP-02 | Submitting resolves the approval chain | ✅ 3 approvals, → IM review |
| MVP-03 | The number carries the requester | ✅ `REQ-000026-GINA` |
| MVP-04 | The IM reviews first | ✅ → Awaiting approval |
| MVP-05 | Two approvers carry it to APPROVED | ✅ |
| MVP-06 | An approver can cut the amount and it sticks | ✅ 18,000 of 22,000 requested |

### The BOM, gated on the approved amount

| | Check | Result |
|---|---|---|
| MVP-07 | A BOM over the approved amount is refused | ✅ `BOM_EXCEEDS_APPROVED_AMOUNT` |
| MVP-08 | One that fits is accepted | ✅ 14,000 + 2,000 + 2,000 carriage = 18,000 exactly |
| MVP-09 | The BOM number carries the requester | ✅ `BOM-000018-GINA` |
| MVP-10 | The PDF renders | ✅ |

### The money

| | Check | Result |
|---|---|---|
| MVP-11 | Sent to Accounts | ✅ |
| MVP-12 | An instalment is refused this release | ✅ `PARTIAL_FUNDING_DISABLED` |
| MVP-13 | The full amount is accepted | ✅ |
| MVP-14 | The purchase is recorded | ✅ |
| MVP-15 | **The money reconciles exactly** | ✅ 16,000 + 2,000 carriage = 18,000, unspent **0** |
| MVP-16 | The purchase is verified | ✅ |
| MVP-17 | Goods reach the shelf and it closes | ✅ → STOCKED, laptops 10 → 12 |

### Inventory: borrow and return

| | Check | Result |
|---|---|---|
| MVP-18 | A request **reserves**, does not issue | ✅ reserved 0 → 2, on-hand unchanged |
| MVP-19 | The IM approves and issues | ✅ |
| MVP-20 | A good return goes back on the shelf | ✅ available 10 → 11 |
| MVP-21 | **A damaged return is quarantined, not shelved** | ✅ quarantined 0 → 1, available unchanged |
| MVP-22 | The borrow closes when everything is back | ✅ → RETURNED |
| MVP-23 | Quarantined stock can be released after repair | ✅ available 11 → 12 |

MVP-21 is the one that protects the shelf: broken kit does not silently become available again.

### Reporting

| | Check | Result |
|---|---|---|
| MVP-24 | The expenses report reconciles | ✅ 84,000 + 8,000 = 92,000 |
| MVP-25 | The trend returns twelve months with real zeros | ✅ Oct 2025 – Sep 2026 |
| MVP-26 | Top items sum to the Items figure | ✅ 84,000 vs 84,000 |
| MVP-27 | The requester dashboard renders their own record | ✅ |
| MVP-28 | The CSV export is served | ✅ |

### Confirmed in the browser too

The inventory register shows LAP-0001 at 12 owned / 12 available — the same figures the API run
produced. The product page's movement history labels each return by condition ("Damaged", "Good"),
so an IM can see what came back in what state without reading the database.

---

## Gate

- `pnpm typecheck` — clean
- `pnpm lint` — 20 errors, unchanged from the long-standing baseline
- `pnpm test` — 13 / 83 / 302, all passing
- `guard-hardcoding --scan-all` — 8, baseline
- Integration suite — 49 files, 677 passing, 0 failing, 8 skipped (all G-20, documented)

---

## Known and accepted for launch

None of these stops a launch; all are recorded.

- **17 findings** in `IMS-Happy-Path-Test.md`, all cosmetic or feedback-level. The one worth doing
  soon is **F-5**: every BOM signature prints "for <their own name>" — an on-behalf-of line where
  nobody acted on anyone's behalf, on the document that goes to Accounts.
- **Partial funding is off** (`ALLOW_PARTIAL_FUNDING`). Accounts must release the whole approved
  amount in one payment. Deliberate for this release.
- **8 integration tests are skipped** (G-20), all of which set up with instalments. They come back
  with a `CONFIG` override on `createTestApp()`.
- **File upload and signatures remain the largest untested surface** — supporting documents,
  invoices, and approve-with-signature. Everything else in the critical set has now been run.
