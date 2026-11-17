import { lastNameSimilarity } from "./similarity";

/**
 * Matchscore tussen een binnenkomend klantprofiel en een bestaande klant.
 * Puur (geen database), zodat het volledig met tests is af te dekken.
 *
 * Uitgangspunten:
 *  - Sterke signalen: adres (postcode + huisnummer), telefoon, e-mail.
 *  - Middel: straat + huisnummer zonder postcode (bv. uit agenda-afspraak),
 *            alleen postcode zonder huisnummer (zoals het websiteformulier soms).
 *  - Zwak:   achternaam (fuzzy). Op naam alleen wordt NOOIT gekoppeld.
 *  - Verschillende huisnummertoevoeging op hetzelfde adres (12A vs 12B) is een
 *    tegen-signaal: dan nooit automatisch koppelen.
 */

export interface MatchProfile {
  emails: string[]; // genormaliseerd
  phones: string[]; // E.164
  postcode: string | null; // 1234AB
  houseNumber: number | null;
  addition: string | null;
  streetKey: string | null;
  city: string | null;
  names: { infix?: string | null; lastName: string | null }[];
  /** Extra adressen (bv. afwijkend montageadres van een traject) */
  extraAddresses?: { postcode: string | null; houseNumber: number | null; addition: string | null; streetKey: string | null }[];
}

export interface MatchSettings {
  weights: {
    address: number;
    addressAdditionMissing: number;
    streetHouseNumber: number;
    postcodeOnly: number;
    phone: number;
    email: number;
    nameMax: number;
  };
  /** Bij naam alleen (geen enkel adres/telefoon/e-mail-signaal) nooit hoger dan dit. */
  nameOnlyCap: number;
  autoThreshold: number;
  doubtThreshold: number;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  weights: {
    address: 50,
    addressAdditionMissing: 50,
    streetHouseNumber: 50,
    postcodeOnly: 15,
    phone: 50,
    email: 50,
    nameMax: 20,
  },
  nameOnlyCap: 20,
  autoThreshold: 70,
  doubtThreshold: 35,
};

export type SignalKey =
  | "address"
  | "address_addition_missing"
  | "address_conflict"
  | "street_house_number"
  | "postcode_only"
  | "phone"
  | "email"
  | "name";

export interface Signal {
  key: SignalKey;
  points: number;
  label: string;
}

export type MatchDecision = "auto" | "doubt" | "none";

export interface MatchResult {
  score: number;
  decision: MatchDecision;
  signals: Signal[];
}

export function scoreMatch(a: MatchProfile, b: MatchProfile, s: MatchSettings = DEFAULT_MATCH_SETTINGS): MatchResult {
  const w = s.weights;
  const signals: Signal[] = [];
  let conflict = false;

  // --- Adres -------------------------------------------------------------
  const addrA = [addr(a), ...(a.extraAddresses ?? [])];
  const addrB = [addr(b), ...(b.extraAddresses ?? [])];
  let bestAddr: Signal | null = null;
  for (const x of addrA) {
    for (const y of addrB) {
      const sig = compareAddress(x, y, w);
      if (sig === "conflict") {
        conflict = true;
        continue;
      }
      if (sig && (!bestAddr || sig.points > bestAddr.points)) bestAddr = sig;
    }
  }
  if (bestAddr) signals.push(bestAddr);
  else if (conflict) signals.push({ key: "address_conflict", points: 0, label: "Zelfde huisnummer, andere toevoeging" });

  // --- Telefoon / e-mail -------------------------------------------------
  const phone = intersect(a.phones, b.phones);
  if (phone) signals.push({ key: "phone", points: w.phone, label: `Telefoon gelijk (${phone})` });
  const email = intersect(a.emails, b.emails);
  if (email) signals.push({ key: "email", points: w.email, label: `E-mail gelijk (${email})` });

  // --- Naam --------------------------------------------------------------
  let bestName = 0;
  for (const na of a.names) for (const nb of b.names) bestName = Math.max(bestName, lastNameSimilarity(na, nb));
  const namePoints = namePointsFor(bestName, w.nameMax);
  if (namePoints > 0) {
    signals.push({ key: "name", points: namePoints, label: `Achternaam lijkt (${Math.round(bestName * 100)}%)` });
  }

  let score = signals.reduce((sum, x) => sum + x.points, 0);
  const hasHardSignal = signals.some((x) => x.key !== "name" && x.key !== "address_conflict" && x.points > 0);
  if (!hasHardSignal) score = Math.min(score, s.nameOnlyCap);
  if (conflict && !bestAddr) score = Math.min(score, s.autoThreshold - 1);
  score = Math.min(score, 100);

  const decision: MatchDecision = score >= s.autoThreshold ? "auto" : score >= s.doubtThreshold ? "doubt" : "none";
  return { score, decision, signals };
}

