import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { appointments, customers, emails, quotes, trajects } from "@/db/schema";
import { syncCustomerMails, syncGmail, syncLeadMails, syncSupplierMails, syncWefactMails } from "@/server/integrations/gmail-sync";
import { processEvent, syncCalendar } from "@/server/integrations/calendar-sync";
import { syncWefact } from "@/server/integrations/wefact-sync";
import { runDaily } from "@/server/daily";
import { getTrajectFinance } from "@/server/finance";
import { intakeLead } from "@/server/intake";
import { changeStage } from "@/server/trajects";
import { setSetting } from "@/server/settings";
import { getIntegration, runTracked, upsertIntegration } from "@/server/integrations/state";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import { db, lead, resetDb, uid } from "./helpers";
import { OWN, fakeCalendar, fakeGmail, fakeWefact } from "./fakes";

beforeEach(async () => {
  await resetDb();
  // In de tests komt het formulier van een fictief adres.
  await setSetting(db(), "intakeFilters", { ...DEFAULT_SETTINGS.intakeFilters, rules: [{ from: OWN, subjectContains: "Aanvraag website", parser: "website-form" }] });
});
afterAll(closeDb);

const FORM = readFileSync(path.join(__dirname, "../fixtures/aanvraag-website.txt"), "utf8");
const FEDI = readFileSync(path.join(__dirname, "../fixtures/fedi-orderbevestiging.txt"), "utf8");
const stageOf = async (id: string) => (await db().select().from(trajects).where(eq(trajects.id, id)))[0].stage;
const leadMail = (id: string) => ({ id, from: `Formulier <${OWN}>`, subject: "Aanvraag website", body: FORM });

describe("Gmail: aanvraagmails", () => {
  it("wordt een lead, krijgt het verwerkt-label en gaat uit de inbox", async () => {
    const g = fakeGmail([leadMail("m1")]);
    expect(await syncLeadMails(db(), g)).toBe(1);
    const [c] = await db().select().from(customers);
    expect(c.displayName).toBe("Katharina Klein");
    const [t] = await db().select().from(trajects);
    expect(t.stage).toBe("lead");
    expect(g.mails[0].labels).toContain("Label_1");
    expect(g.mails[0].labels).not.toContain("INBOX");
    expect(await syncLeadMails(db(), g)).toBe(0);
  });

  it("KLAAR-criterium: storing halverwege (archiveren mislukt) -> opnieuw draaien geeft geen dubbele lead en archiveert alsnog", async () => {
    const g = fakeGmail([leadMail("m1")]);
    g.failNextModify();
    await expect(syncLeadMails(db(), g)).rejects.toThrow(/storing/);
    expect(await db().select().from(customers)).toHaveLength(1);
    await syncLeadMails(db(), g);
    expect(await db().select().from(customers)).toHaveLength(1);
    expect(await db().select().from(trajects)).toHaveLength(1);
    expect(g.mails[0].labels).not.toContain("INBOX");
  });

  it("onherkenbare mail met hetzelfde onderwerp krijgt 'niet herkend'-label en blijft in de inbox", async () => {
    const g = fakeGmail([{ id: "x", from: OWN, subject: "Aanvraag website", body: "Hallo, test" }]);
    await syncLeadMails(db(), g);
    expect(await db().select().from(customers)).toHaveLength(0);
    expect(g.mails[0].labels).toContain("INBOX");
    expect(g.mails[0].labels).toContain("Label_2");
  });
});

