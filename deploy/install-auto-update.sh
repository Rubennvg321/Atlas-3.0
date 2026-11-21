#!/usr/bin/env bash
# Eenmalig uitvoeren als root: zet de automatische update aan (elke 5 minuten).
# Uitzetten:  systemctl disable --now atlas-update.timer
set -euo pipefail
cat >/etc/systemd/system/atlas-update.service <<'UNIT'
[Unit]
Description=Atlas bijwerken als er een nieuwe versie op main staat
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/atlas/deploy/auto-update.sh
UNIT
cat >/etc/systemd/system/atlas-update.timer <<'UNIT'
[Unit]
Description=Elke 5 minuten controleren op een nieuwe Atlas-versie

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now atlas-update.timer
echo "Automatische update staat aan. Atlas controleert elke 5 minuten op een nieuwe versie."
echo "Logboek bekijken:  tail -n 30 /var/log/atlas-update.log"
