import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { appointments, arrivalRequests, notifications, timelineEvents } from "@/db/schema";
import { blockStarts, chooseArrivalTime, planArrivalRequests, retryArrivalMails } from "@/server/arrival";
import { intakeLead } from "@/server/intake";
import { changeStage } from "@/server/trajects";
import { db, lead, resetDb, uid } from "./helpers";
import { fakeGmail } from "./fakes";

beforeEach(resetDb);
afterAll(closeDb);

/** Leest een verstuurde mail terug (de nagebootste Gmail bewaart hem al gedecodeerd): onderwerp en tekst. */
function readMail(msg: string) {
  const [head, body] = msg.split("\r\n\r\n");
  const subj = head.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)?.[1] ?? "";
  return {
    to: head.match(/^To: (.+)$/m)?.[1],
    subject: Buffer.from(subj, "base64").toString("utf8"),
    text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"),
  };
}

/** Klant met traject in "Montage gepland" en een montage op de gegeven dag(en). */
async function montage(days: string[], opts: { email?: string | null; stage?: string; name?: string; houseNumber?: number } = {}) {
  const email = opts.email === undefined ? "peter@example.nl" : opts.email;
  const r = await intakeLead(db(), lead({ name: opts.name ?? "Peter Jansen", ...(email ? { email } : { phone: "0612345678" }), street: "Kerkstraat", houseNumber: opts.houseNumber ?? 12, postcode: "6511AB", city: "Nijmegen" }), {
    provider: "handmatig",
    externalId: uid(),
  });
  await changeStage(db(), { trajectId: r.trajectId!, toStage: opts.stage ?? "montage_gepland", source: "manual" });
  for (const d of days) {
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    await db().insert(appointments).values({
      trajectId: r.trajectId,
      customerId: r.customerId,
      kind: "montage",
      title: "Fam. Jansen",
      allDay: true,
      startsAt: new Date(`${d}T00:00:00+01:00`),
      endsAt: new Date(`${next.toISOString().slice(0, 10)}T00:00:00+01:00`),
    });
  }
  return r;
}
// Nederlandse tijd in november/december = UTC+1
const at = (day: string, hour: number) => new Date(`${day}T${String(hour - 1).padStart(2, "0")}:00:00Z`);

