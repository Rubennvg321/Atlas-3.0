import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { appointments, quotes, trajects } from "@/db/schema";
import { intakeLead } from "@/server/intake";
import { changeStage } from "@/server/trajects";
import { setManualFinance } from "@/server/finance";
import { setSetting } from "@/server/settings";
import { getBusinessStats, getUnlinkedAppointments } from "@/server/dashboard";
import { linkAppointmentToCustomer } from "@/server/integrations/calendar-sync";
import { db, lead, resetDb, uid } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

const NOW = new Date("2026-11-15T10:00:00+01:00");

async function traject(name: string, stage: string) {
  const r = await intakeLead(db(), lead({ name, phone: `06${Math.floor(10000000 + Math.random() * 89999999)}` }), { provider: "handmatig", externalId: uid() });
  if (stage !== "lead") await changeStage(db(), { trajectId: r.trajectId!, toStage: stage, source: "manual", ...(stage === "vervallen" ? { lostReason: "te_duur" } : {}) });
  return r.trajectId!;
}

async function montage(trajectId: string, day: string, status = "gepland") {
  await db().insert(appointments).values({
    trajectId,
    kind: "montage",
    title: "Fam. Test",
    startsAt: new Date(`${day}T08:00:00+01:00`),
    endsAt: new Date(`${day}T16:00:00+01:00`),
    status,
  });
}

describe("dashboard: Bedrijfsstand", () => {
  it("telt omzet in de maand van de montage, met de WeFact-offerte als leidend bedrag", async () => {
    // Montage deze maand, geaccepteerde offerte gaat voor een conceptofferte en de handmatige prijs.
    const a = await traject("Klant Een", "in_uitvoering");
    await db().insert(quotes).values([
      { trajectId: a, number: "OF-1", amountExcl: "9999.00", status: "verzonden", quoteDate: new Date("2026-10-01") },
      { trajectId: a, number: "OF-2", amountExcl: "10000.00", status: "geaccepteerd", quoteDate: new Date("2026-09-01") },
    ]);
    await setManualFinance(db(), a, { saleAmountExcl: 1 });
    await montage(a, "2026-11-03");

    // Eerder dit jaar, alleen handmatige prijs.
    const b = await traject("Klant Twee", "review_gestuurd");
    await setManualFinance(db(), b, { saleAmountExcl: 5000 });
    await montage(b, "2026-03-10");

    // Vorig jaar: telt niet mee.
    const c = await traject("Klant Drie", "review_ontvangen");
    await setManualFinance(db(), c, { saleAmountExcl: 7000 });
    await montage(c, "2025-12-20");

    // Gepland na deze maand en één zonder datum/bedrag.
    const d = await traject("Klant Vier", "montage_gepland");
    await setManualFinance(db(), d, { saleAmountExcl: 3000 });
    await montage(d, "2027-01-12");
    await traject("Klant Vijf", "offerte_geaccepteerd");

    // Vervallen: telt nergens mee, ook niet met montage deze maand.
    const e = await traject("Klant Zes", "vervallen");
    await setManualFinance(db(), e, { saleAmountExcl: 8000 });
    await montage(e, "2026-11-20");

    // Geannuleerde montage telt niet.
    const f = await traject("Klant Zeven", "offerte_geaccepteerd");
    await setManualFinance(db(), f, { saleAmountExcl: 2000 });
    await montage(f, "2026-11-25", "geannuleerd");

    const s = await getBusinessStats(db(), NOW);
    expect(s.year).toBe(2026);
    expect(s.revenueMonth).toBe(10000);
    expect(s.revenueYear).toBe(15000);
    expect(s.plannedRevenue).toBe(3000 + 2000); // d + f (zonder geldige montage)
    expect(s.plannedWithoutAmount).toBe(1);
    expect(s.accepted).toBe(4); // a, d, Klant Vijf, f
    expect(s.montagesPlanned).toBe(1); // alleen d ligt na vandaag
    expect(s.targetPct).toBeNull();
  });

  it("nieuwe leads deze maand en percentage van het maanddoel", async () => {
    const a = await traject("Klant Een", "montage_gepland");
    await setManualFinance(db(), a, { saleAmountExcl: 4000 });
    await montage(a, "2026-11-28");
    const old = await traject("Klant Oud", "lead");
    await db().update(trajects).set({ createdAt: new Date("2026-10-31T12:00:00+01:00") }).where(eq(trajects.id, old));
    await setSetting(db(), "dashboard", { monthlyRevenueTarget: 3200 });

    const s = await getBusinessStats(db(), NOW);
    expect(s.newLeadsMonth).toBe(1);
    expect(s.revenueMonth).toBe(4000);
    expect(s.targetPct).toBe(125);
    expect(s.montagesPlanned).toBe(1);
  });
});

describe("dashboard: Afspraken zonder klant", () => {
  it("toont ongekoppelde montages met voorinvulling en koppelt ze bij het aanmaken van de klant", async () => {
    const [a] = await db()
      .insert(appointments)
      .values({
        kind: "montage",
        title: "Fam. Voorbeeld Dorpsstraat 3a",
        startsAt: new Date("2026-12-02T08:00:00+01:00"),
        endsAt: new Date("2026-12-02T16:00:00+01:00"),
        location: "Dorpsstraat 3a, 6511 AB Nijmegen",
        googleEventId: "evt-voorbeeld",
      })
      .returning();
    // Oud (meer dan 60 dagen geleden) en geannuleerd: niet tonen.
    await db().insert(appointments).values([
      { kind: "montage", title: "Fam. Oud", startsAt: new Date("2026-08-01T08:00:00+02:00"), endsAt: new Date("2026-08-01T16:00:00+02:00") },
      { kind: "montage", title: "Fam. Weg", startsAt: new Date("2026-12-05T08:00:00+01:00"), endsAt: new Date("2026-12-05T16:00:00+01:00"), status: "geannuleerd" },
    ]);

    const list = await getUnlinkedAppointments(db(), NOW);
    expect(list.map((x) => x.title)).toEqual(["Fam. Voorbeeld Dorpsstraat 3a"]);
    expect(list[0].prefill).toMatchObject({ appointmentId: a.id, lastName: "Voorbeeld", postcode: "6511AB", houseNumber: "3", city: "Nijmegen" });

    const r = await intakeLead(db(), lead({ name: "Voorbeeld", postcode: "6511AB", houseNumber: 3, addition: "a" }), { provider: "handmatig", externalId: uid() });
    expect(await linkAppointmentToCustomer(db(), a.id, r.customerId, r.trajectId)).toBe(true);
    expect(await linkAppointmentToCustomer(db(), a.id, r.customerId, r.trajectId)).toBe(false); // idempotent

    const [t] = await db().select().from(trajects).where(eq(trajects.id, r.trajectId!));
    expect(t.stage).toBe("montage_gepland");
    expect(await getUnlinkedAppointments(db(), NOW)).toHaveLength(0);
  });
});
