## 14. Deployment & operations

### 14.1 Capacity — is this enough hardware?

Target load: **12 users**, **~5,000 products**, **5–6 requisitions/day**, continuous type-ahead search.

| Dimension | Your load | What one small VM handles | Headroom |
|---|---|---|---|
| Concurrent requests | 3–5 at peak | 500+ | ~100× |
| Search queries | maybe 2,000/day | 2,000/**second** with a trigram index | ~86,000× |
| Writes (borrows + requisitions + moves) | ~50/day | thousands/second | vast |
| DB size after 3 years | well under 500 MB | limited by disk | — |
| BOM PDFs | ~6/day ≈ 400 MB/year | limited by disk | — |

**Recommended VM: 2 vCPU, 4 GB RAM, 40 GB SSD.** The 4 GB is for Chromium during PDF rendering, not for the database — Postgres itself will be idle. This is over-provisioned on purpose so you never have to think about it.

Consequences of this being small:

- **No Redis, no queue server.** Reminder and overdue jobs are a `node-cron` firing one indexed query every 15 minutes. PDF generation runs in-process behind a spinner. Add BullMQ only if you ever run more than one API container.
- **No read replicas, no caching layer, no connection pooler.** A pool of 10 connections against Postgres' default 100 is 8× more than you need.
- **No zero-downtime deployment.** A 20-second restart at 9pm is invisible to twelve people. Blue-green would cost more complexity than the downtime is worth.
- **Search stays in Postgres.** `CREATE INDEX ON products USING gin (name gin_trgm_ops)` plus a 250 ms client debounce and `LIMIT 20`. Revisit at ~1M products.

The thing that will actually strain this system is not user count — it is a runaway `stock_ledger` if something writes in a loop, or an unbounded query on the borrow history screen. Both are fixed by pagination, which is in the design.

### 14.2 Deploy model

Single VM, Docker Compose, images built by GitHub Actions and pulled by tag. Files are in `deploy/`:

```
deploy/
  docker-compose.yml     db · migrate · api · web · proxy
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

which backs up, pulls, runs migrations as a one-shot container, brings the app up only if migrations succeeded, and waits for the health check. `docker compose up -d` on its own works too — `deploy.sh` just adds the backup and the guard rails.

### 14.3 How data survives updates

`docker compose up -d` recreates containers whose image or config changed and leaves the rest alone. The database lives in a **named volume** (`ims_pgdata`), which is independent of the container lifecycle — the container can be destroyed and rebuilt a hundred times and the volume persists. Same for `ims_files` (generated PDFs) and `ims_caddy_data` (TLS certificates).

**The six ways people actually lose the data**, and the guard against each:

| Failure | Guard |
|---|---|
| `docker compose down -v` — the `-v` deletes volumes | Never type it. `deploy.sh` never calls `down` at all |
| `docker system prune --volumes` during a disk cleanup | `deploy.sh` uses `docker image prune -f` only |
| `postgres:latest` silently becomes a new major version; the new binary refuses to read the old data directory | Image is pinned to `postgres:16.4-alpine`. Major upgrades are a deliberate dump → change image → restore |
| TypeORM `synchronize: true` (or Prisma `db push`) drops a column to "match" the entity | **`synchronize` must be `false` in production.** Schema changes only ever go through checked-in migration files |
| A migration drops a column that older running code still writes to | Two-phase changes: release N stops using the column, release N+1 drops it. Never both in one release |
| The VM dies, and the backups were on the VM | `backup.sh` has an `rclone`/`s3 sync` line — uncomment it. Local-only backups are not backups |

**Migration discipline** is the one that matters most, because it's the only failure on this list that a careless `git pull` can trigger by itself. Rules:

1. Every schema change is a migration file, reviewed in the PR like any other code.
2. Additive first: add nullable column → backfill → make non-null in a later release.
3. Renames are add + copy + drop across two releases, never `ALTER ... RENAME` in one.
4. The `migrate` service runs to completion before `api` starts; if it exits non-zero the API never boots, so you get a clean failure instead of corrupt writes.
5. Rollback is: restore the pre-deploy dump, then `./deploy.sh <previous-tag>`. Rolling *back* a schema migration is usually not possible, which is exactly why `deploy.sh` dumps first.

### 14.4 Backups

`backup.sh` runs from cron nightly and is also called at the top of every deploy:

```
0 2 * * *  /opt/ims/backup.sh >> /var/log/ims-backup.log 2>&1
```

It writes a compressed `pg_dump` plus a tarball of the PDF volume, keeps 30 days, and (once you uncomment the line) copies offsite. `restore.sh` restores a dump and renames the existing database aside rather than dropping it, so a botched restore is still recoverable.

**Do a restore drill once a quarter.** Restore last night's dump into a scratch database and log in. An untested backup is a guess.

### 14.5 Minimum monitoring

At this scale you do not need Prometheus. You need to know three things:

- Did last night's backup produce a file bigger than zero bytes? (cron mails you on failure)
- Is `/health` returning 200? (uptime-kuma in a seventh container, or a free external pinger)
- Is the disk above 80%? (a one-line cron)

Add the nightly ledger invariant check from §7.3 to that list and you have covered every failure mode that would otherwise go unnoticed for weeks.
