#!/bin/sh
# Database + photo backups. Runs inside the "backup" container (postgres:16-alpine).
#   backup.sh now    one backup immediately
#   backup.sh loop   nightly at BACKUP_HOUR (UTC), keeping BACKUP_KEEP_DAYS days
set -eu
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR:-19}"
OUT="${BACKUP_DIR:-/backups}"
DATA="${UPLOADS_PARENT:-/data}" # contains the uploads/ folder

backup_now() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  mkdir -p "$OUT"
  # Custom-format dump: compressed, restorable with pg_restore (see scripts/restore.sh).
  pg_dump -Fc -f "$OUT/db-$stamp.dump.partial"
  mv "$OUT/db-$stamp.dump.partial" "$OUT/db-$stamp.dump"
  if [ -d "$DATA/uploads" ]; then
    tar -czf "$OUT/uploads-$stamp.tar.gz.partial" -C "$DATA" uploads
    mv "$OUT/uploads-$stamp.tar.gz.partial" "$OUT/uploads-$stamp.tar.gz"
  fi
  find "$OUT" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
  find "$OUT" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
  find "$OUT" -name '*.partial' -mmin +120 -delete
  echo "$(date -u +%FT%TZ) backup ok: db-$stamp.dump ($(du -h "$OUT/db-$stamp.dump" | cut -f1))"
}

case "${1:-now}" in
  now) backup_now ;;
  loop)
    echo "nightly backups at ${HOUR}:00 UTC, keeping ${KEEP_DAYS} days"
    while true; do
      since_midnight=$(( $(date -u +%s) % 86400 ))
      wait=$(( (HOUR * 3600 - since_midnight + 86400) % 86400 ))
      [ "$wait" -eq 0 ] && wait=86400
      sleep "$wait"
      backup_now || echo "$(date -u +%FT%TZ) BACKUP FAILED" >&2
    done
    ;;
  *) echo "usage: backup.sh now|loop" >&2; exit 2 ;;
esac
