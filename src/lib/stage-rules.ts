/**
 * Regels voor automatische fasewijzigingen. Een gebeurtenis (afspraak, offerte,
 * orderbevestiging, ...) wijst een doelfase aan. De kaart gaat alleen VOORUIT;
 * nooit terug en nooit uit "Vervallen".
 */
export type StageEvent =
  | "aanvraag_website"
  | "adviesgesprek_gepland"
  | "offerte_gemaakt"
  | "offerte_geaccepteerd"
  | "montage_gepland"
  | "materiaal_besteld"
  | "montage_gestart"
  | "review_verstuurd"
  | "review_ontvangen";

export const EVENT_TARGET: Record<StageEvent, string> = {
  aanvraag_website: "lead",
  adviesgesprek_gepland: "offerte_gepland",
  offerte_gemaakt: "offerte_gemaakt",
  offerte_geaccepteerd: "offerte_geaccepteerd",
  montage_gepland: "montage_gepland",
  materiaal_besteld: "materiaal_besteld",
  montage_gestart: "in_uitvoering",
  review_verstuurd: "review_gestuurd",
  review_ontvangen: "review_ontvangen",
};

export const EVENT_LABEL: Record<StageEvent, string> = {
  aanvraag_website: "Aanvraag via website",
  adviesgesprek_gepland: "Adviesgesprek ingepland (gele afspraak)",
  offerte_gemaakt: "Offerte gemaakt in WeFact",
  offerte_geaccepteerd: "Offerte geaccepteerd",
  montage_gepland: "Montage ingepland (rode afspraak)",
  materiaal_besteld: "Orderbevestiging leverancier ontvangen",
  montage_gestart: "Montage begonnen",
  review_verstuurd: "Reviewverzoek verstuurd",
  review_ontvangen: "Review ontvangen",
};

export interface StageInfo {
  key: string;
  position: number;
  kind: string;
}

/** Geeft de nieuwe fase terug, of null als de kaart moet blijven staan. */
export function nextStage(currentKey: string, event: StageEvent, stages: StageInfo[]): string | null {
  const target = stages.find((s) => s.key === EVENT_TARGET[event]);
  const current = stages.find((s) => s.key === currentKey);
  if (!target || !current) return null;
  if (current.kind === "lost") return null;
  if (target.position <= current.position) return null;
  return target.key;
}
