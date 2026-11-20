import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePpcOrder } from "@/lib/parsers/ppc";
import { parseFediOrder } from "@/lib/parsers/fedi";
import { parseWefactAccepted } from "@/lib/parsers/wefact-mail";
import { classifyEvent, parseLocation, parseMontageTitle } from "@/lib/parsers/calendar";
import { calcFinance, parseEuro } from "@/lib/finance";
import { montageDays } from "@/lib/montage-days";
import { nextStage } from "@/lib/stage-rules";
import { montageInProgress, reviewReminderDue, reviewRequestDue } from "@/lib/review-schedule";
import { DEFAULT_STAGES } from "@/db/seed-defaults";

const fx = (f: string) => readFileSync(path.join(__dirname, "../fixtures", f), "utf8");
const RULES = { advies: { colorId: "5", titleContains: "Advies gesprek Steps&Stairs" }, montage: { colorId: "11" } };

describe("orderbevestiging PPC (PDF)", () => {
  it("leest ordernummer, commissie en totaal excl. btw", () => {
    const o = parsePpcOrder(fx("ppc-orderbevestiging.txt"))!;
    expect(o.supplier).toBe("PPC");
    expect(o.orderNumber).toBe("26510197");
    expect(o.commission).toBe("Fam. Voorbeeld");
    expect(o.amountExcl).toBe(2344.54);
    expect(o.amountIncl).toBe(2836.89);
    expect(o.orderDate?.toISOString().slice(0, 10)).toBe("2026-11-18");
  });
  it("negeert andere documenten", () => {
    expect(parsePpcOrder("Factuur F2026-0068 Familie Janssen")).toBeNull();
  });
});

describe("orderbevestiging fedi (mail)", () => {
  it("leest bestelnummer, commissie en totaal", () => {
    const o = parseFediOrder(fx("fedi-orderbevestiging.txt"))!;
    expect(o.supplier).toBe("fedi");
    expect(o.orderNumber).toBe("BE12558");
    expect(o.commission).toBe("Fam. Voorbeeld");
    expect(o.amountExcl).toBe(1361.2);
  });
  it("werkt ook als 'Commissie' goed gespeld is en de zin eindigt", () => {
    const o = parseFediOrder("Bedankt voor uw bestelling bij fedi! bestelling met nummer BE1 Commissie: Fam. de Boer. Totaal: € 99,95")!;
    expect(o.commission).toBe("Fam. de Boer");
    expect(o.amountExcl).toBe(99.95);
  });
});

describe("WeFact: offerte online geaccepteerd", () => {
  it("leest offertenummer, klant en moment", () => {
    const r = parseWefactAccepted(
      "Offerte OF2026-0076 is online geaccepteerd",
      "De offerte OF2026-0076 is door Familie Voorbeeld op 18-11-2026 om 17:08 geaccepteerd vanaf IP-adres 1.2.3.4.",
    )!;
    expect(r.quoteNumber).toBe("OF2026-0076");
    expect(r.customerName).toBe("Familie Voorbeeld");
    expect(r.acceptedAt?.toISOString()).toBe("2026-11-18T16:08:00.000Z");
  });
  it("andere WeFact-mails worden genegeerd", () => {
    expect(parseWefactAccepted("Factuur F2026-0068 is betaald", "")).toBeNull();
  });
});

describe("Google Agenda", () => {
  it("geel adviesgesprek: klant via gast-e-mail en locatie", () => {
    const c = classifyEvent(
      { summary: "Advies gesprek Steps&Stairs", colorId: "5", location: "Kerkstraat 12, 6511 AB Nijmegen, Nederland", attendees: ["Klant@Example.nl", "info@stepsandstairs.nl"], ownEmails: ["info@stepsandstairs.nl"] },
      RULES,
    );
    expect(c.kind).toBe("advies");
    if (c.kind !== "advies") return;
    expect(c.emails).toEqual(["klant@example.nl"]);
    expect(c.address).toEqual({ street: "Kerkstraat", houseNumber: 12, addition: null, postcode: "6511AB", city: "Nijmegen" });
  });
  it("rode montage: 'Fam. Jansen Kerkstraat 12'", () => {
    const c = classifyEvent({ summary: "Fam. Jansen Kerkstraat 12", colorId: "11", location: null, attendees: [] }, RULES);
    expect(c.kind).toBe("montage");
    if (c.kind !== "montage") return;
    expect(c.nameCandidates).toEqual([{ name: "Jansen", street: "Kerkstraat", houseNumber: 12, addition: null }]);
  });
  it("montage met tussenvoegsel en meerdelige straat geeft alle splitsingen", () => {
    const c = parseMontageTitle("fam. van der Berg Burg. de Withstraat 3a");
    expect(c.map((x) => `${x.name}|${x.street}`)).toContain("van der Berg|Burg. de Withstraat");
    expect(c[0].houseNumber).toBe(3);
    expect(c[0].addition).toBe("A");
  });
  it("montage met komma is eenduidig", () => {
    expect(parseMontageTitle("Fam. Jansen, Kerkstraat 12")).toEqual([{ name: "Jansen", street: "Kerkstraat", houseNumber: 12, addition: null }]);
  });
  it("verkeerde kleur of titel = geen klantafspraak", () => {
    expect(classifyEvent({ summary: "Advies gesprek Steps&Stairs", colorId: "9", location: null, attendees: [] }, RULES).kind).toBe("overig");
    expect(classifyEvent({ summary: "Tandarts", colorId: "11", location: null, attendees: [] }, RULES).kind).toBe("overig");
  });
  it("locatie in verschillende vormen", () => {
    expect(parseLocation("Tintorettohof 8 6663PP Lent")).toMatchObject({ street: "Tintorettohof", houseNumber: 8, postcode: "6663PP", city: "Lent" });
    expect(parseLocation("")).toBeNull();
  });
});

