#!/usr/bin/env bash
# Atlas (opnieuw) bouwen en starten met de nieuwste code. Uitvoeren als root.
set -euo pipefail
cd /opt/atlas
for k in PGHOST PGPASSWORD AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET AUTH_ALLOWED_EMAILS; do
  if ! grep -qE "^${k}=.+" .env; then echo "Let op: ${k} is nog leeg in /opt/atlas/.env"; exit 1; fi
done
git pull --ff-only
docker compose build
# Docker laat soms een oude kopie achter (naam als "1c657ce053c5_atlas-web-1"). Die blokkeert
# het starten met "Conflict. The container name … is already in use". Eerst opruimen.
docker ps -aq --filter "name=^[0-9a-f]{12}_atlas-" | xargs -r docker rm -f >/dev/null
if ! docker compose up -d; then
  echo "Starten mislukt; oude containers opruimen en opnieuw proberen…"
  docker compose rm -sf web worker >/dev/null || true
  docker ps -aq --filter "name=atlas-web" --filter "name=atlas-worker" | xargs -r docker rm -f >/dev/null
  docker compose up -d
fi
docker image prune -f >/dev/null
echo
echo "Atlas draait. Logboek bekijken:  docker compose -f /opt/atlas/docker-compose.yml logs -f web"
