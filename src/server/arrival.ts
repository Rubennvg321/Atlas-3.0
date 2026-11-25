import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { appointments, arrivalRequests, contactPoints, contacts, customers, trajects } from "@/db/schema";
import { addDays, dayKey, montageDays } from "@/lib/montage-days";
import { buildRawEmail } from "@/lib/mime";
import { queueNotification } from "./notify";
import { getSetting } from "./settings";
import { addTimeline } from "./timeline";
import type { GmailClient } from "./integrations/gmail-client";

/**
 * Aankomsttijd voor een montage:
 *  1. Twee dagen voor de eerste montagedag (vanaf `askHour`) maakt Atlas een vraag aan en
 *     stuurt een pushmelding "Hoe laat kom je aan bij …?" met een link naar /aankomst/<id>.
 *  2. Daar kies je een kwartier (bv. 07:45). Atlas mailt de klant direct via Gmail.
 *  3. Nog niet gekozen om `reminderHour`? Eén herinnering. Zonder keuze gaat er nooit een mail.
 * Alles is idempotent: per traject en montagedag hoogstens één vraag en één mail per gekozen tijd.
 */

/** Fases waarin een montage nog moet beginnen. */
const BEFORE_MONTAGE = ["offerte_geaccepteerd", "montage_gepland", "materiaal_besteld"];

const TZ = "Europe/Amsterdam";
const hourIn = (d: Date) => Number(new Intl.DateTimeFormat("nl-NL", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d));

/** "donderdag 27 november" */
export function formatMontageDate(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("nl-NL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
}

/** "07:45" -> "7.45" (zoals je het in een Nederlandse mail schrijft) */
export function formatTime(t: string) {
  const [h, m] = t.split(":");
  return `${Number(h)}.${m}`;
}

/**
 * Eerste dagen van een montageblok. Een dag telt als begin als in de drie dagen ervoor geen
 * montagedag valt; zo is vrijdag + maandag (weekend ertussen) één opdracht.
 */
export function blockStarts(days: string[]): string[] {
  const set = new Set(days);
  return days.filter((d) => ![1, 2, 3].some((n) => set.has(addDays(d, -n))));
}

function fill(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");
}

async function customerInfo(db: DbOrTx, customerId: string) {
  const [c] = await db.select().from(customers).where(eq(customers.id, customerId));
  const [person] = await db.select().from(contacts).where(and(eq(contacts.customerId, customerId), isNull(contacts.deletedAt))).orderBy(asc(contacts.createdAt));
  const [email] = await db
    .select()
    .from(contactPoints)
    .where(and(eq(contactPoints.customerId, customerId), eq(contactPoints.kind, "email"), isNull(contactPoints.deletedAt)))
    .orderBy(asc(contactPoints.createdAt));
  const family = person?.lastName ? [person.infix, person.lastName].filter(Boolean).join(" ") : null;
  const address = [[c?.street, c?.houseNumber, c?.houseNumberAddition].filter(Boolean).join(" "), c?.city].filter(Boolean).join(", ");
  return {
    displayName: c?.displayName ?? "klant",
    salutation: family ? `familie ${family}` : (c?.displayName ?? "klant"),
    shortName: family ? `fam. ${family}` : (c?.displayName ?? "klant"),
    address: address || null,
    email: email?.normalized ?? null,
  };
}

/** Maakt vragen aan en stuurt herinneringen. Draait elk uur (dagelijkse controle). */
export async function planArrivalRequests(db: DbOrTx, now = new Date()): Promise<number> {
  const s = await getSetting(db, "arrivalMail");
  if (!s.enabled) return 0;
  const today = dayKey(now);
  const hour = hourIn(now);
  let n = 0;

  const active = await db.select().from(trajects).where(and(isNull(trajects.deletedAt), inArray(trajects.stage, BEFORE_MONTAGE)));
  for (const t of active) {
    const apps = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.trajectId, t.id), eq(appointments.kind, "montage"), eq(appointments.status, "gepland"), isNull(appointments.deletedAt)));
    const days = montageDays(apps.map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt, allDay: a.allDay })));
    for (const start of blockStarts(days)) {
      // Twee dagen ervoor vanaf askHour; is de montage later ingepland, dan de dag ervoor meteen.
      const due = (today === addDays(start, -2) && hour >= s.askHour) || today === addDays(start, -1);
      if (!due) continue;
      const [r] = await db
        .insert(arrivalRequests)
        .values({ trajectId: t.id, customerId: t.customerId, montageDate: start, askedAt: now })
        .onConflictDoNothing()
        .returning();
      if (!r) continue;
      const c = await customerInfo(db, t.customerId);
      await queueNotification(db, {
        type: "aankomsttijd",
        refKey: `aankomsttijd:${r.id}`,
        title: `Hoe laat kom je aan bij ${c.shortName}?`,
        body: [`Montage ${formatMontageDate(start)}`, c.address, c.email ? "Tik om een tijd te kiezen; Atlas mailt de klant." : "Let op: geen e-mailadres bekend."]
          .filter(Boolean)
          .join("\n"),
        url: `/aankomst/${r.id}`,
      });
      await addTimeline(db, { customerId: t.customerId, trajectId: t.id, type: "mail", title: `Aankomsttijd gevraagd voor de montage van ${formatMontageDate(start)}` });
      n++;
    }
  }

  // Herinnering: nog open, vandaag gevraagd of eerder, montage nog niet begonnen.
  if (hour >= s.reminderHour) {
    const open = await db.select().from(arrivalRequests).where(and(eq(arrivalRequests.status, "open"), isNull(arrivalRequests.remindedAt)));
    for (const r of open) {
      if (r.montageDate <= today) continue;
      const claimed = await db
        .update(arrivalRequests)
        .set({ remindedAt: now })
        .where(and(eq(arrivalRequests.id, r.id), isNull(arrivalRequests.remindedAt)))
        .returning();
      if (!claimed.length) continue;
      const c = await customerInfo(db, r.customerId);
      await queueNotification(db, {
        type: "aankomsttijd",
        refKey: `aankomsttijd-herinnering:${r.id}`,
        title: `Herinnering: hoe laat kom je aan bij ${c.shortName}?`,
        body: `Montage ${formatMontageDate(r.montageDate)}. De klant heeft nog geen aankomsttijd gekregen.`,
        url: `/aankomst/${r.id}`,
      });
      n++;
    }
  }
  return n;
}