describe("Gmail: WeFact en leveranciers", () => {
  it("'Offerte … is online geaccepteerd' zet de kaart door; twee keer verwerken doet niets extra", async () => {
    const r = await intakeLead(db(), lead({ name: "Mark van Huissteden", phone: "0611112222" }), { provider: "handmatig", externalId: uid() });
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "offerte_gemaakt", source: "manual" });
    const g = fakeGmail([
      {
        id: "w1",
        from: "WeFact <mailer@mijnwefact.nl>",
        subject: "Offerte OF2026-0076 is online geaccepteerd",
        body: "De offerte OF2026-0076 is door Familie Van Huissteden op 18-11-2026 om 17:08 geaccepteerd vanaf IP-adres 1.2.3.4.",
      },
    ]);
    expect(await syncWefactMails(db(), g)).toBe(1);
    expect(await stageOf(r.trajectId!)).toBe("offerte_geaccepteerd");
    expect(await syncWefactMails(db(), g)).toBe(0);
    expect(await db().select().from(quotes)).toHaveLength(1);
  });

  it("fedi met Duitse tekstversie en Nederlandse HTML: de HTML (met commissie) wordt gelezen", async () => {
    const r = await intakeLead(db(), lead({ name: "Kees Voorbeeld", phone: "0611113333" }), { provider: "handmatig", externalId: uid() });
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "montage_gepland", source: "manual" });
    const german = "Sehr geehrter Herr,\n\nBestellnummer: BE12558\n\nGesamtkosten Netto: € 1.361,20\n";
    const html = `<div><p>Beste klant,</p>Bedankt voor uw bestelling bij fedi!<br>Wij hebben uw bestelling met nummer <strong>BE12558</strong> goed ontvangen.<br><br>Extra informatie: Comissie: Fam. Voorbeeld\r\nLevering: week 51<BR><table><tr><td>Totaal</td></tr></table><strong>Totaal: € 1.361,20</strong><br></div>`;
    const g = fakeGmail([{ id: "f2", from: "Fedi <info@fedi.de>", subject: "Orderbevestiging", body: german, html }]);
    expect(await syncSupplierMails(db(), g)).toBe(1);
    expect((await getTrajectFinance(db(), r.trajectId!)).purchaseExcl).toBe(1361.2);
  });

  it("fedi-orderbevestiging wordt inkoop bij het juiste traject", async () => {
    const r = await intakeLead(db(), lead({ name: "Kees Voorbeeld", phone: "0611113333" }), { provider: "handmatig", externalId: uid() });
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "montage_gepland", source: "manual" });
    const g = fakeGmail([{ id: "f1", from: "Fedi <verkoop@fedi.de>", subject: "Orderbevestiging", body: FEDI }]);
    expect(await syncSupplierMails(db(), g)).toBe(1);
    expect((await getTrajectFinance(db(), r.trajectId!)).purchaseExcl).toBe(1361.2);
    expect(await stageOf(r.trajectId!)).toBe("materiaal_besteld");
    expect(await syncSupplierMails(db(), g)).toBe(0);
  });
});

describe("Gmail: mail van bekende klanten", () => {
  it("wordt aan het traject gekoppeld; onbekende mail wordt niet opgeslagen", async () => {
    const r = await intakeLead(db(), lead({ name: "Eva Hendriks", email: "eva@example.nl" }), { provider: "handmatig", externalId: uid() });
    const g = fakeGmail([
      { id: "c1", from: "Eva Hendriks <Eva@Example.nl>", subject: "Vraag over de offerte", body: "Hoi!" },
      { id: "c2", from: OWN, to: "eva@example.nl", subject: "Re: Vraag over de offerte", body: "Hallo Eva" },
      { id: "c3", from: "nieuwsbrief@winkel.example", subject: "Aanbieding", body: "Korting" },
    ]);
    expect(await syncCustomerMails(db(), g)).toBe(2);
    const rows = await db().select().from(emails);
    expect(rows.map((e) => [e.gmailMessageId, e.direction, e.trajectId]).sort()).toEqual([
      ["c1", "in", r.trajectId],
      ["c2", "uit", r.trajectId],
    ]);
    expect(await syncCustomerMails(db(), g)).toBe(0);
  });
});

