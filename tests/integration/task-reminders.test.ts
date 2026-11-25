import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { notifications, tasks } from "@/db/schema";
import { planTaskReminders } from "@/server/task-reminders";
import { createTask, setTaskDone } from "@/server/tasks";
import { intakeLead } from "@/server/intake";
import { setSetting } from "@/server/settings";
import { amsterdamClock, amsterdamTime } from "@/lib/zoned";
import { db, lead, resetDb, uid } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

async function traject() {
  const r = await intakeLead(db(), lead({ name: "Rik Voorbeeld", email: "rik@example.nl" }), { provider: "handmatig", externalId: uid() });
  return r.trajectId!;
}

describe("Nederlandse tijd", () => {
  it("winter- en zomertijd", () => {
    expect(amsterdamTime("2026-12-01", "14:30").toISOString()).toBe("2026-12-01T13:30:00.000Z");
    expect(amsterdamTime("2026-07-01", "14:30").toISOString()).toBe("2026-07-01T12:30:00.000Z");
    expect(amsterdamClock(new Date("2026-12-01T13:30:00Z"))).toBe("14:30");
  });
});

describe("taakmeldingen", () => {
  it("taak met tijd: melding op dat moment, niet eerder en niet dubbel; link naar het traject", async () => {
    const tid = await traject();
    await createTask(db(), { trajectId: tid, title: "Follow up", dueAt: amsterdamTime("2026-12-01", "14:00"), dueHasTime: true });
    expect(await planTaskReminders(db(), amsterdamTime("2026-12-01", "13:59"))).toBe(0);
    expect(await planTaskReminders(db(), amsterdamTime("2026-12-01", "14:00"))).toBe(1);
    expect(await planTaskReminders(db(), amsterdamTime("2026-12-01", "14:05"))).toBe(0);
    const [n] = await db().select().from(notifications);
    expect(n.title).toBe("Taak: Follow up");
    expect(n.body).toBe("Rik Voorbeeld · vandaag 14:00");
    expect(n.url).toBe(`/trajecten/${tid}`);
  });

  it("taak met alleen een datum: melding om 08:00 op die dag", async () => {
    const tid = await traject();
    await createTask(db(), { trajectId: tid, title: "Bellen", dueAt: amsterdamTime("2026-12-01", "17:00") });
    expect(await planTaskReminders(db(), amsterdamTime("2026-12-01", "07:59"))).toBe(0);
    expect(await planTaskReminders(db(), amsterdamTime("2026-12-01", "08:00"))).toBe(1);
    expect((await db().select().from(notifications))[0].body).toBe("Rik Voorbeeld · vandaag");
  });

  it("deadline verschoven: nieuwe melding voor het nieuwe moment", async () => {
    const tid = await traject();
    const t = await createTask(db(), { trajectId: tid, title: "Follow up", dueAt: amsterdamTime("2026-12-01", "10:00"), dueHasTime: true });
    await planTaskReminders(db(), amsterdamTime("2026-12-01", "10:00"));
    await db().update(tasks).set({ dueAt: amsterdamTime("2026-12-01", "15:00") }).where(eq(tasks.id, t.id));
    expect(await planTaskReminders(db(), amsterdamTime("2026-12-01", "15:00"))).toBe(1);
    expect(await db().select().from(notifications)).toHaveLength(2);
  });

  it("afgeronde taak, te oude taak (> 1 dag) of soort uitgezet: geen melding", async () => {
    const tid = await traject();
    const done = await createTask(db(), { trajectId: tid, title: "Klaar", dueAt: amsterdamTime("2026-12-01", "10:00"), dueHasTime: true });
    await setTaskDone(db(), done.id, true);
    await createTask(db(), { trajectId: tid, title: "Oud", dueAt: amsterdamTime("2026-11-28", "10:00"), dueHasTime: true });
    expect(await planTaskReminders(db(), amsterdamTime("2026-12-01", "11:00"))).toBe(0);

    await setSetting(db(), "notifications", { types: { taak: false } });
    await createTask(db(), { trajectId: tid, title: "Uit", dueAt: amsterdamTime("2026-12-01", "12:00"), dueHasTime: true });
    await planTaskReminders(db(), amsterdamTime("2026-12-01", "12:00"));
    expect((await db().select().from(notifications)).map((n) => n.status)).toEqual(["skipped"]);
  });
});
