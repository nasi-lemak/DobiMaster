#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 22.04 / 24.04 server for DobiMaster. Run as root from the repo:
#   git clone <repo> /opt/dobimaster && cd /opt/dobimaster && sudo deploy/scripts/setup-server.sh
# Safe to run again: it skips what is already done.
set -euo pipefail
cd "$(dirname "$0")/.."   # deploy/
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }

echo "== System updates, firewall, automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git openssl ufw unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

# Building the app needs more memory than a 1 GB server has; a swap file prevents out-of-memory failures.
if ! swapon --show | grep -q .; then
  echo "== Adding a 2 GB swap file"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
  echo "== Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  echo "== Creating deploy/.env"
  read -r -p "Domain for DobiMaster (e.g. app.yourdobi.my): " domain
  read -r -p "Your email (for HTTPS certificate notices): " email
  read -r -p "Business name customers' data is held by (for the privacy notice, e.g. Dobi Ceria Sdn. Bhd.): " operator
  cp .env.example .env
  # Escape characters that are special in a sed replacement (e.g. "Ali & Sons Sdn. Bhd.").
  esc() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }
  domain=$(esc "$domain"); email=$(esc "$email"); operator=$(esc "$operator")
  sed -i "s|^DOMAIN=.*|DOMAIN=${domain}|; s|^ACME_EMAIL=.*|ACME_EMAIL=${email}|; s|^VAPID_SUBJECT=.*|VAPID_SUBJECT=mailto:${email}|; s|^LEGAL_OPERATOR_NAME=.*|LEGAL_OPERATOR_NAME=${operator}|; s|^LEGAL_CONTACT_EMAIL=.*|LEGAL_CONTACT_EMAIL=${email}|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 32)|; s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  chmod 600 .env
  echo "Saved. Secrets were generated for you; keep a copy of deploy/.env somewhere safe (password manager)."
fi

domain=$(grep -E '^DOMAIN=' .env | cut -d= -f2)
server_ip=$(curl -4 -fsS https://api.ipify.org || true)
dns_ip=$(getent ahostsv4 "$domain" | awk 'NR==1 {print $1}' || true)
if [ -n "$server_ip" ] && [ "$dns_ip" != "$server_ip" ]; then
  echo
  echo "!! $domain points to '${dns_ip:-nothing}', but this server is $server_ip."
  echo "!! Add a DNS 'A' record for $domain -> $server_ip, wait a few minutes, then run this script again."
  echo "!! (HTTPS certificates can't be issued until the domain points here.)"
  exit 1
fi

echo "== Building and starting DobiMaster (the first build takes a few minutes)"
mkdir -p backups && chmod 700 backups
docker compose up -d --build

echo "== Waiting for https://$domain"
for i in $(seq 1 90); do
  if curl -fsS "https://$domain/health" >/dev/null 2>&1; then
    echo
    echo "DobiMaster is live: https://$domain/owner"
    echo "Next: create your account there, then follow docs/DEPLOY.md step 6 (email, WhatsApp, monitoring)."
    exit 0
  fi
  sleep 5
done
echo "Not reachable yet. Check: docker compose logs --tail=100 app caddy" >&2
exit 1
