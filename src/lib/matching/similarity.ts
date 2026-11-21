import { lastNameKey, stripDiacritics } from "../normalize";

/** Jaro-Winkler-overeenkomst tussen 0 en 1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function plain(s: string): string {
  return stripDiacritics(s.toLowerCase()).replace(/[^a-z]/g, "");
}

export interface NameForMatch {
  infix?: string | null;
  lastName: string | null;
}

/**
 * Overeenkomst tussen twee achternamen (0..1). Houdt rekening met
 * tussenvoegsels ("van der Berg" ~ "Berg" ~ "Vanderberg") en spelvarianten.
 * Dubbele namen ("de Vries-Bakker") matchen op elk deel.
 */
export function lastNameSimilarity(a: NameForMatch, b: NameForMatch): number {
  if (!a.lastName || !b.lastName) return 0;
  const partsA = splitDoubleName(a.lastName);
  const partsB = splitDoubleName(b.lastName);
  let best = 0;
  for (const pa of partsA) {
    for (const pb of partsB) {
      best = Math.max(best, singleSimilarity(pa, pb));
    }
  }
  // "Vanderberg" (aan elkaar) tegenover "van der Berg"
  const fullA = plain(`${a.infix ?? ""}${a.lastName}`);
  const fullB = plain(`${b.infix ?? ""}${b.lastName}`);
  if (fullA && fullB) {
    best = Math.max(best, fullA === fullB ? 1 : jaroWinkler(fullA, fullB) * 0.97);
  }
  return best;
}

/** "de Vries-Bakker" -> [geheel, Vries, Bakker]; "El Amrani" -> [geheel, Amrani] */
function splitDoubleName(name: string): string[] {
  const out = new Set<string>([name]);
  const parts = name.split(/\s*-\s*/).filter(Boolean);
  if (parts.length > 1) parts.forEach((p) => out.add(p));
  for (const p of [name, ...parts]) {
    const words = p.split(/\s+/).filter(Boolean);
    if (words.length > 1) out.add(words[words.length - 1]);
  }
  return [...out];
}

function singleSimilarity(a: string, b: string): number {
  const ka = lastNameKey(a);
  const kb = lastNameKey(b);
  if (!ka || !kb) return 0;
  if (plain(a) === plain(b)) return 1;
  if (ka === kb) return 0.97;
  return Math.max(jaroWinkler(ka, kb), jaroWinkler(plain(a), plain(b))) * 0.95;
}
