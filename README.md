# Atlas

Klant- en projectbeheer voor Steps & Stairs: van eerste aanvraag tot afgeronde montage.

## Stand van zaken

| Fase | Inhoud | Status |
|---|---|---|
| 1 | Datamodel, login, klanten, trajecten, Kanban-bord, taken, herkenning en ontdubbeling, import | **Klaar** |
| 2 | Gmail (aanvraagmails → lead, mail bij traject) en Google Agenda | Gepland |
| 3 | WeFact (offertes, debiteuren, status) | Gepland |
| 4 | Dashboard en rapportages | Gepland |
| 5 | Google Business-reviews | Gepland |

## Wat zit er in fase 1

- **Bord**: Lead → Afspraak → Offerte → Opdracht → Montage → Afgerond, plus Vervallen (met reden).
  - Slepen en de keuzelijst op de kaart roepen dezelfde serverfunctie aan (`changeStage`).
  - De fase is één veld in de database. Elke wijziging wordt gelogd: wie, wanneer, van/naar, handmatig of automatisch.
  - Een tweede apparaat ververst bij focus en elke 15 seconden.
  - Elke kaart heeft een versienummer. Wijzig je een kaart vanaf een verouderd scherm, dan wordt die wijziging geweigerd in plaats van stil overschreven.
  - Kaarten zonder volgende actie kleuren oranje, kaarten met een verlopen actie rood.
- **Zoeken** op naam, plaats, postcode, e-mail, telefoon (ook "06…" of "+31…"), offertenummer en trajectnummer.
- **Detailweergave** per traject:
  - contact en adres (met afwijkend montageadres);
  - taken en notities;
  - de volledige tijdlijn.
- **Klantherkenning**: elke nieuwe klant, aanvraag of importregel gaat door dezelfde logica.
  - Normalisatie: e-mail, telefoon naar E.164, postcode, en achternaam met tussenvoegsel apart.
  - Score op adres, telefoon, e-mail en fuzzy naam, met Nederlandse spelvarianten: Jansen/Janssen, Meijer/Meyer, van der Berg/Berg, El Amrani.
  - Hoge score: automatisch koppelen. Twijfel: melding "Mogelijk dubbel" met een vergelijking naast elkaar. Lage score: nieuwe klant.
  - Er wordt nooit samengevoegd op naam alleen. Een andere huisnummertoevoeging (12A tegenover 12B) koppelt nooit automatisch.
  - Samenvoegen behoudt alles en is **ongedaan te maken**. "Niet dezelfde" wordt onthouden.
  - Drempels en gewichten staan in **Instellingen**.
- **Parser voor aanvraagmails** van het websiteformulier ("Aanvraag website"). Is al getest op een echte mail. Het IP-adres wordt bewust niet opgeslagen. Wordt actief zodra Gmail gekoppeld is (fase 2).
- **Import** van bestaande klanten via CSV: eerst proefdraaien (er wordt niets opgeslagen), daarna definitief. Nog een keer importeren maakt geen dubbelen.
- **AVG**: export per klant (JSON), anonimiseren, niets wordt hard verwijderd.
- **Mobiel**: onderbalk, grote knoppen, slepen met aanraking (lang indrukken), installeerbaar als app (PWA).

## Techniek

- Next.js 15 (App Router) + TypeScript, Tailwind
- PostgreSQL 16 + Drizzle ORM (migraties in `drizzle/`)
- Auth.js met Google: alleen toegestane e-mailadressen of het eigen Workspace-domein
- Tests:
  - Vitest: unit- en integratietests tegen een echte PostgreSQL;
  - Playwright: end-to-end in de browser.

Belangrijkste bestanden:

| Bestand | Inhoud |
|---|---|
| `src/lib/normalize.ts` | normalisatie van e-mail, telefoon, postcode, adres en naam |
| `src/lib/matching/score.ts` | matchscore (puur, volledig getest) |
| `src/server/intake.ts` | één ingang voor alle nieuwe klantgegevens (idempotent) |
| `src/server/merge.ts` | samenvoegen, ongedaan maken, "niet dezelfde" |
| `src/server/trajects.ts` | `changeStage`: de enige manier om een fase te wijzigen |
| `src/lib/intake/website-form.ts` | parser voor aanvraagmails |

## Lokaal draaien

```bash
cp .env.example .env            # vul DATABASE_URL in; AUTH_DEV_BYPASS=1 voor lokaal inloggen zonder Google
npm install
npm run db:migrate              # tabellen + standaardinstellingen
npm run db:seed                 # optioneel: fictieve demo-gegevens (leegt de database!)
npm run dev                     # http://localhost:3000
```

## Tests

```bash
npm test                        # unit + integratie (gebruikt database atlas_test)
npm run e2e -- --trace off      # browser-tests (gebruikt database atlas_e2e)
```

## Live zetten (Scaleway Amsterdam)

1. **Scaleway-account** (op naam van het bedrijf). Maak aan:
   - een Managed PostgreSQL 16-database (regio Amsterdam, met automatische back-ups);
   - een kleine Instance (bijv. DEV1-S of PLAY2) met een **flexibel (vast) IP-adres**. Dat IP komt later op de whitelist van WeFact.
2. **DNS**: een A-record `atlas.stepsandstairs.nl` → het vaste IP.
3. **Google Cloud Console**, met je Workspace-beheeraccount:
   - Maak een nieuw project aan.
   - Zet het OAuth-toestemmingsscherm op **Intern**. Dan is er geen Google-keuring nodig.
   - Maak een OAuth-client aan van het type "Webapplicatie", met redirect-URI `https://atlas.stepsandstairs.nl/api/auth/callback/google`.
4. **Op de server**: zet `.env` neer met:
   - `DATABASE_URL`;
   - `AUTH_SECRET` (`openssl rand -base64 32`);
   - `AUTH_GOOGLE_ID` en `AUTH_GOOGLE_SECRET`;
   - `AUTH_ALLOWED_EMAILS` (jouw adres);
   - `AUTH_DEV_BYPASS=0`.

   Start daarna met `docker compose up -d --build`. Migraties draaien automatisch bij het starten. HTTPS regelt Caddy.

## Besluiten fase 1

- **Eén gebruiker** (de eigenaar). Rollen staan wel in het datamodel, zodat later een medewerker of monteur kan worden toegevoegd.
- **Herkenning**:
  - Standaarddrempels: automatisch koppelen vanaf 70, "Mogelijk dubbel" vanaf 35. Instelbaar.
  - Een aanvraag zonder huisnummer (zoals het websiteformulier soms stuurt) telt de postcode alleen als zwak signaal.
- **Lopend traject**:
  - Een aanvraag van een bestaande klant komt op het **lopende** traject (Lead t/m Montage).
  - Is dat er niet (alleen afgeronde of vervallen trajecten), dan komt er een nieuw traject in Lead.
- **WeFact-offerte zonder lopend traject** (fase 3): er komt een nieuw traject in "Offerte". Bij twee lopende trajecten vraagt Atlas bij welk traject de offerte hoort.
- **Afgerond en Vervallen**: die blijven een jaar op het bord staan. Oudere trajecten zijn via zoeken te vinden.
