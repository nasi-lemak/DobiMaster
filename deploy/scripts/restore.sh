#!/usr/bin/env bash
# Restore a backup made by backup.sh. Replaces ALL current data. Run from the deploy/ folder:
#   scripts/restore.sh backups/db-20261005-190000.dump [backups/uploads-20261005-190000.tar.gz]
# Safety: checks the files first, takes a backup of the current data, restores the database in one
# transaction (all or nothing), and always starts the app again, even if something fails.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_DUMP="$(realpath -e "${1:?usage: scripts/restore.sh backups/db-XXXX.dump [backups/uploads-XXXX.tar.gz]}")" || { echo "No such file: $1"; exit 1; }
UPLOADS=""
if [ -n "${2:-}" ]; then UPLOADS="$(realpath -e "$2")" || { echo "No such file: $2"; exit 1; }; fi

echo "== Checking the backup files"
docker compose exec -T db pg_restore -l < "$DB_DUMP" > /dev/null || { echo "Not a readable database dump: $DB_DUMP"; exit 1; }
if [ -n "$UPLOADS" ]; then tar -tzf "$UPLOADS" > /dev/null || { echo "Not a readable photo archive: $UPLOADS"; exit 1; }; fi

read -r -p "This REPLACES all data on this server with $(basename "$DB_DUMP"). Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

echo "== Backing up the current data first (in case you need it back)"
docker compose exec -T backup /bin/sh /backup.sh now

trap 'docker compose start app > /dev/null' EXIT # always bring the app back
docker compose stop app

echo "== Restoring the database"
docker compose exec -T db pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -U dobi -d dobimaster < "$DB_DUMP"

if [ -n "$UPLOADS" ]; then
  echo "== Restoring photos"
  # Unpack to a temporary folder first; only replace the photos once that worked.
  docker run --rm -v dobimaster_uploads:/restore/uploads -v "$(dirname "$UPLOADS")":/in:ro alpine sh -ec "
    mkdir -p /tmp/new && tar -xzf '/in/$(basename "$UPLOADS")' -C /tmp/new && [ -d /tmp/new/uploads ]
    find /restore/uploads -mindepth 1 -delete
    cp -a /tmp/new/uploads/. /restore/uploads/
    chown -R 1000:1000 /restore/uploads"
fi
echo "Restored. Check https://$(grep -E '^DOMAIN=' .env | cut -d= -f2)/health"
