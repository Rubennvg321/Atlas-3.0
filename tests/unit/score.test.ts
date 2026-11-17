import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_SETTINGS, decide, scoreMatch, type MatchProfile } from "@/lib/matching/score";
import { lastNameSimilarity } from "@/lib/matching/similarity";
import { normalizeEmail, normalizePhone, normalizePostcode, parseHouseNumber, splitDutchName, streetKey } from "@/lib/normalize";

/** Hulpfunctie: bouw een profiel uit "menselijke" invoer, zoals een formulier die zou geven. */
function p(o: {
  name?: string;
  names?: string[];
  email?: string | string[];
  phone?: string | string[];
  postcode?: string;
  nr?: string;
  street?: string;
  city?: string;
}): MatchProfile {
  const hn = o.nr ? parseHouseNumber(o.nr) : null;
  const names = (o.names ?? (o.name ? [o.name] : [])).map((n) => splitDutchName(n));
  return {
    emails: [o.email ?? []].flat().map((e) => normalizeEmail(e)!).filter(Boolean),
    phones: [o.phone ?? []].flat().map((t) => normalizePhone(t)!).filter(Boolean),
    postcode: o.postcode ? normalizePostcode(o.postcode) : null,
    houseNumber: hn?.number ?? null,
    addition: hn?.addition ?? null,
    streetKey: streetKey(o.street),
    city: o.city ?? null,
    names: names.map((n) => ({ infix: n.infix, lastName: n.lastName })),
  };
}

const bestaand = p({
  name: "Peter Jansen",
  email: "p.jansen@ziggo.nl",
  phone: "06-12345678",
  postcode: "6511 AB",
  nr: "12",
  street: "Kerkstraat",
  city: "Nijmegen",
});

describe("scoreMatch: automatisch koppelen", () => {
  it("zelfde klant, nieuw e-mailadres, zelfde telefoon (06 vs +31)", () => {
    const r = scoreMatch(p({ name: "Peter Jansen", email: "peter@gmail.com", phone: "+31 6 12345678" }), bestaand);
    expect(r.decision).toBe("auto");
  });

  it("Janssen met dubbele s op hetzelfde adres", () => {
    const r = scoreMatch(p({ name: "P. Janssen", postcode: "6511ab", nr: "12" }), bestaand);
    expect(r.decision).toBe("auto");
  });

  it("zelfde e-mail met hoofdletters en zelfde naam", () => {
    const r = scoreMatch(p({ name: "Peter Jansen", email: " P.Jansen@Ziggo.nl" }), bestaand);
    expect(r.decision).toBe("auto");
  });

  it("telefoon + adres gelijk, ook als naam totaal anders is", () => {
    const r = scoreMatch(p({ name: "Sanne de Wit", phone: "0612345678", postcode: "6511AB", nr: "12" }), bestaand);
    expect(r.decision).toBe("auto");
  });

  it("van der Berg vs Berg op hetzelfde adres", () => {
    const a = p({ name: "Jan van der Berg", postcode: "1234AB", nr: "5" });
    const b = p({ name: "J. Berg", postcode: "1234 ab", nr: "5" });
    expect(scoreMatch(a, b).decision).toBe("auto");
  });

  it("montage-afspraak uit agenda: 'fam. Jansen Kerkstraat 12' zonder postcode", () => {
    const r = scoreMatch(p({ name: "fam. Jansen", street: "Kerkstr.", nr: "12" }), bestaand);
    expect(r.decision).toBe("auto");
    expect(r.signals.map((s) => s.key)).toContain("street_house_number");
  });

  it("aanvraag met typfout in e-mail maar zelfde telefoon en naam", () => {
    const klein = p({ name: "Katharina Klein", email: "katharina.klein@web.de", phone: "0657896904", postcode: "6663PP", nr: "8" });
    const aanvraag = p({ name: "Katharina Klein", email: "katharinai.klein@web.de", phone: "0657896904", postcode: "6663Pp" });
    expect(scoreMatch(aanvraag, klein).decision).toBe("auto");
  });
});

describe("scoreMatch: niet-Nederlandse achternamen", () => {
  it("'El Amrani' met zelfde telefoon wordt automatisch gekoppeld", () => {
    const a = p({ name: "Fatima El Amrani", phone: "0623456789" });
    const b = p({ names: ["Fatima El Amrani"], phone: "+31 6 23456789", email: "f.elamrani@gmail.com" });
    expect(scoreMatch(b, a).decision).toBe("auto");
  });
});

