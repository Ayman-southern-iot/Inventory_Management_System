#!/usr/bin/env bash
# Run the API integration suite ON the keeper, beside its test database, with no SSH tunnel.
#
# Through the M5 -> keeper tunnel the suite took 30-42 minutes, and connections stalled:
# stock-import-lock timed out in every run and bom-transportation hung for 15 minutes once. Against
# a database with no tunnel in the path it ran 992/992 in 81 s, and no session ever waited on a
# lock (investigation of 2026-09-30, recorded in the ADR-0002 review addendum). This script is the
# integration gate. The tunnel stays for ad-hoc dev work only.
#
# What it does:
#   1. rsyncs this working tree, uncommitted changes included, to the keeper. It leaves out
#      node_modules, virtualenvs, .git, build output, .env files and local storage.
#   2. Makes the test database reachable by container name. Docker's default bridge has no
#      container DNS, so it creates a user-defined network and attaches the database to it. This is
#      additive and idempotent: the database keeps its existing networks and published port.
#   3. Builds a small runner image once (node + pnpm + Alpine Chromium, the same base and versions
#      as apps/api/Dockerfile).
#   4. Runs the suite in that image, streams its output back, and exits with the suite's exit code.
#
# Usage:  scripts/test-int-keeper.sh [vitest file filter ...]
#   No arguments runs the whole suite. Arguments are passed to vitest as file filters
#   (substrings, e.g. `bom-transportation stock-import-lock`).
#
# Environment, default in brackets. There are no secrets here: the database credentials are the
# fixed throwaway values pinned in apps/api/test/config/test-env.ts.
#   IMS_KEEPER_SSH         ssh host alias of the keeper                      [mini-keeper]
#   IMS_KEEPER_CONTEXT     docker context that reaches the keeper            [keeper]
#   IMS_KEEPER_DIR         sync target, relative to the keeper user's home   [ims-int/Inventory_Management_System]
#   IMS_INT_DB_CONTAINER   the test database container on the keeper         [ims-db-test]
#   IMS_INT_NETWORK        user-defined network shared with the runner       [ims-int]
#   IMS_INT_NODE_IMAGE     runner base image; keep in step with apps/api/Dockerfile  [node:22.13-alpine]
#   IMS_INT_PNPM_VERSION   pnpm version; keep in step with apps/api/Dockerfile       [9.15.4]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${IMS_KEEPER_SSH:-mini-keeper}"
CONTEXT="${IMS_KEEPER_CONTEXT:-keeper}"
REMOTE_DIR="${IMS_KEEPER_DIR:-ims-int/Inventory_Management_System}"
DB_CONTAINER="${IMS_INT_DB_CONTAINER:-ims-db-test}"
NETWORK="${IMS_INT_NETWORK:-ims-int}"
NODE_IMAGE="${IMS_INT_NODE_IMAGE:-node:22.13-alpine}"
PNPM_VERSION="${IMS_INT_PNPM_VERSION:-9.15.4}"
RUNNER_IMAGE="ims-int-runner:$(printf '%s' "$NODE_IMAGE" | tr ':/' '--')-pnpm${PNPM_VERSION}"
RUNNER_NAME="ims-int-run"
STORE_VOLUME="ims-int-pnpm-store"
# Postgres listens on 5432 inside its container; 55434 is only the keeper-host port for the tunnel.
DB_PORT_IN_NETWORK=5432
# Alpine's Chromium, the same path the production image uses (docker-compose.yml, infra/.env.example).
BROWSER_PATH=/usr/bin/chromium-browser
# Keep-alives, so a stalled link fails in about 45 s instead of hanging.
SSH_OPTS="-o ServerAliveInterval=15 -o ServerAliveCountMax=3"

keeper_docker() { docker --context "$CONTEXT" "$@"; }

# One shared test database: two suites against it truncate each other's rows mid-assertion.
if [ -n "$(keeper_docker ps -q --filter "name=^${RUNNER_NAME}\$")" ]; then
  echo "FATAL: a keeper integration run is already in progress (container ${RUNNER_NAME})." >&2
  exit 2
fi
if [ "$(keeper_docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" != "true" ]; then
  echo "FATAL: ${DB_CONTAINER} is not running on the keeper (context ${CONTEXT})." >&2
  exit 2
fi

