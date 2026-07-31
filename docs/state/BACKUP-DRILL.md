# Backup and restore drill

Phase 06 task 6.3. A backup that has never been restored is not a backup, so this records a
restore that actually happened, with measured times rather than estimates.

**Re-run this drill after any migration that changes the schema shape, and at least quarterly.**
Append a new dated section; do not overwrite the previous one — the trend matters as the database
grows.

---

## 2026-07-31 — first drill

**Environment.** Run against the **dev** database (`ims-dev-db-1`, Postgres on 5433) restoring into
a scratch database `ims_drill` on the same server, plus the real file storage directory
(`apps/api/storage`). The dev database holds genuine data: 27 requisitions, 4 BOMs, 51 audit rows,
10 users.

> **Limitation, stated plainly.** This drill exercised the same commands `infra/backup.sh` and
> `infra/restore.sh` run — `pg_dump -Fc`, `pg_restore --no-owner`, `tar czf` — but **not the
> production compose stack itself**. It did not test `docker compose stop api web migrate`, the
> database rename dance in `restore.sh`, or the `ims_files` named volume. Those are exercised only
> by a drill on the real VM, which has not been done. See "What this drill did not prove".

### Measured

| Step | Time | Size |
|---|---|---|
| `pg_dump -Fc` | **1.086 s** | 11 MB database → 154 KB dump |
| `pg_restore` into a fresh database | **1.668 s** | 18 migrations, all tables |
| `tar czf` of the files directory | **0.813 s** | 686 files, 4.0 MB → 2.7 MB archive |
| `tar xzf` restore of files | **0.609 s** | 686 files |
| **Total wall clock** | **≈ 4.2 s** | |

At this size the restore is bounded by process startup, not data. The figure worth watching is the
dump size: 154 KB today, so a restore stays under a minute until the database is orders of
magnitude larger.

### Verified after restore

Row counts alone would not have caught most of these, which is why each is listed separately.

- **Row counts identical** across `requisitions` (27), `stock_ledger` (12), `audit_log` (51),
  `users` (10), `boms` (4), `notifications` (13).
- **All 18 migrations** present in `kysely_migration`.
- **Append-only triggers survived and still enforce.** `audit_log`, `stock_ledger` and
  `requisition_events` all carry their triggers, and a `DELETE FROM audit_log` against the
  restored database was refused with the correct error. A restore that silently dropped these
  would leave the audit log editable — and nothing else would notice.
- **Sequences preserved exactly** — `requisition_no_seq` at 27, `bom_no_seq` at 4, `borrow_no_seq`
  at 4. A reset sequence is the classic post-restore data-loss bug: the next requisition reuses
  REQ-000001 and collides with a document someone has already filed.
- **All 686 files byte-identical**, compared by md5 of the whole tree, not by count.
- **The application runs on the restored data.** The API was booted against `ims_drill`,
  `admin@ims.local` logged in, the requisition list returned all 27, and the expense report
  returned the same figures as production. This is the check that matters — the others prove the
  bytes moved, this proves the system works.

### Found and fixed during the drill

`backup.sh` wrote the dump and never read it back. `pg_dump` exiting 0 only means it finished
writing; a truncated file, a full disk or a half-written volume still exits 0 and leaves a useless
artefact that nobody discovers until a restore, which is the worst possible moment.

The script now verifies the archive it just wrote, and **both branches were tested**: a good dump
passes, a deliberately truncated one is rejected. The first version of that check used
`pg_restore --list /dev/stdin`, which rejects *good* archives — it would have failed every backup
and taught whoever reads the log to ignore it. The working form copies the dump into the container
and reads it from a real path.

### What this drill did not prove

Honest gaps, so nobody reads this page as more assurance than it is:

1. **Not run on the production VM.** `restore.sh`'s `ALTER DATABASE ... RENAME` path and the
   `ims_files` named volume are untested. Do this on the real host before relying on it.
2. **Offsite copy is still commented out.** `backup.sh` has `rclone`/`aws s3` lines that are
   disabled. Backups currently live on the same machine as the database, so a VM loss takes both.
   This is the single largest remaining risk to "no data should be lost".
3. **No automated restore test.** The drill is manual. Nothing fails if backups silently stop.
4. **The 30-day `find -delete` was not exercised**, so retention pruning is unproven.