export type ChooseResult = { ok: true; sentTo: string; changed: boolean } | { ok: false; error: string };

/**
 * Je keuze vastleggen en de klant mailen. Kies je later een andere tijd, dan gaat er een
 * nieuwe mail ("Gewijzigd: …"); dezelfde tijd nog eens kiezen doet niets.
 */
export async function chooseArrivalTime(db: DbOrTx, id: string, time: string, gmail: GmailClient | null, now = new Date()): Promise<ChooseResult> {
  const s = await getSetting(db, "arrivalMail");
  if (!s.times.includes(time)) return { ok: false, error: "Kies een van de tijden." };
  const [r] = await db.select().from(arrivalRequests).where(eq(arrivalRequests.id, id));
  if (!r) return { ok: false, error: "Deze vraag bestaat niet (meer)." };
  if (r.montageDate < dayKey(now)) return { ok: false, error: "Deze montage is al begonnen." };
  if (r.status === "versturen") return { ok: false, error: "De mail wordt op dit moment al verstuurd." };
  if (r.status === "verstuurd" && r.sentTime === time) return { ok: true, sentTo: r.sentTo ?? "", changed: false };

  await db.update(arrivalRequests).set({ chosenTime: time, chosenAt: now, status: r.status === "verstuurd" ? "verstuurd" : "gekozen", lastError: null }).where(eq(arrivalRequests.id, id));
  return sendArrivalMail(db, id, gmail, now);
}

