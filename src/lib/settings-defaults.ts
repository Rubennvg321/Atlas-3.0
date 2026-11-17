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
  /** Automatische fasewijzigingen: 'proposal' (voorstel) of 'automatic'. */
  automation: {
    appointmentToAfspraak: "proposal",
    quoteAcceptedToOpdracht: "proposal",
  },
  /** Dagen zonder volgende actie waarna een kaart opvalt. */
  board: { staleAfterDays: 7 },
} as const;

export type SettingsShape = typeof DEFAULT_SETTINGS;
