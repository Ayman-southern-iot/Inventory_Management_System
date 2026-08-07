# IMS — Project Map

> **Single-session orientation.** Read this first, then the one reference file relevant to the task.
> The deeper docs in `docs/reference/` split on purpose — open one, not the folder.

---

## What this is

Internal **procurement + inventory + BOM** system for **Southern IoT** (Dhaka, BDT,
`Asia/Dhaka`). 12 users. Three loops:

1. **Borrow** — search catalogue → request → IM approves/hand-over → return.
2. **Requisition** — something not in stock → IM review → N approvers (1 below 15,000 BDT,
   2 at-or-above) → BOM → funds → purchase → receive → stock.
3. **BOM** — printable PDF on letterhead, immutable `approval_snapshot`.

Monorepo on pnpm: **api** (NestJS) + **web** (React/Vite) + **shared** (zod contracts).
Single VM, Docker Compose, Caddy in front. Postgres 16.

**Build status (Aug 2026):** all seven phases done, **368 integration tests green**,
typecheck/lint/test green. No new phase is open. Work to do is **go-live ops**, not
construction. See `docs/state/NOW.md` for the *current* "what's next".

---

## File map (start-here pointers)

| Need | Open this |
|---|---|
| Operating rules, what "done" means | `CLAUDE.md` |
| First-time onboarding | `START-HERE.md` |
| What the project is | `docs/reference/01-understanding.md` |
| Architecture + tech choices | `docs/reference/03-architecture.md` |
| **The three ideas** (placements/ledger, three-money, approval chain) | `docs/reference/04-domain-model.md` |
| Database schema (33 tables, 19 migrations) | `docs/reference/07-data-model.md` |
| State of the build | `docs/state/PROGRESS.md` + `docs/state/NOW.md` |
| Why something was decided | `docs/state/DECISIONS.md` + `docs/adr/` |
| Unresolved product questions | `docs/state/OPEN-QUESTIONS.md` |
| Run the system / deploy / backup / drill | `docs/RUNBOOK.md` |
| Operate the next phase | `plan/PHASE-*.md` (lowest unchecked — none right now) |
| Slash commands / agents / rules | `.claude/skills/`, `.claude/agents/`, `.claude/rules/` |

---

## Non-negotiables (do not violate)

These are the rules every session is bound by. Breaking any of them is the most common
way this project gets ruined.

1. **No hardcoded values.** Anywhere. Layered ownership:
   `process.env` → `apps/api/src/config/config.schema.ts` (only file that touches it).
   Business values → `app_settings` table via `SettingsService`. Enums → `@ims/shared`.
   UI copy → `apps/web/src/i18n/en.ts`. Hex/Tailwind values → `apps/web/src/styles/tokens.css`.
   Backed by `.claude/hooks/guard-hardcoding.sh`.
2. **Only `StockService` writes stock.** It is the **only** module that touches
   `stock_placements` or `stock_ledger`. Every change is one transaction, `SELECT ... FOR UPDATE`
   ordered by id ascending, one append-only ledger row, commit. Codified in
   `docs/adr/0001-stock-as-placements-and-ledger.md`.
3. **Schema changes are migration files only.** `synchronize: false` in every env, including
   local. A dropped column is unrecoverable user data. Additive first
   (nullable → backfill → tighten in a later migration).
4. **Database constraints are the real guarantees.** Money = `numeric(14,2)`.
   `stock_placements`: `quantity ≥ 0`, `reserved_qty ≥ 0`, `quarantined ≥ 0`,
   `reserved+quarantined ≤ quantity`, `UNIQUE(product_id, compartment_id)`.
   `stock_ledger`, `requisition_events`, `audit_log` are append-only by DB **trigger**,
   not grant — even the owner is refused.
5. **Never invent a requirement.** If the spec doesn't say it, check `OPEN-QUESTIONS.md`.
   If it isn't answered, add an entry there and implement the smallest defensible default,
   marked `// OPEN QUESTION: <id>`. Do not silently guess.
6. **No process.env outside config.** Enforced by ESLint custom rule (`NO_PROCESS_ENV`)
   *and* by `process.env` count grep in the guard hook.

