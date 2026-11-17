import {
  normalizeEmail,
  normalizePhone,
  parseAddressLine,
  parsePostcodeCity,
  splitDutchName,
  tidyCity,
} from "../normalize";
import type { LeadInput } from "./types";

/**
 * Leest een aanvraagmail van het websiteformulier ("Aanvraag website").
 * Het formulier zet steeds een label op een regel, met de waarde op de
 * regel(s) eronder:
 *
 *   Naam / Katharina Klein / E-mail / ... / Adres / Tintorettohof / 6663Pp Lent /
 *   Hoe ben je bij Steps&Stairs terecht gekomen? / Google / Bericht / ... / --- / url / ip
 *
 * Het IP-adres onderaan wordt bewust niet bewaard (AVG: niet noodzakelijk).
 */

const LABELS: Record<string, keyof RawForm> = {
  naam: "name",
  "e-mail": "email",
  email: "email",
  "e-mailadres": "email",
  telefoonnummer: "phone",
  telefoon: "phone",
  adres: "address",
  "hoe ben je bij steps&stairs terecht gekomen?": "referral",
  "hoe ben je bij steps & stairs terecht gekomen?": "referral",
  "hoe ben je bij ons terecht gekomen?": "referral",
  bericht: "message",
  opmerking: "message",
};

interface RawForm {
  name: string[];
  email: string[];
  phone: string[];
  address: string[];
  referral: string[];
  message: string[];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/h\d|\/li|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseWebsiteForm(body: string): LeadInput | null {
  const lines = body
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim());

  const raw: RawForm = { name: [], email: [], phone: [], address: [], referral: [], message: [] };
  let current: keyof RawForm | null = null;
  let sourcePage: string | null = null;
  let inFooter = false;

  for (const line of lines) {
    if (inFooter) {
      const url = line.match(/https?:\/\/\S+/);
      if (url && !sourcePage) sourcePage = url[0];
      continue; // IP-adres en overige footer negeren
    }
    if (line === "---" || line === "--") {
      inFooter = true;
      current = null;
      continue;
    }
    const label = LABELS[line.toLowerCase().replace(/:$/, "").trim()];
    if (label) {
      current = label;
      continue;
    }
    // "Naam: Jan" op één regel
    const inline = line.match(/^([^:]{2,60}):\s*(.+)$/);
    if (inline && LABELS[inline[1].toLowerCase().trim()]) {
      current = LABELS[inline[1].toLowerCase().trim()];
      raw[current].push(inline[2].trim());
      continue;
    }
    if (current && (line || current === "message")) raw[current].push(line);
  }

  const name = raw.name.join(" ").trim();
  const emailText = raw.email.join(" ").trim();
  const phoneText = raw.phone.join(" ").trim();
  if (!name && !emailText && !phoneText) return null;

  // Adres: eerste regel straat (+ nummer), regel met postcode = postcode + plaats.
  let street: string | null = null;
  let houseNumber: number | null = null;
  let addition: string | null = null;
  let postcode: string | null = null;
  let city: string | null = null;
  for (const l of raw.address.filter(Boolean)) {
    const pc = parsePostcodeCity(l);
    if (pc.postcode) {
      postcode = pc.postcode;
      city = pc.city ?? city;
      continue;
    }
    if (!street) {
      const a = parseAddressLine(l);
      street = a.street;
      houseNumber = a.houseNumber;
      addition = a.addition;
    } else if (!city) {
      city = tidyCity(l);
    }
  }

  const person = splitDutchName(name);
  const message = raw.message.join("\n").trim() || null;

  return {
    name: name || null,
    person,
    emails: [normalizeEmail(emailText)].filter((x): x is string => !!x),
    phones: [normalizePhone(phoneText)].filter((x): x is string => !!x),
    rawEmail: emailText || null,
    rawPhone: phoneText || null,
    street,
    houseNumber,
    addition,
    postcode,
    city,
    referral: raw.referral.join(" ").trim() || null,
    message,
    sourcePage,
  };
}
