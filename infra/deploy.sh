#!/usr/bin/env bash
# Update the running system. Safe to run repeatedly.
#   ./deploy.sh            -> deploy the tag in .env
#   ./deploy.sh v1.4.2     -> deploy a specific tag (also rewrites .env)
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "FATAL: .env missing. Copy .env.example and fill it in."; exit 1; }

# `docker compose pull --ignore-buildable` first shipped in Compose v2.15.0 (release notes,
# 2023-01-05). Older Compose rejects the flag, so the pull below checks the version first.
IGNORE_BUILDABLE_SINCE_MAJOR=2
IGNORE_BUILDABLE_SINCE_MINOR=15

# True when the installed Compose is at least <major>.<minor>. `--short` prints e.g. 2.29.1 (some
# builds prefix a v). An unreadable version counts as too old, which only costs the optional pull.
compose_at_least() {
  local version major minor
  version="$(docker compose version --short 2>/dev/null || true)"
  version="${version#v}"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  (( major > $1 || (major == $1 && minor >= $2) ))
}

# REGISTRY as .env sets it. docker-compose.yml defaults it to `local`: "built on this host".
REGISTRY_IN_ENV="$(sed -n 's/^REGISTRY=//p' .env | tail -n 1)"
REGISTRY_IN_ENV="${REGISTRY_IN_ENV:-local}"

# 1. Back up FIRST. A migration that goes wrong is only recoverable if you did this.
echo "==> Backing up before deploy"
./backup.sh

# 2. Optionally pin a new tag
if [ "${1:-}" != "" ]; then
  echo "==> Setting IMS_TAG=$1"
  sed -i "s/^IMS_TAG=.*/IMS_TAG=$1/" .env
fi

# 3. Pull code (compose file, nginx template) and images
echo "==> Pulling"
git pull --ff-only
if [ "$REGISTRY_IN_ENV" != "local" ]; then
  # Published images: IMS_TAG picks the version, so every image comes from the registry.
  docker compose pull
else
  # No registry: api, migrate and web are built here from the checkout; only db and proxy come
  # from a public registry. A plain `docker compose pull` also tries the app images, gets "pull
  # access denied", exits 1 and stops this script under `set -e`.
  if compose_at_least "$IGNORE_BUILDABLE_SINCE_MAJOR" "$IGNORE_BUILDABLE_SINCE_MINOR"; then
    docker compose pull --ignore-buildable
  else
    echo "    Compose '$(docker compose version --short 2>/dev/null || echo unknown)' predates" \
      "--ignore-buildable; skipping the pull. 'up' fetches db and proxy if they are missing."
  fi
  echo "==> Building"
  docker compose build
fi

# 4. Recreate only what changed. The db container is left alone unless its
#    image or config changed, and the pgdata volume is never touched.
echo "==> Starting"
docker compose up -d --remove-orphans

# 5. Wait for health
echo "==> Waiting for API health"
for i in $(seq 1 30); do
  if [ "$(docker compose ps -q api | xargs -r docker inspect -f '{{.State.Health.Status}}')" = "healthy" ]; then
    echo "    healthy"; break
  fi
  sleep 3
  [ "$i" = "30" ] && { echo "!!  API did not become healthy. Logs:"; docker compose logs --tail=80 api; exit 1; }
done

# 6. Reclaim disk. `image prune` is safe. NEVER add --volumes to any prune.
docker image prune -f >/dev/null

docker compose ps
echo "==> Deployed: $(grep '^IMS_TAG=' .env)"