---

## The six concepts you must know to work here safely

### 1. Product ≠ Placement
A `products` row holds a stable `product_code` forever. The total quantity is split across
`stock_placements` rows (product × compartment). Moving 30 of 70 = decrement one placement,
upsert another, write one ledger row — the product ID never changes.

### 2. Three quantity states, derived
```
quantity           = on-hand (physical count)
reserved_qty       = reserved for PENDING borrows (no double-booking)
quarantined_qty    = physically present but unusable
available          = quantity − reserved_qty − quarantined_qty
```
Optimistic-lock writes accept `expectedVersion` on the placement row — UI shows
`STOCK_VERSION_CONFLICT` on a stale read.

### 3. Append-only ledger
Every change writes one immutable `stock_ledger` row (RECEIPT/MOVE/ISSUE/RETURN/ADJUST/DISPOSE).
Current quantities are a *cached derivation*. Nightly invariant:
`SUM(ledger deltas per (product,compartment)) == stock_placements.quantity`. Same for
`reserved_qty == SUM(PENDING borrow quantities)`. Both run in
`StockReconciliationJob`.

### 4. Three money figures
- **Requested** — frozen at submit.
- **Approved** — sanctioned figure after the approval chain. May be revised down. Immutable thereafter.
- **Funded** — running sum of `fund_receipts`. Partial is normal; status is `FUNDS_PARTIAL`.

### 5. Requisition state machine (13 states)
```
DRAFT → IM_REVIEW → AWAITING_APPROVAL → APPROVED
  → BOM_GENERATED → SENT_TO_ACCOUNTS → FUNDS_PARTIAL ⇄ FUNDS_RECEIVED
  → PURCHASED → PURCHASE_VERIFIED → STOCKED → CLOSED
                                  ↘ REJECTED (terminal)
                                  ↘ CANCELLED (terminal)
```
- Approver slots frozen at **submit** from then-current threshold — changing the threshold
  later must not reshuffle in-flight requests.
- Any single rejection is terminal. Approver can withdraw until BOM generation.
- Self-approval: skip, substitute from remaining slots, then any active approver
  (oldest account first), refuse with `SELF_APPROVAL_NO_SUBSTITUTE` when none.
  Approver count is **never** reduced.

### 6. Roles are additive
A user holds a *set*: `GENERAL` + (`APPROVER`?`INVENTORY_MANAGER`?`ADMIN`?`s`). `GENERAL` is
implicit for every account. The IM can borrow because they have GENERAL too. `ADMIN` is for
IT/ops — separate from business roles.

---

## Where things live (code)

