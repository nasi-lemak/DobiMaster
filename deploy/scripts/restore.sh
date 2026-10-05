#!/usr/bin/env bash
# Restore a backup made by backup.sh. Replaces ALL current data. Run from the deploy/ folder:
#   scripts/restore.sh backups/db-20261005-1900.dump [backups/uploads-20261005-1900.tar.gz]
set -euo pipefail
cd "$(dirname "$0")/.."
DB_DUMP="${1:?usage: scripts/restore.sh backups/db-XXXX.dump [backups/uploads-XXXX.tar.gz]}"
UPLOADS="${2:-}"
[ -f "$DB_DUMP" ] || { echo "No such file: $DB_DUMP"; exit 1; }

read -r -p "This REPLACES all data on this server with $DB_DUMP. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

docker compose stop app
docker compose exec -T db pg_restore --clean --if-exists --no-owner -U dobi -d dobimaster < "$DB_DUMP"
if [ -n "$UPLOADS" ]; then
  # The archive holds "uploads/…"; the volume is the contents of that folder.
  docker run --rm -v dobimaster_uploads:/restore/uploads -v "$PWD/$(dirname "$UPLOADS")":/in:ro alpine \
    sh -c "find /restore/uploads -mindepth 1 -delete && tar -xzf /in/$(basename "$UPLOADS") -C /restore && chown -R 1000:1000 /restore/uploads"
fi
docker compose start app
echo "Restored. Check https://$(grep -E '^DOMAIN=' .env | cut -d= -f2)/health"
