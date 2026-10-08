#!/usr/bin/env bash
# Run the API as a container ON the keeper, against its dev database, for work that needs a live
# API: entering the drawer plan through the Locations endpoints first of all. Postgres never runs on
# the Mac, and an SSH tunnel to the keeper's database stalls (see test-int-keeper.sh), so the API
# runs beside the database instead.
#
# What it does. Idempotent: re-run it after a pull, or after the database container restarts.
#   1. rsyncs this working tree, uncommitted changes included, to the keeper (same excludes as
#      test-int-keeper.sh, so no .env file ever leaves this machine).
#   2. Builds apps/api/Dockerfile there, tagged with the commit.
#   3. Attaches the dev database to a user-defined network, so the API reaches it by name. Additive:
#      the database keeps its existing networks and published port.
#   4. Writes the API's settings file on the keeper, once, mode 0600: three random secrets and a
#      random seed-admin password. The values are generated on the keeper and never printed. The
#      database credentials are copied from the database container's own environment on each run.
#   5. Runs migrations and the seed in a one-shot container, as the root compose's `migrate` job does.
#   6. Replaces the API container, published on the keeper's loopback only, and waits until Docker
#      reports it healthy.
#
# The dev database keeps its data on tmpfs: restarting that container, or the keeper, empties it.
# Step 5 rebuilds the schema and the seed admin, so re-running this script is the recovery. Anything
# entered through the API since is gone and has to be entered again.
#
# The seed admin's password stays in the settings file on the keeper. To sign in with it, read it
# there yourself; this script never shows it.
#
# Usage:  scripts/dev-api-keeper.sh
#
# Environment, default in brackets:
#   IMS_KEEPER_SSH            ssh host alias of the keeper                         [mini-keeper]
#   IMS_DEV_DIR               sync target and settings dir, relative to the keeper user's home
#                                                                                   [ims-dev]
#   IMS_DEV_DB_CONTAINER      the dev database container on the keeper             [ims-db-dev]
#   IMS_DEV_NETWORK           user-defined network shared with the API             [ims-dev]
#   IMS_DEV_API_CONTAINER     name of the API container                            [ims-api-dev]
#   IMS_DEV_API_PORT          keeper loopback port the API is published on         [3010]
#   IMS_DEV_SEED_ADMIN_EMAIL  the first ADMIN the seed creates                     [admin@ims.local]
#   IMS_DEV_TZ                business time zone of the API process                [Asia/Dhaka]
#   IMS_DEV_HEALTH_TIMEOUT_S  how long to wait for /health after starting          [90]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${IMS_KEEPER_SSH:-mini-keeper}"
DEV_DIR="${IMS_DEV_DIR:-ims-dev}"
DB_CONTAINER="${IMS_DEV_DB_CONTAINER:-ims-db-dev}"
NETWORK="${IMS_DEV_NETWORK:-ims-dev}"
API_CONTAINER="${IMS_DEV_API_CONTAINER:-ims-api-dev}"
API_PORT="${IMS_DEV_API_PORT:-3010}"
SEED_ADMIN_EMAIL="${IMS_DEV_SEED_ADMIN_EMAIL:-admin@ims.local}"
BUSINESS_TZ="${IMS_DEV_TZ:-Asia/Dhaka}"
HEALTH_TIMEOUT_S="${IMS_DEV_HEALTH_TIMEOUT_S:-90}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10"
# Ports inside the network, not configuration: the API's own default (config.schema.ts, API_PORT)
# and the postgres image's.
CONTAINER_PORT=3000
DB_CONTAINER_PORT=5432

# Every docker command runs on the keeper through ssh, so the files it reads (the settings file)
# are the keeper's, and nothing secret crosses into this terminal.
remote() {
  # shellcheck disable=SC2086,SC2029  # SSH_OPTS is a list on purpose; the command expands here on purpose
  ssh $SSH_OPTS "$SSH_HOST" "$@"
}

if ! remote true 2>/dev/null; then
  echo "FATAL: cannot reach ${SSH_HOST} over ssh. Check the WireGuard tunnel first." >&2
  exit 2
fi
if [ "$(remote "docker inspect -f '{{.State.Running}}' '${DB_CONTAINER}' 2>/dev/null" || true)" != "true" ]; then
  echo "FATAL: ${DB_CONTAINER} is not running on ${SSH_HOST}." >&2
  exit 2
fi

SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
DIRTY="$(git -C "$REPO_ROOT" status --porcelain | wc -l | tr -d ' ')"
IMAGE="ims-api:dev-${SHA}"
SRC_DIR="${DEV_DIR}/Inventory_Management_System"
SETTINGS_FILE="${DEV_DIR}/api.env"
DB_ENV_FILE="${DEV_DIR}/db.env"