function namePointsFor(sim: number, max: number): number {
  if (sim >= 0.97) return max;
  if (sim >= 0.92) return Math.round(max * 0.75);
  if (sim >= 0.88) return Math.round(max * 0.5);
  return 0;
}

interface Addr {
  postcode: string | null;
  houseNumber: number | null;
  addition: string | null;
  streetKey: string | null;
  city?: string | null;
}

function addr(p: MatchProfile): Addr {
  return { postcode: p.postcode, houseNumber: p.houseNumber, addition: p.addition, streetKey: p.streetKey, city: p.city };
}

function compareAddress(x: Addr, y: Addr, w: MatchSettings["weights"]): Signal | "conflict" | null {
  if (x.postcode && y.postcode && x.houseNumber && y.houseNumber) {
    if (x.postcode !== y.postcode || x.houseNumber !== y.houseNumber) return null;
    const ax = x.addition ?? "";
    const ay = y.addition ?? "";
    if (ax === ay) return { key: "address", points: w.address, label: "Postcode + huisnummer gelijk" };
    if (ax && ay) return "conflict";
    return { key: "address_addition_missing", points: w.addressAdditionMissing, label: "Postcode + huisnummer gelijk (toevoeging ontbreekt)" };
  }
  if (x.streetKey && y.streetKey && x.houseNumber && y.houseNumber) {
    if (x.streetKey !== y.streetKey || x.houseNumber !== y.houseNumber) return null;
    if (x.postcode && y.postcode && x.postcode !== y.postcode) return null;
    if (x.city && y.city && x.city.toLowerCase() !== y.city.toLowerCase()) return null;
    const ax = x.addition ?? "";
    const ay = y.addition ?? "";
    if (ax && ay && ax !== ay) return "conflict";
    return { key: "street_house_number", points: w.streetHouseNumber, label: "Straat + huisnummer gelijk" };
  }
  if (x.postcode && y.postcode && x.postcode === y.postcode && (!x.houseNumber || !y.houseNumber)) {
    return { key: "postcode_only", points: w.postcodeOnly, label: "Postcode gelijk (huisnummer onbekend)" };
  }
  return null;
}

function intersect(a: string[], b: string[]): string | null {
  const set = new Set(b);
  return a.find((x) => set.has(x)) ?? null;
}

/**
 * Kiest uit meerdere kandidaten de uitkomst. Twee of meer klanten boven de
 * auto-drempel betekent twijfel: dan laten we de gebruiker kiezen.
 */
export function decide<T extends { result: MatchResult }>(candidates: T[]): { decision: MatchDecision; best: T | null; doubts: T[] } {
  const sorted = [...candidates].sort((x, y) => y.result.score - x.result.score);
  const autos = sorted.filter((c) => c.result.decision === "auto");
  const doubts = sorted.filter((c) => c.result.decision !== "none");
  if (autos.length === 1) return { decision: "auto", best: autos[0], doubts: [] };
  if (doubts.length > 0) return { decision: "doubt", best: null, doubts };
  return { decision: "none", best: null, doubts: [] };
}
