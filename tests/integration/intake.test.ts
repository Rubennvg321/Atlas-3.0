import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb } from "@/db";
import { contactPoints, contacts, customers, duplicateCandidates, inboundItems, trajects } from "@/db/schema";
import { parseWebsiteForm } from "@/lib/intake/website-form";
import { intakeLead } from "@/server/intake";
import { changeStage } from "@/server/trajects";
import { markNotSame } from "@/server/merge";
import { db, lead, resetDb, uid } from "./helpers";

const fixture = readFileSync(path.join(__dirname, "../fixtures/aanvraag-website.txt"), "utf8");

beforeEach(resetDb);
afterAll(closeDb);

async function countCustomers() {
  return (await db().select().from(customers).where(isNull(customers.mergedIntoId))).length;
}

describe("intake: nieuwe aanvraag", () => {
  it("echte aanvraagmail wordt een nieuwe klant met traject in Lead", async () => {
    const l = parseWebsiteForm(fixture)!;
    const r = await intakeLead(db(), l, { provider: "website", externalId: "gmail-1" });
    expect(r.decision).toBe("none");
    expect(r.createdCustomer).toBe(true);
    const [t] = await db().select().from(trajects).where(eq(trajects.id, r.trajectId!));
    expect(t.stage).toBe("lead");
    expect(t.referral).toBe("Google");
    const [c] = await db().select().from(customers).where(eq(customers.id, r.customerId));
    expect(c.displayName).toBe("Katharina Klein");
    expect(c.postcode).toBe("6663PP");
    expect(c.city).toBe("Lent");
  });

  it("dezelfde mail twee keer verwerken geeft geen dubbele klant of traject (idempotent)", async () => {
    const l = parseWebsiteForm(fixture)!;
    const a = await intakeLead(db(), l, { provider: "website", externalId: "gmail-1" });
    const b = await intakeLead(db(), l, { provider: "website", externalId: "gmail-1" });
    expect(b.alreadyProcessed).toBe(true);
    expect(b.customerId).toBe(a.customerId);
    expect(await countCustomers()).toBe(1);
    expect((await db().select().from(trajects)).length).toBe(1);
  });

  it("gelijktijdige verwerking van dezelfde mail geeft één klant", async () => {
    const l = parseWebsiteForm(fixture)!;
    await Promise.all([1, 2, 3].map(() => intakeLead(db(), l, { provider: "website", externalId: "gmail-race" })));
    expect(await countCustomers()).toBe(1);
  });

  it("twee verschillende mails van dezelfde persoon tegelijk geven één klant", async () => {
    const l = parseWebsiteForm(fixture)!;
    await Promise.all([intakeLead(db(), l, { provider: "website", externalId: "m1" }), intakeLead(db(), l, { provider: "website", externalId: "m2" })]);
    expect(await countCustomers()).toBe(1);
  });
});