```
apps/
  api/                    NestJS backend (CommonJS, Kysely, puppeteer)
    src/
      main.ts             Boot: helmet, body caps, CORS, prefix api/v1 (except /health)
      app.module.ts       All modules wired here
      config/             ONLY directory that may touch process.env
      database/           migrations/ (19 files 0001..0019) + schema.ts (hand-maintained types)
      modules/            One folder per feature: controller, service, repository, dto/
      common/             IdempotencyService, audit-sanitizer.ts
      security/           PasswordService (argon2id)
    test/                 Integration specs against real Postgres (no mocks)
    scripts/              migrate, seed, scenarios
  web/                    React 18 + Vite 6 + Tailwind v4 + TanStack Query + RHF + zod
    src/
      routes/             Route map + ProtectedRoute + roles allow-list
      pages/              Feature folders: login, dashboard, inventory, borrowing, ...
      features/           Per-domain components + dialogs + query factories
      components/         Primitives: Panel, Badge, Table, Dialog, TextField, QueryBoundary
      styles/tokens.css   The single @theme source (no tailwind.config.js)
      i18n/en.ts          Every user-facing string lives here
      api/client.ts       fetch wrapper: 401→refresh-once, navigator.locks for cross-tab,
                          retry 5xx once, Idempotency-Key on writes, ApiError normalisation
      contexts/           AuthProvider, ToastProvider, QueryClientProvider (only 3)
packages/
  shared/                 zod schemas + inferred TS types (CJS + ESM dual build)
    src/
      enums/              Role, ErrorCode (stable machine codes the SPA switches on)
      contracts/          One file per domain (auth, users, inventory, borrowing, ...)
      settings/registry   SettingKey definitions + first-boot env seeds
infra/
  docker-compose.yml      Production: db, migrate (one-shot gate), api, web, proxy=caddy
  docker-compose.dev.yml  Dev deps only: db (5433), db-test tmpfs (5434)
  Caddyfile               IMS_DOMAIN → /api/*→api, /socket.io/*→api, /*→web; gzip; auto-TLS
  deploy.sh               Safe to re-run. Backs up FIRST, ff-only pull, compose up -d,
                          poll /health, exits 1 with logs on failure.
  backup.sh               pg_dump -Fc + tar of files volume, verifies dump is readable,
                          30-day local retention, offsite hook commented out (G-16).
  restore.sh              Requires literal "yes". Renames current DB to *_old first.
.claude/
  settings.json           Permission allow/deny list + hook wiring
  rules/                  Engineering standards (loaded per relevant file scope)
  skills/                 /resume, /build, /verify, /handoff, /add-endpoint, /add-migration,
                          /add-screen, /domain-context, /adr
  agents/                 explorer, db-engineer, backend-engineer, frontend-engineer,
                          test-engineer, code-reviewer, security-reviewer
  hooks/                  session-state.sh (injects NOW.md), guard-hardcoding.sh, verify-after-edit.sh
docs/
  reference/              15 split design docs — read ONE at a time
  state/                  PROGRESS · SESSION-LOG · DECISIONS · OPEN-QUESTIONS · NOW · BACKUP-DRILL
  adr/                    Architecture decisions (so far: 0001 stock placements+ledger)
  RUNBOOK.md              Install, deploy, rollback, restore, monitoring
storage/                  pdf/ — generated BOM PDFs (gitignored)
```

---

## Typical task recipes

| You were asked to… | First reads | Then |
|---|---|---|
| Add an API endpoint | `.claude/skills/add-endpoint/SKILL.md` (mentioned in README) — otherwise the section below | `apps/api/src/modules/<feature>/` for the pattern |
| Add a screen | `docs/reference/06-screen-map.md`, then the relevant `05-user-flows.md` section | Follow **contract → query layer → four states (loading/empty/error/loaded) → component → forms → copy → tokens** |
| Add a migration | `apps/api/src/database/migrations/` — pick the highest number, additive first | `pnpm db:make <name>`, implement, then `pnpm db:migrate && pnpm db:rollback && pnpm db:migrate` |
| Stock arithmetic | `apps/api/src/modules/stock/stock.service.ts` (the only writer) | Always go through it. READ the docstring. |
| Tweak a money figure, threshold, or slot rule | `apps/api/src/modules/settings/` | The setting lives in `app_settings` table, never env-only after first boot |
| Tweak UI styling | `apps/web/src/styles/tokens.css` (the only token source) | Never hardcode hex/Tailwind arbitrary values in components |
| Add a new failure code the SPA should distinguish | `packages/shared/src/enums/error-code.ts` | Document it. Backend throws; SPA switches on `error.code`. |
| Investigate a bug from previous session | `docs/state/SESSION-LOG.md` (newest entries first) → `docs/state/DECISIONS.md` | Stop guessing. The reasoning is there. |

---

## Slack knobs you did not expect

- **`StockService.receiveAndHold`** exists specifically to undo an issued borrow back to
  PENDING in one transaction — closing the G-14 race where another borrower could grab
  the units mid-revert. Don't try to compose `receive()` + `reserve()` separately.
- **JWT refresh uses family revocation**: reusing any member of a refresh-token family
  revokes the entire family and signs the user out. The successor token's `expires_at`
  is the original family expiry, not a fresh 14 days — stops infinite rotation by a
  stolen family.
- **Idempotency-Key header on every money/borrow mutation.** Header is `(user_id, scope,
  key)` unique-indexed. A double-click on a money action would otherwise look exactly like
  two genuine instalments.
