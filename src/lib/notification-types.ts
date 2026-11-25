/**
 * Soorten meldingen. Een nieuwe soort toevoegen = hier een regel erbij en
 * `queueNotification()` aanroepen waar de gebeurtenis plaatsvindt. Op de
 * pagina Meldingen verschijnt hij dan vanzelf met een aan/uit-knop.
 */
export const NOTIFICATION_TYPES = {
  nieuwe_lead: { label: "Nieuwe aanvraag via de website", description: "Zodra een aanvraagmail als lead in Atlas staat." },
  aankomsttijd: {
    label: "Aankomsttijd kiezen voor een montage",
    description: "Twee dagen voor de eerste montagedag: kies hoe laat je aankomt, Atlas mailt de klant.",
  },
  test: { label: "Testmelding", description: "Alleen via de knop 'Testmelding sturen'.", hidden: true },
} as const satisfies Record<string, { label: string; description: string; hidden?: boolean }>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