describe("marge", () => {
  it("rekent marge, percentage en marge per dag", () => {
    expect(calcFinance({ saleExcl: 6347.1, purchaseExcl: 2344.54, montageDays: 2 })).toEqual({
      saleExcl: 6347.1,
      purchaseExcl: 2344.54,
      margin: 4002.56,
      marginPct: 63.06,
      montageDays: 2,
      marginPerDay: 2001.28,
    });
  });
  it("zonder inkoop of dagen geen marge per dag", () => {
    expect(calcFinance({ saleExcl: 1000, purchaseExcl: null, montageDays: 2 }).marginPerDay).toBeNull();
    expect(calcFinance({ saleExcl: 1000, purchaseExcl: 400, montageDays: null }).marginPerDay).toBeNull();
  });
  it.each([
    ["€ 1.361,20", 1361.2],
    ["2.344,54", 2344.54],
    ["99,9", 99.9],
    ["1361.20", 1361.2],
    ["1.500", 1500],
  ])("bedrag %s", (s, n) => expect(parseEuro(s)).toBe(n));
});

describe("montagedagen uit agenda", () => {
  it("telt meerdaagse en losse afspraken, zonder dubbelen", () => {
    const days = montageDays([
      { startsAt: new Date("2026-12-07T07:00:00Z"), endsAt: new Date("2026-12-07T16:00:00Z") },
      { startsAt: new Date("2026-12-08T07:00:00Z"), endsAt: new Date("2026-12-08T16:00:00Z") },
      { startsAt: new Date("2026-12-08T12:00:00Z"), endsAt: new Date("2026-12-08T15:00:00Z") },
    ]);
    expect(days).toEqual(["2026-12-07", "2026-12-08"]);
  });
  it("hele-dag-afspraak over 3 dagen (einddatum exclusief)", () => {
    expect(montageDays([{ startsAt: new Date("2026-12-06T23:00:00Z"), endsAt: new Date("2026-12-09T23:00:00Z"), allDay: true }])).toEqual([
      "2026-12-07",
      "2026-12-08",
      "2026-12-09",
    ]);
  });
});

describe("automatische fasewijziging: alleen vooruit", () => {
  const stages = DEFAULT_STAGES.map((s) => ({ key: s.key, position: s.position, kind: s.kind }));
  it("lead + adviesgesprek -> offerte gepland", () => expect(nextStage("lead", "adviesgesprek_gepland", stages)).toBe("offerte_gepland"));
  it("in afwachting + adviesgesprek -> offerte gepland", () => expect(nextStage("in_afwachting", "adviesgesprek_gepland", stages)).toBe("offerte_gepland"));
  it("nooit terug: montage gepland + adviesgesprek", () => expect(nextStage("montage_gepland", "adviesgesprek_gepland", stages)).toBeNull());
  it("materiaal besteld + montage ingepland blijft staan", () => expect(nextStage("materiaal_besteld", "montage_gepland", stages)).toBeNull());
  it("nooit uit vervallen", () => expect(nextStage("vervallen", "offerte_geaccepteerd", stages)).toBeNull());
  it("zelfde fase: niets", () => expect(nextStage("offerte_gemaakt", "offerte_gemaakt", stages)).toBeNull());
});

describe("reviewverzoek en herinnering", () => {
  it("verzoek 2 dagen na de laatste montagedag", () => {
    expect(reviewRequestDue("2026-12-08", "2026-12-09")).toBe(false);
    expect(reviewRequestDue("2026-12-08", "2026-12-10")).toBe(true);
    expect(reviewRequestDue(null, "2026-12-10")).toBe(false);
  });
  it("herinnering 7 dagen na het verzoek, alleen als er nog geen review is", () => {
    expect(reviewReminderDue("2026-12-10", false, false, "2026-12-16")).toBe(false);
    expect(reviewReminderDue("2026-12-10", false, false, "2026-12-17")).toBe(true);
    expect(reviewReminderDue("2026-12-10", true, false, "2026-12-20")).toBe(false);
    expect(reviewReminderDue("2026-12-10", false, true, "2026-12-20")).toBe(false);
  });
  it("in uitvoering tussen eerste en laatste montagedag", () => {
    expect(montageInProgress(["2026-12-07", "2026-12-08"], "2026-12-07")).toBe(true);
    expect(montageInProgress(["2026-12-07", "2026-12-08"], "2026-12-06")).toBe(false);
  });
});