- **Demo accounts (`DEMO_ACCOUNTS_ENABLED=true`)** are a literal authentication bypass —
  `anyone-who-opens-the-page-can-act-as-the-administrator`. Server returns 404 when off,
  the SPA shows the list when on, no build flag.
- **PDF download URLs** are HMAC-signed with a **separate** `PDF_SIGNING_SECRET`,
  deliberately *not* the JWT secret. The endpoint is `@Public()` — the token **is** the
  authentication. TTL 300s.
- **Three secrets must differ** (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `PDF_SIGNING_SECRET`). API refuses to boot if any two match.
- **Audit metadata is typed `unknown` by design.** The backend has a redaction list
  (`audit-sanitizer.ts`) so secrets never enter the audit trail — even from free-text
  `note` fields.
- **`SELF_APPROVAL_FORBIDDEN` / `SELF_APPROVAL_NO_SUBSTITUTE`** — never silently let
  the requester approve their own requisition.
- **WebSocket** is wired (`/socket.io/*`) but the README agent found no current reader
  path — invalidation today is via TanStack Query prefix invalidation on every mutation.
  Don't add WS subscribers without a reason.

---

## Landmines (each has cost a previous session)

- **Docker Desktop stops itself between sessions.** `docker info` before any migration or test.
- **Never run `apps/api` through `tsx`** — esbuild drops decorator metadata, Nest DI silently fails.
- **A stale API process is not a code bug.** Check process start time vs `dist/` mtime.
  Built entrypoint is `apps/api/dist/src/main.js`, not `dist/main.js`.
- **Dev DB on 5433, test DB on 5434.** Never `docker compose down -v`.
- **Web dev server binds IPv6 only.** `localhost:5173` works, `127.0.0.1:5173` does not.
- **`stock_ledger`, `requisition_events`, `audit_log`** are append-only by trigger.
- **`resetData` cannot delete requisitions/departments/users** → test DB accumulates them.
  Never assert "exactly one row" — scope by an id you created.
- **`boms-pdf.int-spec.ts`** overrides `PdfRendererService` with a local stub — add new renderer
  methods there too or tests pass with a fake.
- **`test/app.ts` sets `logger: false`** — a 500 arrives with no stack. Use a focused debug.
- **Kysely: interpolating the same `sql` fragment twice** re-emits parameters with different
  placeholder numbers, so `GROUP BY <expr>` won't match `SELECT <expr>`. Group positionally.
- **The web app selects error copy by `code`, not message.** A new failure mode needs a new
  `ErrorCode` member.
- **`approver_slots.slot_no` is constrained to (1, 2)** — no slot 3.
- **A stale dev DB setting** (e.g. expense threshold 25,000) will make next-run assertions fail.
  Reset it, or read the live value via `SettingsService`.
- **`/auth/login` is capped at 10/min per IP.** A smoke script re-logging 5 users rapidly
  returns 429; the resulting `undefined` token looks like a confusing 401.
- **`pnpm-lock.yaml` is large (245 KB).** Don't read it whole — `Grep` for the package.

---

## How to start a session (cold)

1. The `SessionStart` hook auto-injects `docs/state/NOW.md`. **Do not read `PROGRESS.md` or
   `SESSION-LOG.md` to orient** — that's the habit the hook exists to kill.
2. Run `/resume` if you want the git state alongside it.
3. Open the **one** reference file the task demands. Reading five in one session is a mistake.
4. Delegate reading (`explorer`, `db-engineer`, `code-reviewer`) to keep search noise out.

## How to end a session

1. Run `/handoff` (optional note). It rewrites `NOW.md` (≤60 lines) and appends to
   `SESSION-LOG.md`. A session that ends without `/handoff` has thrown away its own context;
   leaving `NOW.md` stale actively misleads the next one.

---

## Build status one-liner

Feature-complete (Phases 00–06, 19 migrations, 368 integration tests green). What's next is
**go-live**: enable offsite backups (G-16), run restore drill on the real prod stack (G-17),
configure Approver slots 1/2 + Sub-threshold approver + Threshold, appoint a 2nd IM and 3rd
approver. See `docs/state/NOW.md` for the cold-start brief.