describe("KLAAR-criterium: aanvraag van bestaande klant met ander e-mailadres", () => {
  it("komt op het bestaande traject binnen (zelfde telefoon + naam)", async () => {
    const eerste = await intakeLead(
      db(),
      lead({ name: "Katharina Klein", email: "katharina.klein@web.de", phone: "06-57896904", street: "Tintorettohof", houseNumber: 8, postcode: "6663 PP", city: "Lent" }),
      { provider: "handmatig", externalId: uid() },
    );
    const aanvraag = parseWebsiteForm(fixture)!; // ander e-mailadres (met 'i'), geen huisnummer
    const r = await intakeLead(db(), aanvraag, { provider: "website", externalId: "gmail-2" });
    expect(r.decision).toBe("auto");
    expect(r.customerId).toBe(eerste.customerId);
    expect(r.trajectId).toBe(eerste.trajectId); // lopend traject, geen nieuw
    expect(r.createdTraject).toBe(false);
    expect(await countCustomers()).toBe(1);
    // nieuw e-mailadres is toegevoegd aan de klant
    const emails = await db().select().from(contactPoints).where(and(eq(contactPoints.customerId, eerste.customerId), eq(contactPoints.kind, "email")));
    expect(emails.map((e) => e.normalized).sort()).toEqual(["katharina.klein@web.de", "katharinai.klein@web.de"]);
  });

  it("partner met eigen naam en e-mail op hetzelfde adres: 'Mogelijk dubbel'", async () => {
    const jansen = await intakeLead(
      db(),
      lead({ name: "Peter Jansen", email: "p.jansen@ziggo.nl", phone: "0612345678", street: "Kerkstraat", houseNumber: 12, postcode: "6511AB", city: "Nijmegen" }),
      { provider: "handmatig", externalId: uid() },
    );
    const r = await intakeLead(
      db(),
      lead({ name: "Sanne Bakker", email: "sanne.b@hotmail.com", phone: "0687654321", street: "Kerkstraat", houseNumber: 12, postcode: "6511 ab", city: "Nijmegen" }),
      { provider: "website", externalId: uid() },
    );
    expect(r.decision).toBe("doubt");
    expect(r.duplicateOf).toEqual([jansen.customerId]);
    const dc = await db().select().from(duplicateCandidates);
    expect(dc).toHaveLength(1);
    expect(dc[0].status).toBe("open");
  });

  it("afgeronde klus (review ontvangen) + nieuwe aanvraag: zelfde klant, nieuw traject", async () => {
    const eerste = await intakeLead(db(), lead({ name: "Henk de Vries", phone: "0611111111", email: "henk@devries.nl" }), { provider: "handmatig", externalId: uid() });
    await changeStage(db(), { trajectId: eerste.trajectId!, toStage: "review_ontvangen", source: "manual" });
    const r = await intakeLead(db(), lead({ name: "H. de Vries", phone: "+31611111111", email: "h.devries@gmail.com" }), { provider: "website", externalId: uid() });
    expect(r.decision).toBe("auto");
    expect(r.customerId).toBe(eerste.customerId);
    expect(r.createdTraject).toBe(true);
    expect(r.trajectId).not.toBe(eerste.trajectId);
  });

  it("partner via telefoon automatisch gekoppeld wordt extra contactpersoon", async () => {
    const eerste = await intakeLead(
      db(),
      lead({ name: "Peter Jansen", phone: "0612345678", street: "Kerkstraat", houseNumber: 12, postcode: "6511AB" }),
      { provider: "handmatig", externalId: uid() },
    );
    // Sanne gebruikt het vaste nummer/zelfde mobiel en woont op hetzelfde adres -> 100 punten
    const r = await intakeLead(db(), lead({ name: "Sanne Bakker", phone: "06 12 34 56 78", street: "Kerkstraat", houseNumber: 12, postcode: "6511AB" }), {
      provider: "website",
      externalId: uid(),
    });
    expect(r.decision).toBe("auto");
    const cts = await db().select().from(contacts).where(eq(contacts.customerId, eerste.customerId));
    expect(cts.map((c) => c.lastName).sort()).toEqual(["Bakker", "Jansen"]);
  });

  it("'Niet dezelfde' wordt onthouden", async () => {
    const a = await intakeLead(db(), lead({ name: "Peter Jansen", postcode: "6511AB", houseNumber: 12 }), { provider: "handmatig", externalId: uid() });
    const b = await intakeLead(db(), lead({ name: "Fatima El Amrani", postcode: "6511AB", houseNumber: 12 }), { provider: "handmatig", externalId: uid() });
    expect(b.decision).toBe("doubt");
    await markNotSame(db(), a.customerId, b.customerId);
    // Nieuwe aanvraag van Fatima: hoort bij Fatima (auto), niet opnieuw twijfel
    const c = await intakeLead(db(), lead({ name: "Fatima El Amrani", postcode: "6511AB", houseNumber: 12, phone: "0699999999" }), {
      provider: "website",
      externalId: uid(),
    });
    expect(c.decision).toBe("auto");
    expect(c.customerId).toBe(b.customerId);
    const [dc] = await db().select().from(duplicateCandidates);
    expect(dc.status).toBe("not_same");
  });

  it("legt elke verwerking vast in inbound_items", async () => {
    await intakeLead(db(), parseWebsiteForm(fixture)!, { provider: "website", externalId: "gmail-9" });
    const [it] = await db().select().from(inboundItems);
    expect(it.status).toBe("done");
    expect(it.decision).toBe("none");
  });
});
