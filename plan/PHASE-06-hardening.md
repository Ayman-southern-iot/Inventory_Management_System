# Phase 06 — Hardening

**Goal:** make it survivable in production without a developer watching it.

**Reference:** `docs/reference/14-deployment.md`

## Tasks

- [x] **6.1 Audit log UI** — admin-only, filterable by actor, entity, and date.
      *Accept:* every state-changing action in phases 01–05 appears with actor and timestamp.

- [x] **6.2 Nightly invariant job** — `SUM(stock_ledger) = stock_placements.quantity` per product;
      a mismatch raises an alert, not a log line.
      *Accept:* deliberately corrupting a placement in a test database triggers the alert.

- [x] **6.3 Backup and restore drill** — run `infra/backup.sh`, wipe a scratch environment, restore
      with `infra/restore.sh`, log in and verify data. Document the elapsed time.
      *Accept:* the drill is written up in `docs/adr/` or `docs/state/DECISIONS.md` with the actual
      restore duration, not an estimate.

- [x] **6.4 Monitoring floor** — `/health` endpoint, uptime check, disk-above-80% cron, backup
      success notification.
      *Accept:* stopping the database makes the health check fail within a minute.

- [x] **6.5 Performance pass** — paginate everything, confirm the trigram index is used
      (`EXPLAIN ANALYZE`), check query counts in the heaviest endpoints for N+1.
      *Accept:* search returns in under 50ms at 10,000 products.
      *Done:* measured at **50,000** products in a scratch database — a selective term plans a
      Bitmap Index Scan on `products_name_trgm_idx` at 0.5ms; a term matching 12% of rows
      seq-scans under `LIMIT 25` at 0.66ms, which is the planner being right rather than the
      index being unusable. Query counts taken from PostgreSQL statement logs, not from reading
      code: every list endpoint is 2-3 flat queries except BOMs, which was an N+1 and is now
      batched. G-13 closed; G-19 records the five endpoints that stay unpaginated on purpose.

- [x] **6.6 Security review** — full pass with `security-reviewer` across auth, permissions,
      file handling, and the PDF template.
      *Accept:* no CRITICAL or HIGH findings outstanding.
      *Done:* no CRITICAL. Two HIGHs found and fixed — **self-approval was reachable on the happy
      path** (specified in requirements §10, marked resolved as OQ-07, never implemented), and
      `GET /requisitions/:id/funding` had no guard at all while returning vendor names and
      purchase totals. Also fixed: unbounded upload buffering, a PDF error leaking the Chromium
      failure to the caller, and a weak path-prefix check. G-11 refuted on re-audit; G-12 closed.

- [x] **6.7 Operator runbook** — deploy, rollback, restore, common failures, who to call.
      *Accept:* someone who has never seen the repo can deploy from it.
      *Done:* `docs/RUNBOOK.md`, written against the actual scripts rather than from memory.
      Writing it surfaced two real defects: `infra/.env.example` was missing `PDF_SIGNING_SECRET`,
      so a fresh production deploy crashed at boot (verified by running the config validator
      against the template), and the api container could not see the backup directory, so 6.4's
      backup-freshness check would have been permanently inert in production.

## Exit criteria

- The backup restore drill has actually been performed, not just scripted
- No CRITICAL or HIGH security findings
- The runbook is complete enough to hand to someone else
