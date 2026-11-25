import { DEFAULT_MATCH_SETTINGS } from "./matching/score";

export const DEFAULT_SETTINGS = {
  matching: DEFAULT_MATCH_SETTINGS,
  /** Herkenning van aanvraagmails (fase 2). */
  intakeFilters: {
    rules: [{ from: "info@stepsandstairs.nl", subjectContains: "Aanvraag website", parser: "website-form" }],
    /** Label voor verwerkte aanvragen; de mail wordt daarna gearchiveerd. */
    processedLabel: "Atlas/Lead",
    unrecognizedLabel: "Atlas/Niet herkend",
    /** Label voor een aanvraag zodra er met die klant een afspraak in de agenda staat. */
    handledLabel: "Behandeld",
    /** Bij de eerste koppeling: aanvragen van de afgelopen zoveel dagen ophalen. */
    lookbackDays: 7,
  },
  /** Mails van WeFact over geaccepteerde offertes. */
  wefactMail: { from: "mijnwefact.nl", subjectContains: "online geaccepteerd" },
  /** Reviewverzoeken (worden pas verstuurd als ze aan staan en er een link is). */
  reviews: {
    enabled: false,
    link: "",
    subject: "Hoe tevreden bent u over uw nieuwe trap?",
    body:
      "Beste {naam},\n\nVorige week hebben wij uw trap gerenoveerd. We hopen dat u er net zo blij mee bent als wij!\n\nZou u ons willen helpen door een korte review te schrijven? Dat kost maar een minuutje:\n{link}\n\nAlvast hartelijk dank.\n\nMet vriendelijke groet,\nSteps & Stairs",
    reminderSubject: "Herinnering: uw ervaring met Steps & Stairs",
    reminderBody:
      "Beste {naam},\n\nOnlangs vroegen we u om een review over de renovatie van uw trap. Mocht u daar nog niet aan toegekomen zijn: we zouden het erg waarderen.\n{link}\n\nMet vriendelijke groet,\nSteps & Stairs",
  },
  /** Agenda-herkenning (fase 2): Google Agenda kleur-id's. 5 = geel (Banana), 11 = rood (Tomato). */
  calendarRules: {
    /**
     * Welke agenda's Atlas leest. "primary" = de hoofdagenda (Werk Ruben, montages);
     * de tweede is de agenda "Offerte" waarin de adviesgesprekken staan.
     */
    calendars: [
      { id: "primary", name: "Werk Ruben" },
      { id: "c_250agaho4v6v83vv8podvdkefs@group.calendar.google.com", name: "Offerte" },
    ] as { id: string; name: string }[],
    advies: { colorId: "5", titleContains: "Advies gesprek Steps&Stairs" },
    montage: { colorId: "11", titlePattern: "^fam\\.?\\s+(?<name>.+?)\\s+(?<street>\\D+?)\\s*(?<nr>\\d+\\s*\\w{0,4})$" },
  },
  /**
   * Automatische fasewijzigingen per gebeurtenis: "automatic" (kaart verschuift
   * direct) of "proposal" (Atlas stelt het voor, jij bevestigt). Altijd alleen vooruit.
   */
  automation: {
    aanvraag_website: "automatic",
    adviesgesprek_gepland: "automatic",
    offerte_gemaakt: "automatic",
    offerte_geaccepteerd: "automatic",
    montage_gepland: "automatic",
    materiaal_besteld: "automatic",
    montage_gestart: "automatic",
    review_verstuurd: "automatic",
    review_ontvangen: "automatic",
  } as Record<string, "automatic" | "proposal">,
  /** Leveranciers waarvan orderbevestigingen als inkoop worden herkend (fase 2). */
  suppliers: {
    rules: [
      { supplier: "PPC", from: "plintenenprofielencentrale.nl", parser: "ppc-pdf" },
      { supplier: "fedi", from: "fedi.de", parser: "fedi-mail" },
    ],
  },
  /**
   * Aankomstmail: 2 dagen voor de eerste montagedag vraagt Atlas (pushmelding) hoe laat je
   * aankomt; na je keuze krijgt de klant een mail. Zonder keuze gaat er nooit een mail.
   */
  arrivalMail: {
    enabled: true,
    /** Vanaf dit uur (Nederlandse tijd) op de dag twee dagen ervoor wordt het gevraagd. */
    askHour: 8,
    /** Nog niet gekozen? Om dit uur één herinnering. */
    reminderHour: 16,
    /** Grenzen van de tijdblokken: 07:30–07:45, 07:45–08:00, 08:00–08:15, 08:15–08:30. */
    times: ["07:30", "07:45", "08:00", "08:15", "08:30"] as string[],
    subject: "Uw traprenovatie op {datum}",
    body:
      "Beste {naam},\n\nOp {datum} komen wij uw trap renoveren. Wij verwachten {tijd} uur bij u te zijn.\n\nMocht er iets veranderen of heeft u nog vragen, dan kunt u op deze e-mail reageren.\n\nMet vriendelijke groet,\nSteps & Stairs",
  },
  /** Meldingen per soort aan (true) of uit (false). Zie src/lib/notification-types.ts. */
  notifications: { types: { nieuwe_lead: true, aankomsttijd: true, taak: true } as Record<string, boolean> },
  /** Dagen zonder volgende actie waarna een kaart opvalt. */
  board: { staleAfterDays: 7 },
  /** Dashboard: omzetdoel per maand (excl. btw). 0 = geen doel. */
  dashboard: { monthlyRevenueTarget: 0 as number },
} as const;

export type SettingsShape = typeof DEFAULT_SETTINGS;
