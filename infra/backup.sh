#!/usr/bin/env bash
# Nightly + pre-deploy backup. Run from cron:
#   0 2 * * *  /opt/ims/backup.sh >> /var/log/ims-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups

echo "[$STAMP] pg_dump ..."
# -Fc = custom format, compressed, restorable with pg_restore into a fresh DB
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/ims-db-$STAMP.dump"

echo "[$STAMP] files ..."
docker run --rm \
  -v ims_files:/files:ro \
  -v "$PWD/backups:/backup" \
  alpine tar czf "/backup/ims-files-$STAMP.tar.gz" -C /files .

# keep 30 days locally
find backups -name 'ims-*' -mtime +30 -delete

# OFFSITE: uncomment one. A backup that lives on the same VM as the database
# is not a backup — it dies with the VM.
# rclone copy backups/ remote:ims-backups/ --max-age 25h
# aws s3 sync backups/ s3://your-bucket/ims/ --exclude '*' --include 'ims-*'

echo "[$STAMP] done: $(ls -lh backups/ims-db-$STAMP.dump | awk '{print $5}')"
