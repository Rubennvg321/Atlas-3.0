# Atlas — klant- en projectbeheer Steps & Stairs

Intern CRM voor een Nederlands traprenovatiebedrijf (één gebruiker: de eigenaar, geen IT-achtergrond →
leg uit in eenvoudig Nederlands, stap voor stap, met kopieer-en-plak-commando's). Interface volledig Nederlands.

## Techniek
Next.js 15 (App Router) + TypeScript + Tailwind · PostgreSQL 17 (Scaleway, beheerd) + Drizzle (migraties in `drizzle/`)
· Auth.js met Google · Vitest (unit + integratie tegen echte Postgres) · Playwright (e2e).
Werkwijze: `main` is de hoofdbranch. Werk in een eigen branch en lever op via een pull request naar `main`;
na het samenvoegen werkt de eigenaar de server bij met `bash /opt/atlas/deploy/update.sh` (server staat op `main`).

## Productie
- Server: Scaleway AMS1, Ubuntu, vast IP 51.15.84.246 (staat op de WeFact-whitelist). Code in `/opt/atlas`.
- Docker Compose: `web` (Next.js, draait migraties bij start), `worker` (achtergrondsync), `caddy` (HTTPS).
- Domein: https://atlas.stepsandstairs.nl (DNS bij mijn.host, beheerd door het marketingbureau).
- Bijwerken: `bash /opt/atlas/deploy/update.sh` · Instellingen opnieuw: `bash /opt/atlas/deploy/configure.sh`
- Database-gebruiker heet `Atlas` (hoofdletter). Geheimen staan alleen in `/opt/atlas/.env`, nooit in de repo of chat.

## Kernregels (niet breken)
- Fase = één veld `trajects.stage`; wijzigen alleen via `changeStage()` (`src/server/trajects.ts`).
- Automatische fasewijziging alleen vooruit, via `applyStageEvent()` (`src/server/automation.ts`).
- Alle nieuwe klantgegevens via `intakeLead()` (herkenning/ontdubbeling); nooit samenvoegen op naam alleen.
- Alles idempotent (externe id's uniek); niets hard verwijderen (soft delete).
- Tests: `npm test` (vereist lokale Postgres op :5432 met databases atlas_test), `npm run e2e -- --trace off`.
- Geen echte klantnamen of e-mailadressen in testbestanden; gebruik example.nl.

Zie `docs/onderwerpen.md` voor de indeling per onderdeel.
