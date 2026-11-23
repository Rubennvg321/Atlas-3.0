import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { appointments, trajects } from "@/db/schema";
import { intakeLead } from "@/server/intake";
import { changeStage } from "@/server/trajects";
import { relinkUnlinkedAppointments, syncCalendar } from "@/server/integrations/calendar-sync";
import type { CalendarClient, CalendarEvent } from "@/server/integrations/calendar-client";
import { db, lead, resetDb, uid } from "./helpers";
import { OWN } from "./fakes";

beforeEach(resetDb);
afterAll(closeDb);

/** Zoals Google: de eerste keer alles, daarna alleen wijzigingen (hier: geen). */
function onlyChangesCalendar(events: CalendarEvent[]): CalendarClient {
  const seen = new Set<string>();
  return {
    account: OWN,
    async changes({ calendarId = "primary" } = {}) {
      if (calendarId !== "primary" || seen.has(calendarId)) return { events: [], nextSyncToken: `tok-${calendarId}-2` };
      seen.add(calendarId);
      return { events, nextSyncToken: `tok-${calendarId}-1` };
    },
  };
}

const stageOf = async (id: string) => (await db().select().from(trajects).where(eq(trajects.id, id)))[0].stage;
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("afspraak die er al was voordat de klant in Atlas kwam", () => {
  it("rode montage: wordt alsnog gekoppeld zodra de klant er is, ook als de afspraak niet meer verandert", async () => {
    const cal = onlyChangesCalendar([
      { id: "m1", etag: "1", status: "confirmed", summary: "Fam. Pater Kerkstraat 12", colorId: "11", start: { date: inDays(10) }, end: { date: inDays(11) } },
    ]);
    await syncCalendar(db(), cal);
    const [los] = await db().select().from(appointments);
    expect(los.customerId).toBeNull();

    // Pater komt later in Atlas (bijv. via WeFact of handmatig)
    const r = await intakeLead(db(), lead({ name: "Jan Pater", phone: "0611119999", street: "Kerkstraat", houseNumber: 12, postcode: "6511AB", city: "Nijmegen" }), {
      provider: "handmatig",
      externalId: uid(),
    });
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "offerte_geaccepteerd", source: "manual" });

    await syncCalendar(db(), cal); // Google stuurt niets nieuws
    const [a] = await db().select().from(appointments);
    expect(a.customerId).toBe(r.customerId);
    expect(a.trajectId).toBe(r.trajectId);
    expect(await stageOf(r.trajectId!)).toBe("montage_gepland");
  });

  it("geel adviesgesprek: de gast-e-mail wordt bewaard en later gebruikt om te koppelen", async () => {
    // Een adviesgesprek van ruim een maand geleden maakt zelf geen nieuwe klant aan
    const cal = onlyChangesCalendar([
      {
        id: "a1",
        etag: "1",
        status: "confirmed",
        summary: "Advies gesprek Steps&Stairs",
        colorId: "5",
        attendees: [{ email: OWN, self: true }, { email: "pater@example.nl" }],
        start: { dateTime: `${inDays(-40)}T10:00:00+01:00` },
        end: { dateTime: `${inDays(-40)}T11:00:00+01:00` },
      },
    ]);
    await syncCalendar(db(), cal);
    const [los] = await db().select().from(appointments);
    expect(los.customerId).toBeNull();
    expect(los.attendeeEmails).toEqual(["pater@example.nl"]);

    const r = await intakeLead(db(), lead({ name: "Jan Pater", email: "Pater@Example.nl" }), { provider: "handmatig", externalId: uid() });
    expect(await relinkUnlinkedAppointments(db())).toBe(1);
    const [a] = await db().select().from(appointments);
    expect(a.customerId).toBe(r.customerId);
    expect(await stageOf(r.trajectId!)).toBe("offerte_gepland");
    expect(await relinkUnlinkedAppointments(db())).toBe(0); // idempotent
  });

  it("twijfelgeval (twee klanten met dezelfde naam, geen adres) blijft los staan", async () => {
    const cal = onlyChangesCalendar([
      { id: "m2", etag: "1", status: "confirmed", summary: "Fam. Pater", colorId: "11", start: { date: inDays(5) }, end: { date: inDays(6) } },
    ]);
    await syncCalendar(db(), cal);
    for (const [n, p] of [["Jan Pater", "0611110001"], ["Piet Pater", "0611110002"]]) {
      const r = await intakeLead(db(), lead({ name: n, phone: p }), { provider: "handmatig", externalId: uid() });
      await changeStage(db(), { trajectId: r.trajectId!, toStage: "offerte_geaccepteerd", source: "manual" });
    }
    await syncCalendar(db(), cal);
    const [a] = await db().select().from(appointments);
    expect(a.customerId).toBeNull();
  });
});
