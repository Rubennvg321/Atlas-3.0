import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * Normalisatie van klantgegevens. Alles wat we vergelijken of uniek opslaan
 * gaat eerst door deze functies, zodat "1234 ab" en "1234AB" of
 * "06-12345678" en "+31 6 12345678" als gelijk worden herkend.
 */

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().toLowerCase().replace(/^mailto:/, "");
  // Bewust ruim: we willen geen geldige adressen weggooien, alleen rommel.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return null;
  return v;
}

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim();
  if (!v) return null;
  // "+31 (0)6 ..." -> "+31 6 ..."
  v = v.replace(/\(0\)/g, "");
  // "0031..." -> "+31..."
  v = v.replace(/^\s*00/, "+");
  const parsed = parsePhoneNumberFromString(v, "NL");
  if (!parsed || !parsed.isPossible()) return null;
  return parsed.number; // E.164
}

const POSTCODE_RE = /^([1-9][0-9]{3})\s*([A-Za-z]{2})$/;

export function normalizePostcode(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(POSTCODE_RE);
  if (!m) return null;
  const letters = m[2].toUpperCase();
  // SA, SD en SS worden in Nederland niet uitgegeven
  if (["SA", "SD", "SS"].includes(letters)) return null;
  return `${m[1]}${letters}`;
}

export function formatPostcode(pc: string | null | undefined): string {
  if (!pc) return "";
  return pc.length === 6 ? `${pc.slice(0, 4)} ${pc.slice(4)}` : pc;
}

export interface HouseNumber {
  number: number;
  addition: string | null;
}

/** "12", "12a", "12 A", "12-2", "12 bis", "12-hs" -> { number, addition } */
export function parseHouseNumber(input: string | number | null | undefined): HouseNumber | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{1,5})\s*[-/ ]?\s*([A-Za-z0-9]{0,6})?(?:\s*[-/ ]?\s*([A-Za-z0-9]{1,6}))?$/);
  if (!m) return null;
  const number = Number.parseInt(m[1], 10);
  if (!number) return null;
  const addition = normalizeAddition([m[2], m[3]].filter(Boolean).join(""));
  return { number, addition };
}

export function normalizeAddition(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return v || null;
}

export interface AddressLine {
  street: string | null;
  houseNumber: number | null;
  addition: string | null;
}

/** "Tintorettohof 12a" -> straat + nummer; "Tintorettohof" -> alleen straat. */
export function parseAddressLine(input: string | null | undefined): AddressLine {
  const empty = { street: null, houseNumber: null, addition: null };
  if (!input) return empty;
  const s = input.trim().replace(/\s+/g, " ").replace(/,$/, "");
  if (!s) return empty;
  // Straatnamen kunnen zelf cijfers bevatten ("Plein 1944 12"), dus pak het
  // laatste nummer-blok.
  const m = s.match(/^(.*\D)\s*(\d{1,5}(?:\s*[A-Za-z]{1,6}|\s*[-/]\s*[A-Za-z0-9]{1,6})?)$/);
  if (m) {
    const hn = parseHouseNumber(m[2]);
    if (hn) return { street: tidyStreet(m[1]), houseNumber: hn.number, addition: hn.addition };
  }
  return { street: tidyStreet(s), houseNumber: null, addition: null };
}

function tidyStreet(s: string): string | null {
  const v = s.trim().replace(/[,\s]+$/, "");
  return v || null;
}

/** Vergelijkingssleutel voor straatnamen: "Burg. de Withstraat" ~ "burgemeester de withstraat". */
export function streetKey(street: string | null | undefined): string | null {
  if (!street) return null;
  let v = stripDiacritics(street.toLowerCase());
  v = v
    .replace(/\bburg(\.\s*|\s+)/g, "burgemeester ")
    .replace(/\bdr(\.\s*|\s+)/g, "dokter ")
    .replace(/\bpr(\.\s*|\s+)/g, "prins ")
    .replace(/\bst(\.\s*|\s+)/g, "sint ")
    .replace(/str\.?$/g, "straat")
    .replace(/[^a-z0-9]/g, "");
  return v || null;
}

/** "6663Pp Lent" / "6663 PP  LENT" -> { postcode, city } */
export function parsePostcodeCity(input: string | null | undefined): { postcode: string | null; city: string | null } {
  if (!input) return { postcode: null, city: null };
  const m = input.trim().match(/^([1-9][0-9]{3}\s*[A-Za-z]{2})\b\s*(.*)$/);
  if (!m) return { postcode: null, city: tidyCity(input) };
  return { postcode: normalizePostcode(m[1]), city: tidyCity(m[2]) };
}

