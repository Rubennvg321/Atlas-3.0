#!/usr/bin/env bash
# Eenmalige inrichting van de Atlas-server (Ubuntu). Uitvoeren als root:
#   bash /opt/atlas/deploy/server-setup.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> Systeem bijwerken"
apt-get update -y
apt-get -y -o Dpkg::Options::="--force-confold" upgrade
apt-get install -y ca-certificates curl git ufw unattended-upgrades openssl

echo "==> Automatische beveiligingsupdates aan"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Docker installeren"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh || apt-get install -y docker.io docker-compose-v2
fi
systemctl enable --now docker

echo "==> Firewall: alleen SSH, HTTP en HTTPS"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Swap (2 GB) voor het bouwen"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> .env voorbereiden"
cd /opt/atlas
if [ ! -f .env ]; then
  cat > .env <<ENV
# Database (Scaleway → Managed Database → Endpoint)
PGHOST=
PGPORT=
PGUSER=atlas
PGPASSWORD=
PGDATABASE=rdb

AUTH_URL=https://atlas.stepsandstairs.nl
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_ALLOWED_EMAILS=
AUTH_ALLOWED_DOMAIN=stepsandstairs.nl
AUTH_DEV_BYPASS=0
ENV
  chmod 600 .env
fi

echo
echo "Klaar. Vul nu de lege velden in met:  nano /opt/atlas/.env"
echo "Start daarna Atlas met:                bash /opt/atlas/deploy/update.sh"