describe("Google Agenda", () => {
  const advies = (id: string, email: string, loc: string) => ({
    id,
    etag: `"${id}-1"`,
    status: "confirmed",
    summary: "Advies gesprek Steps&Stairs",
    colorId: "5",
    location: loc,
    attendees: [{ email: OWN, self: true }, { email }],
    start: { dateTime: "2026-12-01T10:00:00+01:00" },
    end: { dateTime: "2026-12-01T11:00:00+01:00" },
  });

  it("geel adviesgesprek van een bestaande lead: gekoppeld en naar 'Offerte gepland'", async () => {
    const r = await intakeLead(db(), lead({ name: "Katharina Klein", email: "katharina@example.nl", postcode: "6663PP", street: "Tintorettohof", houseNumber: 8 }), {
      provider: "website",
      externalId: uid(),
    });
    expect(await syncCalendar(db(), fakeCalendar([advies("e1", "katharina@example.nl", "Tintorettohof 8, 6663 PP Lent")]))).toBe(1);
    const [a] = await db().select().from(appointments);
    expect(a.trajectId).toBe(r.trajectId);
    expect(a.kind).toBe("advies");
    expect(await stageOf(r.trajectId!)).toBe("offerte_gepland");
    expect((await getIntegration(db(), "google_calendar"))?.config).toMatchObject({ syncTokens: { primary: "tok-1" } });
  });

  it("rode montage 'Fam. Jansen Kerkstraat 12' wordt herkend; meerdaagse montage telt als montagedagen", async () => {
    const r = await intakeLead(db(), lead({ name: "Peter Jansen", phone: "0612345678", street: "Kerkstraat", houseNumber: 12, postcode: "6511AB", city: "Nijmegen" }), {
      provider: "handmatig",
      externalId: uid(),
    });
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "offerte_geaccepteerd", source: "manual" });
    await syncCalendar(db(), fakeCalendar([{ id: "m1", etag: "1", status: "confirmed", summary: "Fam. Jansen Kerkstraat 12", colorId: "11", start: { date: "2026-12-07" }, end: { date: "2026-12-09" } }]));
    expect(await stageOf(r.trajectId!)).toBe("montage_gepland");
    expect((await getTrajectFinance(db(), r.trajectId!)).montageDays).toBe(2);
  });

  it("geannuleerde afspraak wordt 'geannuleerd', niet verwijderd", async () => {
    const r = await intakeLead(db(), lead({ name: "Katharina Klein", email: "katharina@example.nl" }), { provider: "website", externalId: uid() });
    const ev = advies("e1", "katharina@example.nl", "");
    await processEvent(db(), ev, []);
    await processEvent(db(), { ...ev, status: "cancelled" }, []);
    const [a] = await db().select().from(appointments);
    expect(a.status).toBe("geannuleerd");
    expect(a.trajectId).toBe(r.trajectId);
  });

  it("KLAAR-criterium: storing halverwege -> token niet opgeslagen, opnieuw draaien geeft geen dubbelen", async () => {
    await intakeLead(db(), lead({ name: "A Een", email: "a@example.nl" }), { provider: "website", externalId: uid() });
    await intakeLead(db(), lead({ name: "B Twee", email: "b@example.nl" }), { provider: "website", externalId: uid() });
    const cal = fakeCalendar([advies("e1", "a@example.nl", ""), advies("e2", "b@example.nl", "")]);
    cal.failAfter(1);
    await expect(syncCalendar(db(), cal)).rejects.toThrow();
    expect((await getIntegration(db(), "google_calendar"))?.config ?? {}).not.toMatchObject({ syncTokens: { primary: "tok-fail" } });
    await syncCalendar(db(), cal);
    expect(await db().select().from(appointments)).toHaveLength(2);
  });

  it("adviesgesprek in de agenda 'Offerte' (zonder eigen kleur) wordt gekoppeld", async () => {
    const r = await intakeLead(db(), lead({ name: "Katharina Klein", email: "katharina@example.nl" }), { provider: "website", externalId: uid() });
    const offerte = "offerte-agenda@example.nl";
    await setSetting(db(), "calendarRules", { calendars: [{ id: "primary", name: "Werk" }, { id: offerte, name: "Offerte" }] });
    const ev = { ...advies("o1", "katharina@example.nl", "Tintorettohof 8"), colorId: undefined, summary: "Adviesgesprek Steps&Stairs" };
    const cal = fakeCalendar([]);
    cal.changes = async ({ calendarId = "primary" } = {}) => ({ events: calendarId === offerte ? [ev] : [], nextSyncToken: `tok-${calendarId}` });
    expect(await syncCalendar(db(), cal)).toBe(1);
    const [a] = await db().select().from(appointments);
    expect(a.googleCalendarId).toBe(offerte);
    expect(a.trajectId).toBe(r.trajectId);
    expect((await getIntegration(db(), "google_calendar"))?.config).toMatchObject({ syncTokens: { primary: "tok-primary", [offerte]: `tok-${offerte}` } });
  });

  it("oude sync-token van vóór de nieuwe regels wordt genegeerd: alles wordt opnieuw gelezen", async () => {
    await upsertIntegration(db(), "google_calendar", { config: { syncToken: "oud" } });
    const seen: unknown[] = [];
    const cal = fakeCalendar([]);
    cal.changes = async (opts = {}) => {
      seen.push(opts);
      return { events: [], nextSyncToken: "nieuw" };
    };
    await syncCalendar(db(), cal);
    expect(seen.every((o) => !(o as { syncToken?: string }).syncToken)).toBe(true);
  });

  it("montage met alleen een naam ('Fam. Jonker') wordt gekoppeld aan het geaccepteerde traject", async () => {
    const r = await intakeLead(db(), lead({ name: "Piet Jonker", phone: "0612340000" }), { provider: "handmatig", externalId: uid() });
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "offerte_geaccepteerd", source: "manual" });
    await syncCalendar(db(), fakeCalendar([{ id: "j1", etag: "1", status: "confirmed", summary: "Fam. Fam. Jonker", start: { date: "2027-01-05" }, end: { date: "2027-01-07" } }]));
    const [a] = await db().select().from(appointments);
    expect(a.trajectId).toBe(r.trajectId);
    expect(await stageOf(r.trajectId!)).toBe("montage_gepland");
  });

  it("montage met alleen een naam koppelt niet aan een lead, en niet als de naam twee keer voorkomt", async () => {
    const lead1 = await intakeLead(db(), lead({ name: "Anna Bakker", phone: "0612340001" }), { provider: "handmatig", externalId: uid() });
    const a = await intakeLead(db(), lead({ name: "Jan de Vries", phone: "0612340002" }), { provider: "handmatig", externalId: uid() });
    const b = await intakeLead(db(), lead({ name: "Els de Vries", phone: "0612340003", street: "Dorpsstraat", houseNumber: 1, postcode: "1234AB" }), { provider: "handmatig", externalId: uid() });
    for (const t of [a, b]) await changeStage(db(), { trajectId: t.trajectId!, toStage: "offerte_geaccepteerd", source: "manual" });
    await syncCalendar(
      db(),
      fakeCalendar([
        { id: "b1", etag: "1", status: "confirmed", summary: "Fam. Bakker", start: { date: "2027-01-05" }, end: { date: "2027-01-06" } },
        { id: "v1", etag: "1", status: "confirmed", summary: "Fam. de Vries", start: { date: "2027-01-08" }, end: { date: "2027-01-09" } },
      ]),
    );
    const rows = await db().select().from(appointments);
    expect(rows.every((x) => x.trajectId === null)).toBe(true);
    expect(await stageOf(lead1.trajectId!)).toBe("lead");
  });

  it("eerder zonder klant opgeslagen montage wordt bij een nieuwe ronde alsnog gekoppeld", async () => {
    const ev = { id: "k1", etag: "1", status: "confirmed", summary: "Fam. Klimkowska", start: { date: "2026-11-26" }, end: { date: "2026-11-28" } };
    await processEvent(db(), ev, []);
    expect((await db().select().from(appointments))[0].trajectId).toBeNull();
    const r = await intakeLead(db(), lead({ name: "Ola Klimkowska", phone: "0612340004" }), { provider: "handmatig", externalId: uid() });
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "offerte_geaccepteerd", source: "manual" });
    await processEvent(db(), ev, []);
    const rows = await db().select().from(appointments);
    expect(rows).toHaveLength(1);
    expect(rows[0].trajectId).toBe(r.trajectId);
  });

  it("oud adviesgesprek (> 30 dagen) van een onbekende maakt geen nieuwe lead", async () => {
    const ev = { ...advies("old1", "onbekend@example.nl", ""), start: { dateTime: "2026-01-10T10:00:00+01:00" }, end: { dateTime: "2026-01-10T11:00:00+01:00" } };
    await processEvent(db(), ev, []);
    expect(await db().select().from(customers)).toHaveLength(0);
  });

  it("andere afspraken (verkeerde kleur) worden niet opgeslagen", async () => {
    await syncCalendar(db(), fakeCalendar([{ id: "x", status: "confirmed", summary: "Tandarts", colorId: "2", start: { dateTime: "2026-12-01T10:00:00+01:00" }, end: { dateTime: "2026-12-01T11:00:00+01:00" } }]));
    expect(await db().select().from(appointments)).toHaveLength(0);
  });
});

