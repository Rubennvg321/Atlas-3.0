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
Adres zoeken via Google bij adresvelden (sleutel in Koppelingen → Adres zoeken via Google; Places API (New)):
`src/components/address-search.tsx`, `src/lib/places.ts`, `src/server/integrations/places-client.ts`

## 4. Traject-detail, taken en notities
*"Ik wil iets aanpassen aan de detailpagina van een traject of aan taken."*
`src/app/(app)/trajecten/[id]/`, `src/components/traject-client.tsx`, `src/server/tasks.ts`, `src/app/(app)/taken/`

## 5. Financieel: verkoop, inkoop, marge per dag
*"Ik wil iets aanpassen aan verkoop, inkoop of marge."*
`src/lib/finance.ts`, `src/lib/montage-days.ts`, `src/server/finance.ts`, `src/server/purchases.ts`,
`src/components/finance-card.tsx`

## 6. Gmail
*"Ik wil iets aanpassen aan hoe Atlas mail verwerkt."*
Aanvraagmails → lead + label "Atlas/Lead", label "Behandeld" zodra er een afspraak staat, orderbevestigingen PPC/fedi, "offerte online geaccepteerd", klantmail.
`src/server/integrations/gmail-sync.ts`, `gmail-client.ts`, `src/lib/intake/website-form.ts`, `src/lib/parsers/`,
`src/lib/mime.ts`, `src/server/pdf.ts`

## 7. Google Agenda
*"Ik wil iets aanpassen aan de koppeling met Google Agenda."*
Gele adviesgesprekken, rode montages, afspraak aanmaken vanuit Atlas (nog te bouwen), agendahistorie-import.
`src/server/integrations/calendar-sync.ts`, `calendar-client.ts`, `src/lib/parsers/calendar.ts`

## 8. Reviews
*"Ik wil iets aanpassen aan de reviewverzoeken."*
Verzoek 2 dagen na montage, herinnering na 7 dagen, teksten, later Google Business-reviews ophalen.
`src/server/daily.ts`, `src/lib/review-schedule.ts`, Koppelingen → Reviewverzoeken

## 9. WeFact
*"Ik wil iets aanpassen aan de koppeling met WeFact."*
Offertes, debiteuren, statuscodes, verkoop excl. btw.
`src/server/integrations/wefact-sync.ts`, `wefact-client.ts`

## 10. Koppelingen en achtergrondproces
*"Er gaat iets mis met een koppeling of synchronisatie."*
Status, fouten, opnieuw proberen, tokens, worker.
`src/app/(app)/koppelingen/`, `src/server/integrations/state.ts`, `google-oauth.ts`, `src/worker/index.ts`,
`src/server/crypto.ts`. Logboek op de server: `docker compose -f /opt/atlas/docker-compose.yml logs --tail 50 worker`

## 11. Dashboard en widgets
*"Ik wil iets aanpassen aan het dashboard of een widget toevoegen."*
Widget "Bedrijfsstand" (omzet maand/jaar, geplande omzet, nieuwe leads, akkoord, montages). Klik op een omzet-tegel → "Omzet per klant" (`?omzet=JJJJ-MM` of `?omzet=JJJJ`) met omzetdoel.
Widget "Beste klant van de maand" (hoogste marge per montagedag, keuzemenu maand via `?maand=JJJJ-MM`).
Ideeën: conversie, doorlooptijd, montageplanning. Nieuwe widget = nieuw bestand in `src/components/widgets/`.
`src/app/(app)/dashboard/`, `src/server/dashboard.ts`, `src/components/widgets/`

## 11b. Zijbalk en indeling van Atlas
*"Ik wil een onderdeel toevoegen aan de zijbalk."*
`src/components/nav.tsx` (lijst `SECTIONS`), `src/app/(app)/layout.tsx`

## 11c. Meldingen en de app op de telefoon
*"Ik wil een melding toevoegen of iets aanpassen aan de Atlas-app op mijn telefoon."*
Pushmeldingen (nu: nieuwe aanvraag), per soort aan/uit, apparaten, testmelding; installeerbare app (manifest, pictogrammen).
Nieuwe soort melding = regel in `src/lib/notification-types.ts` + `queueNotification()` waar het gebeurt.
`src/server/notify.ts`, `src/app/(app)/meldingen/`, `src/components/push-setup.tsx`, `public/sw.js`, `src/app/manifest.ts`

## 12. Import van bestaande klanten
*"Ik wil bestaande klanten importeren."*
`src/server/import.ts`, `src/app/(app)/import/`

## 13. Server, hosting en back-ups
*"Ik heb een vraag over de server, Scaleway, het domein of back-ups."*
`deploy/`, `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `CLAUDE.md` (sectie Productie)

## 14. Login, gebruikers en privacy (AVG)
*"Ik wil iets aanpassen aan inloggen, gebruikers of privacy."*
`src/auth.ts`, `src/server/session.ts`, export/anonimiseren in `src/server/customer-edit.ts`
