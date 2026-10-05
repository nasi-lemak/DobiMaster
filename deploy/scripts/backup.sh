#!/bin/sh
# Database + photo backups. Runs inside the "backup" container (postgres:16-alpine).
#   backup.sh now    one backup immediately (exit code 1 if it failed)
#   backup.sh loop   nightly at BACKUP_HOUR (UTC), keeping BACKUP_KEEP_DAYS days
# Every run writes its outcome to $BACKUP_DIR/last-backup.txt ("ok …" or "FAILED …").
set -u
umask 077 # dumps contain password hashes and phone numbers: owner-only
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR:-19}"
OUT="${BACKUP_DIR:-/backups}"
DATA="${UPLOADS_PARENT:-/data}" # contains the uploads/ folder

fail() {
  echo "$(date -u +%FT%TZ) BACKUP FAILED: $*" >&2
  echo "FAILED $(date -u +%FT%TZ) $*" > "$OUT/last-backup.txt" 2>/dev/null
  return 1
}

# Every step is checked explicitly (`|| fail`): `set -e` is not reliable inside a function called from
# `if`/`||`, which is how the loop below calls it.
backup_now() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  mkdir -p "$OUT" || fail "can't create $OUT" || return 1
  db="$OUT/db-$stamp.dump"
  pg_dump -Fc -f "$db.partial" || { rm -f "$db.partial"; fail "pg_dump failed"; return 1; }
  # A dump only counts if it is non-empty and pg_restore can read its table of contents.
  [ -s "$db.partial" ] || { rm -f "$db.partial"; fail "empty dump"; return 1; }
  pg_restore -l "$db.partial" > /dev/null || { rm -f "$db.partial"; fail "dump is unreadable"; return 1; }
  mv "$db.partial" "$db" || { fail "can't save dump"; return 1; }
  if [ -d "$DATA/uploads" ]; then
    up="$OUT/uploads-$stamp.tar.gz"
    tar -czf "$up.partial" -C "$DATA" uploads || { rm -f "$up.partial"; fail "photo archive failed"; return 1; }
    tar -tzf "$up.partial" > /dev/null || { rm -f "$up.partial"; fail "photo archive is unreadable"; return 1; }
    mv "$up.partial" "$up" || { fail "can't save photo archive"; return 1; }
  fi
  # Prune only after a verified backup, so failures never eat the last good copies.
  find "$OUT" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
  find "$OUT" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
  find "$OUT" -name '*.partial' -mmin +120 -delete
  size=$(du -h "$db" | cut -f1)
  echo "ok $(date -u +%FT%TZ) db-$stamp.dump ($size)" > "$OUT/last-backup.txt"
  echo "$(date -u +%FT%TZ) backup ok: db-$stamp.dump ($size)"
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
      backup_now || true # already logged and recorded in last-backup.txt
    done
    ;;
  *) echo "usage: backup.sh now|loop" >&2; exit 2 ;;
esac
