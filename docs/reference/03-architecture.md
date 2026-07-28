## 3. Architecture

### 3.1 Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React + TypeScript, Vite, TanStack Query, Tailwind, shadcn/ui | Type safety matters when a schema this branchy hits the UI |
| State/sync | TanStack Query + WebSocket invalidation | "Updates instantly without any error" = server is truth, socket tells the client to refetch |
| Backend | NestJS (TypeScript) — modular monolith, REST | Same language both sides; module boundaries without distributed-system pain |
| DB | PostgreSQL 15+ | Transactions, row locking, `CHECK` constraints, `JSONB` for event payloads |
| Realtime | Socket.IO, per-user rooms | Login popup, pending-approvals badge, live tracker |
| Jobs | `node-cron`, in-process | Deadline reminders, overdue checks, email. At 5–6 requisitions/day a queue server is pure overhead — see §14.1 |
| PDF | Headless Chromium (Puppeteer) rendering an HTML letterhead template | Only reliable way to match your company pad exactly |
| Files | Docker volume on the VM | Generated BOM PDFs. MinIO/S3 is unnecessary complexity for one host — a mounted volume plus the backup job is the whole story |
| Auth | JWT access (15 min) + rotating refresh, RBAC guards | Standard, no external IdP needed |

**Alternatives considered:** Django + HTMX would be faster to build and cheaper to host, but the borrow/requisition screens are stateful enough that a proper SPA pays for itself. Firebase was rejected outright — you cannot do reliable multi-row stock transactions in Firestore, and stock correctness is the whole product.

### 3.2 Component view

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

**The one architectural rule that matters:** `StockService` is the *only* module allowed to write `stock_placements` and `stock_ledger`. Borrowing, requisitions and BOM all call into it. Every other bug in this system is recoverable; a stock bug is not, because the physical shelf and the database silently diverge and nobody notices for a month.

### 3.3 Deployment — single VM, Docker Compose

Seven services, one `docker compose up -d`. See `deploy/docker-compose.yml`.

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

**Why the API and worker are separate containers.** The worker bundles Chromium for letterhead-accurate PDF rendering (§9). Chromium is the memory hog in this stack, and a render that overruns its budget should not take the API down with it — so the worker gets a hard `mem_limit: 1g` and the API keeps serving.

**Migrations run as a one-shot service** that `api` and `worker` wait on via `service_completed_successfully`. This is what makes a bare `docker compose up -d` on a clean VM produce a working system rather than a crash loop.

**VM sizing:** 2 vCPU / 4 GB RAM / 40 GB disk is comfortable at the scale in A11. The disk is sized by BOM PDFs and backup retention, not by the database — the database itself stays well under 1 GB for years.

**Non-negotiables before go-live:**

| # | Item | Why |
|---|------|-----|
| 1 | **Backups must leave the VM** | `./backups` sits on the same disk as the database. If that disk dies you lose both. `rclone`/`rsync` the dump nightly to another host or object storage |
| 2 | **Do a restore drill once** | An untested backup is a hope, not a backup. Restore into a scratch database and log in before you trust it |
| 3 | **Postgres is not published** | No `ports:` on `db`. It is reachable only on the compose network |
| 4 | **`.env` is `chmod 600` and out of git** | It holds the DB password and both JWT secrets |
| 5 | **Docker log rotation** | Configured via the `x-logging` anchor. Without it, json-file logs fill the disk and take the system down — a slow, boring, entirely avoidable outage |
| 6 | **`restart: unless-stopped` everywhere** | The stack comes back by itself after a VM reboot |
| 7 | **Disk snapshots if your host offers them** | One VM is a single point of failure. Acceptable for an internal tool, but know that you accepted it |

**On Supabase:** self-hosting it here would be the wrong call. Its Docker stack is roughly ten containers (Kong, GoTrue, PostgREST, Realtime, Storage, imgproxy, Studio, meta, analytics, vector), and this system would use maybe three of those capabilities while fighting the rest. The permission model in §10 is state-dependent — *"an approver may withdraw only while status is not yet BOM_GENERATED"* — which is workflow logic, not row visibility, so it belongs in TypeScript rather than in RLS policies. And every stock write has to go through a locking transaction anyway (§7.3), which means bypassing the auto-generated API that is Supabase's main draw. Plain Postgres in the compose file gives the same database with a quarter of the moving parts. Supabase would earn its place if this were multi-tenant SaaS on managed infrastructure; on one VM it does not.

---