describe("WeFact", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  it("offerte wordt gekoppeld via de herkenningslogica, verkoop excl. btw komt op het traject, status volgt", async () => {
    const r = await intakeLead(db(), lead({ name: "Familie Janssen", email: "janssen@example.nl" }), { provider: "website", externalId: uid() });
    const wf = fakeWefact(
      [{ Identifier: "101", PriceQuoteCode: "OF2026-0080", DebtorCode: "DB13023", SurName: "Janssen", AmountExcl: "6347.10", AmountIncl: "7680.00", Date: today(), Status: "2", Modified: "2026-11-20 10:00:00" }],
      [{ DebtorCode: "DB13023", SurName: "Janssen", EmailAddress: "janssen@example.nl", ZipCode: "6662 ZP", Address: "Kievitshof 48", City: "Elst" }],
    );
    expect(await syncWefact(db(), wf)).toBe(1);
    expect(await stageOf(r.trajectId!)).toBe("offerte_gemaakt");
    expect((await getTrajectFinance(db(), r.trajectId!)).saleExcl).toBe(6347.1);
    const [c] = await db().select().from(customers).where(eq(customers.id, r.customerId));
    expect(c.wefactDebtorCode).toBe("DB13023");
    wf.quotes[0].Status = "3";
    wf.quotes[0].Modified = "2026-11-21 09:00:00";
    await syncWefact(db(), wf);
    expect(await stageOf(r.trajectId!)).toBe("offerte_geaccepteerd");
    expect(await db().select().from(quotes)).toHaveLength(1);
    expect(await db().select().from(customers)).toHaveLength(1);
  });

  it("debiteurnummer gaat voor op herkenning; dezelfde sync twee keer geeft geen dubbelen", async () => {
    const r = await intakeLead(db(), lead({ name: "Piet Pieters", phone: "0612121212" }), { provider: "handmatig", externalId: uid() });
    await db().update(customers).set({ wefactDebtorCode: "DB1" }).where(eq(customers.id, r.customerId));
    const wf = fakeWefact([{ Identifier: "1", PriceQuoteCode: "OF1", DebtorCode: "DB1", AmountExcl: "1000", Date: today(), Status: "0", Modified: "2026-11-20 10:00:00" }], []);
    await syncWefact(db(), wf);
    await syncWefact(db(), wf);
    const qs = await db().select().from(quotes);
    expect(qs).toHaveLength(1);
    expect(qs[0].trajectId).toBe(r.trajectId);
  });
});

