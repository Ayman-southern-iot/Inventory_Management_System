# Operator runbook

Everything needed to run this system without having read the code. One VM, Docker Compose,
Caddy in front. Twelve users. Currency BDT, timezone Asia/Dhaka.

If you are reading this during an incident, jump to [When something is wrong](#when-something-is-wrong).

---

## 0. Before go-live — the checklist that must be done first

Work down this list before the first real requisition. Items 0, 1, 2 and 7 are **hard
blockers**: the system is not safe to hold real data until all four are done. Item 0 comes first,
because until production runs `infra/`, the `.env` steps below change nothing. Item 7 belongs to
the **IT team**, not to this repository. It blocks go-live, not a merge.

### 0. Run production from `infra/` — HARD BLOCKER, before every other item

**Why.** On 2026-09-27 the operator found the VM running the **root** `docker-compose.yml`. That
file is the demo stack. It ran from `/root/ims/Inventory_Management_System` at commit `9f4176d`,
as containers `ims-api-1`, `ims-web-1`, `ims-db-1` and `ims-proxy-1`, with the proxy publishing
`0.0.0.0:5173->80`. This comes from the operator's inspection and was not re-checked here.

The root file:

- hard-codes `DEMO_ACCOUNTS_ENABLED: 'true'`;
- defaults `POSTGRES_PASSWORD` to a value that is public in this repository;
- passes none of the Phase 11 settings.

So every `.env` step in §0.1 and §0.8 does nothing on the VM as it runs today. Its seed also
runs on every start, and with demo mode on it does two things (`apps/api/scripts/seed.ts:30`,
`:164-190`, `:263`):

- it resets every demo account's password back to `demo` and re-activates the account;
- it seeds invented demo products.

Everything from §1 on assumes `infra/`.

**It is a config switch, not a data migration.** This was checked in both compose files on this
branch on 2026-09-30:

- both set `name: ims`;
- both declare the volumes `pgdata`, `files`, `caddy_data` and `caddy_config` with no explicit
  name, so both use `ims_pgdata`, `ims_files`, `ims_caddy_data` and `ims_caddy_config`;
- both run `postgres:16.4-alpine` on `/var/lib/postgresql/data`;
- both mount `files` at `/app/storage`.

`infra/` reattaches the same data.

**What does differ is the settings.** Both files' environments were fed through the API's own
config parser and compared. They differed in nine places. Three of them broke the switch when
`infra/.env` was copied from the example as it stood before 2026-09-30. The example now carries
the right values, and step 4 makes them mandatory; check any older `infra/.env` against it.

From here on, run every `docker compose` command from `infra/`, except the steps below that
still address the root stack.

#### Step 1 — Record what is running, before changing anything

```bash
cd /root/ims/Inventory_Management_System
docker ps --filter label=com.docker.compose.project=ims --format \
  '{{.Names}}  {{.Label "com.docker.compose.project.config_files"}}  {{.Label "com.docker.compose.project.working_dir"}}'
docker volume ls | grep ims_
git log -1 --format='%h %s'
docker compose exec -T db printenv POSTGRES_USER POSTGRES_DB   # never print the password
grep -oE '^[A-Z_]+' .env 2>/dev/null                           # names only: what the root .env overrides
```

- If `config_files` ends in `Inventory_Management_System/docker-compose.yml`, this item is still
  to do. If it ends in `infra/docker-compose.yml`, it is already done.
- Write down the volume names. **Expect exactly `ims_pgdata`, `ims_files`, `ims_caddy_data` and
  `ims_caddy_config`. If they differ, stop:** `infra/` would create new, empty volumes.

Then record these numbers. Step 7 compares against them.

```bash
Q() { docker compose exec -T db psql -U ims -d "${DB:-ims}" -Atc "$1"; }   # use step 1's user and database if not ims
Q "select max(name) from kysely_migration"      # 0030_approver_count_may_be_zero at 9f4176d
Q "select count(*) from products"
Q "select sp.compartment_id, sp.quantity, sp.reserved_qty from stock_placements sp
   join products p on p.id = sp.product_id where p.product_code = '<a code you know>' order by 1"
Q "select product_code, name from products
   where product_code in ('LAP-0001','GPU-0001','CBL-0001','FRN-0001')"   # the demo catalogue; see step 9
# The nightly reconciliation (stock.service.ts:792-861), both halves. Each must print 0.
Q "with l as (select product_id, compartment_id, sum(d)::int q from (select product_id,
   to_compartment_id compartment_id, quantity d from stock_ledger where to_compartment_id is not null
   union all select product_id, from_compartment_id, -quantity from stock_ledger
   where from_compartment_id is not null) m group by 1,2)
   select count(*) from l full join stock_placements p using (product_id, compartment_id)
   where coalesce(l.q,0) <> coalesce(p.quantity,0)"
Q "with b as (select product_id, compartment_id, sum(quantity)::int q from borrow_requests
   where status = 'PENDING' group by 1,2)
   select count(*) from stock_placements p full join b using (product_id, compartment_id)
   where coalesce(p.reserved_qty,0) <> coalesce(b.q,0)"
```

#### Step 2 — Back up, copy it off the VM, and prove it restores

`infra/backup.sh` reads `infra/.env`, which does not exist yet. So run the same two commands by
hand against the running root stack:

```bash
STAMP=$(date +%Y%m%d-%H%M%S); mkdir -p ~/ims-switch
docker compose exec -T db pg_dump -U ims -d ims -Fc > ~/ims-switch/ims-db-$STAMP.dump
docker run --rm -v ims_files:/files:ro -v ~/ims-switch:/backup alpine \
  tar czf /backup/ims-files-$STAMP.tar.gz -C /files .
```

Copy both files **off the VM** (§5: a backup on the same machine dies with it). Then run the
restore drill from `docs/state/BACKUP-DRILL.md` against that dump, in a scratch database on the
same server:

```bash
docker compose cp ~/ims-switch/ims-db-$STAMP.dump db:/tmp/drill.dump
docker compose exec -T db sh -c 'createdb -U ims ims_drill && pg_restore -U ims -d ims_drill --no-owner /tmp/drill.dump'
DB=ims_drill Q "select max(name) from kysely_migration"    # then the counts and both reconciliation queries
```

The drill passes when all of these hold:

- the row counts in `ims_drill` equal `ims`;
- both reconciliation queries print 0 on `ims_drill`;
- the checks under "Verified after restore" in `BACKUP-DRILL.md` hold: triggers, sequences and
  files;
- the file count in the tar equals `find /files -type f` on the volume.

Then `docker compose exec -T db dropdb -U ims ims_drill`. **Nothing else starts until the drill
passes.**

#### Step 2b — Rehearse the migrations on a copy

Step 6 applies nine migrations to live data that no test has seen. Rehearse them first on the
**keeper** (`docker --context keeper`, `ssh mini-keeper`), against a copy of the VM's database.
**The switch does not happen until the rehearsal passes.**

**The dump holds staff names and email addresses.** It lives on the keeper only. It is never
committed and never copied anywhere else, and it is deleted when the rehearsal ends (item 6
below).

1. **Dump on the VM and copy the dump straight to the keeper.** `pg_dump` is read-only. Step 2's
   dump will do if nothing has been written since.

   ```bash
   # On the VM, from /root/ims/Inventory_Management_System (step 2's command):
   docker compose exec -T db pg_dump -U ims -d ims -Fc > ~/ims-switch/ims-db-$STAMP.dump
   # From the workstation: VM -> keeper; -3 streams it through without storing it here.
   ssh mini-keeper 'mkdir -p -m 700 ~/ims-rehearsal'
   scp -3 root@<vm>:~/ims-switch/ims-db-$STAMP.dump mini-keeper:ims-rehearsal/ims.dump
   ```

2. **Restore it into a throwaway database, and record the "before" numbers.** The database lives
   on tmpfs, so removing the container removes the data.

   ```bash
   docker --context keeper network create ims-rehearsal
   docker --context keeper run -d --name ims-rehearsal-db --network ims-rehearsal \
     --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=ims -e POSTGRES_DB=ims \
     -e POSTGRES_PASSWORD=<throwaway> postgres:16.4-alpine
   ssh mini-keeper 'docker cp ~/ims-rehearsal/ims.dump ims-rehearsal-db:/tmp/ims.dump'
   docker --context keeper exec ims-rehearsal-db pg_restore -U ims -d ims --no-owner /tmp/ims.dump
   R() { docker --context keeper exec ims-rehearsal-db psql -U ims -d ims -Atc "$1"; }
   R "select max(name) from kysely_migration"                        # 0030_approver_count_may_be_zero
   for t in products stock_placements stock_ledger; do echo "$t $(R "select count(*) from $t")"; done
   R "select name from storage_zones order by name"                  # the zones, before rooms exist
   ```

3. **Run the release's `migrate` step against it**, exactly as `infra/` will: `migration:run`,
   then `seed:run`. Use an image built from the release.

   ```bash
   # On the workstation, at the release commit:
   docker --context keeper build -f apps/api/Dockerfile -t ims-api:rehearsal .
   # On the keeper, create ~/ims-rehearsal/rehearsal.env (chmod 600) from infra/.env.example,
   # filled as in step 4 with:
   #   POSTGRES_HOST=ims-rehearsal-db, POSTGRES_PASSWORD=<throwaway>, throwaway secrets,
   #   SEED_ADMIN_EMAIL=<the VM's admin>, DEMO_ACCOUNTS_ENABLED=false, ALLOW_DIRECT_TAKE=true
   ssh mini-keeper 'cd ~/ims-rehearsal && docker run --rm --network ims-rehearsal \
     --env-file rehearsal.env ims-api:rehearsal sh -c "npm run migration:run && npm run seed:run"'
   ```

4. **Boot the app on the migrated copy and take.** `clients/python/smoke_client.py` builds its own
   fixture: a product, a room, a zone, a cell, six units received, a service account and a key.
   It then takes through `POST /stock/take` (its check P2). It only accepts a loopback address,
   so reach the keeper through a tunnel.

   ```bash
   ssh mini-keeper 'cd ~/ims-rehearsal && docker run -d --name ims-rehearsal-api \
     --network ims-rehearsal --env-file rehearsal.env -p 127.0.0.1:3900:3000 ims-api:rehearsal'
   ssh -f -N -L 3900:127.0.0.1:3900 mini-keeper
   cd clients/python && IMS_BASE_URL=http://127.0.0.1:3900 IMS_SMOKE_ADMIN_EMAIL=<the VM's admin> \
     IMS_SMOKE_ADMIN_PASSWORD=<its password on the VM> uv run python smoke_client.py
   ```

   On the VM, demo mode sets the admin's password to the demo password on every start.

5. **The pass criteria.** Record each result in the change ticket.

   - **All migrations complete.** `migrate` exits 0, and
     `R "select max(name) from kysely_migration"` prints `0039_api_key_service_accounts`.
   - **Row counts are unchanged.** `products`, `stock_placements` and `stock_ledger` equal the
     "before" numbers. Measure before the smoke client runs, because it adds rows of its own.
   - **Zones → rooms: list them.** 0033 does no mapping of its own. It puts every existing zone
     into one holding room, `Unassigned Room` (`0033_storage_rooms.ts:45`). Pass: every zone
     from the "before" list appears under that room. The list is the input for deciding the real
     rooms, and an admin moves the zones after go-live.

     ```bash
     R "select r.name, z.name from storage_zones z join storage_rooms r on r.id = z.room_id order by 1, 2"
     ```

   - **Shelf labels: list them.** 0034 gives every existing compartment a `storage_id`, which is
     what gets printed on shelf labels:

     ```bash
     R "select r.name || ' / ' || z.name || ' / ' || c.code, c.storage_id from storage_compartments c
        join storage_zones z on z.id = c.zone_id join storage_rooms r on r.id = z.room_id order by 2"
     ```

   - **Category taxonomy: list the result.** 0035 changes no rows; it makes the category optional
     and adds a depth guard. `seed:run` then adds the reference tree that every install gets
     (`seed.ts:253`). Pass: the depth query prints at most 3, and no product has lost its category
     (the last query prints 0).

     ```bash
     R "with recursive t as (select id, name, 1 as depth, name::text as path from categories
        where parent_id is null union all select c.id, c.name, t.depth + 1, t.path || ' > ' || c.name
        from categories c join t on c.parent_id = t.id)
        select t.depth, t.path, (select count(*) from products p where p.category_id = t.id)
        from t order by t.path"
     R "with recursive t as (select id, 1 as depth from categories where parent_id is null union all
        select c.id, t.depth + 1 from categories c join t on c.parent_id = t.id) select max(depth) from t"
     R "select count(*) from products where category_id is null"
     ```

   - **Reconciliation is 0.** Both queries from step 1 (with `R` in place of `Q`) print 0, both
     before and after the smoke client runs.
   - **The app boots and a take succeeds.** The smoke client prints `PASS` for every check,
     including P2, the take.

6. **Clean up, pass or fail:**

   ```bash
   docker --context keeper rm -f ims-rehearsal-api ims-rehearsal-db   # tmpfs: the copy goes with it
   docker --context keeper network rm ims-rehearsal
   docker --context keeper image rm ims-api:rehearsal
   ssh mini-keeper 'rm -rf ~/ims-rehearsal'                          # the dump and the env file
   ```

   Also close the 3900 tunnel. The dump in `~/ims-switch` on the VM stays: it is step 2's backup.

#### Step 3 — Carry the database password over

The Postgres image reads `POSTGRES_PASSWORD` only when it creates an empty cluster. `ims_pgdata`
keeps the password it was created with. That is probably the root file's public default, unless
the root `.env` set one when the volume was first made. If `infra/.env` holds any other value,
`migrate` and `api` fail with `password authentication failed for user "ims"`, while `db` still
reports healthy. Its healthcheck is `pg_isready`, which does not log in.

- **A. Rotate. This is preferred, because the demo default is public in this repository.** In
  the window, once `api` is stopped (step 6), run:

  ```bash
  docker compose exec db psql -U ims -d ims -c '\password ims'
  ```

  It prompts twice. `\password` sends `ALTER USER ims PASSWORD …` with the value already hashed,
  so the plaintext never reaches shell history or the server log. No old password is needed:
  this image trusts local-socket connections. That is PROVEN on `postgres:16.4-alpine`
  (`local all all trust` in `pg_hba.conf` on our test server) and ASSUMED to be the same on the
  VM. If psql asks for a password anyway, it wants the current one. Put the same new value in
  `infra/.env` as `POSTGRES_PASSWORD`.
- **B. Reuse.** Set `POSTGRES_PASSWORD` in `infra/.env` to exactly the value the cluster has now.

After A, the root stack only starts again (step 8) with the new value as `POSTGRES_PASSWORD` in
the root `.env`.

#### Step 4 — Build `infra/.env`

```bash
cd /root/ims/Inventory_Management_System/infra
cp .env.example .env && chmod 600 .env
openssl rand -hex 32    # three times: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, PDF_SIGNING_SECRET, all different
```

| Key | Value | Why |
|---|---|---|
| `DEMO_ACCOUNTS_ENABLED` | `false` | Explicit. The default is also false. |
| `POSTGRES_DB`, `POSTGRES_USER` | As step 1 recorded (`ims` / `ims`) | They name the existing cluster. Changing them here renames nothing. |
| `POSTGRES_PASSWORD` | Step 3 | |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PDF_SIGNING_SECRET` | New | Everyone is signed out once, and open PDF links stop working (they expire in five minutes anyway). |
| **`FILE_STORAGE_DIR`** | **`/app/storage/files`** | **Must be this value** (the example carries it since 2026-09-30). The old example's `./storage/files` resolves against the container's working directory `/app/apps/api` (`apps/api/Dockerfile:78`, `file-storage.service.ts:164`), which is off the `ims_files` volume. Every existing upload would vanish from the app, and new ones would be lost on the next recreate. |
| **`PDF_STORAGE_DIR`** | **`/app/storage/pdf`** | **Must be this value**, for the same reason. |
| **`PDF_BROWSER_EXECUTABLE_PATH`** | **`/usr/bin/chromium-browser`** | **Must be set.** The example only has it since 2026-09-30. Empty means puppeteer's bundled Chromium, which cannot run on the Alpine image (`config.schema.ts:486-489`), so BOM PDFs would fail. |
| **`SEED_ADMIN_EMAIL`** | **The existing admin's address** (`admin@ims.local` unless the root `.env` set another) | `migrate` re-runs the seed on every start. An address that does not exist creates a **second** admin with `SEED_ADMIN_PASSWORD`. |
| `SEED_ADMIN_PASSWORD` | A strong value | Used only if that address does not exist yet. |
| `PDF_MARGIN_TOP_MM` | `20`, unless BOMs print on letterhead (§0.6) | The example says 45; the running stack uses 20. |
| `TRUST_PROXY_HOPS` | As agreed with IT (§0.7) | |
| `ALLOW_DIRECT_TAKE`, `DIRECT_TAKE_MAX_QTY`, `API_KEY_WRITE_MAX_LIFETIME_DAYS`, `THROTTLE_APIKEY_*` | As in §0.8 | None of these is in the example. |
| `IMS_DOMAIN` | From IT, step 5 | |
| `REGISTRY`, `IMS_TAG` | See step 6 | They name the images. |

The comparison found nothing else in the example that differs from what the stack runs today.
The exceptions are demo mode and the new secrets, above, and `MONITOR_BACKUP_DIR=/backups`, which
`infra/` mounts on purpose. The comparison assumed the root `.env` overrides nothing. Step 1's
`grep` shows whether it does. Carry over any value it sets.

#### Step 5 — The published port changes from 5173 to 80/443 (IT's part, §0.7)

The root stack publishes 5173 (`docker-compose.yml:170-171`). `infra/` publishes 80 and 443
(`infra/docker-compose.yml:101-103`). Whatever forwards traffic to `rndserver:5173` today stops
reaching IMS at the switch. IT decides which of two setups to use:

- **Caddy terminates TLS itself.** Set `IMS_DOMAIN` to the public hostname. Caddy then obtains
  its own certificate.
- **Caddy sits behind IT's proxy on plain HTTP.** Set `IMS_DOMAIN=:80`. The Caddyfile is
  templated on `{$IMS_DOMAIN}`, so no Caddyfile edit is needed; the root stack does exactly
  this. The note in `infra/.env.example:16-17` says to edit the Caddyfile instead; setting the
  variable is enough.

**Before the window, IT tells us three things:**

1. the upstream address and port their proxy will forward to;
2. which `IMS_DOMAIN` form to use;
3. the hop count for `TRUST_PROXY_HOPS`.

§0.7's security condition applies to whichever port `infra/` publishes. **The switch happens only
with IT present, in an agreed window.** Between step 6's `down` and IT repointing, IMS is
unreachable.

#### Step 6 — The switch

```bash
cd /root/ims/Inventory_Management_System
docker compose stop proxy web api                            # no more writes; db stays up
docker compose exec db psql -U ims -d ims -c '\password ims' # path A only (step 3)
# A final dump now that nothing writes: step 2's two commands, new STAMP, copied off the VM.
docker compose down
```

**Never `docker compose down -v`. `-v` deletes the named volumes, and they are the system:
`ims_pgdata` is the database and `ims_files` is every upload and PDF. Both files use the project
name `ims`, so the volumes `infra/` is about to reattach are exactly the ones `-v` deletes, and the
dump becomes the only copy.**

**Step 2b's rehearsal must have passed before any of this.** Start from `infra/`. `infra/deploy.sh`
is the normal path, but three of its assumptions do not
hold at this moment:

1. Its first step is `./backup.sh`, which needs a running `db`.
2. It runs `git pull --ff-only`. The checkout must be on the release branch, and it will pull.
3. It runs `docker compose pull` for `${REGISTRY}/ims-api:${IMS_TAG}`. The VM builds its images
   locally. With no such image in a registry, `pull` exits 1 and the script stops. That is
   PROVEN with Compose v5.1.2 on our test host; the VM's Compose version is UNKNOWN.

Unless the images are in a registry, run its steps by hand:

```bash
cd /root/ims/Inventory_Management_System/infra
git -C .. log -1 --format='%h %s'       # the release being deployed: record it
docker compose up -d db                 # reattaches ims_pgdata
./backup.sh                             # works now: infra/.env exists and db is up
docker compose build
docker compose up -d --remove-orphans   # migrate runs to completion first, then api starts
docker compose logs migrate | tail -20
```

`migrate` runs `migration:run` and then `seed:run` before `api` starts
(`infra/docker-compose.yml:40-58`, `:68-70`). `9f4176d`'s last migration is `0030`. Deploying this
branch therefore applies nine:

- `0031_project_proposals`
- `0032_borrow_custody`
- `0033_storage_rooms`
- `0034_compartment_storage_id`
- `0035_category_taxonomy`
- `0036_product_code_sequence`
- `0037_api_keys`
- `0038_import_jobs`
- `0039_api_key_service_accounts`

The `down` of `0033` and of `0035` refuses in some data states, so undoing these is a restore,
not a rollback migration.

#### Step 7 — Verify

```bash
cd /root/ims/Inventory_Management_System/infra
docker compose exec api printenv DEMO_ACCOUNTS_ENABLED ALLOW_DIRECT_TAKE TRUST_PROXY_HOPS FILE_STORAGE_DIR PDF_STORAGE_DIR
```

Use `printenv` with names, not `env`: `env` prints every secret to the screen and the scrollback.

- `DEMO_ACCOUNTS_ENABLED` is `false`, and the other four are the values from step 4.
- `curl -s <the IMS address>/api/v1/auth/demo-accounts` does **not** list accounts.
- `Q "select max(name) from kysely_migration"` prints `0039_api_key_service_accounts`.
- The product count and the known product's placements equal step 1's numbers.
- An existing uploaded signature or invoice opens, and one BOM PDF generates. Together these
  prove step 4's storage and browser paths.
- A sign-in works.
- Both reconciliation queries print 0.

#### Step 8 — Roll back

```bash
cd /root/ims/Inventory_Management_System/infra && docker compose down   # never -v
cd .. && docker compose up -d                                           # the root stack; the same volumes reattach
```

The switch itself changes nothing in the database, but two things in step 6 do:

- `migrate` applies `0031`–`0039` on the first `up`;
- path A changes the password.

**Once migrations have run, rolling back means restoring the step 2 dump.** Use the final copy
that step 6 took with step 2's commands: the earlier one misses anything written since. There is
no migration rollback to fall back on, because the `down` of `0033` and `0035` can refuse:

- `0033` refuses once any zone name exists in more than one room;
- `0035` refuses once any product has no category.

The code at `9f4176d` also does not know `0031`–`0039`, and its own `migrate` runs on every start.
It is ASSUMED to refuse a database carrying migrations it does not know; Kysely's migrator checks
for this, but it has not been tested here. Restore first, then start the root stack.
`infra/restore.sh` does the restore. Its rename path has never been run on the VM
(`BACKUP-DRILL.md`, "What this drill did not prove").

After path A, put the new password in the root `.env`. IT points traffic back at 5173.

#### Step 9 — After the switch

- **Reset the admin's password** (Admin → Users → Reset password). With demo mode off, the seed
  leaves existing accounts alone, so the reset now sticks. On the root stack every restart put
  it back to `demo`.
- **Deactivate the four demo accounts:** `im@ims.local`, `approver1@ims.local`,
  `approver2@ims.local` and `general@ims.local` (Admin → Users). First confirm with the
  Inventory Manager that nobody does real work under one of them. **Deactivate, never delete.**
  Requisitions, ledger rows, borrows and the audit log reference them. The app has no user delete
  for this reason (`users.controller.ts` offers only `PATCH :id/active`), so do not delete them in
  SQL either.
- **Revoke every API key and deactivate every service account** created while demo mode was on
  (§0.1).
- **Archive the demo products, and only once they hold no stock and no open borrows.** The four
  products are `LAP-0001`, `GPU-0001`, `CBL-0001` and `FRN-0001`, seeded on every root-stack
  start. Check both, with step 1's `Q`:

  ```bash
  Q "select p.product_code, coalesce(sum(sp.quantity), 0), coalesce(sum(sp.reserved_qty), 0)
     from products p left join stock_placements sp on sp.product_id = p.id
     where p.product_code in ('LAP-0001','GPU-0001','CBL-0001','FRN-0001') group by 1 order by 1"
  Q "select p.product_code, b.status, count(*) from borrow_requests b join products p on p.id = b.product_id
     where p.product_code in ('LAP-0001','GPU-0001','CBL-0001','FRN-0001')
     and b.status in ('PENDING','ISSUED','PARTIALLY_RETURNED') group by 1, 2"
  ```

  - Archive a product only when the first query shows `0|0` for it and the second lists nothing
    for it.
  - **If a demo product holds stock or an open borrow, stop.** Decide with the Inventory Manager
    how to take the invented stock out through the normal stock screens; the ledger records it.
    The demo seed does receive stock: on the dev database `CBL-0001` holds 55, `GPU-0001` 4 and
    `LAP-0001` 10.
  - **Never delete a product.** `stock_ledger` is append-only and references it. Archiving keeps
    the history intact.
- Then work through the rest of §0.

### 1. Turn demo mode off — HARD BLOCKER

While `DEMO_ACCOUNTS_ENABLED=true`, `GET /api/v1/auth/demo-accounts` answers **without any
authentication** and hands out every account's email plus the shared password. Anyone who can
reach the login page can sign in as **System Administrator**. There is effectively no
authentication until this is off.

This only works on the `infra/` stack (item 0). The root demo file hard-codes it on. Item 0,
step 4 has already set it:

```bash
# In infra/.env
DEMO_ACCOUNTS_ENABLED=false

cd infra && docker compose up -d --force-recreate api
```

Confirm it is actually off — the check is one command and it is worth doing:

```bash
curl -s <the IMS address>/api/v1/auth/demo-accounts    # must NOT list accounts
```

Then **change the password on every seeded account**, because the demo password was known:
Admin → Users → Reset password, for all five.

Then **revoke every API key and deactivate every service account that exists** (Admin → API
keys). While demo mode was on, anyone could sign in as the administrator, so anything issued in
that time was issued by nobody in particular. While demo mode is on in production the API refuses
every key and refuses to issue new ones (ADR-0002). Anything minted before that refusal existed,
or before this switch, starts working the moment demo mode goes off.

### 2. Push the repository — HARD BLOCKER

At the time of writing the work exists on one laptop and nowhere else. A disk failure loses the
entire build. Push before launch, not after.

```bash
git push origin <branch>
```

### 3. Configure the approval chain

A fresh install accepts no requisition until an admin has set all four. The seed creates none of
them, and the failure at submit names the missing one:

- Admin → Settings → **Sub-threshold approver**
- Admin → Settings → **Approver 1** and **Approver 2**
- At least one user holding **Inventory Manager**
- At least one **department**

### 4. Check the expense threshold

Admin → Settings → Expense threshold. It seeds at 15,000 BDT. At or above it a requisition needs
two approvers; below it, one. Set it to whatever the office actually uses before people start
raising requests against the wrong rule — the count is frozen onto each requisition at submit, so
changing it later does not correct requisitions already in flight.

### 5. Set up backups

`pg_dump` on a schedule, with the output going **somewhere other than this machine**. See §5.
Until that is running, the database has the same single point of failure as the git repository.

### 6. Decide the BOM paper

`PDF_MARGIN_TOP_MM` is 20, which suits plain white A4 and fits five items to a page. If BOMs are
printed on a pre-printed letterhead pad instead, raise it to the height of the printed area.

### 7. Real client IP behind Cloudflare — IT handoff — HARD BLOCKER for go-live

**Owner:** IT team. **Status:** open. **Blocks:** go-live. It does **not** block merging the code.

This section says what the application needs. How the proxy chain meets it is IT's decision.

**Problem.** `https://ims.siot.solutions` has Cloudflare in front and Caddy behind (Arif,
2026-09-29). Behind a proxy chain, every client can appear to the API as one address: a Cloudflare
edge or a proxy. The API keeps its limits per client address. That covers the sign-in backoff and
every rate-limit tier except the per-key one: `auth`, `loginBurst`, `public`, `authenticated` and
`apiKeyAddress`. It also records that address in the audit log (the IP column of Admin → Audit
log). If everyone shares one address, one person's failed sign-ins throttle the whole company,
the key-address limit is shared by every panel, and the audit log cannot tell users apart. This
follows from how the API reads the address. It has **not** been observed on the real chain:
the VM runs an older build on the demo stack (item 0), and nobody has checked what address the
API sees there.

