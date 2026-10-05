#!/usr/bin/env bash
# Update to the latest code: back up, pull, rebuild, restart (database migrations run on start).
# Run from anywhere:  deploy/scripts/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== Backing up first"
docker compose exec -T backup /bin/sh /backup.sh now
echo "== Pulling latest code"
git -C .. pull --ff-only
echo "== Rebuilding and restarting"
docker compose up -d --build
docker image prune -f >/dev/null
echo "== Waiting for the app to report healthy"
for i in $(seq 1 60); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "Updated and healthy."; exit 0
  fi
  sleep 2
done
echo "The app did not become healthy. See: docker compose logs --tail=100 app" >&2
exit 1
