# AI Playbook — Inventory Management System (IMS)

> **Complete context for a fresh AI assistant with zero prior knowledge of this codebase.**
> Read this file first. After one read you should be able to: name every module, know every
> invariant, predict where every business rule lives, and write code that matches the existing
> style. Open `docs/reference/05-user-flows.md` only if you need the per-screen walkthrough;
> everything else you need is in here.
>
> **Maintenance rule:** see `.claude/rules/05-ai-playbook.md`. A `PostToolUse` hook
> (`.claude/hooks/playbook-reminder.sh`) reminds Claude to update this file after every
> meaningful edit. Last updated: 2026-08-07 (Project Hub tasks 6 & 7 landed).

---

## Table of contents

0. [What this project is](#0-what-this-project-is)
1. [The user story (replay the whole product)](#1-the-user-story-replay-the-whole-product)
2. [Roles & permissions matrix](#2-roles--permissions-matrix)
3. [The five non-negotiables](#3-the-five-non-negotiables)
4. [Stack & architecture](#4-stack--architecture)
5. [The seven concepts you must know](#5-the-seven-concepts-you-must-know)
6. [Layout — where to find things](#6-layout--where-to-find-things)
7. [Commands, ports, dev users](#7-commands-ports-dev-users)
8. [Backend conventions (NestJS)](#8-backend-conventions-nestjs)
9. [Frontend conventions (React + TS)](#9-frontend-conventions-react--ts)
10. [Database — schema, constraints, locking recipe](#10-database--schema-constraints-locking-recipe)
11. [Settings & config ownership](#11-settings--config-ownership)
12. [Testing priorities](#12-testing-priorities)
13. [Infra rules](#13-infra-rules)
14. [Conventions (naming, comments, git, errors)](#14-conventions-naming-comments-git-errors)
15. [Skills & agents — when to use](#15-skills--agents--when-to-use)
16. [Landmines (each has cost a session before)](#16-landmines-each-has-cost-a-session-before)
17. [Open work & known gaps](#17-open-work--known-gaps)
18. [Notifications matrix](#18-notifications-matrix)
19. [Screen map](#19-screen-map)
20. [BOM generation rules](#20-bom-generation-rules)
21. [Capacity, deployment, runbook essentials](#21-capacity-deployment-runbook-essentials)
22. [What "done" means for a task](#22-what-done-means-for-a-task)
23. [Maintenance of this playbook](#23-maintenance-of-this-playbook)

---

## 0. What this project is

Internal **procurement + inventory + BOM** system for **Southern IoT** (Dhaka, **BDT**,
`Asia/Dhaka`). **12 users.** Three loops:

1. **Borrow** — search catalogue → request → IM approves / hand-over → return.
2. **Requisition** — something not in stock → IM review → N approvers (1 below 15,000 BDT,
   2 at-or-above) → BOM → funds → purchase → receive → stock.
3. **BOM** — printable PDF on company letterhead with an **immutable `approval_snapshot`**.

**Stack (pnpm monorepo, Node 20.11+):**

- **api** — NestJS + Kysely (typed query builder) + Postgres 16. JWT (15 min) + rotating
  refresh tokens, family-wide revocation on reuse.
- **web** — React + Vite + TypeScript + TanStack Query + Tailwind + shadcn/ui. State-only
  socket (pushes **invalidation signals**, not data).
- **shared** (`packages/shared`) — dual CJS+ESM build, zod contracts + enums + settings registry.
- **Infra** — single VM, Docker Compose, Caddy in front. No Redis, no queue server — at 12
  users, `node-cron` and an in-process PDF renderer are the whole job layer.
- **PDF** — headless Chromium (Puppeteer) rendering HTML templates against the company pad as
  a background layer. Lives in a separate container with `mem_limit: 1g` so a render that
  overruns its budget cannot take the API down.

**Build status (Aug 2026):** all seven phases done, **368 integration tests green**,
typecheck/lint/test green. Project Hub feature (Tasks 1–7) added on top: hub listing at
`/projects`, project detail at `/projects/:projectId` with IN_USE/RETURNED tags, IM/Admin
detach, and requisitions-for-this-project. No new phase is open. Remaining work is
**go-live ops**, not construction. See `docs/state/NOW.md` (auto-injected every session)
for the live "what's next".

---

## 1. The user story (replay the whole product)

This is the canonical scenario. Every domain rule in this document serves one of these scenes.

### 1.1 Saad needs an Arduino (borrow loop)

1. He logs in. He sees tabs: **Inventory** | **Make Requisition** | **My Requisitions**.
2. In **Inventory** he searches "Arduino". It exists and is in stock. He presses **Borrow**,
   picks (or creates) a **project**, says how many, says returnable vs consumable.
3. The Inventory Manager (IM) gets an instant popup, approves. Stock quantity updates
   automatically. Saad physically collects the item.
4. A log row is written against that product: *Name · Borrow date · Return date · Project ·
   Purpose*. Newest first. Because quantity can be > 1, several people can hold the same
   product at once — the log is per-borrow, not per-product.
5. When Saad returns it, the IM marks it returned and stock goes back up.

### 1.2 Saad needs something that isn't in stock (requisition loop)

1. He goes to **Make Requisition**. The search box is also a dropdown, fed from the catalogue.
2. If he picks an existing product, a **green hint** appears: *"Already available — 2 in
   Meta / 1A"*. He can still add it (out of stock, or he needs 5 and we only have 2).
3. If the product doesn't exist, he types a free-text name.
4. Per line: **quantity** and **unit amount (BDT)**; line total and request total computed.
5. Request-level: urgency, approval deadline, reason, department, project.
6. While still a DRAFT he may also **attach one supporting document** — a quote, vendor
   proposal, or spec sheet (PDF/PNG/JPEG, ≤10 MB). It is reference material for the
   decision, not part of the BOM; approvers see it as a paper thumbnail on the detail
   page. He can replace or remove it until the requisition is submitted.
7. **Proceed.** The **IM approves first** — their approval means *"confirmed, we really
   don't have this, go ahead"*.
8. Then approvers act (2 above the expense threshold, no fixed order; 1 below — see
   §5.3 for the exact rule).
9. **My Requisitions** shows the live tracker:
   `Requisition made ✓ → IM Approved ✓ → Approver 1 ✓ → Approver 2 ⏳ → BOM created ⏳ →
   Sent to Accounts ⏳ → Money Received ⏳ → Products Bought ⏳`
   Green = done, ash = pending, red ✗ = rejected. On a rejection, **"See why"** reveals
   the rejection note.
10. An approver who clicks by mistake can **withdraw** their approval (until BOM generated).

### 1.3 Inventory Manager (IM)

Runs the warehouse: full CRUD on inventory, categories, locations; moves stock between
locations including **partial moves** ("move 30 of 70" — same product, now shown as two
location chips in different colours, derived deterministically from compartment ID);
handles borrow approvals and returns; generates the BOM on company letterhead with every
approver's name and designation stamped on it.

### 1.4 Admin

Creates users, assigns one of the four roles, names approvers and their designations,
changes the expense threshold and other business settings **without a code change**.

### 1.5 Gaps the story implies but never states (each became a recorded decision)

| # | Gap | Recorded decision |
|---|-----|-------------------|
| G1 | Story ends at "Buy Products" — bought items never enter inventory | Final stage added: **Received & Stocked** |
| G2 | Requester estimate vs. BOM actual cost | Two separate fields; over-budget rule (configurable tolerance, default 10%) |
| G3 | Below 15,000 BDT threshold, how many approvers? | **1** approver |
| G4 | Nothing says stock is held between "borrow requested" and "IM approved" | **Reservation model** (§5.1) |
| G5 | "Return date" ambiguous — expected vs actual | **Store both** |
| G6 | Partial returns (took 5, returned 3) | **Supported** |
| G7 | Withdraw approval after BOM printed? | **Blocked after BOM generation** |
| G8 | Approvers 1/2 — fixed or per-department? | **Global default, per-department override** |
| G9 | Laptops: track *which* laptop Saad has? | **Optional serial tracking** (`asset_units` dormant in schema, on/off via `is_trackable` on **category**, not hard-coded) |
| G10 | Requester wants to show the approver the vendor's quote | **Single supporting document on DRAFT** (§5.7): one PDF/PNG/JPEG, optional, DRAFT-only, insert-only file, not frozen onto the BOM |

---

## 2. Roles & permissions matrix

Roles are **additive**, not exclusive. Everyone can borrow and raise requisitions. An
"Approver" is a General user *plus* approval rights; the IM is a General user *plus*
warehouse rights. A user holds a **set** of roles (`user_roles` table — not an array column,
so two concurrent role grants cannot lose each other).

| Action | General | Approver | Inv. Manager | Admin |
|--------|:-------:|:--------:|:------------:|:-----:|
| Browse inventory | ✓ | ✓ | ✓ | ✓ |
| Borrow / return own items | ✓ | ✓ | ✓ | ✓ |
| Raise requisition | ✓ | ✓ | ✓ | ✓ |
| Approve borrow · mark returned | | | ✓ | |
| CRUD products/categories/locations | | | ✓ | |
| Move / split stock | | | ✓ | |
| First-stage requisition approval (IM) | | | ✓ | |
| Second-stage approval · withdraw | | ✓ | | |
| Generate / void BOM | | | ✓ | |
| Log funds · record purchase · receive to stock | | | ✓ | |
| Create users · assign roles · set designations | | | | ✓ |
| Configure approvers & threshold | | | | ✓ |
| View audit log | | | | ✓ |

**An approver cannot approve their own requisition.** The system skips to the next configured
approver and logs the substitution; refuses with `SELF_APPROVAL_NO_SUBSTITUTE` if none exists.
The **approver count is never reduced** — the operator may still override the choice of
substitute. **The IM is never pinged when the remaining balance arrives** — they check back
manually.

---

## 3. The five non-negotiables

Violating any of these is the most common way this project gets ruined.

| # | Rule | Where enforced |
|---|------|----------------|
| 1 | **No hardcoded values, anywhere.** `process.env` only in `apps/api/src/config/config.schema.ts`. Business values via `SettingsService` (reads `app_settings`). Enums from `@ims/shared`. UI copy from `apps/web/src/i18n/en.ts`. Hex/Tailwind values from `apps/web/src/styles/tokens.css`. | `.claude/rules/10-no-hardcoding.md`, `.claude/hooks/guard-hardcoding.sh` (PostToolUse) |
| 2 | **Only `StockService` writes stock.** No other module touches `stock_placements` or `stock_ledger`. Always one transaction, `SELECT ... FOR UPDATE` ordered by `placement.id` ascending, one append-only ledger row. | `.claude/rules/40-database.md`, `docs/adr/0001-stock-as-placements-and-ledger.md` |
| 3 | **Schema changes are migration files only.** `synchronize: false` in every env, including local. **Additive first** (nullable → backfill → tighten in a later migration). **Never drop a column in the same release that stops writing to it.** | `.claude/rules/40-database.md`, `infra/` |
| 4 | **DB constraints are the real guarantees.** Money = `numeric(14,2)`. `stock_placements`: `quantity ≥ 0`, `reserved_qty ≥ 0`, `quarantined ≥ 0`, `reserved+quarantined ≤ quantity`, `UNIQUE(product_id, compartment_id)`. `stock_ledger`, `requisition_events`, `audit_log` are append-only by **trigger**, not grant. | `.claude/rules/40-database.md` |
| 5 | **Never invent a requirement.** If the spec doesn't say it, check `docs/state/OPEN-QUESTIONS.md`. If it isn't answered, add an entry there and implement the smallest defensible default, marked `// OPEN QUESTION: <id>` in code. **Do not silently guess.** | `CLAUDE.md`, `docs/state/OPEN-QUESTIONS.md` |

There is also a **sixth rule of equal weight** that says it in a different form:

> **The one architectural rule that matters:** `StockService` is the *only* module allowed to
> write `stock_placements` and `stock_ledger`. Borrowing, requisitions and BOM all call into
> it. Every other bug in this system is recoverable; a stock bug is not, because the physical
> shelf and the database silently diverge and nobody notices for a month.

---

## 4. Stack & architecture

### 4.1 Stack and why

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React + TS, Vite, TanStack Query, Tailwind, shadcn/ui | Type safety matters when a schema this branchy hits the UI |
| State/sync | TanStack Query + WebSocket **invalidation** | "Updates instantly without error" = server is truth, socket tells client to refetch |
| Backend | NestJS (TS) — modular monolith, REST | Same language both sides; module boundaries without distributed-system pain |
| DB | PostgreSQL 16 | Transactions, row locking, `CHECK` constraints, `JSONB` for event payloads |
| Realtime | Socket.IO, per-user rooms | Login popup, pending-approvals badge, live tracker |
| Jobs | `node-cron`, in-process | Deadline reminders, overdue checks. At 5–6 requisitions/day a queue server is pure overhead |
| PDF | Headless Chromium (Puppeteer) rendering HTML letterhead template | Only reliable way to match the company pad exactly |
| Files | Docker volume on the VM | Generated BOM PDFs. MinIO/S3 is unnecessary complexity for one host |
| Auth | JWT access (15 min) + rotating refresh, RBAC guards | Standard, no external IdP needed |

**Considered and rejected:** Django + HTMX (faster to build, but the borrow/requisition
screens are stateful enough that a proper SPA pays for itself). Firebase (cannot do reliable
multi-row stock transactions — stock correctness is the whole product). Supabase (its Docker
stack is ~10 containers; we use 3 capabilities while fighting the rest; permission logic is
workflow, not row visibility, so it belongs in TS; locking transactions must bypass the
auto-generated API).

### 4.2 Component view

```
┌──────────────────────────────────────────────────────────────┐
│  React SPA                                                    │
│  General │ Inventory Mgr │ Approver │ Admin  (role-gated)     │
└───────────┬──────────────────────────────┬───────────────────┘
            │ REST /api/v1 (JWT)           │ WebSocket
┌───────────▼──────────────────────────────▼───────────────────┐
│  NestJS Modular Monolith                                      │
│                                                               │
│  auth │ users │ catalog │ storage │ stock ──┐                 │
│                                             │ StockService    │
│  borrowing ─────────────────────────────────┤ (only writer    │
│  requisitions │ approvals │ funds ──────────┤  of stock)      │
│  bom │ pdf │ notifications │ settings │ audit                 │
└───────────┬───────────────────────┬──────────────────────────┘
            │                       │
      ┌─────▼──────┐         ┌──────▼──────┐        ┌──────────┐
      │ PostgreSQL │         │  cron jobs  │        │  files   │
      │  (volume)  │         │ (in-process)│        │ (volume) │
      └────────────┘         └─────────────┘        └──────────┘
```

### 4.3 Deployment — single VM, Docker Compose

```
                    Internet / LAN
                          │  :443
                  ┌───────▼────────┐
                  │  proxy (Caddy) │  automatic TLS
                  └───┬────────┬───┘
             /api/*   │        │   /*
             /socket  │        │
              ┌───────▼──┐  ┌──▼──────┐
              │   api    │  │   web   │  nginx + built SPA
              │ NestJS   │  └─────────┘
              └──┬────┬──┘
                 │    │            ┌──────────┐
        ┌────────▼─┐  └───────────▶│  redis   │◀────┐
        │    db    │               └──────────┘     │
        │ Postgres │◀──────────────────────────┐    │
        └────┬─────┘                      ┌────┴────┴───┐
             │                            │   worker    │ Chromium
        ┌────▼─────┐                      │ PDF + cron  │ mem_limit 1g
        │  backup  │ nightly pg_dump      └──────┬──────┘
        └──────────┘                             │
                              volume: files ◀────┘  BOM PDFs
```

**The API and worker are separate containers.** Chromium is the memory hog — a render that
overruns its budget should not take the API down. The worker gets `mem_limit: 1g`.

**Migrations run as a one-shot `migrate` service** that `api` and `worker` wait on via
`service_completed_successfully`. A bare `docker compose up -d` on a clean VM produces a
working system rather than a crash loop.

**VM sizing: 2 vCPU / 4 GB RAM / 40 GB SSD.** 4 GB is for Chromium, not for the database.
Postgres itself stays well under 1 GB for years.

---

## 5. The seven concepts you must know

### 5.1 Product ≠ Placement (the shape of stock)

```
Product (Arduino Uno, code PRD-0142)        ← one card, one ID, forever
   ├── Placement: Meta / 2A      qty 40     ← blue chip (colour from compartment ID)
   └── Placement: Nvidia / 1C    qty 30     ← purple chip
       total on hand: 70
```

- **Product** = catalogue card, stable `product_code` forever.
- **Placement** = product × compartment × quantity. A product in two compartments has two
  placement rows. This is what makes "move 30 of 70" work without changing the product ID.
- **Location** is two levels: Zone ("Meta", "Nvidia") → Compartment ("1A", "1B", "3C").
- Placement colour is derived deterministically from the compartment ID, so the same
  location is always the same colour on every card.
- **Trackable scope** (per the requirements doc, only laptops and R&D hardware tracked today;
  furniture out of scope) is modelled as `is_trackable` on **category**, not hard-coded —
  turning furniture on later is a checkbox, not a migration. Untracked categories can still
  exist in the catalogue for reference without carrying placements or ledger rows.

**`available = quantity − reserved_qty`.** Borrow requests **reserve**; issuing decrements
both; returns increment quantity. **Consumables are issued and never return.**

| Event | quantity | reserved |
|-------|----------|----------|
| Borrow requested | — | +n |
| IM rejects / requester cancels | — | −n |
| IM approves & issues | −n | −n |
| Item returned | +n | — |
| Consumable issued | −n | −n (never comes back) |

### 5.2 The ledger is append-only and authoritative

Every stock mutation appends one immutable row:

```
id | product   | from_comp | to_comp | qty | type   | ref_type | ref_id | actor | at
17 | PRD-0142  | Meta/2A   | Nvid/1C | 30  | MOVE   | manual   | null   | u_im  | ...
18 | PRD-0142  | Nvid/1C   | null    |  2  | ISSUE  | borrow   | b_88   | u_im  | ...
19 | PRD-0142  | null      | Nvid/1C |  2  | RETURN | borrow   | b_88   | u_im  | ...
```

`SUM(ledger) == SUM(placements.quantity)` per product is the invariant you can assert
nightly. If it ever fails, you have a bug and you know it within 24 hours instead of never.
Placement quantities are a **cache** of the ledger. `stock_ledger` has no `UPDATE`/`DELETE`
grant at the DB-user level — append-only by permission, not by convention.

### 5.3 Requisition lifecycle (state machine)

```
DRAFT → IM_REVIEW → AWAITING_APPROVAL → APPROVED → BOM_GENERATED → SENT_TO_ACCOUNTS →
FUNDS_PARTIAL / FUNDS_RECEIVED → PURCHASED → STOCKED → CLOSED
```
with `REJECTED` terminal from any approval stage.

- The **IM approves first** — their approval means "confirmed, we really don't have this".
- Then approvers act **in parallel**, no fixed order. **Above the expense threshold: 2.
  Below it: 1.** Both counts are `app_settings` values, so the policy changes without a
  redeploy.
- **Any single rejection kills the whole request.** It does not need both.
- An approver may **withdraw** their approval **until the BOM is generated**.
- Approver count is **frozen at submit** from the then-current threshold. Changing the
  threshold next week must not retroactively add an approver to a request mid-chain
  (requirements §11).
- `requisition_events` is append-only by trigger (like `stock_ledger`). The live tracker
  reads both the approval rows *and* the event log so it can show
  "approved → withdrawn → re-approved".
- Over-budget rule (configurable, default 10%): if the IM's BOM total exceeds the
  **approved amount** by more than the tolerance, the requisition **bounces back for
  re-approval** instead of silently going to Accounts.
- Partial funding is normal (`FUNDS_PARTIAL`). `approved_amount` defaults to `requested`,
  may be revised down at approval. The over-budget rule compares BOM total against
  *approved*, not requested.
- `fund_returns` is a separate table (not negative `fund_receipts`), so every future
  `SUM` stays unambiguous.

### 5.4 The three money figures

| Figure | Set by | When | Can change after? |
|--------|--------|------|-------------------|
| **Requested** `requisitions.requested_amount` | Requester (sum of line estimates) | Frozen at submit | No — it is the historical ask |
| **Approved** `requisitions.approved_amount` | The approval chain | On full approval | Only via withdraw → re-approve |
| **Funded** `SUM(fund_receipts.amount)` | Inventory Manager | Each receipt logged | Grows with each receipt |

```
Requested  22,000 BDT
Approved   18,000 BDT   ▼ 4,000 revised down by Farhana Akter, CFO
Funded     10,000 BDT   ◐ 8,000 outstanding
```

The outstanding balance is displayed but **never** pings the IM. The "Remaining" column
printed on the BOM is **`Requested − Approved`** (operator's answer, OQ-18, 2026-07-30) —
how much of the request the approvers did *not* sanction. It is known at submit and never
moves.

### 5.5 BOM

Generated by the IM after full approval, from **one *or more* approved requisitions**. Carries
an **immutable `approval_snapshot`** per source requisition into `bom_requisitions.approval_snapshot`:

```json
[
  {"stage":"INVENTORY_MANAGER","name":"Tanvir Alam","designation":"Inventory Manager","acted_at":"2026-07-22T10:14:00+06:00"},
  {"stage":"APPROVER","slot":1,"name":"Kamrul Hasan","designation":"Head of Operations","acted_at":"..."},
  {"stage":"APPROVER","slot":2,"name":"Farhana Akter","designation":"Chief Financial Officer","acted_at":"...","on_behalf_of":null}
]
```

**Snapshotting matters: never render the BOM PDF by joining live to `users`.** A July BOM
must still show July's job titles even if Admin later changes someone's designation or that
person leaves. A requisition can sit on at most one live BOM (`UNIQUE` partial index where
`is_void = false`). Voiding a batched BOM returns every source requisition to `APPROVED`.
Funds are still logged **per requisition**, not per BOM; a batched BOM's pro-rata split is
pre-filled in the IM's allocation dialog.

### 5.6 Auth & sessions

- **15-minute access tokens** + **rotating refresh tokens** with family-wide revocation on
  reuse. A replayed token means it leaked; killing the family logs out the attacker at the
  cost of logging out the legitimate user — the correct trade.
- **Tokens in `localStorage`** (single-origin internal tool, no third-party embeds).
  Mitigated by short access TTL and server-side reuse detection. Revisit if it ever becomes
  internet-facing.
- **`refresh_tokens.revoked_reason`** is recorded, not inferred (migration 0005). A token
  killed by an admin and one killed by the theft response are otherwise identical and must
  tell the user different things.
- **Login rate limit: 10/min per IP** plus per-email throttle. A script that signs in five
  users repeatedly trips its own limit and then reads as 401.
- **Password policy: min 4, no composition rule** — deliberate, operator-instructed
  weakening (OQ-17, 2026-07-30). This is an internal tool on one VM behind the office
  network, with a 10/min per-IP login cap and a per-email throttle. Those two limiters and
  the hashing cost are now the only defence and **must not be weakened**.
- **`@Roles()` attaches only `RolesGuard`; `JwtAuthGuard` is global via `APP_GUARD`** —
  re-attaching it per controller would force every feature module to import `JwtModule` to
  satisfy the injector.
- **The actor is always `req.user.id`.** Never trust a client-supplied user id.

### 5.7 Supporting document on a requisition

The requester may attach **one** PDF, PNG, or JPEG (quote, vendor proposal, spec sheet) to
their own DRAFT. The rule is deliberately narrow — it is reference material for the
**decision**, not part of the **payable document**, and not part of the **BOM**.

- **Single nullable FK on `requisitions.supporting_document_file_id`** — column-over-join-table
  because the user picks exactly one document (mirrors `purchases.invoice_file_id`; DECISIONS.md
  2026-08-08). The `stored_file_kind` enum gained `SUPPORTING_DOCUMENT`.
- **DRAFT-only edit window.** Only the requester may attach, replace, or remove, and only while
  the requisition is DRAFT — the same `lockRequisition` row lock that `submit` takes guards
  against a racing submit between status check and FK repoint. Submit commits? Attach fails with
  a 409. Attach in flight? Submit waits. The race is symmetric.
- **Insert-only file model.** Replace inserts a new `stored_files` row and repoints the FK;
  the old row stays for the audit trail. Never UPDATE `stored_files.bytes`. Never mutate in
  place. The same rule as `SIGNATURE` and `INVOICE`.
- **Read authorization.** Requester, IM, Admin (always), **plus** any approver with an
  assigned row on this requisition (`requisition_approvals.assigned_user_id = actor.id`).
  Distinct from the funds-module predicate (requester + IM + Admin only) because the document
  can swing a decision — an approver acting on this requisition must be able to read it.
- **Not in the BOM snapshot.** `bom_requisitions.approval_snapshot` is who/when/role, not the
  supporting material. The supporting file is not frozen onto the BOM PDF.
- **Magic bytes + size.** The interceptor enforces `config.uploads.maxDocumentBytes` (default
  10 MB) **and** a magic-byte sniff — extension alone is not enough; `foo.exe.pdf` is still
  rejected. Read returns `Content-Disposition: inline` so the browser preview opens in a new
  tab rather than downloading.
- **Audit.** `requisition.supporting_document_attached` on attach or replace,
  `requisition.supporting_document_removed` on delete, both carrying the new file id (or null
  on remove) in metadata.
- **UI shape.** Form: third panel between *Request details* and *Items*, file picker with
  `accept=".pdf,.png,.jpg,.jpeg"`, auto-saved on pick, replace/remove buttons when present.
  Detail: small paper thumbnail card above the status panel; the card wraps an `<a target="_blank">`
  so the file opens in a new tab. The card renders nothing if the requisition has no document.

---

## 6. Layout — where to find things

```
/                                 repo root
├── CLAUDE.md                     operating rules, loaded every session (~100 lines)
├── AI_PLAYBOOK.md                THIS FILE — complete context, one read
├── START-HERE.md                 human onboarding
├── package.json                  root scripts (dev, build, test, typecheck, lint, db:*)
├── pnpm-workspace.yaml           apps/* + packages/*
├── tsconfig.base.json            strict TS, noUncheckedIndexedAccess on
├── .claude/
│   ├── settings.json             permissions + hook wiring (SessionStart, PostToolUse)
│   ├── rules/                    00..60 engineering rules, mostly path-scoped
│   ├── skills/                   /resume /build /verify /handoff /add-* /domain-context
│   ├── agents/                   explorer, backend/frontend/db/test/code/security-reviewer
│   └── hooks/                    session-state.sh, guard-hardcoding.sh, playbook-reminder.sh
├── docs/
│   ├── PROJECT-MAP.md            ONE-FILE overview (use this if you only read one doc)
│   ├── RUNBOOK.md                deploy, backup, restore, incidents (operator-facing)
│   ├── reference/                the design, split by topic — usually skip, in this playbook
│   │   ├── 00-preface.md          → inlined in §1
│   │   ├── 01-understanding.md   → inlined in §1
│   │   ├── 02-assumptions.md     → inlined in §1.5 + §3 + §11
│   │   ├── 03-architecture.md    → inlined in §4
│   │   ├── 04-domain-model.md    → inlined in §5.1–§5.4
│   │   ├── 05-user-flows.md      PER-SCREEN walkthrough — open on demand for the
│   │   │                          exact flow you are building
│   │   ├── 06-screen-map.md      → inlined in §19
│   │   ├── 07-data-model.md      → inlined in §10
│   │   ├── 08-notifications.md   → inlined in §18
│   │   ├── 09-bom.md             → inlined in §20
│   │   ├── 10-permissions.md     → inlined in §2
│   │   ├── 11-build-order.md     → inlined in plan/ (PHASE-*.md files)
│   │   ├── 12-future.md          → inlined in §17
│   │   ├── 13-open-questions.md  → see docs/state/OPEN-QUESTIONS.md
│   │   └── 14-deployment.md      → inlined in §21
│   ├── adr/                      Architecture Decision Records (expensive-to-reverse)
│   └── state/
│       ├── NOW.md                ⭐ INJECTED every session by hook (≤60 lines)
│       ├── PROGRESS.md           detailed position + phase table
│       ├── DECISIONS.md          one-line-per-decision log
│       ├── OPEN-QUESTIONS.md     OQ-* (needs answer) and G-* (deferred engineering)
│       ├── SESSION-LOG.md        newest-first, grows every session
│       └── BACKUP-DRILL.md       backup/restore drill record
├── plan/
│   └── PHASE-00..06-*.md         each phase: tasks with exit criteria (all done)
├── infra/                        docker-compose, Caddyfile, deploy/backup/restore scripts
├── apps/
│   ├── api/                      NestJS backend
│   │   └── src/
│   │       ├── main.ts, app.module.ts
│   │       ├── config/           zod-validated typed config (process.env ONLY here)
│   │       ├── database/         Kysely, migrations dir
│   │       ├── common/           shared filters, decorators, guards, pipes
│   │       ├── security/         hashing, throttling, sanitisation
│   │       └── modules/          audit, auth, boms, borrowing, categories, departments,
│   │                             files, funds, health, locations, maintenance,
│   │                             notifications, pdf, products, projects, reports,
│   │                             requisitions, settings, stock, users
│   └── web/                      React/Vite SPA
│       └── src/
│           ├── App.tsx, main.tsx
│           ├── api/              HTTP client + typed query-key factory
│           ├── components/ui/    shared primitives only
│           ├── features/         feature-first: <feature>/{components,hooks,api}
│           ├── i18n/en.ts        ALL user-visible copy lives here
│           ├── routes/           router + paths (single source of route URLs)
│           ├── styles/tokens.css design tokens (colours, spacing)
│           └── lib/, test/
├── packages/
│   └── shared/                   dual CJS+ESM build, exports zod contracts + enums +
│                                 settings registry
└── scripts/
    └── audit-deps.sh
```

---

## 7. Commands, ports, dev users

```bash
pnpm dev                  # api (3000) + web (5173), watch mode
pnpm build                # shared → api → web
pnpm test                 # unit (web + api)
pnpm typecheck            # must pass before "done"
pnpm lint                 # must pass before "done"
pnpm db:up                # start dev (5433) + test (5434) Postgres
pnpm db:migrate           # apply migrations
pnpm db:rollback          # one migration back
pnpm db:make <name>       # generate empty migration
pnpm db:seed              # idempotent reference data
pnpm --filter @ims/api test:int   # integration tests (real Postgres)
pnpm audit:deps           # dependency audit

# Verification suite (run via /verify):
bash .claude/hooks/guard-hardcoding.sh --scan-all
```

**Ports:** API **3000**, web **5173**, dev Postgres **5433**, test Postgres **5434**. Ports
5432 and 5430 were already occupied on the build machine by unrelated stacks; the compose
file reflects that.

**Seeded dev logins (dev only):** `admin@ims.local` with `SEED_ADMIN_PASSWORD` from `.env`,
plus `general@`, `im@`, `approver1@`, `approver2@` at `@ims.local` with `DevPassword123`.

**Web dev server binds IPv6 only** — `localhost:5173` works, `127.0.0.1:5173` does not.

---

## 8. Backend conventions (NestJS)

```
src/modules/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts      HTTP only: parse, authorize, delegate, serialise
├── <feature>.service.ts         business rules, transactions
├── <feature>.repository.ts      SQL / query builder (Kysely)
├── dto/                         zod schemas + inferred types
├── entities/
└── <feature>.service.spec.ts
```

- **Controllers contain no business logic.** If a controller has an `if` that isn't a guard
  clause, it belongs in the service.
- Every request body, query, param parsed by **zod at the controller boundary**; types
  inferred via `z.infer<typeof X>`. Never declared twice.
- Multi-row changes: **one explicit transaction passed as a parameter**. No ambient context.
- Lock rows in **consistent order** (always by `placement.id` ascending) or you will deadlock.
- **Never** call an external service (email, PDF) inside a transaction. Enqueue for after
  commit.
- **`Idempotency-Key` header** on every mutating endpoint, stored with a unique index. A
  double-click never double-approves.
- `@Roles(Role.X)` for coarse checks; ownership/state checks live in the service.
- Actor is **always** `req.user.id`. Never trust a client-supplied user id.
- **Typed domain exceptions** (`InsufficientStockError`), not strings.
- API errors return `{ code, message, details? }`. `code` is a stable machine-readable enum.
- User-facing messages never leak SQL, stack traces, or internal IDs.
- Settings registry is data-driven from `packages/shared/src/settings/registry.ts` — adding a
  business value is **one entry plus one config-schema line**, nothing to keep in sync.
- Env seeds `app_settings` on first boot only (`ON CONFLICT DO NOTHING`) — a restart must
  **never** reset a value an admin has since changed.
- **`process.env` appears in exactly one file** (`config/config.schema.ts`). ESLint custom
  rule `NO_PROCESS_ENV` and the guard hook enforce this.

---

## 9. Frontend conventions (React + TS)

- **Server state through TanStack Query.** No `useEffect` + `fetch`. Period.
- Query keys from typed factory in `src/api/keys.ts`. **Precise invalidation.**
- WebSocket pushes **invalidation signals**, not data. Server stays source of truth.
- **Forms:** React Hook Form + the **same zod schema the API uses**, imported from
  `@ims/shared`. Never redefine validation on the client.
- **Every data screen handles 4 states:** loading · empty · error-with-retry · loaded.
  "Empty" is not "loading forever".
- **No user-visible string literals** in JSX. Everything from `src/i18n/en.ts`. This is not
  about translation — wording changes are one file, and the QA checklist can diff copy.
- **No hex colours, no arbitrary Tailwind values.** Use semantic tokens
  (`text-success`, `text-pending`, `text-danger`). Tracker's green/ash/red defined once.
- Feature-first: `src/features/<feature>/{components,hooks,api}`. `src/components/ui/` is
  shared primitives only. Component used by one feature lives in that feature.
- Props explicitly typed. No `React.FC`, no implicit `any`, no `{...rest}` onto DOM elements
  without a typed pick. Component over ~150 lines is doing two jobs — split it.
- **Never optimistic-update anything stock-related**; server can reject on lock conflict.
- A11y floor: labels tied to inputs, visible focus, dialogs trap focus + close on Escape,
  tables have headers.
- **Web app selects error copy by `code`, not message.** A new failure mode needs a new
  `ErrorCode` member, or the UI shows the old sentence however good the server's message is.
- **The web router ends in a catch-all redirect**, so a broken notification link silently
  lands on the dashboard rather than erroring — links must come from
  `notifications.links.ts`, which mirrors `apps/web/src/routes/paths.ts`.

---

## 10. Database — schema, constraints, locking recipe

### 10.1 Tables (33 tables, 23 migrations)

**Identity & admin** — `app_settings`, `departments`, `users`, `user_roles`, `refresh_tokens`,
`login_attempts`, `approver_slots`, `delegations`, `projects`, and the `user_role` /
`refresh_revocation_reason` enums.

**Catalogue & locations** — `categories` (parent of itself for sub-categories), `products`,
`storage_zones`, `storage_compartments`.

**Stock** — `stock_placements`, `stock_ledger`, `asset_units` (dormant, optional serial
tracking via `is_trackable` on **category**).

**Borrow** — `borrow_requests` (status: `PENDING|REJECTED|ISSUED|PARTIALLY_RETURNED|RETURNED|CANCELLED`),
`borrow_returns` (partial returns supported).

**Requisitions** — `requisitions` (status enum: full lifecycle, see §5.3; a single
nullable `supporting_document_file_id` FK for the requester-attached quote / proposal /
spec sheet, DRAFT-only edit, insert-only), `requisition_items`, `requisition_approvals`
(stage `INVENTORY_MANAGER|APPROVER`, slot 1 or 2, action `PENDING|APPROVED|REJECTED|WITHDRAWN`),
`requisition_events` (append-only by trigger).

**BOM** — `boms`, `bom_requisitions` (carries the `approval_snapshot` JSON), `bom_lines`
(units costed by the IM at generation, total GENERATED).

**Money & purchases** — `fund_receipts`, `fund_returns` (separate table, not negative
receipts), `purchases`, `purchase_lines` (carry `stocked_to_compartment_id` — the receive-
to-stock step).

**Cross-cutting** — `notifications` (in-app bell, no email per OQ-10), `audit_log`
(append-only by trigger), `stored_files` (uploads — signatures, invoices, supporting
documents; kinds `SIGNATURE`, `INVOICE`, `SUPPORTING_DOCUMENT`; a new row per upload so a
BOM printed in July keeps the signature that was actually used).

### 10.2 Money fields

- `numeric(14,2)` everywhere money appears.
- BDT only. No multi-currency (A10).
- `estimated_line_total` is a **GENERATED column**, never written — a line total that
  disagrees with its own inputs is how a requisition total silently drifts.

### 10.3 The constraints that make the system "error free"

```sql
-- one placement row per product per compartment
ALTER TABLE stock_placements
  ADD CONSTRAINT uq_placement UNIQUE (product_id, compartment_id);

-- stock can never go negative, reservations can never exceed stock
ALTER TABLE stock_placements
  ADD CONSTRAINT ck_qty      CHECK (quantity >= 0),
  ADD CONSTRAINT ck_reserved CHECK (reserved_qty >= 0 AND reserved_qty <= quantity);
-- (also: quarantined >= 0, reserved + quarantined <= quantity)

-- one compartment code per zone
ALTER TABLE storage_compartments
  ADD CONSTRAINT uq_compartment UNIQUE (zone_id, code);

-- an approver appears at most once per requisition
ALTER TABLE requisition_approvals
  ADD CONSTRAINT uq_approval UNIQUE (requisition_id, stage, slot);

-- a BOM may cover several requisitions, but a requisition sits on at most one live BOM
CREATE UNIQUE INDEX uq_live_bom_req
  ON bom_requisitions (requisition_id)
  WHERE bom_id IN (SELECT id FROM boms WHERE is_void = false);
-- belt-and-braces in BomService inside the generating transaction

-- only fully approved requisitions may be added to a BOM  (service-level guard)
-- returns can never exceed what was borrowed  (enforced in service + trigger)
```

`stock_ledger`, `requisition_events`, `audit_log` are **append-only by trigger**, not grant —
even the owner is refused. A correction is a new compensating row, never an edit.
`approver_slots.slot_no` is constrained to **(1, 2)** — there is no slot 3 to fall back to.

### 10.4 The concurrency recipe (StockService)

Every stock write follows this exact shape — copy it verbatim:

```ts
await this.db.transaction(async (tx) => {
  const placement = await this.stock.lockPlacement(tx, placementId); // SELECT ... FOR UPDATE
  // re-read quantity from the locked row, never trust a value read earlier in the request
  // apply the change
  // append exactly one stock_ledger row describing it
});
// then enqueue emails/PDFs for after commit
```

Plus three more concurrency rules baked into the schema:

1. **Optimistic lock on the UI path.** The client sends the `version` it rendered; a mismatch
   returns `409 Conflict` → "stock changed, refresh".
2. **Idempotency keys** on all approve/reject/borrow/move endpoints (`Idempotency-Key`
   header, unique index).
3. **Approval races**: `UPDATE requisition_approvals SET action='APPROVED' WHERE id=$1 AND
   action='PENDING'`. Zero rows affected = someone already acted; return a clean error
   instead of overwriting a rejection. **Decisions and returns are claimed with a
   conditional UPDATE** (`WHERE status = 'PENDING'`, `WHERE returned_qty = <what we read>`)
   rather than read-then-write — two IMs on a shared screen is the normal case, and zero
   rows updated is how the loser finds out instead of both issuing stock.

**Nightly invariant check** (task 6.2) runs `SUM(ledger by product) ==
SUM(placements.quantity)` AND checks `reserved_qty` consistency (G-14) — a stranded
reservation was the whole failure mode G-14 described. A mismatch is an **alert**, not a
warning.

### 10.5 Migration rules

- Every schema change is a checked-in reviewed migration file. **Never** `synchronize: true`.
- **Additive first.** Add nullable → backfill → enforce not-null in a later migration.
- **Never rename in place.** Add new column, copy, ship, drop old one **next release**.
- **Never drop a column in the same release that stops writing to it.** Release N stops using
  it; release N+1 drops it. Otherwise a rollback loses data.
- Every migration is tested by running it against seeded data, then rolling back.
- Migrations **never** contain business data. Seeds do, idempotent (`ON CONFLICT DO NOTHING`).
- Kysely + hand-written SQL migrations (not an ORM) — `synchronize: false` is required, and
  Kysely has no such concept at all, so the illegal state is unrepresentable rather than
  merely configured off.

### 10.6 Indexes worth having on day one

```
products              (name gin_trgm)              -- combobox search
stock_placements      (product_id)
stock_ledger          (product_id, created_at DESC)
borrow_requests       (product_id, created_at DESC), (requester_id), (status)
requisitions          (requester_id, created_at DESC), (status)
requisition_approvals (assigned_user_id, action)   -- powers the badge count
requisition_events    (requisition_id, created_at)
notifications         (user_id, is_read, created_at DESC)
```

**Query hygiene**

- Every list endpoint **paginated** (`PAGINATION_MAX_PAGE = 10_000` shared bound, G-13).
- N+1 queries are a review blocker. Use joins or a dataloader; check query count in tests.
- **Interpolating the same Kysely `sql` fragment twice re-emits parameters with different
  placeholder numbers** → `GROUP BY <expr>` won't match `SELECT <expr>`. Group positionally.
- **Fan-out trap**: joining a requisition to `fund_receipts`, `purchases` and `fund_returns`
  at once multiplies the rows and inflates every figure. Pre-aggregate per requisition.

---

## 11. Settings & config ownership

| Kind of value | Home | Changed by |
|---|---|---|
| Secrets, connection strings, hostnames, ports | env → `apps/api/src/config/config.schema.ts` (only file) | ops, at deploy |
| Business policy (expense threshold, over-budget tolerance, reminders) | `app_settings` table via `SettingsService` (cached, invalidated on write) | admin, at runtime |
| Domain constants (status names, role names, movement types) | TS enum + Postgres enum | a migration |
| Layout, colour, spacing | design tokens (`apps/web/src/styles/tokens.css`) | designer |
| Copy shown to a user | `apps/web/src/i18n/en.ts` | anyone |

**The audit purge** ships disabled by default; an admin must set `AUDIT_RETENTION_DAYS` to
enable it. Retention is an explicit preset list (`AUDIT_RETENTION_PRESETS` in
`packages/shared/src/settings/registry.ts`: 5/10/15 days, 1/3/6 months, 1/3/5/10 years,
Forever). The admin UI presents these as a dropdown so the persisted day count always
matches a label.

**Audit always-on core** (`AUDIT_ALWAYS_ON_ACTIONS` — the `auth.*`, `user.*`, `settings.update`
and `audit.purge` families) cannot be disabled by the admin toggle — an admin able to stop
their own actions being recorded defeats the feature.

**`AUDIT_ENABLED_ACTIONS` is the one setting reconciled on every boot.** `SettingsService.seedMissing`
appends `AUDIT_ACTIONS - AUDIT_KNOWN_ACTIONS` to the stored array, then rewrites
`AUDIT_KNOWN_ACTIONS` to the current `AUDIT_ACTIONS`. Its value is a materialised snapshot of a
code-level list, so without this an action added by a later release is absent from the stored
allow-list and is silently never recorded on any already-booted database. Adding a new
`AuditAction` therefore needs no migration. `AUDIT_KNOWN_ACTIONS` is an `InternalSettingKey`
(`packages/shared/src/settings/registry.ts`) — an `app_settings` row that is deliberately *not* a
`SettingKey`, so it has no env seed, never appears in `SettingsService.list()` or the admin panel,
and `PUT /admin/settings` rejects it. It is what distinguishes "this release introduced the action"
from "an admin switched it off": the latter stays off across every restart (`DECISIONS.md`,
2026-08-07).

**Settings changed by hand in dev persist** — reset `EXPENSE_THRESHOLD_BDT` to 15,000 or read
it live rather than assuming.

---

## 12. Testing priorities (finite budget)

1. **Stock arithmetic + concurrency.** Reserve/issue/return/move/split/oversell — integration
   tests against real Postgres, **not mocks**.
2. **Approval state machine.** Every legal transition + illegal ones rejected.
3. **Threshold and approver-count logic**, including that a threshold change does not affect
   in-flight requisitions.
4. **Permission boundaries.** Each role hitting each endpoint it should not reach.
5. Everything else: happy path only.

**Mandatory:** the concurrency test fires N simultaneous borrow requests against stock 1,
asserts exactly one succeeds and the ledger has exactly one ISSUE row (this test is the
reason the locking exists).

**Rules**

- Integration tests run against throwaway Postgres (testcontainers or compose service),
  migrated from scratch each run.
- Each test creates its own data via factories and cleans up in a transaction rollback.
  **No shared fixtures that tests mutate** — that is how you get order-dependent flakes.
- **No `sleep`.** Await the actual condition.
- A flaky test is deleted or fixed the day it appears. A tolerated flake trains everyone to
  ignore red.
- Tests assert on observable behaviour, not mock calls.
- Integration tests transpile with tsc, not esbuild — esbuild cannot emit
  `design:paramtypes`, so Nest DI fails to resolve anything under vitest's default transform.

---

## 13. Infra rules

- **A deploy must never be able to lose data.** Postgres in named volume `ims_pgdata`. Never
  bind-mount, never anonymise.
- Postgres image pinned to **major version**. Major bump = planned dump-and-restore, not tag
  change.
- **`docker compose down -v` and `docker system prune --volumes` are forbidden.** `deploy.sh`
  never calls `down` at all.
- Migrations run as one-shot `migrate` service that **must exit 0** before `api` starts.
- `deploy.sh` takes a backup before doing anything else.
- Multi-stage builds, non-root user, no build toolchain in runtime layer.
- Pin base images by major+minor. Never `:latest`.
- No secrets in images or build args. Secrets via `env_file` at runtime.
- Healthchecks on `api` and `db`; compose ordering depends on them, not `sleep`.
- Docker log rotation via `x-logging` anchor — without it, json-file logs fill the disk.
- `restart: unless-stopped` everywhere. Disk snapshots if the host offers them.

---

## 14. Conventions (naming, comments, git, errors)

**Naming**
- DB: `snake_case`, plural tables, `<table>_id` foreign keys.
- TS: `camelCase` values, `PascalCase` types, `SCREAMING_SNAKE` for constants.
- Booleans read as assertions: `isActive`, `hasApproved`, `canWithdraw`.
- No abbreviations except project glossary (`BOM`, `IM`, `BDT`).

**Comments**
- Comment the *why*, never the *what*. A comment explaining *what* means rename instead.
- Exception: any non-obvious business rule cites its spec section,
  `// requirements §4: either rejection kills the whole request`.

**Git**
- Conventional commits: `feat(stock): …`, `fix(approvals): …`, `chore(deps): …`.
- One logical change per commit. Migration + the code that uses it belong together.
- Never commit `.env`, dumps, or generated PDFs.

**Errors**
- Never swallow an error. Either handle it or let it propagate to the global filter.
- Domain failures are typed exceptions (`InsufficientStockError`), not strings.
- User-facing messages never leak SQL, stack traces, or internal IDs.

**Engineering judgement**
- Prefer the boring solution. 12 users; cleverness costs more than it saves.
- Make illegal states unrepresentable. A `CHECK` constraint beats a comment beats a code review.
- Fail fast and loudly at boot (bad config, missing migration) rather than at 3pm on a Tuesday.
- When two designs are close, pick the one that is easier to delete.

---

## 15. Skills & agents — when to use

### 15.1 Skills (slash commands)

| Skill | Use when |
|-------|----------|
| `/resume` | Session start; loads current state and proposes the next task |
| `/build [NN]` | Execute the next unfinished phase end-to-end |
| `/verify [NN]` | Phase exit criteria check (run typecheck/lint/test/guard + exercise endpoints) |
| `/handoff` | End of session; rewrite NOW.md, append SESSION-LOG, commit |
| `/add-endpoint` | Add an API endpoint (zod DTO, service, repo, controller, tests) |
| `/add-migration` | New migration: additive first, rollback tested |
| `/add-screen` | New web feature folder: query hooks, RHF form, i18n, states |
| `/adr` | Record an architectural decision expensive to reverse |
| `domain-context` | (auto-loaded) stock/borrowing/requisitions/BOM vocabulary |

### 15.2 Agents (specialists)

| Agent | Purpose |
|-------|---------|
| `explorer` (haiku, read-only) | "where is X handled?", "what already exists for Y?" — search before implementing |
| `db-engineer` | Migration authoring/review |
| `backend-engineer` | Implement a spec'd backend slice |
| `frontend-engineer` | Implement a spec'd UI slice |
| `test-engineer` | Write tests for a slice |
| `code-reviewer` | Before marking a task done |
| `security-reviewer` | Anything touching auth, permissions, file uploads |

**Delegate reading; keep judgement in the main thread.**

### 15.3 How to work (the workflow)

1. **At session start:** `docs/state/NOW.md` is auto-injected. Trust it; do not re-read
   `PROGRESS.md` or `SESSION-LOG.md`.
2. **Orient:** open only the one `plan/PHASE-NN-*.md` task, then the **one**
   `docs/reference/*.md` file it names (usually `05-user-flows.md`).
3. **Delegate reading** to the `explorer` subagent — keep search output out of the main thread.
4. **Implement** via the right specialist (`db-engineer`, `backend-engineer`,
   `frontend-engineer`).
5. **Test** via `test-engineer`. Tests assert observable behaviour, not mock calls.
6. **Verify:** `pnpm typecheck && pnpm lint && pnpm test` — not "should pass", run it.
7. **Review** via `code-reviewer` (or `security-reviewer` for auth/permissions/uploads).
8. **Commit** one logical change with conventional commits.
9. **At session end:** `/handoff` rewrites `NOW.md`, appends to `SESSION-LOG.md`, commits.

---

## 16. Landmines (each has cost a session before)

- **Docker Desktop stops itself between sessions.** `docker info` before any migration/test.
- **Never run `apps/api` through `tsx`** — esbuild drops `design:paramtypes` and Nest DI
  resolves every injected dep to `undefined`. Use `pnpm --filter @ims/api build && node
  dist/src/main.js` or `pnpm dev`. `tsx` is fine for `scripts/migrate.ts` / `seed.ts` (no DI).
- **A stale API process is not a code bug.** Check process start time against `dist/` mtime.
  Built entrypoint is `apps/api/dist/src/main.js`, not `dist/main.js`.
- **Dev DB 5433, test DB 5434.** Never `docker compose down -v`.
- **Web dev server binds IPv6 only** — `localhost:5173` works, `127.0.0.1:5173` does not.
- `stock_ledger`, `requisition_events` and `audit_log` are **append-only by trigger** — even
  a cascade or `ON DELETE SET NULL` fails. That's why `resetData` cannot delete them.
- `resetData` cannot delete requisitions, departments or users → **test DB accumulates** them.
  Never assert "exactly one row" or "it is on page one" — scope by an id you created.
- `boms-pdf.int-spec.ts` overrides `PdfRendererService` with a local stub — add any new
  renderer method there too. `test/app.ts` sets `logger: false`, so a 500 arrives with no stack.
- **Interpolating the same Kysely `sql` fragment twice re-emits parameters with different
  placeholder numbers** → `GROUP BY <expr>` won't match `SELECT <expr>`. Group positionally.
- **Web app selects error copy by `code`, not message.** A new failure mode needs a new
  `ErrorCode` member, or the UI shows the old sentence however good the server's message is.
- `approver_slots.slot_no` is constrained to **(1, 2)** — there is no slot 3 to fall back to.
- Settings changed by hand in dev **persist** — reset `EXPENSE_THRESHOLD_BDT` to 15,000 or
  read it live rather than assuming.
- A smoke script that logs in repeatedly **trips its own rate limit** (10/min/IP).
- Integration run takes ~50s but has exceeded a 600s shell timeout when DB was cold — redirect
  to file and grep, don't stream.
- **Timezone bug**: ranges resolved in UTC miss Dhaka's 4am-yesterday. Ranges must be calendar
  days in `REPORTING_TIME_ZONE`, resolved by Postgres via `AT TIME ZONE`.
- **`@typescript-eslint/consistent-type-imports` is off for `apps/api/src`** — Nest resolves
  DI from `design:paramtypes`, which the compiler only emits for value imports, so the
  rule's autofix silently breaks the container at boot.

---

## 17. Open work & known gaps

Current best view is `docs/state/OPEN-QUESTIONS.md`. Snapshot of operator-actionable items:

**Go-live blockers (operator's list, not code):**
- **G-16** — Offsite backups. Lines in `infra/backup.sh` (rclone / aws s3) are commented out;
  backups live on the same VM as the database.
- **G-17** — Run the restore drill on the production stack (only drilled on scratch DB).
- **Three settings** with no safe default: Approver slots 1/2, **Sub-threshold approver**
  (most commonly missed — the symptom is "An approver has not been assigned" on submit
  while Approver 1 and 2 slots are visibly filled), expense threshold.
- Appoint a **second Inventory Manager and a third approver** — nobody may approve their
  own, so a lone IM or approver cannot submit.

**Unconfirmed assumptions (🟡 in OQ):**
- OQ-14 audit always-on core membership.
- OQ-16 notification audience.
- OQ-20 part-payments kept (status enum already has `FUNDS_PARTIAL`).
- OQ-22 borrow-to-user may target any active user (plan defaults picker to requester).

**Deferred engineering (G):**
- G-18 — integration tests write uploads into dev storage dir (orphans).
- G-19 — five endpoints return a bare array rather than `Paginated<T>` — revisit past ~1000
  rows (`projects`, `candidates` self-drains; `categories`, `zones`, `settings` are bounded
  by admin action).

**Things to revisit as this grows** (from `docs/reference/12-future.md`):
- Serial-number tracking. `asset_units` dormant; flip via `is_trackable` on category.
- Approval chains beyond 1-or-2: replace frozen `required_approver_count` with a rules table.
  `requisition_approvals` already supports N approvers.
- Multi-warehouse: a `warehouse` level above zone, one column.
- Accounts integration: `fund_receipts` and `purchases` shaped for an ERP sync to write.

---

## 18. Notifications matrix

| Trigger | Recipient | Channel |
|---------|-----------|---------|
| Borrow request raised | Inventory Manager | socket popup + badge + bell |
| Borrow approved / rejected | Requester | bell (+ email) |
| Item overdue | Borrower + IM | daily job |
| Requisition submitted | Inventory Manager | popup + badge |
| IM approved | Approver 1 & 2 (or delegates) | badge + email |
| Approval deadline passed, still pending | Assigned approver | job, repeats every 24h until acted |
| Rejected at any stage | Requester (note attached) | bell + email |
| Approval withdrawn | Requester + IM + other approver | bell |
| BOM generated | Requester | bell |
| Funds received (partial or full) | Requester | bell |

**Deliberately absent per the requirements doc:** the IM is never pinged when the remaining
balance arrives; there is no low-stock alerting. Both omissions are easy to reverse later —
the job scaffolding is already there.

**Login popup:** on socket connect the server pushes any `PENDING` items for that user. The
IM sees the modal, can dismiss it, and the items remain in Pending Approvals with the badge
count. Dismissal is per-session, not permanent.

**Notification links** come from `notifications.links.ts`, which mirrors
`apps/web/src/routes/paths.ts`. A test fails if any notification links somewhere the app
does not serve.

---

## 19. Screen map

| Role | Screens |
|------|---------|
| **General** | Inventory (browse/search/borrow) · Projects → Project Detail (borrowed items with in-use/returned tags + project requisitions) · Make Requisition (with **supporting document panel** on DRAFT, §5.7) · My Requisitions (tracker) · My Borrowings · Notifications |
| **Inventory Manager** | Inventory (full CRUD, categories, zones/compartments, moves) · Projects (may detach a borrow from project attribution; borrow + stock history remain) · Pending Approvals ⁽ᵇᵃᵈᵍᵉ⁾ · Accepted Approvals · Product Borrowing Approvals · BOM workspace · Funds & Purchases · + all General screens |
| **Approver** | Projects → Project Detail · Pending Approvals ⁽ᵇᵃᵈᵍᵉ⁾ · Accepted Approvals (sees **supporting document card** on the requisition detail page when the requester attached one) · Delegate settings · + all General screens |
| **Admin** | Projects (same detach permission as IM) · Users · Roles & Approvers · Departments · Settings · Audit log |

For the **per-screen click-by-click walkthrough**, open `docs/reference/05-user-flows.md`.
That file is intentionally not inlined here because (a) it is 227 lines and changes when
the UI does, and (b) you only need the exact flow you are building.

---

## 20. BOM generation rules

- Triggered by the IM once status = `APPROVED`. Auto-filled from the requisition; the IM
  fills in **unit cost** and **vendor** per line.
- **One BOM, one or more requisitions.** Only requisitions in `APPROVED` are selectable. A
  requisition can sit on at most one live BOM (`UNIQUE` partial index). Each BOM line carries
  its own **purpose** and **linked project**, inherited from its source requisition — a
  batched BOM stays legible line by line.
- Funds are still logged **per requisition**, not per BOM. If Accounts releases one lump sum
  against a batched BOM, the IM allocates across the source requisitions; the dialog
  pre-fills a pro-rata split.
- **Voiding a batched BOM returns every source requisition to `APPROVED`.**
- At generation time the system takes an immutable **`approval_snapshot`** per source
  requisition into `bom_requisitions.approval_snapshot` — see §5.5 for the shape.
- **Other PDF exports:** inventory records, exportable as PDF for Accounts. Same rendering
  pipeline, different template: current stock by product with location breakdown, plus
  filtered variants (by category, zone, project, borrow ledger for a date range). Landscape
  A4, company pad header, generated on demand rather than stored.
- The BOM PDF is rendered from an HTML template carrying the company pad as a background
  layer, with the footprints block at the bottom (name over designation over date, one
  column per approver — and one footprints block per source requisition on a batched BOM).
- Rendered once, stored in the `files` volume, served by signed URL. Regeneration voids the
  old BOM and issues a new number — no silent overwrites.
- PDF token (`PdfDownloadTokenInvalidError` / `PdfRenderFailedError`) keeps its `reason`
  discriminator as a field, never as `details` — the exception filter copies `details` into
  the response, which would otherwise leak Chromium launch failures (container paths,
  executable location) to the caller (G-12).

---

## 21. Capacity, deployment, runbook essentials

### 21.1 Capacity

Target load: **12 users**, **~5,000 products**, **5–6 requisitions/day**, continuous
type-ahead search.

| Dimension | Your load | What one small VM handles | Headroom |
|---|---|---|---|
| Concurrent requests | 3–5 at peak | 500+ | ~100× |
| Search queries | maybe 2,000/day | 2,000/**second** with a trigram index | ~86,000× |
| Writes (borrows + requisitions + moves) | ~50/day | thousands/second | vast |
| DB size after 3 years | well under 500 MB | limited by disk | — |
| BOM PDFs | ~6/day ≈ 400 MB/year | limited by disk | — |

**VM: 2 vCPU, 4 GB RAM, 40 GB SSD.** Over-provisioned on purpose.

**No Redis, no queue server.** Reminder and overdue jobs are `node-cron` firing one indexed
query every 15 minutes. PDF generation runs in-process behind a spinner. Add BullMQ only if
you ever run more than one API container. **No read replicas, no caching layer, no connection
pooler.** A pool of 10 connections against Postgres' default 100 is 8× more than you need.
**No zero-downtime deployment** — a 20-second restart at 9pm is invisible to twelve people.
**Search stays in Postgres** (`gin_trgm` on `products.name`) plus a 250 ms client debounce and
`LIMIT 20`. Revisit at ~1M products.

### 21.2 Deploy model

Single VM, Docker Compose. `infra/`:

```
infra/
  docker-compose.yml     db · migrate · api · web · proxy
  docker-compose.dev.yml dev-only ports
  Caddyfile              TLS + routing
  .env.example           copy to .env on the VM, never commit
  deploy.sh              backup → pull → migrate → up -d → health check
  backup.sh              pg_dump + files tarball, 30-day retention
  restore.sh             restore a dump, keeps the old DB aside
```

Your update loop becomes:

```bash
cd /opt/ims
./deploy.sh            # or ./deploy.sh v1.4.2 to pin a version
```

which backs up, pulls, runs migrations as a one-shot container, brings the app up only if
migrations succeeded, and waits for the health check. `docker compose up -d` on its own
works too — `deploy.sh` just adds the backup and the guard rails.

### 21.3 What runs in production (5 containers)

| Service | What it is | Notes |
|---|---|---|
| `db` | PostgreSQL 16.4 | **Never published to the host.** Data in the `pgdata` volume. |
| `migrate` | The API image, run once | Applies migrations, then exits. `api` waits for it. |
| `api` | NestJS backend | Health at `/health`. Uploads and PDFs in the `files` volume. |
| `web` | The React SPA | Static files. |
| `proxy` | Caddy | Owns ports 80/443 and gets the TLS certificate automatically. |

**Two volumes matter, and they are the whole system:**
- **`pgdata`** — the database. Losing it is losing everything.
- **`files`** — uploaded signatures, uploaded invoices, and generated BOM PDFs.

`docker compose down -v` deletes both. There is never a reason to run it.

### 21.4 First install (on a fresh VM)

```bash
git clone <repo> /opt/ims && cd /opt/ims/infra
cp .env.example .env
# edit .env: replace every CHANGE_ME
openssl rand -hex 32      # JWT_ACCESS_SECRET
openssl rand -hex 32      # JWT_REFRESH_SECRET
openssl rand -hex 32      # PDF_SIGNING_SECRET
openssl rand -hex 32      # POSTGRES_PASSWORD
# the three secrets must all differ from each other, and the API refuses to boot
# if any two match
# set IMS_DOMAIN (DNS must already point at this VM)
# set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD

mkdir -p backups
docker compose up -d
docker compose ps         # all services up, api healthy
```

Sign in as `SEED_ADMIN_EMAIL`. You will be forced to change the password immediately — that
is by design, and the seed password is now spent.

### 21.5 Go-live checklist (operator, not code)

Three settings have no safe default and the system will refuse work until they are set.
**Admin → Settings**: Approver slots 1 and 2, **Sub-threshold approver** (different from the
slots, most commonly missed), expense threshold (BDT).

Nobody can approve their own requisition. If the only IM or approver raises a requisition,
the system stands someone else in, and refuses the submit with `SELF_APPROVAL_NO_SUBSTITUTE`
when none exists. **Appoint a second Inventory Manager and a third approver** to avoid this.

For full incident handling see `docs/RUNBOOK.md` (the operator runbook; it duplicates the
essentials above and adds the on-call playbook).

---

## 22. What "done" means for a task

- Types check, lint passes, tests pass.
- New behaviour has a test that **fails without the change**.
- No hardcoded values introduced (the guard hook will tell you).
- `docs/state/PROGRESS.md` checkbox ticked.
- Any decision recorded in `docs/state/DECISIONS.md` with one line of reasoning.
- One logical commit with conventional message.
- If you touched stock, approvals, or schema: state out loud which invariant you are
  protecting and how.
- **If you added an upload feature:** DRAFT-only edit window (or whatever the domain's
  freeze rule is), insert-only `stored_files` row model (replace inserts a new row),
  magic-byte sniff + interceptor size guard, read-authorization matrix stated in the
  playbook (§5.x), audit rows for attach / remove / replace, integration tests for
  every status + role combination, and a live-stack smoke run before the last commit.
  Anything less and the next session will redo your work.

---

## 23. Maintenance of this playbook

This file is updated by the AI itself after every meaningful edit, per the
`PostToolUse:Write|Edit` hook `.claude/hooks/playbook-reminder.sh` and the rule
`.claude/rules/05-ai-playbook.md`. The reminder is **advisory** — when you change
schema, modules, commands, landmines, decisions, or workflow, refresh the relevant
section here. **Do not rewrite the whole file on every edit** — touch only what changed.

**Update in the same PR as the feature, not at session-end.** A fresh agent reading
the playbook to load context will not know the feature exists if it lives only in
PROGRESS.md. Minimum set for a shipped feature:

- §5.x — one new concept subsection per new domain object or rule (auth shape, freeze
  rules, file model, audit actions).
- §1.5 — append a gap row (`G{n}`) so the decision is traceable from the story.
- §10.1 — table, column, migration count, and `stored_file_kind` enum value (if a new one).
- §19 — touch the screen map row if any new UI shipped.
- §22 — extend the "done" definition when the new feature introduces a new shape of risk
  (e.g. uploads).

PROGRESS.md and DECISIONS.md are session-tracking; the playbook is the load-the-context
file. Both matter; this one is what a cold-start agent reads first.

This playbook is a **derivative summary**, not a source of truth. If something here
conflicts with `CLAUDE.md`, `docs/reference/`, `docs/state/`, or the actual code, **the
canonical source wins and this file must be updated to match.**