export function tidyCity(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().replace(/\s+/g, " ");
  if (!v) return null;
  // Hoofdletters netjes: "LENT" -> "Lent", "'s-hertogenbosch" -> "'s-Hertogenbosch"
  return v
    .toLowerCase()
    .replace(/(^|[\s-])([a-zà-ÿ])/g, (_m, p: string, c: string) => p + c.toUpperCase())
    .replace(/^'S-/, "'s-");
}

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Namen
// ---------------------------------------------------------------------------

/** Nederlandse (en Belgische/Duitse) tussenvoegsels, langste eerst. */
const INFIXES = [
  "van de", "van der", "van den", "van het", "van 't", "van ter", "van ten",
  "in de", "in der", "in den", "in het", "in 't", "op de", "op den", "op der", "op het", "op 't",
  "aan de", "aan den", "aan het", "uit de", "uit den", "uit het", "bij de", "voor de", "onder de",
  "de la", "de le", "von der", "von dem", "van", "von", "de", "der", "den", "het", "'t",
  "ter", "ten", "te", "le", "la", "du", "da", "di", "vd", "v.d.", "v/d",
] as const;

/** Voorvoegsels die bij de achternaam horen (geen Nederlands tussenvoegsel): El Amrani, Ben Ali, Abu Bakr. */
const NAME_PARTICLES = new Set(["el", "al", "ben", "bin", "abu", "ait", "aït", "ou", "mc", "mac", "o'"]);

const SALUTATIONS = /^(fam(ilie)?\.?|dhr\.?|mevr?\.?|mw\.?|hr\.?|heer|mevrouw|meneer|de heer|mr\.?|ir\.?|ing\.?|drs\.?)\s+/i;

export interface PersonName {
  firstName: string | null;
  infix: string | null;
  lastName: string | null;
}

/**
 * Splitst een vrije naam in voornaam / tussenvoegsel / achternaam.
 *   "Jan van der Berg"      -> Jan | van der | Berg
 *   "Berg, van der"         -> null | van der | Berg
 *   "fam. Janssen"          -> null | null | Janssen
 *   "Katharina Klein"       -> Katharina | null | Klein
 *   "J. de Vries-Bakker"    -> J. | de | Vries-Bakker
 */
export function splitDutchName(input: string | null | undefined): PersonName {
  const empty: PersonName = { firstName: null, infix: null, lastName: null };
  if (!input) return empty;
  let s = input.trim().replace(/\s+/g, " ");
  let hadSalutation = false;
  while (SALUTATIONS.test(s)) {
    s = s.replace(SALUTATIONS, "");
    hadSalutation = true;
  }
  if (!s) return empty;

  // "Achternaam, tussenvoegsel" of "Achternaam, Voornaam tussenvoegsel"
  if (s.includes(",")) {
    const [last, rest] = s.split(",", 2).map((p) => p.trim());
    const restLower = rest.toLowerCase();
    const inf = INFIXES.find((i) => restLower === i || restLower.endsWith(" " + i));
    if (inf) {
      const first = rest.slice(0, rest.length - inf.length).trim();
      return { firstName: first || null, infix: canonicalInfix(inf), lastName: last || null };
    }
    return { firstName: rest || null, infix: null, lastName: last || null };
  }

  const words = s.split(" ");
  if (words.length === 1) {
    return { firstName: null, infix: null, lastName: words[0] };
  }

  // Zoek het eerste tussenvoegsel ná het eerste woord (of op positie 0 bij "fam. van Dam").
  const startAt = hadSalutation ? 0 : 1;
  for (let i = startAt; i < words.length - 1; i++) {
    for (const inf of INFIXES) {
      const n = inf.split(" ").length;
      const candidate = words.slice(i, i + n).join(" ").toLowerCase();
      if (candidate === inf && i + n < words.length) {
        const first = words.slice(0, i).join(" ");
        return {
          firstName: first || null,
          infix: canonicalInfix(inf),
          lastName: words.slice(i + n).join(" "),
        };
      }
    }
  }
  // Voorvoegsels als "El", "Ben", "Abu" horen bij de achternaam.
  let lastStart = words.length - 1;
  while (lastStart > (hadSalutation ? 0 : 1) && NAME_PARTICLES.has(words[lastStart - 1].toLowerCase())) lastStart--;
  if (hadSalutation && lastStart === 1 && NAME_PARTICLES.has(words[0].toLowerCase())) lastStart = 0;
  return { firstName: words.slice(0, lastStart).join(" ") || null, infix: null, lastName: words.slice(lastStart).join(" ") };
}

function canonicalInfix(inf: string): string {
  if (inf === "vd" || inf === "v.d." || inf === "v/d") return "van de";
  return inf;
}

/**
 * Fonetische sleutel voor achternamen, afgestemd op Nederlandse spelvarianten:
 * Janssen/Jansen, Meijer/Meyer/Meier, de Groot/Groot, Claassen/Klaasen,
 * Smit/Smid/Smidt, Bakker/Backer, Philips/Filips.
 * Tussenvoegsels tellen niet mee.
 */
export function lastNameKey(lastName: string | null | undefined): string | null {
  if (!lastName) return null;
  let v = stripDiacritics(lastName.toLowerCase());
  // eventueel meegegeven tussenvoegsel aan het begin weghalen
  for (const inf of INFIXES) {
    if (v.startsWith(inf + " ")) {
      v = v.slice(inf.length + 1);
      break;
    }
  }
  v = v.replace(/[^a-z]/g, "");
  if (!v) return null;
  v = v
    .replace(/eij|ij|ei|ey|y/g, "Y")
    .replace(/ae/g, "a")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/ck/g, "k")
    .replace(/c(?=[aoukl]|$)/g, "k")
    .replace(/ch/g, "g")
    .replace(/qu/g, "kw")
    .replace(/x/g, "ks")
    .replace(/dt$|d$/g, "t")
    .replace(/(.)\1+/g, "$1"); // dubbele letters (ss, kk, aa, ee, oo)
  return v;
}

export function displayName(p: PersonName): string {
  return [p.firstName, p.infix, p.lastName].filter(Boolean).join(" ");
}
