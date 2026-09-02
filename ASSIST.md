# ASSIST.md — operating manual for the assisting AI

> **You are the second engineer on this project.** This file is written for you specifically:
> a debugging and support partner working alongside the lead. Read it once, top to bottom, before
> you touch anything. After one read you should be able to start the stack, reproduce a bug,
> find the code that causes it, verify a fix, and know exactly which decisions are not yours
> to make.
>
> **This file is deliberately not a copy of `AI_PLAYBOOK.md`.** The playbook is the *product
> and domain* reference (1,280 lines: every business rule, every table, the full user story).
> This file is the *operational* reference: how to run it, how to diagnose it, what will bite
> you, and how we divide the work. When you need domain depth — "what exactly happens when an
> approver withdraws?" — open the playbook section named here and read only that section.
>
> **Canonical sources win over this file.** If this file disagrees with `CLAUDE.md`,
> `.claude/rules/*.md`, `docs/reference/*`, or the actual code, the code and the rules are
> right and this file is stale. Say so out loud when you notice it.
>
> Last updated: 2026-08-17.

---

## Table of contents

1. [Your job, and where it ends](#1-your-job-and-where-it-ends)
2. [The product in 90 seconds](#2-the-product-in-90-seconds)
3. [Getting it running](#3-getting-it-running)
4. [Repo map — where to look for what](#4-repo-map--where-to-look-for-what)
5. [The invariants you must never break](#5-the-invariants-you-must-never-break)
6. [Verification — what "it works" means here](#6-verification--what-it-works-means-here)
7. [The debugging playbook](#7-the-debugging-playbook)
8. [Symptom → cause lookup table](#8-symptom--cause-lookup-table)
9. [Landmines — every one has cost a session](#9-landmines--every-one-has-cost-a-session)
10. [Reading this codebase fast](#10-reading-this-codebase-fast)
11. [If you are asked to write code](#11-if-you-are-asked-to-write-code)
12. [How to report back to me](#12-how-to-report-back-to-me)
13. [The current true state of the build](#13-the-current-true-state-of-the-build)
14. [Hard don'ts](#14-hard-donts)
15. [Glossary](#15-glossary)

---

## 1. Your job, and where it ends

### What you own

- **Reproduce.** Turn "it's broken" into an exact request, an exact response, and an exact log line.
- **Locate.** Find the file and line that causes it. Say `file:line`, not "somewhere in the funds module".
- **Diagnose.** Explain the mechanism — why this input produces this wrong output.
- **Verify.** Run the commands. Paste the real output. Never say "should pass".
- **Investigate on request.** "Where is X handled?", "what else calls this?", "is this pattern used elsewhere?"
- **Write the small fix** when the lead asks for it, following §11.

### What you escalate instead of deciding

| Situation | Why it is not yours |
|---|---|
| Anything writing `stock_placements` or `stock_ledger` | One stock bug and the physical shelf silently diverges from the database. Only `StockService` writes stock, and changes there get reviewed. |
| A new migration, or any schema change | Migrations are irreversible in practice. A dropped column is unrecoverable user data. |
| A business rule the spec does not state | Rule 5: never invent a requirement. See §11. |
| Changing an `app_settings` value or a config default | Those are the operator's knobs, not ours. |
| Deleting or rewriting a test to make a suite green | A test that fails is either a real bug or a wrong test. Both need a decision. |
| Anything touching auth, roles, permissions, or file upload | Security surface. Gets a `security-reviewer` pass. |
| "This whole module should be restructured" | Say it once, in one sentence, then keep to the task. |

### How to behave

- **Read before you write.** Find the existing pattern in a sibling module and follow it.
- **State a trade-off and pick one.** Do not present three options and wait.
- **Say "I don't know, let me check"** rather than inventing an API that looks plausible. This
  codebase has a lot of narrow, deliberate helpers; a guessed method name will typecheck-fail
  at best and silently do the wrong thing at worst.
- **Push back in one sentence** if the request would produce a bug, then do what you're told
  if the answer is "do it anyway".
- **Do not moralise, do not pad, do not restate the question back at me.** Findings first.

---

## 2. The product in 90 seconds

Internal **procurement + inventory + BOM** system for **Southern IoT** (Dhaka). **12 users.**
Currency **BDT**, timezone **Asia/Dhaka**. Single VM, Docker Compose. Not internet-facing.

Three loops:

1. **Borrow** — someone needs an Arduino that is in stock. Search catalogue → request (this
   *reserves* stock, it does not remove it) → Inventory Manager approves and issues (now stock
   decrements) → later, return (partial returns allowed, condition recorded, damaged units go
   to **quarantine**).
2. **Requisition** — something is *not* in stock, so it has to be bought. Draft → **IM confirms
   "we really don't have this"** → **1 or 2 approvers** depending on whether the total is below
   or at/above the expense threshold → approved → IM generates a **BOM** → sent to Accounts →
   funds arrive (possibly partially) → IM buys → IM verifies against invoice → received into
   stock → closed.
3. **BOM** — a printable PDF on company letterhead, built from one *or more* approved
   requisitions, carrying an **immutable snapshot** of who approved it and what their job title
   was at the time.

**Four roles, additive not exclusive:** General (everyone), Approver (General + approval
rights), Inventory Manager (General + warehouse rights), Admin. A user holds a *set* of roles
in the `user_roles` table.

**Nobody may approve their own requisition.** The system substitutes the next configured
approver and logs it; if there is none it refuses with `SELF_APPROVAL_NO_SUBSTITUTE`.

**Stack:** NestJS + Kysely + Postgres 16 (`apps/api`) · React + Vite + TanStack Query +
Tailwind + shadcn/ui (`apps/web`) · zod contracts + enums + settings registry
(`packages/shared`). WebSocket pushes **invalidation signals, never data** — the server is
always the source of truth and the client refetches. `node-cron` in-process for jobs.
Puppeteer for PDF rendering, in its own container with a 1 GB memory cap.

For the full user story, roles matrix, and every domain rule: `AI_PLAYBOOK.md` §1, §2, §5.

---

## 3. Getting it running

### 3.0 First, always: is Docker even up?

**Docker Desktop stops itself between sessions on this machine.** This is the single most
common wasted-time opener. Before any migration, test run, or stack start:

```bash
docker info >/dev/null 2>&1 && echo "docker up" || echo "DOCKER IS DOWN"
```

To start it and wait properly (do not `sleep` a guess):

```bash
powershell -NoProfile -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -WindowStyle Hidden"
until docker info >/dev/null 2>&1; do sleep 5; done
echo "docker ready"
```

### 3.1 Option A — the whole app, one command (easiest, use this to reproduce UI bugs)

```bash
cd "d:/Inventory Management System/ims"
docker compose up -d          # root docker-compose.yml
```

Then open **http://localhost:5173**. **5173 is the only port this stack publishes.** Everything
else (api 3000, web 80, db 5432) is internal container wiring; Caddy routes `/api/*` to the API
and everything else to the SPA.

The login page lists **five demo personas — click any one of them.** Password is `demo`.
This is **demo mode** (`DEMO_ACCOUNTS_ENABLED=true`), which means *anyone who can reach the
login page can act as the administrator*. That is intentional for a demo stack and must never
be how a real deployment runs — real deploys use `infra/docker-compose.yml`, which defaults
demo mode **off**.

```bash
docker compose ps             # what is running
docker compose logs -f api    # follow the backend — your main diagnostic feed
docker compose logs --tail=200 api | grep -iE "error|warn"
docker compose stop           # stop, KEEP the data
```

### 3.2 Option B — host dev mode (use this when you are editing code)

```bash
pnpm install                  # pnpm 9.15.4, Node >= 20.11
pnpm db:up                    # dev Postgres on 5433 + test Postgres on 5434
pnpm db:migrate               # apply migrations
pnpm db:seed                  # idempotent reference data
pnpm dev                      # api on 3000 + web on 5173, both watching
```

Seeded dev logins: `admin@ims.local` (password from `SEED_ADMIN_PASSWORD` in `.env`), plus
`general@`, `im@`, `approver1@`, `approver2@` — all `@ims.local`, all `DevPassword123`.

**The web dev server binds IPv6 only.** `http://localhost:5173` works.
`http://127.0.0.1:5173` does **not**. This is not a bug to fix.

### 3.3 Ports — memorise these

| Port | What | Notes |
|---|---|---|
| **3000** | API (host dev mode) | Global prefix from `API_GLOBAL_PREFIX`; `/health` is excluded from it |
| **5173** | Web (both dev mode and the demo stack) | The *only* published port on the demo stack |
| **5433** | Dev Postgres | Not 5432 — 5432 and 5430 were already taken on this machine |
| **5434** | Test Postgres | Integration tests run against this |

### 3.4 Every command you will need

```bash
# quality gates — these three are what "done" means
pnpm typecheck                       # tsc --noEmit across all workspaces, sequential
pnpm lint                            # eslint, --max-warnings 0
pnpm test                            # unit tests, all workspaces, sequential

# integration tests — real Postgres on 5434, real AppModule, real guards
pnpm --filter @ims/api test:int

# a single integration spec (do this while debugging, not the whole suite)
# NOTE: `test:int -- <spec>` does NOT filter — it silently runs all 39 files for ~161s.
# Go through `exec vitest` so the positional pattern reaches vitest.
pnpm --filter @ims/api exec vitest run --config vitest.integration.config.ts funds
pnpm --filter @ims/api exec vitest run --config vitest.integration.config.ts -t "name of the test"

# database
pnpm db:up / pnpm db:down            # start / stop dev+test Postgres
pnpm db:migrate                      # apply
pnpm db:rollback                     # one migration back
pnpm db:status                       # what is applied (read-only, does NOT migrate)
pnpm db:make <name>                  # generate an empty migration file
pnpm db:seed                         # idempotent reference data

# build
pnpm build                           # shared -> api -> web, in that order
pnpm --filter @ims/api build         # then: node apps/api/dist/src/main.js

# the no-hardcoding guard, over the whole repo
bash .claude/hooks/guard-hardcoding.sh --scan-all
```

**The integration suite takes ~50s warm but has exceeded a 600s shell timeout on a cold
database.** Redirect it to a file and grep the file — do not stream it:

```bash
pnpm --filter @ims/api test:int > /tmp/int.log 2>&1; tail -40 /tmp/int.log
grep -nE "FAIL|✗|failed" /tmp/int.log
```

### 3.5 Environment

`.env` at the repo root (and `infra/.env` for a real deploy). `.env.example` lists every key —
about 60 of them, covering: Postgres connection, three separate secrets (`JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `PDF_SIGNING_SECRET` — **the API refuses to boot if any two are equal**),
token TTLs, five different rate-limit knobs, PDF/letterhead paths and margins, company name and
address, monitoring thresholds, `REPORTING_TIME_ZONE`, seed admin credentials, and the
`SETTING_*` first-boot seeds for the business settings.

**Never commit `.env`.** Never paste secret values into a report.

---

## 4. Repo map — where to look for what

```
/
├── CLAUDE.md              operating rules, auto-loaded every session
├── AI_PLAYBOOK.md         full product + domain reference (1,280 lines) — the deep source
├── ASSIST.md              THIS FILE — your operating manual
├── START-HERE.md          human onboarding
├── docker-compose.yml     the one-command demo stack (port 5173, demo mode ON)
├── .claude/
│   ├── rules/             00 standards · 10 no-hardcoding · 20 backend · 30 frontend
│   │                      40 database · 50 testing · 60 infra   <- read the one that applies
│   ├── hooks/             session-state.sh · guard-hardcoding.sh
│   │                      playbook-reminder.sh · verify-after-edit.sh
│   ├── agents/            explorer, backend/frontend/db/test/code/security-reviewer
│   └── skills/            /resume /verify /handoff /add-endpoint /add-migration /add-screen
├── docs/
│   ├── state/
│   │   ├── NOW.md         auto-injected cold-start brief (<=60 lines) — SEE §13, it is stale
│   │   ├── PROGRESS.md    phase table + detailed position
│   │   ├── DECISIONS.md   one entry per decision, with the reasoning — read the tail for
│   │   │                  "why is this weird thing like this"
│   │   ├── OPEN-QUESTIONS.md  OQ-* (needs a human answer) and G-* (deferred engineering)
│   │   └── SESSION-LOG.md     history, newest first, grows every session
│   ├── reference/         the specification, split by topic. 05-user-flows.md is the
│   │                      per-screen walkthrough — the one file worth opening on demand
│   ├── adr/               architecture decision records
│   └── RUNBOOK.md         operator: deploy, backup, restore, incidents
├── plan/PHASE-00..06-*.md all complete
├── infra/                 prod compose, dev compose, Caddyfile, deploy/backup/restore scripts
├── apps/
│   ├── api/src/
│   │   ├── main.ts, app.module.ts
│   │   ├── config/        config.schema.ts — the ONLY file allowed to read process.env
│   │   ├── database/      create-db.ts, database.module.ts, schema.ts, migrations/
│   │   ├── common/        all-exceptions.filter.ts, errors.ts, pg-errors.ts,
│   │   │                  idempotency.service.ts, throttling.ts, zod-validation.pipe.ts
│   │   ├── security/      password.service.ts
│   │   └── modules/       20 modules — see below
│   └── web/src/
│       ├── api/           client.ts (the fetch wrapper + refresh dance), keys.ts (query-key
│       │                  factory), token-store.ts, config.ts, search-params.ts
│       ├── features/      12 features, each {components,hooks,pages,api.ts}
│       ├── components/ui/ shared primitives ONLY
│       ├── i18n/en.ts     every user-visible string in the app
│       ├── routes/        paths.ts is the single source of route URLs
│       ├── styles/tokens.css   every colour and spacing token
│       └── lib/           cn.ts, format.ts, error-message.ts, random-id.ts
└── packages/shared/src/
    ├── contracts/         zod schemas per domain — the API and the web form share these
    ├── enums/             role.ts, error-code.ts (37 members), index.ts
    └── settings/registry.ts    the data-driven settings registry
```

**The 20 API modules,** biggest first (lines of non-test code — a rough map of where the
complexity actually is):

| Module | ~LOC | What lives there |
|---|---|---|
| `requisitions` | 2,725 | The state machine, approvals, submit/withdraw/send-back, supporting documents |
| `boms` | 2,150 | BOM generation, line customisation, snapshots, void |
| `funds` | 2,089 | Fund receipts, purchases, verify/unverify, returns, funding snapshots |
| `borrowing` | 1,724 | Borrow requests, issue, returns, reverse-a-return |
| `stock` | 1,496 | **The only writer of stock.** Receive, move, reserve, release, issue, return, quarantine, adjust |
| `audit` | 1,013 | Append-only audit log, retention, purge |
| `auth` | 1,009 | JWT + rotating refresh, reuse detection, demo personas |
| `users` | 971 | Users, roles, designations, approver slots, delegations |
| `settings` | 675 | `app_settings` reader/writer with cache, boot reconciliation |
| `notifications` | 651 | In-app bell, socket rooms, link builder |
| `products` `files` `locations` `reports` `projects` `pdf` `categories` `maintenance` `departments` `health` | 47–567 | as named |

**The 12 web features:** `admin`, `auth`, `boms`, `borrowing`, `dashboard`, `funds`,
`inventory`, `notifications`, `profile`, `projects`, `reports`, `requisitions`.

**Migrations:** 24 files, numbered `0001` … `0026`. **`0020` and `0021` do not exist** — the
numbers were skipped. Do not go hunting for them. Newest three are `0024_orphan_supporting_uploads`,
`0025_requisition_transportation`, `0026_funding_snapshots`.

**Integration specs:** 39 files in `apps/api/test/`, named `<topic>.int-spec.ts`. Named by
feature, so `stock-concurrency.int-spec.ts`, `self-approval.int-spec.ts`,
`funding-snapshots.int-spec.ts` etc. That directory is a good index of what behaviour is
considered load-bearing.

---

## 5. The invariants you must never break

These are not style preferences. Each one exists because breaking it produces a bug class that
is either unrecoverable or invisible for weeks.

### 5.1 Only `StockService` writes stock

No other module touches `stock_placements` or `stock_ledger`. Borrowing, requisitions, funds
and BOM all call *into* `StockService`. If you find yourself writing an `UPDATE stock_placements`
anywhere else, stop and escalate.

Every stock write follows exactly this shape:

```ts
await this.db.transaction().execute(async (tx) => {
  const placement = await this.stock.lockPlacement(tx, placementId); // SELECT ... FOR UPDATE
  // re-read the quantity from the LOCKED row — never trust a value read earlier in the request
  // apply the change
  // append exactly ONE stock_ledger row describing it
});
// only now enqueue emails / PDFs — never inside the transaction
```

Rules inside that shape:

- **Lock in a consistent order — always `placement.id` ascending.** Any other order deadlocks.
- **`available = quantity − reserved_qty − quarantined_qty`.** All three terms. Forgetting
  `quarantined_qty` was a real, long-lived bug (fixed in `acec306`): a damaged return left
  units physically in a quarantine bin while the system happily offered them for borrowing.
- **One ledger row per mutation, ever.** `SUM(ledger per product) == SUM(placements.quantity)`
  is asserted by a nightly job. If your change breaks that equality, the nightly alert fires.
- **Never call an external service inside a transaction.** Enqueue for after commit.

### 5.2 Append-only means append-only

`stock_ledger`, `requisition_events`, and `audit_log` are append-only **by database trigger**,
not by convention or by grant. An `UPDATE` or `DELETE` fails loudly — **including via a cascade
or an `ON DELETE SET NULL`.** A correction is always a new compensating row, never an edit.

This is why "just delete the bad row and re-run it" is not available to you. It is also why
`resetData()` in the test factories cannot delete requisitions, departments or users (see §9).

### 5.3 The database constraints are the real guarantee

Code is the second line of defence, not the first. Money is `numeric(14,2)` everywhere.
`stock_placements` enforces `quantity >= 0`, `reserved_qty >= 0`, `quarantined >= 0`,
`reserved + quarantined <= quantity`, and `UNIQUE(product_id, compartment_id)`. A requisition
sits on at most one live BOM via a partial unique index. Transportation cost and its
description are both-or-neither by CHECK.

If a bug report says "the data is in an impossible state", your first question is *which
constraint should have caught this and why didn't it* — not "how do we clean up the row".

### 5.4 Snapshot, never join live

A BOM printed in July must still show July's job titles, even after Admin changes someone's
designation or that person leaves the company. So `bom_requisitions.approval_snapshot` freezes
name + designation + stage + timestamp as JSON, and `funding_snapshots` (migration 0026)
freezes the money figures at each forward transition.

**Never "fix" a snapshot by joining live to `users`.** That is not a simplification, it is the
bug the snapshot exists to prevent.

### 5.5 No hardcoded values, anywhere

The most-violated rule in the project, with its own rule file (`.claude/rules/10-no-hardcoding.md`)
and its own enforcement hook. The test: *would anyone ever want this different — in another
environment, next quarter, or for another customer?* If yes, it is configuration.

| Kind of value | Where it lives |
|---|---|
| Secrets, hosts, ports, TTLs | env → `apps/api/src/config/config.schema.ts` — **the only file in the backend allowed to read `process.env`** |
| Business policy (expense threshold, approver counts, tolerances, reminder cadence) | the `app_settings` table, read through `SettingsService` (cached, invalidated on write) |
| Domain constants (statuses, roles, movement types) | a TS enum in `@ims/shared` **plus** a Postgres enum — changing one is a migration |
| Colour, spacing, layout | `apps/web/src/styles/tokens.css` — no hex, no arbitrary Tailwind values |
| Anything a user reads | `apps/web/src/i18n/en.ts` — no string literals in JSX |

Genuinely universal constants (`MS_PER_DAY`, `BCRYPT_ROUNDS`) are fine, but they get a name and
live in the module's `constants.ts`. An unnamed literal in the middle of a function is never
the exception.

### 5.6 Never invent a requirement

If the spec does not say, check `docs/state/OPEN-QUESTIONS.md`. If it is not answered there,
**add an entry to that file**, implement the smallest defensible default, and mark it in code:

```ts
// OPEN QUESTION: OQ-23 — assuming X until the operator confirms
```

Do not silently guess. A guessed business rule that ships is indistinguishable from a
requirement six months later.

### 5.7 The actor is always `req.user.id`

Never trust a client-supplied user id, for anything, ever. Every mutating endpoint takes an
`Idempotency-Key` header stored behind a unique index, so a double-click cannot double-approve.
Approval races are settled with a conditional update
(`UPDATE ... SET action='APPROVED' WHERE id=$1 AND action='PENDING'`) — zero rows affected is
how the loser finds out, rather than overwriting a rejection.

---

## 6. Verification — what "it works" means here

**Evidence before assertions. Always.** "Should pass" is not a result. Run the command, read
the output, paste the relevant lines.

The gate, in order of cost:

```bash
pnpm typecheck                       # fast-ish, catches most of it
pnpm lint                            # --max-warnings 0, so a warning is a failure
pnpm test                            # unit: api + web + shared
pnpm --filter @ims/api test:int      # integration: real Postgres, ~50s warm
bash .claude/hooks/guard-hardcoding.sh --scan-all
```

A change is done when: types check, lint passes, tests pass, **the new behaviour has a test
that fails without the change**, no hardcoded values were introduced, and the decision (if you
made one) is recorded in `docs/state/DECISIONS.md` with one line of reasoning.

### The current baseline is not fully green — know this before you panic

`docs/state/DECISIONS.md` records a **documented baseline of 458 passing / 8 pre-existing
failures**, concentrated in `reports` and `throttling`. **I have not re-verified that count
this session**, so treat it as a claim, not a fact.

What this means for you practically:

1. **Capture the baseline before you change anything.** Run the suite, save the output, and
   diff against it afterwards. Otherwise you cannot tell your 8 failures from the inherited 8.
2. **Never report "tests pass" if 8 are red.** Report "N pass, 8 fail, same 8 as the baseline".
3. **Do not delete or skip a failing test to get green.** Escalate instead.
4. A tolerated red suite is against this project's own testing rule
   (`.claude/rules/50-testing.md`: a flaky test is fixed or deleted the day it appears). It is
   real debt, and it is on the list.

### How integration tests actually work

`apps/api/test/app.ts` boots the **real** `AppModule` against the **real** Postgres on 5434 —
real guards, real exception filter, real everything. The only differences from production are
`logger: false` and no helmet/CORS.

Two consequences that will confuse you if you don't know them:

- **`logger: false` means a 500 arrives with no stack trace.** When an integration test fails
  with an opaque `INTERNAL`, temporarily flip that logger on in your local run to see the cause.
- Every test gets a **distinct fake source IP** via `nextClientIp()`, because both rate
  limiters count per IP and tests sharing one address leak failures into each other. If you add
  a test, use the helper.

Factories available from `apps/api/test/factories.ts` and `stock-factories.ts`:
`createUser`, `createUserAndLogin`, `login`, `createDepartment`, `uniqueEmail`,
`uniqueDepartmentName`, `seedSubthresholdApprover`, `countRefreshTokens`, `resetData`,
`createCategory`, `createProduct`, `createZone`, `createCompartment`, `createStockFixture`,
`placementOf`, `ledgerRows`, `resetInventory`.

---

## 7. The debugging playbook

Follow this. It is ordered to fail fast on the cheap causes before you start reading code.

### Step 0 — Is it even the code?

Three environmental causes account for a large share of "bugs" here. Rule them out first:

1. **Is Docker up?** (`docker info`) — see §3.0.
2. **Is the running API actually your code?** Compare the process start time against the mtime
   of `apps/api/dist/`. A stale API process serving old code is not a code bug. The built
   entrypoint is `apps/api/dist/src/main.js` — **not** `dist/main.js`.
3. **Is a setting or a leftover row lying to you?** Settings changed by hand in dev **persist**.
   If an assertion about "two approvers" fails, read `EXPENSE_THRESHOLD_BDT` live before
   assuming logic is broken.

### Step 1 — Reproduce it exactly

Get to a concrete request and response. Not "borrowing is broken" — this:

```
POST /api/v1/borrow-requests
body: {"productId":"…","quantity":3,…}
-> 409 {"code":"INSUFFICIENT_STOCK","message":"Only 1 available — 2 in quarantine"}
```

For a UI bug: open the browser devtools Network tab and get the actual request the SPA sent.
More than once the answer has been that the request never left the browser at all (see the
`crypto.randomUUID` entry in §8 — a real bug that presented as a server error for a request the
server never received).

### Step 2 — Read the error code, not the message

Every API error is `{ code, message, details? }`, produced in exactly one place:
`apps/api/src/common/all-exceptions.filter.ts`. `code` is a stable member of the 37-member
`ErrorCode` enum in `packages/shared/src/enums/error-code.ts`. **The web app selects its copy
by `code`, never by message** — so the code is the real signal and the sentence the user saw may
be generic.

Grep the code to find the throw site immediately:

```bash
grep -rn "INSUFFICIENT_STOCK" apps/api/src packages/shared/src apps/web/src
```

The 37 codes, so you recognise them on sight:

```
VALIDATION_FAILED UNAUTHENTICATED INVALID_CREDENTIALS TOKEN_EXPIRED TOKEN_REUSE_DETECTED
SESSION_REVOKED FORBIDDEN NOT_FOUND CONFLICT ACCOUNT_DEACTIVATED RATE_LIMITED
PAYLOAD_TOO_LARGE UNKNOWN_SETTING INSUFFICIENT_STOCK STOCK_VERSION_CONFLICT
CATEGORY_NOT_TRACKABLE STOCK_RESERVED BORROW_INVALID_TRANSITION BORROW_ALREADY_DECIDED
DUPLICATE_PROJECT_NAME REQUISITION_INVALID_TRANSITION APPROVAL_ALREADY_ACTED
NOT_YOUR_APPROVAL APPROVER_SLOT_UNASSIGNED SUBTHRESHOLD_APPROVER_UNASSIGNED
SELF_APPROVAL_NO_SUBSTITUTE SELF_APPROVAL_FORBIDDEN BOM_REQUISITION_NOT_APPROVED
BOM_ALREADY_ON_LIVE_BOM BOM_ALREADY_VOID BOM_OVER_BUDGET BOM_QUANTITY_EXCEEDS_SOURCE
ALL_BOM_LINES_REMOVED PDF_RENDER_FAILED PDF_DOWNLOAD_TOKEN_INVALID
CANNOT_SEND_BACK_FOR_REVISION INTERNAL
```

An `INTERNAL` means an *unexpected* exception — a typed domain error would have produced its own
code. So `INTERNAL` is always either a bug in our code or an unhandled Postgres error, and
always worth a stack trace.

### Step 3 — Follow the layers in order

The architecture is strict, which makes the search space small. A request goes:

```
HTTP  ->  controller  ->  service  ->  repository  ->  Postgres
          (parse+authorize  (business rules,   (SQL via Kysely)
           +delegate only)   transactions)
```

- **Controller** contains no business logic. If a controller has an `if` that isn't a guard
  clause, that itself is the bug. Body/query/param are parsed by **zod at the controller
  boundary** using a schema from `@ims/shared`.
- **Service** owns rules and transactions. Multi-row changes take **one explicit transaction
  passed as a parameter** — there is no ambient context to hunt for.
- **Repository** owns SQL. If a figure is wrong, this is usually where it's wrong.

So: wrong *permission* → guard or service. Wrong *validation* → the zod schema in
`packages/shared/src/contracts/`. Wrong *number* → repository. Wrong *state transition* →
service. Wrong *text on screen* → `apps/web/src/i18n/en.ts`.

### Step 4 — For a wrong-number bug, suspect the aggregate first

Two specific traps produce plausible-looking wrong money figures:

- **The fan-out trap.** Joining a requisition to `fund_receipts`, `purchases` and `fund_returns`
  in one query multiplies the rows and inflates every total. Pre-aggregate per requisition.
- **The `sql` fragment reuse trap.** Interpolating the same Kysely `sql` fragment twice re-emits
  its parameters with *different* placeholder numbers, so `GROUP BY <expr>` will not match
  `SELECT <expr>`. Group positionally.

### Step 5 — For a state-machine bug, read the event log

`requisition_events` is append-only and records the whole history, so it can show
"approved → withdrawn → re-approved". The live tracker in the UI reads both the approval rows
*and* the event log. If a requisition is in a state you can't explain, query its events in
order — that is the actual answer, not the current `status` column.

### Step 6 — Narrow with the right test, not the whole suite

Run the one integration spec that covers the area (`ls apps/api/test/` is your index), with
`-t "…"` to pin a single case. Then write the failing test *first* if you're about to fix it —
a fix without a test that failed before it is not verified, it is hoped.

### Step 7 — Report

Per §12. Mechanism, location, evidence, proposed fix, blast radius.

---

## 8. Symptom → cause lookup table

Check here before you start reading code. Every row is something that has actually happened.

**A remedy in this table that no session has run is a hypothesis, not a fix.** The
`npx puppeteer browsers install chrome` line lived here for a day, was repeated in three
reports by two engineers, and destroyed a virtual store the first time anyone tried it. If you
act on a row and it works, you have upgraded it; if you act on a row and it does not, fix the
row in the same session.

| Symptom | Most likely cause | What to do |
|---|---|---|
| Every DI dependency is `undefined`, Nest fails far from the cause | Someone ran `apps/api` through **`tsx`**. esbuild does not emit `design:paramtypes`. | Use `pnpm dev`, or `pnpm --filter @ims/api build && node apps/api/dist/src/main.js`. `tsx` is fine for `scripts/migrate.ts` and `scripts/seed.ts` (no DI there). |
| Code change has no effect | Stale API process | Compare process start time to `apps/api/dist/` mtime. Restart. Entrypoint is `dist/src/main.js`. |
| "Something went wrong on the server" but the server logged nothing | `crypto.randomUUID` is **secure-context only**. On `http://<lan-ip>:5173` it is `undefined`, so every idempotent mutation threw a `TypeError` *before sending*. | Already fixed (`d4c1bf9`) — `randomId()` falls back to `crypto.getRandomValues`. If you see this shape again, check the request ever left the browser. |
| `127.0.0.1:5173` refuses, `localhost:5173` works | Web dev server binds **IPv6 only** | Use `localhost`. Not a bug. |
| Migration or test fails with a connection error | Docker Desktop stopped itself | §3.0 |
| `429 RATE_LIMITED`, then a confusing `401` with an `undefined` token | A script logging in repeatedly **tripped its own limit** (10/min/IP) | Log in once and reuse the token, or wait the window. The limiter is working correctly. |
| Borrow says stock is available but the shelf is empty | Damaged/`NOT_WORKING` returns sit in **quarantine**. `available` must subtract `quarantined_qty`. | Fixed at the three write sites (`move`/`reserve`/`adjust`). If a *new* site computes `quantity - reserved`, that is the bug. |
| A `GROUP BY` returns wrong groupings or errors | Same Kysely `sql` fragment interpolated twice → different placeholder numbers | Group positionally. |
| Money figures inflated, roughly by an integer multiple | Fan-out from joining `fund_receipts` + `purchases` + `fund_returns` at once | Pre-aggregate per requisition. |
| Submit fails: "An approver has not been assigned" while slots 1 and 2 are visibly filled | The **sub-threshold approver** is a *separate setting* from the two slots, and is the most commonly missed one | Admin → Settings → set it. Code: `SUBTHRESHOLD_APPROVER_UNASSIGNED`. |
| `SELF_APPROVAL_NO_SUBSTITUTE` on submit | Nobody may approve their own requisition, and there is no one else configured to stand in | Operator must appoint a second IM / third approver. Not a code bug. |
| A refusal shows the wrong sentence even though the server's message is correct | The web app picks copy by **`code`**, not message — so a new failure mode that **reuses an existing `ErrorCode`** renders the old code's copy, however well the server words it | A new failure mode needs its own `ErrorCode` member *and* a copy entry in `apps/web/src/i18n/en.ts`. In the test, **assert `body.code`, not just the status** — a test that only checks `400`/`409` stays green while the user reads the wrong sentence. That is exactly how this shipped twice: the sub-threshold approver message (fixed by giving it `SUBTHRESHOLD_APPROVER_UNASSIGNED`) and six funds/approval refusals sharing one code. |
| Integration test 500s with no stack trace | `test/app.ts` sets `logger: false` | Flip the logger on for your local run. |
| `pnpm typecheck` fails on a shared type that visibly exists in `packages/shared/src` | `@ims/shared` resolves to `dist/`, not source — a new export is invisible until it is built | `pnpm --filter @ims/shared build`. `pnpm build` orders shared first; `pnpm typecheck` alone does not build anything. |
| A BOM PDF test fails on a method that exists | `boms-pdf.int-spec.ts` overrides `PdfRendererService` with a **local stub** | Add the new renderer method to the stub too. |
| `vitest run … "a|b|c"` finds no test files and exits 1 | The filter is a **substring match, not a regex** — no file is named `a|b|c` | Pass them as separate arguments: `vitest run --config … a b c`. The failure looks like a broken suite rather than a bad filter, which is the same trap as `test:int -- <spec>` two rows down. |
| A test asserting "exactly one row" or "it's on page one" fails randomly | `resetData` cannot delete requisitions, departments or users (append-only triggers), so **the test DB accumulates them** | Never assert absolute counts or page position. Scope every assertion by an id you created. |
| Date-range report misses yesterday's early-morning rows | Range resolved in **UTC** instead of Dhaka calendar days | Ranges must be calendar days in `REPORTING_TIME_ZONE`, resolved by Postgres via `AT TIME ZONE`. |
| An `ON DELETE CASCADE` or `SET NULL` fails | It touches `stock_ledger` / `requisition_events` / `audit_log`, which refuse writes **by trigger** | Restructure. Do not remove the trigger. |
| `pnpm db:migrate status` seemed to migrate | Fixed in `b321750` — `status` is read-only now | If you see it migrate, that regressed. |
| Threshold policy seems wrong for one old requisition | The **approver count is frozen at submit**. A later threshold change must not retroactively add an approver mid-chain. | Working as designed (requirements §11). |
| A lint autofix broke Nest DI at boot | `@typescript-eslint/consistent-type-imports` is **off for `apps/api/src`** on purpose — Nest needs *value* imports to emit `design:paramtypes` | Never re-enable it there. |
| PDF error leaks a container path or Chromium executable location | `PdfRenderFailedError` keeps its `reason` as a **field**, never as `details` — the filter copies `details` into the response | Keep it that way (G-12). |
| Two IMs on one screen, both act, one gets a clean error | Conditional-update claiming (`WHERE status='PENDING'`) | Working as designed. Zero rows updated is how the loser finds out. |
| `Cannot find module '<dep>'` from a command run at the repo root | pnpm keeps each workspace's dependencies in **its own** `node_modules` — the root resolves only what the root declares | **It proves nothing about whether the dependency is installed.** Re-run from the workspace that owns it (`cd apps/api && node -e "…"`) or via `pnpm --filter @ims/api exec …`. This is how "puppeteer is not installed" was once concluded about a package that was installed. |
| An `npx <tool>` or `npm i` run at the repo root appears to work, then **everything** breaks | npx/npm rewrote `node_modules` in npm's flat layout and **deleted pnpm's `node_modules/.pnpm` store**. Every workspace symlink is left dangling — `vitest` simply vanishes — and the root `package.json` gains a `dependencies` block plus a stray `package-lock.json` | Never run `npx` or `npm` at the root of this repo. Recover with: `git checkout -- package.json`, `rm -f package-lock.json`, then **`pnpm install`**. `pnpm-lock.yaml` and the workspace manifests are untouched by the damage, which is the only reason it is recoverable. |
| The gate comes back **better** than baseline and you did not touch that area | Almost never a bonus fix. The integration suite runs files in parallel against one database, and `app_settings` survives between spec files, so anything that shifts scheduling moves the count | **Bisect an improvement exactly as hard as a regression.** Stash your change and re-measure; then stash only the source and keep the test. Adding one unrelated test to `audit.int-spec` once made three `reports` failures vanish, which read as a fix and was scheduling. The rule about attributing new failures had always been there; nothing said anything about attributing disappeared ones. |
| A spec fails only in the full suite and passes with its neighbours | A **setting** leaked from a spec that booted earlier. `resetData` clears every other table but can only null `app_settings.updated_by` — it holds a `Db` and cache invalidation needs the running `SettingsService` | Find the polluter by pairing, not by reading: `vitest run <suspect> <victim>`. Any spec that writes a setting must call `restoreSeededSettings(ctx)` in `afterAll`. Two did not, and cost three failures that were attributed to the wrong file for months. |
| A command "succeeded" but nothing changed | It was a **silent no-op**. The exit code reports that the command ran, not that it did anything | Check the effect, never the exit code. Three in one hour: an inline `node -e` `replace()` matched nothing and printed its own success message; `git stash push <paths>` with an **untracked** file in the list stashes nothing (it complains on the `pop`, not the push), so a red-on-revert run measured the unmodified tree and passed; and a partial revert produced a module-resolution error that read as a red run. Patch scripts here `throw` on a missing anchor for exactly this reason — inline one-liners do not, so verify them by re-reading the file. |
| You are about to fix a defect and there is already a **passing test over it** | The test was written by describing what the code did, not by deciding what it should do. A test written that way can only ever confirm the implementation | **Treat the test as part of the defect.** Change it with the fix, in the same commit, and make it state the contract. Two so far this round: `reports/api.test.ts:20` pinned the export path that never reached the API, and `BomLineEditorRow.quantity-hint.test.tsx` asserted "the input is empty by design" about the field that blanked itself. Both were found by fixing the bug, not by auditing the suite — that is the efficient order, so do not go sweeping for them. |
| A test goes green after your fix, but you never checked it goes **red again** with the fix reverted | It is testing something else. The classic is a fixture that never reached the state under test — a requisition that stayed `DRAFT` because the submit 409'd, so every assertion about a submitted requisition was trivially true | Revert the fix and re-run. If the test does not fail, it is not your test yet. This caught a D-014 clock spec that had already passed a red run: the first red was the fixture, not the defect, and only restoring the fix exposed it. Red-before is the step everyone remembers; **red-again-on-revert is the one that validates the test**. |
| A tool's **binary** is missing although its npm package is installed | Its `postinstall` was skipped or interrupted — not a missing manual step | **`pnpm install`.** Puppeteer's postinstall fetches the pinned Chrome build (`131.0.6778.204`) on its own. Never reach for the tool's own installer: run from the root it resolves a different, newer copy of the tool and wrecks the store (row above); run from the workspace it is simply unnecessary. |

---

## 9. Landmines — every one has cost a session

Condensed, so you can scan it before starting work. Detail for most of these is in §8.

- **Docker Desktop stops itself between sessions.** `docker info` first, always.
- **A backtick inside a `` sql`…` `` template ends the literal.** Cost two debugging rounds:
  migration 0027, then `reports.repository.ts`. A SQL comment that quoted a table name in
  backticks terminated the query, and the syntax error pointed at an unrelated line. Write SQL
  comments in plain words. The same hazard bites bash heredocs — use Write/Edit for anything
  containing backticks, `${}` or nested quotes.
- **Never return `this.funding()` from inside its own transaction.** It runs on its own
  connection, so the caller gets the figures as they were *before* the call — the exact state they
  are asking to see changed. Latent in `unverifyPurchase` since 5.5 (harmless there: unverify
  moves no money), fatal for a void. Fixed in all four call sites.
- **`resetData` deliberately leaves requisitions in place** — their events are append-only — so
  money accumulates across a spec file. Assert report totals as a **delta**, or scope by a
  department the test created. An absolute figure passes until somebody adds a test above yours.
- **`pnpm typecheck` reads `packages/shared/dist`, not source.** Change a shared contract or add
  an `ErrorCode` and typecheck fails against the stale build until
  `pnpm --filter @ims/shared build`. The integration suite passes throughout, because vitest
  resolves shared from source — so a green suite is not evidence that typecheck is green.
- **`pnpm db:up`, not `docker compose up`.** The root compose file is the production-shaped stack
  and leaves 5434 unbound; every int-spec then dies on `ECONNREFUSED 127.0.0.1:5434`.
- **Never run `apps/api` through `tsx`.** DI dies silently.
- **A stale API process is not a code bug.** Check start time vs `dist/` mtime.
- **Built entrypoint is `apps/api/dist/src/main.js`**, not `dist/main.js`.
- **Dev DB 5433, test DB 5434.** And: **never `docker compose down -v`** — that deletes
  `pgdata` (the database) and `files` (every uploaded signature, invoice and generated PDF).
  There is no reason to ever run it. `docker system prune --volumes` is equally forbidden.
- **Web dev server is IPv6-only** — `localhost:5173`, never `127.0.0.1:5173`.
- **Three tables are append-only by trigger**, cascades included.
- **`resetData` leaves requisitions/departments/users behind** → the test DB accumulates rows.
- **`boms-pdf.int-spec.ts` has its own `PdfRendererService` stub** — keep it in sync.
- **`test/app.ts` sets `logger: false`** — 500s arrive bare.
- **Reusing a Kysely `sql` fragment renumbers its parameters.**
- **The web app picks error copy by `code`.** Assert `body.code` in the test, not just the status.
- **A `Cannot find module` at the repo root proves nothing** under pnpm — re-run from the owning workspace.
- **Never run `npx` or `npm` at the repo root.** It replaces pnpm's store with npm's flat layout,
  `node_modules/.pnpm` disappears and every workspace link dangles. Recovery is `pnpm install`.
- **A missing tool binary is a skipped postinstall.** `pnpm install`, never the tool's own installer.
- **Revert the fix and check the test goes red again.** A red run before the fix does not prove
  the test is testing the fix — a broken fixture is red for its own reasons.
- **Bisect a suspiciously good gate too.** Scheduling moves the integration count; an
  unexplained improvement is as unattributed as an unexplained failure.
- **A passing test over a defect is part of the defect.** Change it with the fix, and make it
  say what the behaviour should be rather than what it was.
- **A command that can silently do nothing must be checked for its effect, not its exit code.**
  `git stash push <paths>` with an untracked path, and any inline `replace()` that misses.
- **A spec that writes a setting must `restoreSeededSettings(ctx)` in `afterAll`.**
  `app_settings` is the only state that outlives a spec file.
- **`approver_slots.slot_no` is constrained to (1, 2)** — there is no slot 3 to fall back to.
- **Dev settings persist.** Reset `EXPENSE_THRESHOLD_BDT` to 15,000 or read it live.
- **A repeated-login smoke script trips its own 10/min/IP limit.**
- **The integration run has blown a 600s shell timeout on a cold DB** — redirect to a file.
- **Timezone**: UTC ranges miss Dhaka's early-morning rows.
- **`consistent-type-imports` is off for `apps/api/src`** on purpose.
- **The API refuses to boot if any two of the three secrets match** (`JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `PDF_SIGNING_SECRET`). That is a feature; generate three.
- **Four compose files exist, with different ports on purpose.** Root `docker-compose.yml`
  (demo, publishes only 5173, demo mode ON) · `infra/docker-compose.yml` (production, 80+443,
  demo mode off) · `infra/docker-compose.dev.yml` (host dev DBs on 5433/5434). Know which one
  you are talking about before you "fix" a port.
- **`0020` and `0021` migrations do not exist.** Skipped numbers, not missing files.
- **A stack running with no `.env` is the demo stack**, whatever anyone intended — demo accounts
  on, and the JWT and PDF-signing secrets are literals in a file that is on GitHub. Fine on a
  closed LAN for a testing round; not a launch. Check before assuming a deployment is protected:
  `curl -s http://<host>:5173/api/v1/auth/demo-accounts` answers **unauthenticated**, and if it
  lists emails and a password there is no authentication on that system.
- **Windows reserves TCP port blocks at boot**, and 5173 / 5433 / 5434 can all land inside one.
  The proxy fails to bind with *"forbidden by its access permissions"* while nothing is listening,
  and the integration suite dies on `ECONNREFUSED :5434`. An OS reservation, not a broken app.
- **A probe is not the product.** A synthetic `dispatchEvent` does not register a combobox
  selection, so lines fall through to free text and it reads as a broken catalogue picker; the
  database settles it (`product_id` null on those rows). Ask what the harness did differently from
  a person before filing anything.
- **`GET /reports/expenses` returns `{ buckets, totals }`** — not `rows`, not `items`. A check
  written against an invented field name compared `0` to `0` and passed green. Read the zod
  contract in `packages/shared/src/contracts/` before asserting.
- **Partial funding and revising the approved amount are switched off for this release**
  (`ALLOW_PARTIAL_FUNDING`, `ALLOW_APPROVED_AMOUNT_REVISION`, both default false). A refusal from
  either is correct behaviour, not a defect — `WORKING-AS-DESIGNED`, cited to `DECISIONS.md`
  2026-09-02.

---

## 10. Reading this codebase fast

The conventions are consistent enough that you can predict where things are. Use that instead
of grepping blind.

### Backend shape — every module looks like this

```
src/modules/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts      HTTP only: parse, authorize, delegate, serialise
├── <feature>.service.ts         business rules, transactions
├── <feature>.repository.ts      SQL via Kysely
├── <feature>.errors.ts          typed domain exceptions
├── dto/                         zod schemas + inferred types
└── <feature>.service.spec.ts
```

- Types are **inferred** from zod (`z.infer<typeof X>`), never declared twice.
- `@Roles(Role.X)` for coarse role checks; ownership and state checks live in the service.
- **`@Roles()` attaches only `RolesGuard`.** `JwtAuthGuard` is global via `APP_GUARD` —
  re-attaching it per controller would force every feature module to import `JwtModule`.
- Domain failures are **typed exceptions** (`InsufficientStockError`), never strings.

### Frontend shape

- **All server state through TanStack Query.** No `useEffect` + `fetch`, ever.
- Query keys come from the typed factory in `apps/web/src/api/keys.ts`. Invalidation is
  precise, not blanket.
- Forms are React Hook Form + **the same zod schema the API uses**, imported from `@ims/shared`.
  Validation is never redefined on the client.
- **Every data screen handles four states:** loading · empty · error-with-retry · loaded.
  "Empty" is not "loading forever".
- **Never optimistic-update anything stock-related** — the server can reject on a lock conflict.
- Feature-first: a component used by one feature lives in that feature. `components/ui/` is
  shared primitives only. A component over ~150 lines is doing two jobs.
- `apps/web/src/api/client.ts` is worth reading once in full. It holds the transparent
  refresh-and-retry, and a **single shared in-flight refresh** — because six queries expiring
  together would otherwise fire six refreshes, five of which present an already-rotated token
  and trip the server's reuse detection, logging the user out.

### Comments are a real signal here

The house style is **comment the *why*, never the *what***, and non-obvious business rules cite
their spec section (`// requirements §4: either rejection kills the whole request`). Migrations
and contracts carry long explanatory headers.

**Practical consequence: read the comment above a weird-looking line before you "fix" it.**
Most of the surprising code in this repo has a paragraph above it explaining which bug it
prevents. `apps/api/src/database/migrations/0026_funding_snapshots.ts` is a good example of
the density to expect.

`docs/state/DECISIONS.md` is the long-form version of the same thing. When something looks
wrong and there's no comment, grep DECISIONS for the feature name before concluding it's a bug.

---

## 11. If you are asked to write code

1. **Find the sibling and copy its shape.** Adding an endpoint? Read a comparable one in
   another module first. There are skills for the common cases — `/add-endpoint`,
   `/add-migration`, `/add-screen` — and following them keeps you inside the conventions.
2. **Write the failing test first.** New behaviour needs a test that fails without your change.
   Tests assert observable behaviour, not mock calls. **No `sleep`** — await the actual
   condition. Stock and concurrency get **integration** tests against real Postgres, not mocks.
3. **Check the rule file for the area you're in:** `.claude/rules/20-backend.md`,
   `30-frontend.md`, `40-database.md`, `50-testing.md`, `60-infra.md`.
4. **No hardcoded values.** §5.5. The guard hook catches maybe 80%; the rest is your judgement.
5. **No new user-visible string in JSX** — add it to `apps/web/src/i18n/en.ts`.
6. **A new failure mode needs a new `ErrorCode` member**, or the UI will show the old sentence
   no matter how good your server message is.
7. **Prefer the boring solution.** Twelve users. Cleverness costs more than it saves. When two
   designs are close, pick the one that is easier to delete.
8. **Make illegal states unrepresentable** — a CHECK constraint beats a comment beats a code
   review.
9. **Run the gate** (§6) and paste the output.
10. **One logical change per commit,** conventional message (`fix(funds): …`). A migration and
    the code that uses it belong in the same commit. Never commit `.env`, dumps, or generated
    PDFs. Do not commit or push unless asked.

Testing priority order, since the budget is finite:
**stock arithmetic + concurrency** → **approval state machine** → **threshold/approver-count
logic** (including that a threshold change does not affect in-flight requisitions) →
**permission boundaries** (each role hitting each endpoint it should not reach) → everything
else happy-path only.

---

## 12. How to report back — the handoff block

**`.claude/rules/70-assist-handoff.md` is canonical for this section.** It is always loaded, so
it is kept terse; this section holds the template and the reasoning. If the two ever disagree,
the rule file wins.

The premise: output is pasted between two engineers, one of whom has **no shell, no git, no
database, no browser** — only the characters in the paste. So **every claim carries its evidence
inline. If it is not in the block, it did not happen.**

One block per issue. Never batch two issues into one block.

### The template — copy this

~~~
TASK       QA-###  (or a one-line description)
CLASSIFY   FIXED | NOT-REPRODUCED | WORKING-AS-DESIGNED | BLOCKED | INVESTIGATION-ONLY
SPEC       DERIVED A12 — docs/reference/02-assumptions.md:17 ("per requirements §6")
           (or: REQUIRED §n via the reference file that transcribes it | NO-BASIS)
ROOT       The mechanism — why this input produced this wrong output. 2–3 sentences.

TOUCHED
  - apps/api/src/modules/funds/funds.repository.ts:198-231
  - apps/api/test/funds.int-spec.ts:44-77 (new)

DIFF
```diff
(real git diff, >=3 lines of context, no `...` inside a hunk)
```

EVIDENCE
  R $ pnpm --filter @ims/api exec vitest run --config vitest.integration.config.ts funds    # red run, before the fix
  (verbatim output)
  R $ pnpm --filter @ims/api exec vitest run --config vitest.integration.config.ts funds    # green run, after
  (verbatim output)
  R gate for this batch: see GATE block above
  D the same shape exists in purchases.repository.ts:88 — not exercised, see NOTCHECKED

BASELINE   N pass / M fail — baseline N0/M0 — same M / different: <list>

INVARIANT  ASSIST §5.1 (stock) — not touched, this is a read path only.
           ASSIST §5.4 (snapshots) — reads funding_snapshots, writes nothing.

NEWSURF    none

NOTCHECKED
  - did not run the web unit suite; no frontend file changed
  - did not verify against a batched (multi-requisition) BOM

OPEN
  - assumed a fund_return against a cancelled requisition is out of scope; not in the spec
~~~

And once per session or per logical batch, printed once and referenced by every block above:

~~~
GATE  (re-run after the last edit of the batch)
  R $ pnpm typecheck
  (verbatim)
  R $ pnpm lint
  (verbatim)
  R $ pnpm test
  (verbatim)
  R $ bash .claude/hooks/guard-hardcoding.sh --scan-all      # if any literal was added
  (verbatim)
~~~

### The rules that make it reviewable

- **Tag every line `R` (ran it) or `D` (deduced it).** Never blend them in one sentence. "I ran
  the funds spec: 12 pass, 1 fail" and "this should make the funds spec pass" are different
  kinds of statement and must never look alike.
- **Show the new-behaviour test failing first, then passing.** A green-only run is hoped, not
  verified.
- **`NOTCHECKED` is mandatory and never empty.** An unstated gap reads as a checked one.
- **Never "tests pass" while any are red.** Report the count and whether the failures are the
  inherited ones. See §6 and `docs/state/DECISIONS.md` for the current baseline — do not trust
  a number memorised from anywhere else.
- **`INVARIANT` is never omitted**, even when the answer is "none". Writing it forces the check.
- **`INVESTIGATION-ONLY`** gets the answer, the `file:line` refs, and **a 1–5 line verbatim
  excerpt per reference** — the reader cannot open the file, so a bare `file:line` is
  unreviewable to them. Still never dump whole files.
- **On a STOP condition** (rule §STOP — stock writes outside `StockService`, schema changes,
  deleting a failing test, invented business rules, auth/upload surfaces, and the rest): print
  `STOP-INVARIANT`, name the invariant, and wait. Do not implement, do not work around.
- **Do not claim done.** Report what is true; the lead decides whether it is done.
- **Disagree once, in one sentence, with the technical reason.** If reaffirmed, comply and note
  the concern. Verify a challenge on its merits rather than complying reflexively — and say so
  if the challenge is wrong.
- **Do not write to `docs/state/*` unless asked.** Those files are the project's memory and the
  lead maintains them.
- **Never paste a secret, token, or password value.** Name the key instead.

---

## 13. The current true state of the build

**Rewritten 2026-09-02.** Earlier versions of this section warned that the status docs were behind
the code. That is no longer the case for `NOW.md`, `PROGRESS.md` and `SESSION-LOG.md` — they were
brought current on 2026-09-02 and are maintained per session. `AI_PLAYBOOK.md` is still a
derivative summary with residual drift; where it and the code disagree, **the code wins**.

### What is actually true

- **Phases 00–08 are complete**, plus four QA rounds on top of them. There is no open phase file
  and nothing is queued. What remains is go-live operations, the untested upload surface, and the
  ranked candidates in `NOW.md`.
- **It is deployed.** A demo stack runs on the VM (`rndserver`) for the testing round, and the
  branch is pushed. **Demo mode is on, which means there is effectively no authentication** —
  deliberate for this round, and the reason `GET /auth/demo-accounts` answers unauthenticated.
- The working branch is **`fix/lan-secure-context`**, still unmerged to `main`. Whether that is
  intentional remains an open question for the lead.
- **Test baseline: 685 integration pass / 0 fail / 0 skipped, 50 files** — green, and with nothing
  skipped for the first time in the project's history. `pnpm lint` carries **20 pre-existing
  errors**; compare against 20, not zero. `guard-hardcoding.sh --scan-all` reports 8.
  `DECISIONS.md` holds the authoritative figures — read them there rather than trusting a number
  memorised from a rule file.
- Recent work not in the original plan: transportation cost on the purchase that paid it (0029),
  `funding_snapshots` (0026), a requester's own approval stage no longer created (0030), BOM and
  purchase money ceilings, reversible money stages, the personal dashboard, the rebuilt expenses
  page with a twelve-month trend and top items, the chronological money trail, and demo mode.

### Two features are switched off for this release

`ALLOW_PARTIAL_FUNDING` and `ALLOW_APPROVED_AMOUNT_REVISION`, both default false, both refusing
server-side with their own `ErrorCode`, both hiding their control in the UI. **A refusal from
either is `WORKING-AS-DESIGNED`**, cited to `DECISIONS.md` 2026-09-02 — not a defect. The code and
its tests are intact; reversing it is one env var.

### Residual playbook drift — check the code before trusting these

| Document | Problem |
|---|---|
| `AI_PLAYBOOK.md` §5.1 | Gives `available = quantity − reserved_qty`. The real rule subtracts `quarantined_qty` as well. |
| `AI_PLAYBOOK.md` §5.3 | Lifecycle list omits `PURCHASE_VERIFIED` and `CANCELLED`, both in the enum. |
| `AI_PLAYBOOK.md` §5.3, §20 | Described the over-budget BOM bounce-back gate as live. It was retired in `5435fac` — **and then reinstated in a stricter, per-requisition form** on 2026-09-01 (`BOM_EXCEEDS_APPROVED_AMOUNT`). Read `boms.service.ts`, not the playbook. |
| `AI_PLAYBOOK.md` §10.1 | Table and migration counts are stale; migrations now run to **0030**. |

**When the playbook and the code disagree, the code wins — and tell the lead, because the playbook
is supposed to be fixed in the same change that outdated it.**

### Open items you may run into

- **Untested surface: file upload and signatures** — supporting documents, invoices,
  approve-with-signature. The largest part of the build nobody has exercised.
- **`G-14`** — the prevention half is still open.
- **`G-16`** — offsite backups are not configured; backups sit on the same VM as the database.
  The `rclone`/`aws s3` lines in `infra/backup.sh` are commented out.
- **`G-17`** — the restore drill has only been run against a scratch DB, not the production stack.
- **`G-18`** — integration tests write uploads into the dev storage directory, leaving orphans.
- **`G-19`** — five endpoints return a bare array rather than `Paginated<T>`. Deliberate;
  revisit past ~1,000 rows.
- **`F-5`** — every BOM signature prints "for &lt;their own name&gt;", on the document Accounts reads.
- **Unconfirmed assumptions** (marked 🟡 in `OPEN-QUESTIONS.md`): OQ-14 audit always-on
  membership · OQ-16 notification audience · OQ-30 · OQ-31 · OQ-33.
- **A fresh production install accepts no requisition** until an admin sets approver slots 1 and 2,
  the **sub-threshold approver** (a separate setting, most commonly missed), an Inventory Manager,
  one department, and the expense threshold. The error at submit names the missing one.
  `docs/RUNBOOK.md` §0.

---

## 14. Hard don'ts

- **Never `docker compose down -v`.** Never `docker system prune --volumes`. `pgdata` is the
  database; `files` is every upload and generated PDF.
- **Never write `stock_placements` or `stock_ledger` outside `StockService`.**
- **Never `synchronize: true`.** It is false in every environment including local, and Kysely
  has no such concept — the illegal state is unrepresentable, keep it that way.
- **Never edit an applied migration.** Write a new one.
- **Never drop a column in the same release that stops writing to it.** Release N stops using
  it; N+1 drops it. Otherwise a rollback loses data.
- **Never rename a column in place.** Add, copy, ship, drop next release.
- **Never remove an append-only trigger** to make a delete work.
- **Never `process.env` outside `apps/api/src/config/config.schema.ts`.**
- **Never delete or `.skip` a failing test to get a green run.**
- **Never commit `.env`, database dumps, or generated PDFs.**
- **Never paste a secret, token, or password value into a report or a commit message.**
- **Never join live to `users` where a snapshot exists.**
- **Never optimistic-update stock in the UI.**
- **Never re-enable `consistent-type-imports` for `apps/api/src`.**
- **Never commit or push unless you were asked to.**

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **IM** | Inventory Manager. Runs the warehouse; approves borrows; is the *first* approval stage on a requisition; generates BOMs; logs funds and purchases. |
| **BOM** | Bill of Materials. The printable PDF on company letterhead, built from one or more approved requisitions, carrying an immutable approval snapshot. |
| **BDT** | Bangladeshi Taka. The only currency; no multi-currency support by design. |
| **Product** | A catalogue card with a stable `product_code`, forever. |
| **Placement** | product × compartment × quantity. One product in two compartments = two placement rows. This is what makes "move 30 of 70" possible without changing the product id. |
| **Zone / Compartment** | The two levels of location. Zone ("Meta", "Nvidia") → Compartment ("1A", "3C"). Placement chip colour is derived deterministically from the compartment id, so a location is always the same colour everywhere. |
| **Reserved** | Held by a pending borrow request. Counted out of `available` but still physically present. |
| **Quarantined** | Returned damaged or not working, physically present but unusable. Also counted out of `available`. |
| **Requested / Approved / Funded** | The three money figures. Requested is the requester's ask, frozen at submit. Approved is what the chain sanctioned (may be revised down). Funded is `SUM(fund_receipts)` and grows as Accounts releases money. |
| **Remaining** (on the BOM) | `Requested − Approved` — how much of the ask the approvers did *not* sanction. Known at submit, never moves. |
| **Approval snapshot** | Immutable JSON on `bom_requisitions`, freezing each approver's name, designation, stage and timestamp at generation time. |
| **Funding snapshot** | Row in `funding_snapshots` capturing the money figures at each *forward* lifecycle transition. Backward transitions deliberately do not snapshot. |
| **Sub-threshold approver** | A distinct `app_settings` value naming who approves requisitions *below* the expense threshold. Separate from approver slots 1 and 2, and the setting operators most often forget. |
| **Send back for revision** | `APPROVED → DRAFT` on a single-item over-budget requisition that cannot be shrunk. Clears the approved figures and asks the requester to revise. |
| **Ledger** | `stock_ledger`. Append-only, authoritative. Placement quantities are a *cache* of it, reconciled nightly. |
| **OQ-*** | An open product question needing a human answer. `docs/state/OPEN-QUESTIONS.md`. |
| **G-*** | Deferred engineering work, consciously postponed. Same file. |

---

**Last word.** The rule that matters most: `StockService` is the only writer of stock. Every
other bug in this system is recoverable. A stock bug is not — the physical shelf and the
database diverge silently, and nobody notices for a month. When in doubt anywhere near stock,
stop and ask.
