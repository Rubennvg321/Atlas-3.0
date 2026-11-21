#!/usr/bin/env bash
# Atlas (opnieuw) bouwen en starten met de nieuwste code. Uitvoeren als root.
set -euo pipefail
cd /opt/atlas
for k in PGHOST PGPASSWORD AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET AUTH_ALLOWED_EMAILS; do
  if ! grep -qE "^${k}=.+" .env; then echo "Let op: ${k} is nog leeg in /opt/atlas/.env"; exit 1; fi
done
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo
echo "Atlas draait. Logboek bekijken:  docker compose -f /opt/atlas/docker-compose.yml logs -f web"
