import { parseAddressLine, parsePostcodeCity, normalizeEmail } from "../normalize";

/**
 * Herkent klantafspraken in Google Agenda:
 *  - Adviesgesprek: titel met "Advies gesprek" (geel / agenda "Offerte"); klant via locatie (adres) en gast (e-mail).
 *  - Montage: titel "Fam. Naam + straat huisnummer" (rood / agenda "Werk Ruben").
 */
export interface CalendarRules {
  advies: { colorId: string; titleContains: string };
  montage: { colorId: string };
}

export interface CalendarEventInput {
  summary: string | null;
  colorId: string | null;
  location: string | null;
  attendees: string[]; // e-mailadressen
  ownEmails?: string[]; // eigen adressen, worden genegeerd
}

export interface ParsedAddress {
  street: string | null;
  houseNumber: number | null;
  addition: string | null;
  postcode: string | null;
  city: string | null;
}

export type CalendarClassification =
  | { kind: "advies"; emails: string[]; address: ParsedAddress | null }
  | { kind: "montage"; nameCandidates: { name: string; street: string | null; houseNumber: number | null; addition: string | null }[]; address: ParsedAddress | null }
  | { kind: "overig" };

export function parseLocation(location: string | null): ParsedAddress | null {
  if (!location?.trim()) return null;
  // "Kerkstraat 12, 6511 AB Nijmegen, Nederland" of "Kerkstraat 12 6511AB Nijmegen"
  const parts = location.split(",").map((p) => p.trim()).filter((p) => p && !/^(nederland|netherlands|nl)$/i.test(p));
  let street: string | null = null;
  let houseNumber: number | null = null;
  let addition: string | null = null;
  let postcode: string | null = null;
  let city: string | null = null;
  for (const part of parts) {
    const pcInline = part.match(/^(.*?\d.*?)\s+([1-9]\d{3}\s?[A-Za-z]{2}\b.*)$/);
    const pcPart = pcInline ? pcInline[2] : part;
    const pc = parsePostcodeCity(pcPart);
    if (pc.postcode) {
      postcode = pc.postcode;
      city = pc.city ?? city;
      if (pcInline && !street) {
        const a = parseAddressLine(pcInline[1]);
        street = a.street;
        houseNumber = a.houseNumber;
        addition = a.addition;
      }
      continue;
    }
    if (!street) {
      const a = parseAddressLine(part);
      street = a.street;
      houseNumber = a.houseNumber;
      addition = a.addition;
    } else if (!city) city = part;
  }
  if (!street && !postcode) return null;
  return { street, houseNumber, addition, postcode, city };
}

/** "Fam. van der Berg Dorpsstraat 3a" -> alle mogelijke splitsingen naam | straat. */
export function parseMontageTitle(summary: string) {
  const m = summary.trim().match(/^fam(?:ilie)?\.?\s+(.+)$/i);
  if (!m) return [];
  // "Fam. Fam. Van huissteden" (dubbel getypt) -> "Van huissteden"
  let rest = m[1].replace(/^(?:fam(?:ilie)?\.?\s+)+/i, "").replace(/\s+/g, " ").trim();
  // "Fam. Jansen, Kerkstraat 12" of "Fam. Jansen - Kerkstraat 12": duidelijke scheiding
  const sep = rest.match(/^(.+?)\s*(?:,|\s-\s|\+)\s*(.+)$/);
  if (sep) {
    const a = parseAddressLine(sep[2]);
    return [{ name: sep[1].trim(), street: a.street, houseNumber: a.houseNumber, addition: a.addition }];
  }
  const addr = rest.match(/^(.*\D)\s(\d{1,5}(?:\s?[A-Za-z]{1,3}|[-/][A-Za-z0-9]{1,4})?)$/);
  if (!addr) {
    // Alleen een naam, soms met een notitie erachter ("Tiemessen zacht", "Metin pvc"):
    // eerst de hele tekst, dan steeds een woord minder.
    const words = rest.split(" ");
    return words.map((_, i) => ({ name: words.slice(0, words.length - i).join(" "), street: null, houseNumber: null, addition: null }));
  }
  const words = addr[1].trim().split(" ");
  const nr = parseAddressLine(`x ${addr[2]}`);
  rest = "";
  const out = [];
  for (let i = 1; i < words.length; i++) {
    out.push({ name: words.slice(0, i).join(" "), street: words.slice(i).join(" "), houseNumber: nr.houseNumber, addition: nr.addition });
  }
  return out;
}

/** Alleen letters en cijfers, kleine letters: "Advies gesprek" = "Adviesgesprek". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Titel van een adviesgesprek. De bedrijfsnaam wordt vaak net anders getypt
 * ("Steps&Stairs", "Step&Stairs", of weggelaten), dus die telt niet mee;
 * "Advies gesprek" / "Adviesgesprek" ergens in de titel is genoeg.
 */
export function isAdviesTitle(title: string, titleContains: string) {
  const core = titleContains
    .split(/\s+/)
    .filter((w) => !w.includes("&") && !/^steps?$|^stairs$/i.test(w))
    .join(" ");
  const key = squash(core || titleContains);
  return !!key && squash(title).includes(key);
}

/**
 * Kleur: een afspraak zonder eigen kleur krijgt de kleur van de agenda waarin
 * hij staat (zo werkt Google Agenda meestal). Die telt dus als goed; alleen een
 * afwijkende eigen kleur sluit een afspraak uit.
 */
const colorOk = (eventColor: string | null, ruleColor: string | null | undefined) => !eventColor || !ruleColor || eventColor === ruleColor;

export function classifyEvent(e: CalendarEventInput, rules: CalendarRules): CalendarClassification {
  const title = (e.summary ?? "").trim();
  const own = new Set((e.ownEmails ?? []).map((x) => x.toLowerCase()));
  const emails = e.attendees.map((a) => normalizeEmail(a)).filter((a): a is string => !!a && !own.has(a));
  const address = parseLocation(e.location);
  if (colorOk(e.colorId, rules.advies.colorId) && isAdviesTitle(title, rules.advies.titleContains)) {
    return { kind: "advies", emails, address };
  }
  if (colorOk(e.colorId, rules.montage.colorId) && /^fam(ilie)?\.?\s/i.test(title)) {
    return { kind: "montage", nameCandidates: parseMontageTitle(title), address };
  }
  return { kind: "overig" };
}