**Requirement.** The API must see each caller's real public IP.

**Security condition.** Only the proxy directly in front of Caddy may reach the port Caddy
publishes: **5173** on the root stack today, **80/443** once item 0 is done. If anything else can
reach it, it can send its own `CF-Connecting-IP` or `X-Forwarded-For` and choose
any address it likes. That bypasses every per-address limit above and writes a false IP into the
audit log.

**What the application expects to receive.**

- **The header it reads is `X-Forwarded-For`, and only that.** The API does not read
  `CF-Connecting-IP`, `X-Real-IP` or `Forwarded`.
- **It trusts `TRUST_PROXY_HOPS` proxy hops, default `1`.** The peer that connects to the API is
  hop 1. The API takes the client address from the `X-Forwarded-For` it receives, counting that
  many entries from the right. With `1` it takes the rightmost entry; with `2`, the one before it.
  If the header has fewer entries than that, it takes the leftmost one. So the real public IP must
  arrive at that position, and every entry to its right must have been added by a proxy IT
  controls.
- **Changing the hop count is configuration, not code.** Set `TRUST_PROXY_HOPS` in the API's
  environment and recreate `api`. That is `infra/.env` for the production stack; the root
  `docker-compose.yml` passes the value through as well. It accepts 0–10. A blank value stops the
  API from booting rather than being read as 0. **IT tells the app owner the value its chain
  needs.**