# ------------------------------------------------------------------------------ 1. sync
HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
DIRTY="$(git -C "$REPO_ROOT" status --porcelain | wc -l | tr -d ' ')"
echo "==> Syncing ${HEAD_SHA} (${DIRTY} uncommitted path(s)) to ${SSH_HOST}:${REMOTE_DIR}"
# shellcheck disable=SC2086,SC2029  # SSH_OPTS is a list on purpose; REMOTE_DIR expands here on purpose
ssh $SSH_OPTS "$SSH_HOST" "mkdir -p '${REMOTE_DIR}'"
# --delete never removes excluded paths, so the keeper's own linux node_modules persist between
# runs and `pnpm install` below only does work when the lockfile changed.
rsync -a --delete -e "ssh ${SSH_OPTS}" \
  --include='.env.example' \
  --exclude='.env' --exclude='.env.*' \
  --exclude='node_modules/' --exclude='.venv/' --exclude='.git/' \
  --exclude='dist/' --exclude='coverage/' --exclude='.claude/' \
  --exclude='/apps/api/storage/' --exclude='/infra/backups/' \
  "${REPO_ROOT}/" "${SSH_HOST}:${REMOTE_DIR}/"
# shellcheck disable=SC2086,SC2029
REMOTE_ABS="$(ssh $SSH_OPTS "$SSH_HOST" "cd '${REMOTE_DIR}' && pwd")"

# ------------------------------------------------------------------------------ 2. network
keeper_docker network inspect "$NETWORK" >/dev/null 2>&1 || keeper_docker network create "$NETWORK" >/dev/null
if ! keeper_docker inspect -f '{{json .NetworkSettings.Networks}}' "$DB_CONTAINER" | grep -q "\"${NETWORK}\""; then
  echo "==> Attaching ${DB_CONTAINER} to network ${NETWORK} (its existing networks and port stay as they are)"
  keeper_docker network connect "$NETWORK" "$DB_CONTAINER"
fi

# ------------------------------------------------------------------------------ 3. runner image
if ! keeper_docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1; then
  echo "==> Building ${RUNNER_IMAGE} (once)"
  # pnpm through npm, not corepack, for the reason apps/api/Dockerfile gives. PUPPETEER_SKIP_DOWNLOAD:
  # there is no linux-arm64 build of puppeteer's browser, and the image's Chromium is used instead.
  # apk is retried because a mirror stall once killed this build after 12 minutes with
  # "pango: IO ERROR"; a second attempt only fetches what is still missing.
  keeper_docker build -t "$RUNNER_IMAGE" - <<DOCKERFILE
FROM ${NODE_IMAGE}
RUN for attempt in 1 2 3; do \\
      apk add --no-cache chromium nss freetype harfbuzz ttf-dejavu ca-certificates tzdata && break; \\
      [ "\$attempt" = 3 ] && exit 1; echo "apk attempt \$attempt failed; retrying"; \\
    done \\
 && npm install -g pnpm@${PNPM_VERSION}
ENV TZ=Asia/Dhaka PUPPETEER_SKIP_DOWNLOAD=true CI=true
DOCKERFILE
fi
keeper_docker volume create "$STORE_VOLUME" >/dev/null

# ------------------------------------------------------------------------------ 4. run
echo "==> Integration suite on the keeper: ${DB_CONTAINER}:${DB_PORT_IN_NETWORK} via network ${NETWORK}"
set +e
# Uploads and rendered PDFs go to apps/api/storage (FILE_STORAGE_DIR / PDF_STORAGE_DIR are not
# pinned in TEST_ENV, gap G-18). A tmpfs keeps them per run instead of piling up in the synced
# checkout (the first full run left 124 files), and keeps the monitoring spec's disk check off the
# keeper's own disk: that disk was 87% used on 2026-09-30, and the check failed on it.
keeper_docker run --rm --init --name "$RUNNER_NAME" --network "$NETWORK" \
  -v "${REMOTE_ABS}:/repo" -v "${STORE_VOLUME}:/pnpm-store" -w /repo \
  --tmpfs /repo/apps/api/storage:rw,size=1g \
  -e npm_config_store_dir=/pnpm-store \
  -e IMS_INT_DB_HOST="$DB_CONTAINER" \
  -e IMS_INT_DB_PORT="$DB_PORT_IN_NETWORK" \
  -e IMS_INT_BROWSER_PATH="$BROWSER_PATH" \
  "$RUNNER_IMAGE" sh -c '
    set -e
    pnpm install --frozen-lockfile --filter "@ims/shared..." --filter "@ims/api..." > /tmp/install.log 2>&1 \
      || { cat /tmp/install.log; exit 1; }
    pnpm --filter @ims/shared build > /tmp/shared-build.log 2>&1 || { cat /tmp/shared-build.log; exit 1; }
    cd apps/api
    exec pnpm exec vitest run --config vitest.integration.config.ts "$@"
  ' sh "$@"
rc=$?
set -e
echo "==> Keeper integration run at ${HEAD_SHA} finished: exit ${rc}"
exit "$rc"
