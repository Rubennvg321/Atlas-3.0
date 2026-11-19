#!/usr/bin/env bash
# Vraagt stap voor stap de instellingen en schrijft /opt/atlas/.env
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/atlas/.env}"

ask() { # vraag, variabele, verborgen?
  local q="$1" var="$2" hidden="${3:-}" val=""
  while [ -z "$val" ]; do
    echo
    if [ -n "$hidden" ]; then
      read -r -s -p "$q " val; echo; [ -n "$val" ] && echo "   (ontvangen, ${#val} tekens)"
    else
      read -r -p "$q " val
    fi
    val="$(echo "$val" | tr -d '[:space:]')"
    [ -z "$val" ] && echo "   Leeg. Probeer het nog een keer."
  done
  printf -v "$var" '%s' "$val"
}

echo "=============================================="
echo " Atlas instellen. Plakken gaat met Cmd+V."
echo " Bij wachtwoorden zie je niets als je plakt;"
echo " dat is normaal. Druk daarna op Enter."
echo "=============================================="

ask "1/5  Plak de Endpoint van de database (bijv. 51.158.1.2:12345):" ENDPOINT
while [[ "$ENDPOINT" != *:* ]]; do
  echo "   Er moet een dubbele punt in staan, bijv. 51.158.1.2:12345"
  ask "1/5  Plak de Endpoint van de database:" ENDPOINT
done
PGHOST="${ENDPOINT%:*}"; PGPORT="${ENDPOINT##*:}"

ask "2/5  Plak het database-wachtwoord:" PGPASSWORD hidden
ask "3/5  Plak het Client-ID van Google (eindigt op .apps.googleusercontent.com):" GID
ask "4/5  Plak het Clientgeheim van Google (begint meestal met GOCSPX-):" GSECRET hidden
ask "5/5  Met welk e-mailadres wil je inloggen?" EMAIL

AUTH_SECRET="$(grep -E '^AUTH_SECRET=.+' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
[ -z "$AUTH_SECRET" ] && AUTH_SECRET="$(openssl rand -base64 32)"

umask 077
cat > "$ENV_FILE" <<ENV
PGHOST=$PGHOST
PGPORT=$PGPORT
PGUSER=atlas
PGPASSWORD=$PGPASSWORD
PGDATABASE=rdb

AUTH_URL=https://atlas.stepsandstairs.nl
AUTH_SECRET=$AUTH_SECRET
AUTH_GOOGLE_ID=$GID
AUTH_GOOGLE_SECRET=$GSECRET
AUTH_ALLOWED_EMAILS=$EMAIL
AUTH_ALLOWED_DOMAIN=stepsandstairs.nl
AUTH_DEV_BYPASS=0
ENV
chmod 600 "$ENV_FILE"

echo
echo "Opgeslagen. Database: $PGHOST poort $PGPORT, inloggen met: $EMAIL"
echo "Volgende stap:  bash /opt/atlas/deploy/update.sh"
