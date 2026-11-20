import { DEFAULT_MATCH_SETTINGS } from "./matching/score";

export const DEFAULT_SETTINGS = {
  matching: DEFAULT_MATCH_SETTINGS,
  /** Herkenning van aanvraagmails (fase 2). */
  intakeFilters: {
    rules: [{ from: "info@stepsandstairs.nl", subjectContains: "Aanvraag website", parser: "website-form" }],
  },
  /** Agenda-herkenning (fase 2): Google Agenda kleur-id's. 5 = geel (Banana), 11 = rood (Tomato). */
  calendarRules: {
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
  /** Dagen zonder volgende actie waarna een kaart opvalt. */
  board: { staleAfterDays: 7 },
} as const;

export type SettingsShape = typeof DEFAULT_SETTINGS;