/** Verstuurt de mail voor een gekozen tijd (ook gebruikt om een mislukte mail opnieuw te proberen). */
export async function sendArrivalMail(db: DbOrTx, id: string, gmail: GmailClient | null, now = new Date()): Promise<ChooseResult> {
  const [r] = await db.select().from(arrivalRequests).where(eq(arrivalRequests.id, id));
  if (!r?.chosenTime) return { ok: false, error: "Er is nog geen tijd gekozen." };
  if (r.status === "verstuurd" && r.sentTime === r.chosenTime) return { ok: true, sentTo: r.sentTo ?? "", changed: false };
  const c = await customerInfo(db, r.customerId);
  const fail = async (error: string, status: string) => {
    await db.update(arrivalRequests).set({ status, lastError: error }).where(eq(arrivalRequests.id, id));
    return { ok: false as const, error };
  };
  const previous = r.status;
  if (!c.email) return fail("Er is geen e-mailadres van deze klant bekend. Voeg het toe bij de klant en kies dan opnieuw.", "gekozen");
  if (!gmail) return fail("Gmail is niet gekoppeld, dus de mail kon niet worden verstuurd. Atlas probeert het later opnieuw.", "gekozen");

  // Eerst claimen, dan versturen: bij een herstart nooit twee keer dezelfde mail.
  const claimed = await db
    .update(arrivalRequests)
    .set({ status: "versturen" })
    .where(and(eq(arrivalRequests.id, id), eq(arrivalRequests.status, previous)))
    .returning();
  if (!claimed.length) return { ok: false, error: "De mail wordt op dit moment al verstuurd." };

  const s = await getSetting(db, "arrivalMail");
  const changed = !!r.sentTime;
  const vars = { naam: c.salutation, datum: formatMontageDate(r.montageDate), tijd: formatTime(r.chosenTime) };
  const subject = `${changed ? "Gewijzigd: " : ""}${fill(s.subject, vars)}`;
  try {
    await gmail.send(buildRawEmail({ to: c.email, subject, text: fill(s.body, vars) }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(arrivalRequests).set({ status: "gekozen", lastError: msg.slice(0, 300) }).where(eq(arrivalRequests.id, id));
    return { ok: false, error: "Versturen via Gmail lukte niet. Atlas probeert het later automatisch opnieuw." };
  }
  await db
    .update(arrivalRequests)
    .set({ status: "verstuurd", sentAt: now, sentTo: c.email, sentTime: r.chosenTime, lastError: null })
    .where(eq(arrivalRequests.id, id));
  await addTimeline(db, {
    customerId: r.customerId,
    trajectId: r.trajectId,
    type: "mail",
    title: `${changed ? "Gewijzigde aankomsttijd" : "Aankomsttijd"} gemaild naar ${c.email}: ${formatTime(r.chosenTime)} uur op ${vars.datum}`,
  });
  return { ok: true, sentTo: c.email, changed };
}

/** Mails die bij het kiezen niet lukten (Gmail even weg) opnieuw proberen. Draait elk uur. */
export async function retryArrivalMails(db: DbOrTx, gmail: GmailClient | null, now = new Date()): Promise<number> {
  if (!gmail) return 0;
  const today = dayKey(now);
  const rows = await db.select().from(arrivalRequests).where(eq(arrivalRequests.status, "gekozen"));
  let n = 0;
  for (const r of rows) {
    if (r.montageDate < today) continue;
    const res = await sendArrivalMail(db, r.id, gmail, now);
    if (res.ok) n++;
  }
  return n;
}

/** Alles voor het keuzescherm. */
export async function getArrivalRequest(db: DbOrTx, id: string) {
  const [r] = await db.select().from(arrivalRequests).where(eq(arrivalRequests.id, id));
  if (!r) return null;
  const c = await customerInfo(db, r.customerId);
  const s = await getSetting(db, "arrivalMail");
  return { ...r, customer: c, times: s.times, dateLabel: formatMontageDate(r.montageDate) };
}

export async function openArrivalRequests(db: DbOrTx, now = new Date()) {
  const today = dayKey(now);
  const rows = await db
    .select()
    .from(arrivalRequests)
    .where(inArray(arrivalRequests.status, ["open", "gekozen"]))
    .orderBy(asc(arrivalRequests.montageDate));
  const out = [];
  for (const r of rows) if (r.montageDate >= today) out.push({ ...r, customer: await customerInfo(db, r.customerId), dateLabel: formatMontageDate(r.montageDate) });
  return out;
}
