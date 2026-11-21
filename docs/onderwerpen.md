# Onderwerpen voor aparte chats

Begin een nieuwe chat met de openingszin van het onderwerp. Dan hoeft de chat alleen die bestanden te lezen.

## 1. Bord en fases
*"Ik wil iets aanpassen aan het bord of de fases in Atlas."*
Kanban, slepen/keuzelijst, kaartweergave, kleuren, volgorde van fases, Vervallen.
`src/components/board.tsx`, `src/components/stage-control.tsx`, `src/app/(app)/bord/`, `src/server/trajects.ts`,
`src/db/seed-defaults.ts`, `drizzle/0002_nieuwe_fases.sql`

## 2. Automatische fasewijzigingen
*"Ik wil een regel aanpassen wanneer kaarten automatisch verschuiven."*
Welke gebeurtenis naar welke fase, automatisch of voorstel.
`src/lib/stage-rules.ts`, `src/server/automation.ts`, Instellingen → Automatische fasewijzigingen

## 3. Klanten, herkenning en ontdubbelen
*"Ik wil iets aanpassen aan klanten, 'Mogelijk dubbel' of samenvoegen."*
`src/lib/normalize.ts`, `src/lib/matching/`, `src/server/customers.ts`, `src/server/intake.ts`, `src/server/merge.ts`,
`src/server/customer-edit.ts`, `src/app/(app)/klanten/`, `src/app/(app)/dubbels/`

## 4. Traject-detail, taken en notities
*"Ik wil iets aanpassen aan de detailpagina van een traject of aan taken."*
`src/app/(app)/trajecten/[id]/`, `src/components/traject-client.tsx`, `src/server/tasks.ts`, `src/app/(app)/taken/`

## 5. Financieel: verkoop, inkoop, marge per dag
*"Ik wil iets aanpassen aan verkoop, inkoop of marge."*
`src/lib/finance.ts`, `src/lib/montage-days.ts`, `src/server/finance.ts`, `src/server/purchases.ts`,
`src/components/finance-card.tsx`

## 6. Gmail
*"Ik wil iets aanpassen aan hoe Atlas mail verwerkt."*
Aanvraagmails → lead + label "Atlas/Lead", orderbevestigingen PPC/fedi, "offerte online geaccepteerd", klantmail.
`src/server/integrations/gmail-sync.ts`, `gmail-client.ts`, `src/lib/intake/website-form.ts`, `src/lib/parsers/`,
`src/lib/mime.ts`, `src/server/pdf.ts`

## 7. Google Agenda
*"Ik wil iets aanpassen aan de koppeling met Google Agenda."*
Gele adviesgesprekken, rode montages, afspraak aanmaken vanuit Atlas (nog te bouwen), agendahistorie-import.
`src/server/integrations/calendar-sync.ts`, `calendar-client.ts`, `src/lib/parsers/calendar.ts`

## 8. WeFact
*"Ik wil iets aanpassen aan de koppeling met WeFact."*
Offertes, debiteuren, statuscodes, verkoop excl. btw.
`src/server/integrations/wefact-sync.ts`, `wefact-client.ts`

## 9. Reviews
*"Ik wil iets aanpassen aan de reviewverzoeken."*
Verzoek 2 dagen na montage, herinnering na 7 dagen, teksten, later Google Business-reviews ophalen.
`src/server/daily.ts`, `src/lib/review-schedule.ts`, Koppelingen → Reviewverzoeken

## 10. Koppelingen en achtergrondproces
*"Er gaat iets mis met een koppeling of synchronisatie."*
Status, fouten, opnieuw proberen, tokens, worker.
`src/app/(app)/koppelingen/`, `src/server/integrations/state.ts`, `google-oauth.ts`, `src/worker/index.ts`,
`src/server/crypto.ts`. Logboek op de server: `docker compose -f /opt/atlas/docker-compose.yml logs --tail 50 worker`

## 11. Dashboard en rapportages (nog te bouwen)
*"Ik wil beginnen aan het dashboard (orderportefeuille, conversie, doorlooptijd, montageplanning)."*

## 12. Import van bestaande klanten
*"Ik wil bestaande klanten importeren."*
`src/server/import.ts`, `src/app/(app)/import/`

## 13. Server, hosting en back-ups
*"Ik heb een vraag over de server, Scaleway, het domein of back-ups."*
`deploy/`, `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `CLAUDE.md` (sectie Productie)

## 14. Login, gebruikers en privacy (AVG)
*"Ik wil iets aanpassen aan inloggen, gebruikers of privacy."*
`src/auth.ts`, `src/server/session.ts`, export/anonimiseren in `src/server/customer-edit.ts`