describe("aankomsttijd", () => {
  it("begin van een opdracht: vrijdag + maandag is één opdracht, een week later een nieuwe", () => {
    expect(blockStarts(["2026-12-04", "2026-12-07", "2026-12-08", "2026-12-14"])).toEqual(["2026-12-04", "2026-12-14"]);
  });

  it("twee dagen ervoor vanaf 8 uur één vraag met pushmelding; niet eerder, niet dubbel", async () => {
    await montage(["2026-12-10", "2026-12-11"]);
    expect(await planArrivalRequests(db(), at("2026-12-08", 7))).toBe(0);
    expect(await planArrivalRequests(db(), at("2026-12-08", 9))).toBe(1);
    expect(await planArrivalRequests(db(), at("2026-12-08", 10))).toBe(0);
    const [r] = await db().select().from(arrivalRequests);
    expect(r.montageDate).toBe("2026-12-10");
    const [n] = await db().select().from(notifications);
    expect(n.title).toBe("Hoe laat kom je aan bij fam. Jansen?");
    expect(n.url).toBe(`/aankomst/${r.id}`);
    expect(n.body).toContain("donderdag 10 december");
  });

  it("montage pas de dag ervoor ingepland: meteen vragen; geen vraag voor een lead of een al begonnen montage", async () => {
    await montage(["2026-12-10"]);
    await montage(["2026-12-10"], { stage: "lead", email: "anna@example.nl", name: "Anna Bakker", houseNumber: 99 });
    expect(await planArrivalRequests(db(), at("2026-12-09", 6))).toBe(1);
    expect(await planArrivalRequests(db(), at("2026-12-10", 9))).toBe(0);
    expect(await db().select().from(arrivalRequests)).toHaveLength(1);
  });

  it("kiezen -> klant krijgt mail met de tijd; zelfde tijd nog eens doet niets; andere tijd -> 'Gewijzigd'-mail", async () => {
    const t = await montage(["2026-12-10"]);
    await planArrivalRequests(db(), at("2026-12-08", 9));
    const [r] = await db().select().from(arrivalRequests);
    const g = fakeGmail([]);
    const res = await chooseArrivalTime(db(), r.id, "07:45", g, at("2026-12-08", 9));
    expect(res).toEqual({ ok: true, sentTo: "peter@example.nl", changed: false });
    expect(g.sent).toHaveLength(1);
    const m = readMail(g.sent[0]);
    expect(m.to).toBe("peter@example.nl");
    expect(m.subject).toBe("Uw traprenovatie op donderdag 10 december");
    expect(m.text).toContain("Beste familie Jansen");
    expect(m.text).toContain("om 7.45 uur");

    await chooseArrivalTime(db(), r.id, "07:45", g, at("2026-12-08", 10));
    expect(g.sent).toHaveLength(1);

    const res2 = await chooseArrivalTime(db(), r.id, "08:15", g, at("2026-12-08", 11));
    expect(res2).toMatchObject({ ok: true, changed: true });
    expect(g.sent).toHaveLength(2);
    expect(readMail(g.sent[1]).subject).toMatch(/^Gewijzigd: /);
    expect(readMail(g.sent[1]).text).toContain("om 8.15 uur");

    const tl = await db().select().from(timelineEvents).where(eq(timelineEvents.trajectId, t.trajectId!));
    expect(tl.some((e) => e.title.startsWith("Aankomsttijd gemaild naar peter@example.nl: 7.45 uur"))).toBe(true);
    expect(tl.some((e) => e.title.startsWith("Gewijzigde aankomsttijd"))).toBe(true);
  });

  it("onbekende tijd wordt geweigerd", async () => {
    await montage(["2026-12-10"]);
    await planArrivalRequests(db(), at("2026-12-08", 9));
    const [r] = await db().select().from(arrivalRequests);
    expect(await chooseArrivalTime(db(), r.id, "06:00", fakeGmail([]), at("2026-12-08", 9))).toMatchObject({ ok: false });
  });

  it("geen e-mailadres: geen mail, duidelijke melding", async () => {
    await montage(["2026-12-10"], { email: null });
    await planArrivalRequests(db(), at("2026-12-08", 9));
    const [r] = await db().select().from(arrivalRequests);
    const g = fakeGmail([]);
    const res = await chooseArrivalTime(db(), r.id, "08:00", g, at("2026-12-08", 9));
    expect(res.ok).toBe(false);
    expect(g.sent).toHaveLength(0);
    expect((await db().select().from(notifications))[0].body).toContain("geen e-mailadres");
  });

  it("Gmail even weg: keuze blijft bewaard en de mail gaat later alsnog (één keer)", async () => {
    await montage(["2026-12-10"]);
    await planArrivalRequests(db(), at("2026-12-08", 9));
    const [r] = await db().select().from(arrivalRequests);
    expect((await chooseArrivalTime(db(), r.id, "07:30", null, at("2026-12-08", 9))).ok).toBe(false);
    expect((await db().select().from(arrivalRequests))[0].status).toBe("gekozen");
    const g = fakeGmail([]);
    expect(await retryArrivalMails(db(), g, at("2026-12-08", 10))).toBe(1);
    expect(await retryArrivalMails(db(), g, at("2026-12-08", 11))).toBe(0);
    expect(g.sent).toHaveLength(1);
    expect(readMail(g.sent[0]).text).toContain("om 7.30 uur");
  });

  it("nog niet gekozen om 16 uur: één herinnering", async () => {
    await montage(["2026-12-10"]);
    await planArrivalRequests(db(), at("2026-12-08", 9));
    await planArrivalRequests(db(), at("2026-12-08", 15));
    expect(await db().select().from(notifications)).toHaveLength(1);
    await planArrivalRequests(db(), at("2026-12-08", 16));
    await planArrivalRequests(db(), at("2026-12-08", 17));
    const ns = await db().select().from(notifications);
    expect(ns).toHaveLength(2);
    expect(ns.some((n) => n.title.startsWith("Herinnering: hoe laat kom je aan"))).toBe(true);
  });
});