**Acceptance tests.** IT runs these after its change, once `TRUST_PROXY_HOPS` matches the chain.
Tests (a) and (c) go through `https://ims.siot.solutions` from outside the office network. Use an
email that is not an account, so that no real user's sign-in backoff is touched.

a) **Two public IPs land in two buckets.** From two machines with different public IPs, send one
   failed sign-in each, at least a minute after any earlier attempt from either machine:

   ```bash
   curl -s -D - -o /dev/null -X POST https://ims.siot.solutions/api/v1/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"it-check@example.com","password":"NotThePassword123"}' \
     | grep -i x-ratelimit-remaining-auth
   ```

   **Pass:** both machines print the same `X-RateLimit-Remaining-auth` value, so each has its own
   bucket. **Fail:** the second machine's value is lower than the first's, so they share one.

b) **A forged header sent straight to the origin is refused or ignored.** From a machine that is
   *not* the proxy in front of Caddy, try the origin directly:

   ```bash
   curl -m 5 -s -D - -o /dev/null -X POST http://<origin-host>:<published-port>/api/v1/auth/login \
     -H 'Content-Type: application/json' \
     -H 'CF-Connecting-IP: 192.0.2.77' -H 'X-Forwarded-For: 192.0.2.77' \
     -d '{"email":"it-forge@example.com","password":"NotThePassword123"}'
   ```

   **Pass:** there is no answer (refused), or the Admin → Audit log row for `it-forge@example.com`
   shows an IP other than `192.0.2.77` (ignored). **Fail:** that row shows `192.0.2.77`.

