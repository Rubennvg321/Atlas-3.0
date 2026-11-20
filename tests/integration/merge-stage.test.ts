import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { contactPoints, customers, duplicateCandidates, stageChanges, tasks, timelineEvents, trajects } from "@/db/schema";
import { intakeLead } from "@/server/intake";
import { markNotSame, mergeCustomers, undoMerge } from "@/server/merge";
import { changeStage } from "@/server/trajects";
import { addNote, createTask } from "@/server/tasks";
import { ConflictError, DomainError } from "@/server/errors";
import { db, lead, resetDb, uid } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

async function twoDoubtCustomers() {
  const a = await intakeLead(db(), lead({ name: "Peter Jansen", email: "p.jansen@ziggo.nl", phone: "0612345678", street: "Kerkstraat", houseNumber: 12, postcode: "6511AB", city: "Nijmegen" }), {
    provider: "handmatig",
    externalId: uid(),
  });
  const b = await intakeLead(db(), lead({ name: "Sanne Bakker", email: "sanne@hotmail.com", phone: "0687654321", postcode: "6511AB", houseNumber: 12 }), {
    provider: "website",
    externalId: uid(),
  });
  expect(b.decision).toBe("doubt");
  return { a, b };
}

describe("samenvoegen", () => {
  it("verplaatst alle gegevens, koppelingen en historie", async () => {
    const { a, b } = await twoDoubtCustomers();
    await createTask(db(), { trajectId: b.trajectId!, title: "Terugbellen" });
    await addNote(db(), { trajectId: b.trajectId!, body: "Wil tapijt" });

    await mergeCustomers(db(), a.customerId, b.customerId);

    const tr = await db().select().from(trajects).where(eq(trajects.customerId, a.customerId));
    expect(tr).toHaveLength(2);
    const cps = await db().select().from(contactPoints).where(eq(contactPoints.customerId, a.customerId));
    expect(cps.map((c) => c.normalized).sort()).toEqual(["+31612345678", "+31687654321", "p.jansen@ziggo.nl", "sanne@hotmail.com"]);
    const tk = await db().select().from(tasks).where(eq(tasks.customerId, a.customerId));
    expect(tk).toHaveLength(1);
    const [merged] = await db().select().from(customers).where(eq(customers.id, b.customerId));
    expect(merged.mergedIntoId).toBe(a.customerId);
    expect(merged.deletedAt).toBeNull(); // niets hard of zacht verwijderd
    const [dc] = await db().select().from(duplicateCandidates);
    expect(dc.status).toBe("merged");
  });

  it("is volledig ongedaan te maken, ook als er daarna nieuwe gegevens bij kwamen", async () => {
    const { a, b } = await twoDoubtCustomers();
    const before = {
      a: (await db().select().from(timelineEvents).where(eq(timelineEvents.customerId, a.customerId))).length,
      b: (await db().select().from(timelineEvents).where(eq(timelineEvents.customerId, b.customerId))).length,
    };
    const m = await mergeCustomers(db(), a.customerId, b.customerId);
    // na samenvoegen nog een taak op het traject van A
    await createTask(db(), { trajectId: a.trajectId!, title: "Offerte maken" });

    await undoMerge(db(), m.id);

    const trB = await db().select().from(trajects).where(eq(trajects.customerId, b.customerId));
    expect(trB.map((t) => t.id)).toEqual([b.trajectId]);
    const cpsB = await db().select().from(contactPoints).where(eq(contactPoints.customerId, b.customerId));
    expect(cpsB.map((c) => c.normalized).sort()).toEqual(["+31687654321", "sanne@hotmail.com"]);
    const tlB = await db().select().from(timelineEvents).where(eq(timelineEvents.customerId, b.customerId));
    expect(tlB.length).toBe(before.b);
    const tkA = await db().select().from(tasks).where(eq(tasks.customerId, a.customerId));
    expect(tkA).toHaveLength(1); // nieuwe taak blijft bij A
    const [merged] = await db().select().from(customers).where(eq(customers.id, b.customerId));
    expect(merged.mergedIntoId).toBeNull();
    const [dc] = await db().select().from(duplicateCandidates);
    expect(dc.status).toBe("open");
    await expect(undoMerge(db(), m.id)).rejects.toThrow(DomainError);
  });

  it("vult lege velden aan en zet die terug bij ongedaan maken", async () => {
    const a = await intakeLead(db(), lead({ name: "Jan Smit", phone: "0622222222" }), { provider: "handmatig", externalId: uid() });
    const b = await intakeLead(db(), lead({ name: "Jan Smidt", phone: "0622222222", street: "Dorpsstraat", houseNumber: 3, postcode: "1234AB", city: "Elst" }), {
      provider: "handmatig",
      externalId: uid(),
    });
    // b is automatisch aan a gekoppeld en heeft adres aangevuld; maak handmatig een tweede klant
    expect(b.customerId).toBe(a.customerId);
    const [c] = await db().insert(customers).values({ displayName: "J. Smit", postcode: "9999ZZ", houseNumber: 1, city: "Ergens", wefactDebtorCode: "DEB001" }).returning();
    await db().update(customers).set({ postcode: null, houseNumber: null, city: null, street: null }).where(eq(customers.id, a.customerId));
    const m = await mergeCustomers(db(), a.customerId, c.id);
    let [s] = await db().select().from(customers).where(eq(customers.id, a.customerId));
    expect(s.postcode).toBe("9999ZZ");
    expect(s.wefactDebtorCode).toBe("DEB001");
    await undoMerge(db(), m.id);
    [s] = await db().select().from(customers).where(eq(customers.id, a.customerId));
    expect(s.postcode).toBeNull();
    expect(s.wefactDebtorCode).toBeNull();
    const [cc] = await db().select().from(customers).where(eq(customers.id, c.id));
    expect(cc.wefactDebtorCode).toBe("DEB001");
  });

  it("weigert samenvoegen met zichzelf of een al samengevoegde klant", async () => {
    const { a, b } = await twoDoubtCustomers();
    await expect(mergeCustomers(db(), a.customerId, a.customerId)).rejects.toThrow(DomainError);
    await mergeCustomers(db(), a.customerId, b.customerId);
    await expect(mergeCustomers(db(), a.customerId, b.customerId)).rejects.toThrow(DomainError);
  });

  it("'Niet dezelfde' overschrijft een open melding en blijft staan bij nieuwe matches", async () => {
    const { a, b } = await twoDoubtCustomers();
    await markNotSame(db(), b.customerId, a.customerId);
    // nieuwe aanvraag die beide raakt verandert de status niet
    await intakeLead(db(), lead({ name: "Iemand Anders", postcode: "6511AB", houseNumber: 12 }), { provider: "website", externalId: uid() });
    const rows = await db().select().from(duplicateCandidates);
    const pair = rows.find((r) => [r.customerAId, r.customerBId].sort().join() === [a.customerId, b.customerId].sort().join())!;
    expect(pair.status).toBe("not_same");
  });
});

