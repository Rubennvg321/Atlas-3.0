#!/usr/bin/env bash
# Wordt elke 5 minuten door systemd gestart (zie install-auto-update.sh).
# Staat er een nieuwe versie op main, dan wordt Atlas bijgewerkt met update.sh.
# Mislukt het bouwen, dan blijft de vorige versie gewoon draaien.
set -uo pipefail
cd /opt/atlas
LOG=/var/log/atlas-update.log
exec 9>/run/atlas-update.lock
flock -n 9 || exit 0   # er loopt al een update

git fetch --quiet origin main || { echo "$(date '+%F %T') ophalen van GitHub mislukt" >>"$LOG"; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0

NEW=$(git log -1 --format='%h %s' origin/main)
echo "$(date '+%F %T') nieuwe versie: $NEW — bijwerken…" >>"$LOG"
if bash /opt/atlas/deploy/update.sh >>"$LOG" 2>&1; then
  echo "$(date '+%F %T') klaar: $NEW draait" >>"$LOG"
else
  echo "$(date '+%F %T') MISLUKT — de vorige versie draait nog. Zie hierboven." >>"$LOG"
  exit 1
fi
