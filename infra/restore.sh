#!/usr/bin/env bash
# Restore a dump into the running database. DESTRUCTIVE — it replaces current data.
#   ./restore.sh backups/ims-db-20260728-020000.dump
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

DUMP="${1:?usage: ./restore.sh <dumpfile>}"
read -rp "This REPLACES the current '$POSTGRES_DB' database. Type 'yes' to continue: " ok
[ "$ok" = "yes" ] || exit 1

docker compose stop api web migrate
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB}_old;" \
  -c "ALTER DATABASE $POSTGRES_DB RENAME TO ${POSTGRES_DB}_old;" \
  -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < "$DUMP"
docker compose up -d

echo "Restored. Old database kept as ${POSTGRES_DB}_old — drop it once you've verified."
