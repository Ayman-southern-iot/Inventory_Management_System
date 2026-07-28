#!/usr/bin/env bash
# Update the running system. Safe to run repeatedly.
#   ./deploy.sh            -> deploy the tag in .env
#   ./deploy.sh v1.4.2     -> deploy a specific tag (also rewrites .env)
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "FATAL: .env missing. Copy .env.example and fill it in."; exit 1; }

# 1. Back up FIRST. A migration that goes wrong is only recoverable if you did this.
echo "==> Backing up before deploy"
./backup.sh

# 2. Optionally pin a new tag
if [ "${1:-}" != "" ]; then
  echo "==> Setting IMS_TAG=$1"
  sed -i "s/^IMS_TAG=.*/IMS_TAG=$1/" .env
fi

# 3. Pull code (compose file, Caddyfile) and images
echo "==> Pulling"
git pull --ff-only
docker compose pull

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