c) **The audit log records the real client IP for a sign-in.** From a machine whose public IP you
   know, sign in at `https://ims.siot.solutions`, or send the failed sign-in from (a). In Admin →
   Audit log, the `auth.login.success` or `auth.login.failure` row shows that machine's public IP.
   Then repeat the request with `-H 'X-Forwarded-For: 192.0.2.77'` added. The row must still show
   the real IP, because a hop count set too high lets a caller choose its own address.

**To close this item,** IT reports the hop count its chain uses and the result of (a), (b) and (c).
The app owner sets `TRUST_PROXY_HOPS` if it is not `1`, and ticks this item.

### 8. Before any system uses an API key

A key is a bearer credential: whoever reads it off the network can use it until it is revoked.
Do all three of these before issuing a key to the lab panel, the voice assistant or a script.

1. **Key clients call `https://ims.siot.solutions`, never an IP or port 5173.** That is the
   canonical HTTPS hostname, with Cloudflare in front and Caddy behind (Arif, 2026-09-29). Its DNS
   answered with Cloudflare addresses on 2026-09-29.
2. **§0.7 is closed, including its security condition.** The per-address key limit
   (`apiKeyAddress`) only works once the API sees real client addresses. The demo stack
   (`docker-compose.yml`) publishes its Caddy on host port 5173 over **plain HTTP**, so a client
   that can reach 5173 directly sends its key in cleartext.
3. **Demo mode is off, and §0.1 is done** (seeded passwords reset, keys and service accounts
   created under demo revoked). Until then every key is refused with
   `403 API_KEYS_DISABLED_IN_DEMO`.

To open the one-call take (`POST /stock/take`), set these in `.env` and recreate `api`:

```bash
ALLOW_DIRECT_TAKE=true                 # default false
DIRECT_TAKE_MAX_QTY=10                 # units per take; default 10 (OQ-KT11 — a guess)
API_KEY_WRITE_MAX_LIFETIME_DAYS=180    # longest a write key may live; default 180
# THROTTLE_APIKEY_LIMIT / THROTTLE_APIKEY_TTL_SECONDS — per key and per address; default 120 / 60
```

The integrator's reference is `docs/reference/15-integration-api.md`.

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