describe("scoreMatch: twijfel ('Mogelijk dubbel')", () => {
  it("partner met eigen naam en eigen e-mail op hetzelfde adres", () => {
    const partner = p({ name: "Sanne Bakker", email: "sanne.bakker@hotmail.com", phone: "0687654321", postcode: "6511AB", nr: "12" });
    const r = scoreMatch(partner, bestaand);
    expect(r.decision).toBe("doubt");
  });

  it("nieuwe bewoners na verhuizing (zelfde adres, andere naam)", () => {
    const r = scoreMatch(p({ name: "Fatima El Amrani", postcode: "6511AB", nr: "12" }), bestaand);
    expect(r.decision).toBe("doubt");
  });

  it("zelfde e-mailadres maar andere achternaam (gedeeld gezinsadres)", () => {
    const r = scoreMatch(p({ name: "Lotte de Boer", email: "p.jansen@ziggo.nl" }), bestaand);
    expect(r.decision).toBe("doubt");
  });

  it("websiteformulier zonder huisnummer: zelfde postcode + zelfde achternaam", () => {
    const r = scoreMatch(p({ name: "Petra Jansen", postcode: "6511AB" }), bestaand);
    expect(r.decision).toBe("doubt");
  });

  it("toevoeging ontbreekt aan één kant (12 vs 12A) met zelfde naam", () => {
    const a = p({ name: "Ahmed Yilmaz", postcode: "3011AA", nr: "12" });
    const b = p({ name: "A. Yilmaz", postcode: "3011AA", nr: "12A" });
    expect(scoreMatch(a, b).decision).toBe("auto");
    const c = p({ name: "Henk de Vries", postcode: "3011AA", nr: "12" });
    expect(scoreMatch(c, b).decision).toBe("doubt");
  });

  it("andere toevoeging (12A vs 12B) koppelt nooit automatisch, ook niet met dezelfde naam", () => {
    const a = p({ name: "Henk de Vries", postcode: "3011AA", nr: "12A" });
    const b = p({ name: "Henk de Vries", postcode: "3011AA", nr: "12B" });
    const r = scoreMatch(a, b);
    expect(r.decision).not.toBe("auto");
    expect(r.signals.map((s) => s.key)).toContain("address_conflict");
  });

  it("twee kandidaten boven de auto-drempel wordt twijfel", () => {
    const k1 = { id: 1, result: scoreMatch(p({ name: "Jansen", phone: "0612345678", postcode: "6511AB", nr: "12" }), bestaand) };
    const k2 = { id: 2, result: scoreMatch(p({ name: "Jansen", email: "p.jansen@ziggo.nl", postcode: "6511AB", nr: "12" }), bestaand) };
    const d = decide([k1, k2]);
    expect(d.decision).toBe("doubt");
    expect(d.doubts).toHaveLength(2);
  });
});

describe("scoreMatch: nieuwe klant", () => {
  it("zelfde naam, verder niets gelijk: nooit samenvoegen op naam alleen", () => {
    const r = scoreMatch(p({ name: "Peter Jansen", email: "pj@kpnmail.nl", postcode: "9711AA", nr: "3" }), bestaand);
    expect(r.decision).toBe("none");
    expect(r.score).toBeLessThanOrEqual(DEFAULT_MATCH_SETTINGS.nameOnlyCap);
  });

  it("andere persoon in dezelfde straat (ander huisnummer)", () => {
    const r = scoreMatch(p({ name: "Peter Jansen", street: "Kerkstraat", nr: "14", postcode: "6511AB" }), bestaand);
    expect(r.decision).toBe("none");
  });

  it("totaal andere klant", () => {
    const r = scoreMatch(p({ name: "Eva Hendriks", email: "eva@xs4all.nl", phone: "0201234567", postcode: "1012AB", nr: "1" }), bestaand);
    expect(r.decision).toBe("none");
    expect(r.score).toBe(0);
  });
});

describe("drempelwaarden zijn instelbaar", () => {
  it("een strengere auto-drempel maakt van auto twijfel", () => {
    const strict = { ...DEFAULT_MATCH_SETTINGS, autoThreshold: 90 };
    const r = scoreMatch(p({ name: "Peter Jansen", phone: "0612345678" }), bestaand, strict);
    expect(r.decision).toBe("doubt");
  });
});

describe("lastNameSimilarity", () => {
  const n = (s: string) => splitDutchName(s);
  it.each([
    ["Jan Jansen", "Jan Janssen", 0.95],
    ["Jan van der Berg", "J. Berg", 0.97],
    ["Jan Vanderberg", "Jan van der Berg", 0.9],
    ["Anna de Vries-Bakker", "Anna Bakker", 0.97],
    ["Kees Meijer", "Kees Meyer", 0.95],
    ["Fatima El Amrani", "F. Amrani", 0.95],
    ["Fatima El Amrani", "Fatima Elamrani", 0.9],
  ])("%s ~ %s >= %d", (a, b, min) => expect(lastNameSimilarity(n(a), n(b))).toBeGreaterThanOrEqual(min));

  it.each([
    ["Jan Jansen", "Jan Hendriks"],
    ["Jan Berg", "Jan Bos"],
    ["Jan de Vries", "Jan de Graaf"],
  ])("%s !~ %s", (a, b) => expect(lastNameSimilarity(n(a), n(b))).toBeLessThan(0.88));
});

describe("straat + huisnummer zonder postcode", () => {
  it("zelfde straat en nummer in een andere plaats is geen match", () => {
    const r = scoreMatch(p({ name: "fam. Jansen", street: "Kerkstraat", nr: "12", city: "Arnhem" }), bestaand);
    expect(r.decision).toBe("none");
  });
});
