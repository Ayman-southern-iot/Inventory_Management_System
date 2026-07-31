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

# Prove the dump is readable before trusting it. `pg_dump` exiting 0 only means it finished
# writing; a truncated file, a full disk or a half-written volume still produces exit 0 with a
# useless artefact. `--list` parses the archive's table of contents, so it fails loudly here —
# at 2am, in the log — rather than during a restore, which is the worst possible moment to
# discover it. Verified in the 2026-07-31 drill.
#
# The dump is copied into the container and read from a real path. `pg_restore --list /dev/stdin`
# looks tidier and does not work — it rejects a perfectly good archive, so the check would have
# failed every backup and, worse, trained whoever reads the log to ignore it. Verified both ways
# in the drill: a good dump passes, a truncated one is rejected.
echo "[$STAMP] verifying dump ..."
if ! docker compose exec -T db sh -c \
  'cat > /tmp/verify.dump && pg_restore --list /tmp/verify.dump >/dev/null; rc=$?; rm -f /tmp/verify.dump; exit $rc' \
  < "backups/ims-db-$STAMP.dump"; then
  echo "[$STAMP] FATAL: the dump just written is not a readable archive." >&2
  echo "[$STAMP] Keeping it for inspection and leaving older backups alone." >&2
  exit 1
fi

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