describe("dagelijkse controle en reviews", () => {
  async function montageTraject() {
    const r = await intakeLead(db(), lead({ name: "Peter Jansen", email: "peter@example.nl" }), { provider: "handmatig", externalId: uid() });
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "montage_gepland", source: "manual" });
    for (const d of ["2026-12-07", "2026-12-08"])
      await db().insert(appointments).values({ trajectId: r.trajectId, customerId: r.customerId, kind: "montage", title: "Fam. Jansen", startsAt: new Date(`${d}T07:00:00Z`), endsAt: new Date(`${d}T15:00:00Z`) });
    return r;
  }
  const reviewsOn = () => setSetting(db(), "reviews", { ...DEFAULT_SETTINGS.reviews, enabled: true, link: "https://g.page/r/test/review" });

  it("montage die al geweest is (later gekoppeld): ook naar 'In uitvoering', niet ervoor", async () => {
    const r = await montageTraject();
    await runDaily(db(), null, new Date("2026-12-01T08:00:00Z"));
    expect(await stageOf(r.trajectId!)).toBe("montage_gepland");
    await runDaily(db(), null, new Date("2026-12-20T08:00:00Z"));
    expect(await stageOf(r.trajectId!)).toBe("in_uitvoering");
  });

  it("op de eerste montagedag naar 'In uitvoering'", async () => {
    const r = await montageTraject();
    await runDaily(db(), null, new Date("2026-12-07T08:00:00Z"));
    expect(await stageOf(r.trajectId!)).toBe("in_uitvoering");
  });

  it("2 dagen na de laatste montagedag een reviewverzoek (één keer), na 7 dagen een herinnering", async () => {
    await reviewsOn();
    const r = await montageTraject();
    const g = fakeGmail([]);
    await runDaily(db(), g, new Date("2026-12-09T09:00:00Z"));
    expect(g.sent).toHaveLength(0);
    await runDaily(db(), g, new Date("2026-12-10T09:00:00Z"));
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0]).toContain("To: peter@example.nl");
    expect(Buffer.from(g.sent[0].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString()).toContain("https://g.page/r/test/review");
    expect(await stageOf(r.trajectId!)).toBe("review_gestuurd");
    await runDaily(db(), g, new Date("2026-12-11T09:00:00Z"));
    expect(g.sent).toHaveLength(1);
    await runDaily(db(), g, new Date("2026-12-17T09:00:00Z"));
    expect(g.sent).toHaveLength(2);
    await runDaily(db(), g, new Date("2026-12-30T09:00:00Z"));
    expect(g.sent).toHaveLength(2);
  });

  it("geen herinnering als de review al binnen is", async () => {
    await reviewsOn();
    const r = await montageTraject();
    const g = fakeGmail([]);
    await runDaily(db(), g, new Date("2026-12-10T09:00:00Z"));
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "review_ontvangen", source: "manual" });
    await runDaily(db(), g, new Date("2026-12-20T09:00:00Z"));
    expect(g.sent).toHaveLength(1);
  });

  it("reviews staan standaard uit: dan wordt er niets verstuurd", async () => {
    await montageTraject();
    const g = fakeGmail([]);
    await runDaily(db(), g, new Date("2026-12-10T09:00:00Z"));
    expect(g.sent).toHaveLength(0);
  });
});

describe("syncoverzicht", () => {
  it("fout in begrijpelijke taal met wachttijd; daarna weer 'Werkt'", async () => {
    const r1 = await runTracked(db(), "wefact", "incremental", 15, async () => {
      throw new Error("WeFact: Your IP is not allowed (whitelist)");
    });
    expect(r1.ok).toBe(false);
    let row = await getIntegration(db(), "wefact");
    expect(row?.status).toBe("fout");
    expect(row?.lastError).toContain("51.15.84.246");
    await runTracked(db(), "wefact", "incremental", 15, async () => 3);
    row = await getIntegration(db(), "wefact");
    expect(row?.status).toBe("gekoppeld");
    expect(row?.lastError).toBeNull();
  });
});

describe("volledige Gmail-run", () => {
  it("draait alle onderdelen achter elkaar", async () => {
    const g = fakeGmail([leadMail("m1")]);
    expect(await syncGmail(db(), g)).toBeGreaterThanOrEqual(1);
    expect(await db().select().from(trajects).where(eq(trajects.stage, "lead"))).toHaveLength(1);
  });
});
