#!/usr/bin/env bash
# Enter the drawer plan into the dev API on the keeper (apps/api/scripts/drawer-plan.ts).
#
# A dry run by default: it reports what IMS has and what it would create, and changes nothing.
# Pass --apply to create the missing rooms, zones and compartments.
#
# Run scripts/dev-api-keeper.sh first, from the same commit: it syncs the tree, builds the image this
# runs in and starts the API. The script runs inside that image on the API's network and signs in as
# the dev seed admin. The admin's credentials are read from the keeper's settings file, on the
# keeper, and piped to the script's stdin: they are never printed and never reach this machine.
#
# Usage:  scripts/drawer-plan-keeper.sh [--apply]
#
# Environment, default in brackets (the first five as in dev-api-keeper.sh):
#   IMS_KEEPER_SSH          ssh host alias of the keeper                    [mini-keeper]
#   IMS_DEV_DIR             sync target and settings dir on the keeper      [ims-dev]
#   IMS_DEV_NETWORK         network the API runs on                         [ims-dev]
#   IMS_DEV_API_CONTAINER   the API container                               [ims-api-dev]
#   IMS_DEV_API_PREFIX      the API's route prefix (API_GLOBAL_PREFIX)      [api/v1]
#   IMS_DRAWER_PLAN_FILE    the plan, relative to the repo root
#                           [apps/web/src/features/panel/layout/ims-import-v4.csv]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${IMS_KEEPER_SSH:-mini-keeper}"
DEV_DIR="${IMS_DEV_DIR:-ims-dev}"
NETWORK="${IMS_DEV_NETWORK:-ims-dev}"
API_CONTAINER="${IMS_DEV_API_CONTAINER:-ims-api-dev}"
API_PREFIX="${IMS_DEV_API_PREFIX:-api/v1}"
PLAN_FILE="${IMS_DRAWER_PLAN_FILE:-apps/web/src/features/panel/layout/ims-import-v4.csv}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10"
# The API's own port inside the network (config.schema.ts, API_PORT), as in dev-api-keeper.sh.
CONTAINER_PORT=3000

case "${1:-}" in
  '') APPLY='' ;;
  --apply) APPLY='--apply' ;;
  *) echo "usage: $0 [--apply]" >&2; exit 2 ;;
esac

remote() {
  # shellcheck disable=SC2086,SC2029  # SSH_OPTS is a list on purpose; the command expands here on purpose
  ssh $SSH_OPTS "$SSH_HOST" "$@"
}

SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
IMAGE="ims-api:dev-${SHA}"
if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  echo "NOTE: uncommitted changes. ${IMAGE} holds them only if dev-api-keeper.sh ran after they were made." >&2
fi
if ! remote "docker image inspect '${IMAGE}' >/dev/null 2>&1"; then
  echo "FATAL: ${IMAGE} is not on ${SSH_HOST}. Run scripts/dev-api-keeper.sh first." >&2
  exit 2
fi
if [ "$(remote "docker inspect -f '{{.State.Health.Status}}' '${API_CONTAINER}' 2>/dev/null" || true)" != "healthy" ]; then
  echo "FATAL: ${API_CONTAINER} is not running healthy on ${SSH_HOST}. Run scripts/dev-api-keeper.sh first." >&2
  exit 2
fi

echo "==> drawer plan ${APPLY:-(dry run)} with ${IMAGE} against ${API_CONTAINER}"
# Sourced into the remote shell, not exported: printf is a builtin, so only the two seed-admin
# values are read, and they reach the script on stdin, never an argv or the environment.
remote ". '${DEV_DIR}/api.env' && \
  printf '%s\n%s\n' \"\$SEED_ADMIN_EMAIL\" \"\$SEED_ADMIN_PASSWORD\" | \
  docker run --rm -i --network '${NETWORK}' \
    -v \"\$HOME/${DEV_DIR}/Inventory_Management_System/${PLAN_FILE}:/plan.csv:ro\" \
    '${IMAGE}' node dist/scripts/drawer-plan.js \
    --file /plan.csv --api 'http://${API_CONTAINER}:${CONTAINER_PORT}/${API_PREFIX}' ${APPLY}"
