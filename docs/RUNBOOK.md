# Operator runbook

Everything needed to run this system without having read the code. One VM, Docker Compose,
Caddy in front. Twelve users. Currency BDT, timezone Asia/Dhaka.

If you are reading this during an incident, jump to [When something is wrong](#when-something-is-wrong).

---

## 1. What is running

Five containers, defined in `infra/docker-compose.yml`:

| Service | What it is | Notes |
|---|---|---|
| `db` | PostgreSQL 16.4 | **Never published to the host.** Data lives in the `pgdata` volume. |
| `migrate` | The API image, run once | Applies migrations, then exits. `api` waits for it to succeed. |
| `api` | NestJS backend | Health at `/health`. Uploads and PDFs in the `files` volume. |
| `web` | The React SPA | Static files. |
| `proxy` | Caddy | Owns ports 80/443 and gets the TLS certificate automatically. |

Two volumes matter, and they are the whole system:

- **`pgdata`** — the database. Losing it is losing everything.
- **`files`** — uploaded signatures, uploaded invoices, and generated BOM PDFs.

`docker compose down -v` deletes both. There is never a reason to run it.

---

## 2. First install

On a fresh VM with Docker and Docker Compose installed:

```bash
git clone <repo> /opt/ims && cd /opt/ims/infra
cp .env.example .env
```

Now edit `.env`. Every line that says `CHANGE_ME` must be replaced. Generate each secret
separately — **the three secrets must all differ from each other**, and the API refuses to boot
if any two match:

```bash
openssl rand -hex 32      # JWT_ACCESS_SECRET
openssl rand -hex 32      # JWT_REFRESH_SECRET
openssl rand -hex 32      # PDF_SIGNING_SECRET
openssl rand -hex 32      # POSTGRES_PASSWORD
```

Also set `IMS_DOMAIN` to the real hostname (Caddy uses it to request the certificate, so DNS
must already point at this VM), and `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

Then:

```bash
mkdir -p backups          # compose mounts this read-only into the api container
docker compose up -d
docker compose ps         # all services up, api healthy
```

Sign in as `SEED_ADMIN_EMAIL`. You will be forced to change the password immediately — that is
by design, and the seed password is now spent.

### Before you let anyone else in

Three settings have no safe default and the system will refuse work until they are set.
**Admin → Settings**:

1. **Approver slots 1 and 2** — who signs off requisitions at or above the expense threshold.
2. **Sub-threshold approver** — a single person who signs off requisitions *below* the threshold.
   This is a **different setting** from the approver slots and is the most commonly missed one:
   the symptom is "An approver has not been assigned" on submit while the Approver 1 and 2 slots
   are visibly filled in.
3. **Expense threshold (BDT)** — the amount at which a requisition needs two approvers.

Nobody can approve their own requisition. If the only Inventory Manager or the only approver
raises a requisition, the system stands someone else in, and refuses the submit if there is
nobody to stand in. Appointing a second Inventory Manager and a third approver avoids this.

### Turn on backups

Backups are not automatic. Add the cron job:

```bash
crontab -e
0 2 * * *  /opt/ims/infra/backup.sh >> /var/log/ims-backup.log 2>&1
```

Then **read [section 5](#5-backups)**, because a backup you have never restored is not a backup.

---

## 3. Deploying a new version

```bash
cd /opt/ims/infra
./deploy.sh              # deploys the tag currently in .env
./deploy.sh v1.4.2       # deploys a specific tag, and rewrites .env to match
```

`deploy.sh` takes a backup first, pulls, recreates only what changed, then waits up to 90
seconds for the API to report healthy. It leaves the `db` container alone unless its image or
config changed, and never touches `pgdata`. If the API does not become healthy it prints the
last 80 log lines and exits non-zero — the previous containers are already gone at that point,
so treat a failed deploy as an outage and go to [rollback](#4-rollback).

Migrations run in their own container before the API starts. If a migration fails, the `api`
service never starts, which is deliberate: a backend running against a half-migrated schema is
worse than one that is down.

---

## 4. Rollback

**Code only** — no migration ran, or the migration is backward compatible:

```bash
cd /opt/ims/infra
./deploy.sh v1.4.1       # the previous tag
```

**Code and data** — a migration ran and the data is wrong:

```bash
cd /opt/ims/infra
ls -lt backups/                                   # pick the dump from before the deploy
./restore.sh backups/ims-db-20260731-020000.dump  # asks you to type 'yes'
./deploy.sh v1.4.1
```

`restore.sh` stops `api`, `web` and `migrate`, renames the current database to `ims_old` rather
than dropping it, restores into a fresh one, and brings everything back up. **The old database
is kept.** Verify the system before dropping it:

```bash
docker compose exec db psql -U ims -d postgres -c "DROP DATABASE ims_old;"
```

Rolling back to a tag *older than a migration that already ran* is not supported — the old code
does not know about the new schema. Restore the database first, then deploy the old tag.

---

## 5. Backups

`backup.sh` runs nightly at 02:00 and before every deploy. Each run writes two files into
`infra/backups/`:

- `ims-db-<stamp>.dump` — the database, `pg_dump -Fc`.
- `ims-files-<stamp>.tar.gz` — the `files` volume: signatures, invoices, generated PDFs.

Local retention is 30 days. The script **verifies** each dump is a readable archive before
trusting it, so a truncated file or a full disk fails loudly in the log at 2am rather than
during a restore.

### The one thing still outstanding

Backups are written to the same VM as the database. **A host loss takes the database and every
backup of it.** The offsite lines are in `backup.sh`, commented out, waiting on a decision about
where they go:

```bash
# rclone copy backups/ remote:ims-backups/ --max-age 25h
# aws s3 sync backups/ s3://your-bucket/ims/ --exclude '*' --include 'ims-*'
```

Uncomment one and configure its credentials. Until then the backup strategy survives a bad
migration but not a dead VM.

### Practise the restore

Restore has been drilled against a scratch database (2026-07-31, ~4.2 seconds for the current
data volume) but **not yet against this production stack**. Do it once, deliberately, before you
need it:

```bash
./backup.sh
./restore.sh backups/<the dump you just made>
# sign in, open a requisition, check a BOM PDF renders
docker compose exec db psql -U ims -d postgres -c "DROP DATABASE ims_old;"
```

---

## 6. Monitoring

The API checks four things every hour and notifies every admin **in-app** the first time one
fails. There is no email (no SMTP relay is available), so **an admin who never signs in never
sees an alert.** Every failure is also written to the API log.

Alerts fire on the transition into failure, not every hour, so a still-failing check stays quiet
until it recovers and fails again.

Check the current state yourself at any time — sign in as an admin and call:

```
GET /api/v1/admin/system-health
```

| Check | Fails when | What to do |
|---|---|---|
| `database` | Postgres is unreachable | `docker compose logs db`; see [below](#the-database-container-keeps-restarting) |
| `disk` | Less than 20% headroom | Prune images, check `backups/` size, grow the disk |
| `storage` | The uploads directory is not writable | Disk full, or the `files` volume remounted read-only |
| `backups` | Newest backup older than 26h | The cron job stopped — check `/var/log/ims-backup.log` |

The public `/health` endpoint returns only `{status, database}` and is what the container
healthcheck uses. Disk headroom and backup timing are deliberately admin-only.

---

## 7. When something is wrong

### The stack comes up but `proxy` will not start

Symptom, from `docker compose up -d --build`:

```
Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:5173
-> 127.0.0.1:0: listen tcp 0.0.0.0:5173: bind: An attempt was made to access a socket in a
way forbidden by its access permissions.
```

Every other container is fine — `api` reports healthy — and nothing is listening on 5173.
That wording is specific: **Windows has reserved the port**, it is not in use. Hyper-V and
WinNAT claim blocks of the dynamic port range at boot, the blocks move between reboots, and
5173 sits low enough to be caught by one.

Confirm it:

```bash
netstat -ano | grep ":5173"                                  # expect nothing
netsh interface ipv4 show excludedportrange protocol=tcp     # look for a range covering 5173
```

A range with no `*` beside it is one Windows took automatically.

**Check the other two ports as well.** The blocks come in contiguous hundreds, so a grab that
catches 5173 usually catches the development databases with it — `5433` (dev) and `5434`
(integration tests) both sit in the next block up. The symptom there is different and easy to
misread: the containers say they are running, but `docker port ims-dev-db-test-1` prints
nothing and the integration suite dies on `ECONNREFUSED 127.0.0.1:5434` before a single test
file loads. The binding is in the container config; it was never established.

The fix is to claim all three ports so they cannot be taken again, in an **Administrator**
shell:

```powershell
net stop winnat
netsh int ipv4 add excludedportrange protocol=tcp startport=5173 numberofports=1 store=persistent
netsh int ipv4 add excludedportrange protocol=tcp startport=5433 numberofports=2 store=persistent
net start winnat
```

Then bring both stacks back, recreating the containers whose bindings never took:

```bash
docker compose up -d                                                   # the app stack
docker compose -f infra/docker-compose.dev.yml up -d --force-recreate  # the dev databases
```

`--force-recreate` is needed on the second one: the containers already exist with the right
binding in their config, so a plain `up -d` reports them up to date and changes nothing. The
data lives in a volume and survives the recreation.

Stopping `winnat` releases the automatic reservations; the `store=persistent` exclusion then
survives reboots, and an explicitly excluded port is still bindable by a process that asks for
it by name — the exclusion only stops Windows handing it out to something else.

If you would rather not touch the machine's networking, publish the proxy on a port above the
dynamic range instead — change `5173:80` in `docker-compose.yml` — but everyone's bookmark and
the `WEB_PUBLIC_URL` in `.env` change with it, so prefer reclaiming the port.
### Nobody can sign in

Check the API is actually up. Caddy only proxies `/api/*` to the backend, so `/health` is not
reachable from outside — ask the container:

```bash
docker compose ps                                             # api should say (healthy)
docker compose exec api wget -qO- http://localhost:3000/health
```

If the API is healthy, the likely cause is a locked account rather than an outage — five failed
attempts within five minutes locks that email, and it clears itself once the window passes. An
admin can also reset the password from **Admin → Users**.

### "An approver has not been assigned" on submit

Almost always **Admin → Settings → Sub-threshold approver** is empty. That is a separate setting
from Approver 1 and Approver 2, and it is the one that applies to requisitions below the expense
threshold. The error names which one is missing — read it rather than assuming.

If it says instead that you are the approver and nobody can stand in, appoint another approver:
nobody is allowed to approve their own requisition.

### A BOM PDF will not generate

Rendering runs Chromium inside the API container and times out after 30 seconds. The user-facing
message is deliberately generic; the real reason is in the log:

```bash
docker compose logs --tail=100 api | grep -i pdf
```

A download link is valid for five minutes. "Link expired" means exactly that — regenerate it
from the BOM screen.

### Stock numbers look wrong

Do not edit the database. A job at 02:00 daily re-checks every placement against the ledger and
every reservation against its pending borrows, and reports mismatches:

```bash
docker compose logs api | grep -i reconcil
```

Read `docs/reference/` for the stock model before touching anything.
`stock_ledger`, `requisition_events` and `audit_log` are append-only and enforced by database
triggers — an UPDATE or DELETE against them will be rejected.

### The database container keeps restarting

```bash
docker compose logs --tail=100 db
df -h                       # a full disk is the usual cause
```

Do not delete the `pgdata` volume to "reset" it. That is the data.

### The disk is full

In order of how much they free and how safe they are:

```bash
docker image prune -f              # safe, usually the biggest win
du -sh infra/backups               # 30 days of dumps live here
docker system df                   # what is actually using space
```

**Never** add `--volumes` to any `prune` command.

---

## 8. Routine tasks

| Task | Where |
|---|---|
| Add or deactivate a user, reset a password, change roles | Admin → Users |
| Change the expense threshold or approver slots | Admin → Settings |
| See who did what | Admin → Audit log |
| Overall spend, filtered by month or date range | Expenses (Approver, IM and Admin) |

Deactivating a user is preferred over deleting: their history stays intact, their sessions are
revoked immediately, and they cannot sign in.

Two refusals you will meet and should not try to work around — both exist so the admin panel
cannot lock every admin out of the admin panel:

- You cannot deactivate your own account, or remove your own administrator role.
- You cannot deactivate or demote the **last active administrator**.

---

## 9. Facts worth knowing before you debug

- **Business values are not in `.env`.** The expense threshold, approver counts and audit
  retention live in the `app_settings` table and are owned by the admin UI. The `SETTING_*`
  variables seed them on **first boot only**; editing them later does nothing. That is
  deliberate — it is what makes the threshold changeable without a redeploy.
- **Secrets and hostnames are in `.env`** and take effect on restart.
- **Schema changes only ever happen through migration files.** Auto-sync is off in every
  environment. Never `ALTER TABLE` by hand.
- **All money is `numeric(14,2)`**, never floating point.
- **Times are stored UTC**, displayed and reported in Asia/Dhaka.