# ------------------------------------------------------------------------------ 1. sync
echo "==> Syncing ${SHA} (${DIRTY} uncommitted path(s)) to ${SSH_HOST}:${SRC_DIR}"
remote "mkdir -p '${SRC_DIR}'"
rsync -a --delete -e "ssh ${SSH_OPTS}" \
  --include='.env.example' \
  --exclude='.env' --exclude='.env.*' \
  --exclude='node_modules/' --exclude='.venv/' --exclude='.git/' \
  --exclude='dist/' --exclude='coverage/' --exclude='.claude/' \
  --exclude='/apps/api/storage/' --exclude='/infra/backups/' \
  "${REPO_ROOT}/" "${SSH_HOST}:${SRC_DIR}/"

# ------------------------------------------------------------------------------ 2. image
if [ "$DIRTY" != "0" ] || ! remote "docker image inspect '${IMAGE}' >/dev/null 2>&1"; then
  echo "==> Building ${IMAGE} on the keeper (several minutes the first time)"
  remote "cd '${SRC_DIR}' && docker build -q -f apps/api/Dockerfile -t '${IMAGE}' ." >/dev/null
else
  echo "==> ${IMAGE} already built"
fi

# ------------------------------------------------------------------------------ 3. network
remote "docker network inspect '${NETWORK}' >/dev/null 2>&1 || docker network create '${NETWORK}' >/dev/null"
if ! remote "docker inspect -f '{{json .NetworkSettings.Networks}}' '${DB_CONTAINER}'" | grep -q "\"${NETWORK}\""; then
  echo "==> Attaching ${DB_CONTAINER} to network ${NETWORK}"
  remote "docker network connect '${NETWORK}' '${DB_CONTAINER}'"
fi

# ------------------------------------------------------------------------------ 4. settings
# Generated on the keeper, written with umask 077, and never echoed. Kept between runs, so the
# seed admin's password does not change under anyone who has already read it.
if ! remote "test -s '${SETTINGS_FILE}'"; then
  echo "==> Writing ${SSH_HOST}:${SETTINGS_FILE} (mode 0600, values generated there, not shown)"
  # development, not production: in production the seed creates its admin with a forced password
  # change, and until that is done the API refuses every other call from it. A script signing in
  # with that admin (the drawer-plan entry) would get nothing but 403s.
  remote "umask 077 && {
    echo NODE_ENV=development
    echo JWT_ACCESS_SECRET=\$(openssl rand -hex 32)
    echo JWT_REFRESH_SECRET=\$(openssl rand -hex 32)
    echo PDF_SIGNING_SECRET=\$(openssl rand -hex 32)
    echo SEED_ADMIN_EMAIL='${SEED_ADMIN_EMAIL}'
    echo SEED_ADMIN_PASSWORD=\$(openssl rand -hex 18)
    echo DEMO_ACCOUNTS_ENABLED=false
    echo PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
    echo FILE_STORAGE_DIR=/app/storage/files
    echo PDF_STORAGE_DIR=/app/storage/pdf
  } > '${SETTINGS_FILE}'"
fi
# The database's credentials are whatever its container was started with; copy them, do not guess.
remote "umask 077 && docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' '${DB_CONTAINER}' \
  | grep -E '^POSTGRES_(DB|USER|PASSWORD)=' > '${DB_ENV_FILE}'"

RUN_ENV="--env-file '${SETTINGS_FILE}' --env-file '${DB_ENV_FILE}' \
  -e POSTGRES_HOST='${DB_CONTAINER}' -e POSTGRES_PORT=${DB_CONTAINER_PORT} -e TZ='${BUSINESS_TZ}'"

# ------------------------------------------------------------------------------ 5. migrate + seed
echo "==> Migrating and seeding ${DB_CONTAINER}"
remote "docker run --rm --network '${NETWORK}' ${RUN_ENV} '${IMAGE}' \
  sh -c 'npm run --silent migration:run && npm run --silent seed:run'"

# ------------------------------------------------------------------------------ 6. API
echo "==> Starting ${API_CONTAINER} on ${SSH_HOST} 127.0.0.1:${API_PORT}"
remote "docker rm -f '${API_CONTAINER}' >/dev/null 2>&1 || true"
remote "docker run -d --name '${API_CONTAINER}' --restart unless-stopped --network '${NETWORK}' \
  ${RUN_ENV} -p '127.0.0.1:${API_PORT}:${CONTAINER_PORT}' '${IMAGE}' >/dev/null"

# Docker's own health status, not a probe of /health: it is what drawer-plan-keeper.sh checks, so
# once this returns that check passes too. The image's HEALTHCHECK polls /health every 15 s.
deadline=$((SECONDS + HEALTH_TIMEOUT_S))
until [ "$(remote "docker inspect -f '{{.State.Health.Status}}' '${API_CONTAINER}'")" = "healthy" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "FATAL: ${API_CONTAINER} did not answer /health within ${HEALTH_TIMEOUT_S} s. Its last log lines:" >&2
    remote "docker logs --tail 30 '${API_CONTAINER}'" >&2
    exit 1
  fi
  sleep 3
done
echo "==> ${API_CONTAINER} is healthy: ${IMAGE}, http://127.0.0.1:${API_PORT} on ${SSH_HOST}"
