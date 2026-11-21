# Atlas — klant- en projectbeheer Steps & Stairs

Intern CRM voor een Nederlands traprenovatiebedrijf (één gebruiker: de eigenaar, geen IT-achtergrond →
leg uit in eenvoudig Nederlands, stap voor stap, met kopieer-en-plak-commando's). Interface volledig Nederlands.

## Techniek
Next.js 15 (App Router) + TypeScript + Tailwind · PostgreSQL 17 (Scaleway, beheerd) + Drizzle (migraties in `drizzle/`)
· Auth.js met Google · Vitest (unit + integratie tegen echte Postgres) · Playwright (e2e).
Werkwijze: `main` is de hoofdbranch. Werk in een eigen branch en lever op via een pull request naar `main`.
Vraagt de eigenaar om een pull request, wacht dan tot de CI-tests groen zijn en voeg hem zelf samen (de eigenaar
wil dit niet steeds met de hand doen). De server werkt zichzelf binnen ~5 minuten bij als `main` verandert
(`deploy/auto-update.sh`, systemd-timer `atlas-update.timer`); handmatig kan nog met `bash /opt/atlas/deploy/update.sh`.

## Productie
- Server: Scaleway AMS1, Ubuntu, vast IP 51.15.84.246 (staat op de WeFact-whitelist). Code in `/opt/atlas`.
- Docker Compose: `web` (Next.js, draait migraties bij start), `worker` (achtergrondsync), `caddy` (HTTPS).
- Domein: https://atlas.stepsandstairs.nl (DNS bij mijn.host, beheerd door het marketingbureau).
- Bijwerken: automatisch (logboek: `tail -n 30 /var/log/atlas-update.log`), of met de hand `bash /opt/atlas/deploy/update.sh`
  · Automatische update aanzetten (eenmalig): `bash /opt/atlas/deploy/install-auto-update.sh` · Instellingen opnieuw: `bash /opt/atlas/deploy/configure.sh`
- Database-gebruiker heet `Atlas` (hoofdletter). Geheimen staan alleen in `/opt/atlas/.env`, nooit in de repo of chat.

## Kernregels (niet breken)
- Fase = één veld `trajects.stage`; wijzigen alleen via `changeStage()` (`src/server/trajects.ts`).
- Automatische fasewijziging alleen vooruit, via `applyStageEvent()` (`src/server/automation.ts`).
- Alle nieuwe klantgegevens via `intakeLead()` (herkenning/ontdubbeling); nooit samenvoegen op naam alleen.
- Alles idempotent (externe id's uniek); niets hard verwijderen (soft delete).
- Tests: `npm test` (vereist lokale Postgres op :5432 met databases atlas_test), `npm run e2e -- --trace off`.
- Geen echte klantnamen of e-mailadressen in testbestanden; gebruik example.nl.

Zie `docs/onderwerpen.md` voor de indeling per onderdeel.