describe("fasewijziging (KLAAR-criterium: slepen = dropdown)", () => {
  async function newTraject() {
    const r = await intakeLead(db(), lead({ name: "Eva Hendriks", email: "eva@xs4all.nl" }), { provider: "handmatig", externalId: uid() });
    return r.trajectId!;
  }

  it("wijzigt het ene fase-veld en logt wie/wanneer/van/naar/hoe", async () => {
    const id = await newTraject();
    const t = await changeStage(db(), { trajectId: id, toStage: "offerte_gepland", source: "manual", expectedVersion: 1 });
    expect(t.stage).toBe("offerte_gepland");
    expect(t.version).toBe(2);
    const log = await db().select().from(stageChanges).where(eq(stageChanges.trajectId, id)).orderBy(stageChanges.createdAt);
    expect(log.map((l) => [l.fromStage, l.toStage, l.source])).toEqual([
      [null, "lead", "manual"],
      ["lead", "offerte_gepland", "manual"],
    ]);
  });

  it("verouderde versie (tweede apparaat) geeft een conflict en wijzigt niets", async () => {
    const id = await newTraject();
    await changeStage(db(), { trajectId: id, toStage: "offerte_gepland", source: "manual", expectedVersion: 1 }); // apparaat 1 (slepen)
    await expect(changeStage(db(), { trajectId: id, toStage: "offerte_gemaakt", source: "manual", expectedVersion: 1 })).rejects.toThrow(ConflictError); // apparaat 2 (dropdown, oud scherm)
    const [t] = await db().select().from(trajects).where(eq(trajects.id, id));
    expect(t.stage).toBe("offerte_gepland");
  });

  it("gelijktijdige wijzigingen: precies één slaagt", async () => {
    const id = await newTraject();
    const results = await Promise.allSettled([
      changeStage(db(), { trajectId: id, toStage: "offerte_gepland", source: "manual", expectedVersion: 1 }),
      changeStage(db(), { trajectId: id, toStage: "offerte_gemaakt", source: "manual", expectedVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const log = await db().select().from(stageChanges).where(eq(stageChanges.trajectId, id));
    expect(log).toHaveLength(2);
  });

  it("Vervallen vereist een reden, 'anders' vereist toelichting", async () => {
    const id = await newTraject();
    await expect(changeStage(db(), { trajectId: id, toStage: "vervallen", source: "manual" })).rejects.toThrow(/reden/);
    await expect(changeStage(db(), { trajectId: id, toStage: "vervallen", source: "manual", lostReason: "anders" })).rejects.toThrow(/toelichting/);
    const t = await changeStage(db(), { trajectId: id, toStage: "vervallen", source: "manual", lostReason: "te_duur" });
    expect(t.lostReason).toBe("te_duur");
    // terugzetten wist de reden
    const t2 = await changeStage(db(), { trajectId: id, toStage: "offerte_gemaakt", source: "manual" });
    expect(t2.lostReason).toBeNull();
  });

  it("zelfde fase opnieuw kiezen doet niets", async () => {
    const id = await newTraject();
    const t = await changeStage(db(), { trajectId: id, toStage: "lead", source: "manual" });
    expect(t.version).toBe(1);
  });

  it("onbekende fase wordt geweigerd", async () => {
    const id = await newTraject();
    await expect(changeStage(db(), { trajectId: id, toStage: "bestaatniet", source: "manual" })).rejects.toThrow(DomainError);
  });
});
