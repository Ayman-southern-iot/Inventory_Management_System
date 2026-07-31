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

- [ ] **6.4 Monitoring floor** — `/health` endpoint, uptime check, disk-above-80% cron, backup
      success notification.
      *Accept:* stopping the database makes the health check fail within a minute.

- [ ] **6.5 Performance pass** — paginate everything, confirm the trigram index is used
      (`EXPLAIN ANALYZE`), check query counts in the heaviest endpoints for N+1.
      *Accept:* search returns in under 50ms at 10,000 products.

- [ ] **6.6 Security review** — full pass with `security-reviewer` across auth, permissions,
      file handling, and the PDF template.
      *Accept:* no CRITICAL or HIGH findings outstanding.

- [ ] **6.7 Operator runbook** — deploy, rollback, restore, common failures, who to call.
      *Accept:* someone who has never seen the repo can deploy from it.

## Exit criteria

- The backup restore drill has actually been performed, not just scripted
- No CRITICAL or HIGH security findings
- The runbook is complete enough to hand to someone else
