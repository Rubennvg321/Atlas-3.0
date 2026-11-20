import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { appointments } from "@/db/schema";
import { classifyEvent, type ParsedAddress } from "@/lib/parsers/calendar";
import { scoreMatch, type MatchProfile } from "@/lib/matching/score";
import { splitDutchName, streetKey } from "@/lib/normalize";
import type { LeadInput } from "@/lib/intake/types";
import { findCandidateIds, loadProfiles, matchProfile } from "../customers";
import { intakeLead } from "../intake";
import { applyStageEvent } from "../automation";
import { findOpenTraject, createTraject } from "../trajects";
import { getMatchSettings, getSetting } from "../settings";
import { addTimeline } from "../timeline";
import type { CalendarClient, CalendarEvent } from "./calendar-client";
import { cfg, getIntegration, upsertIntegration } from "./state";

const CAL_ID = "primary";

function times(e: CalendarEvent) {
  const allDay = !!e.start?.date && !e.start?.dateTime;
  const startsAt = new Date(e.start?.dateTime ?? `${e.start?.date}T00:00:00+01:00`);
  const endsAt = new Date(e.end?.dateTime ?? `${e.end?.date ?? e.start?.date}T00:00:00+01:00`);
  return { startsAt, endsAt, allDay };
}

function addressProfile(a: ParsedAddress | null): Pick<MatchProfile, "postcode" | "houseNumber" | "addition" | "streetKey" | "city"> {
  return { postcode: a?.postcode ?? null, houseNumber: a?.houseNumber ?? null, addition: a?.addition ?? null, streetKey: streetKey(a?.street), city: a?.city ?? null };
}

/** Lopend traject van de klant; anders een nieuw traject in Lead. */
async function trajectFor(db: DbOrTx, customerId: string) {
  const open = await findOpenTraject(db, customerId);
  if (open.length) return open[0].id;
  const t = await createTraject(db, { customerId, stage: "lead", source: "agenda" }, { source: "automatic" });
  return t.id;
}

/** Montage: probeer elke splitsing "naam | straat" en kies de beste duidelijke match. */
async function matchMontage(db: DbOrTx, cands: { name: string; street: string | null; houseNumber: number | null; addition: string | null }[], loc: ParsedAddress | null) {
  const s = await getMatchSettings(db);
  let best: { customerId: string; score: number } | null = null;
  let second = 0;
  for (const c of cands) {
    const person = splitDutchName(`fam. ${c.name}`);
    const profile: MatchProfile = {
      emails: [],
      phones: [],
      ...addressProfile(loc),
      ...(c.street ? { streetKey: streetKey(c.street), houseNumber: c.houseNumber, addition: c.addition } : {}),
      names: person.lastName ? [{ infix: person.infix, lastName: person.lastName }] : [],
    };
    if (!profile.streetKey && !profile.postcode) continue;
    const ids = await findCandidateIds(db, profile, { ...s, nameOnlyCap: Math.max(s.nameOnlyCap, s.doubtThreshold) });
    const profiles = await loadProfiles(db, ids);
    for (const [customerId, p] of profiles) {
      const r = scoreMatch(profile, p, s);
      if (!best || r.score > best.score) {
        if (best && best.customerId !== customerId) second = Math.max(second, best.score);
        best = { customerId, score: r.score };
      } else if (best.customerId !== customerId) second = Math.max(second, r.score);
    }
  }
  if (best && best.score >= s.autoThreshold && best.score > second) return best.customerId;
  return null;
}

export async function processEvent(db: DbOrTx, e: CalendarEvent, own: string[]): Promise<boolean> {
  const rules = await getSetting(db, "calendarRules");
  const [existing] = await db.select().from(appointments).where(and(eq(appointments.googleCalendarId, CAL_ID), eq(appointments.googleEventId, e.id)));

  if (e.status === "cancelled") {
    if (existing && existing.status !== "geannuleerd") {
      await db.update(appointments).set({ status: "geannuleerd", updatedAt: new Date() }).where(eq(appointments.id, existing.id));
      if (existing.customerId)
        await addTimeline(db, { customerId: existing.customerId, trajectId: existing.trajectId, type: "afspraak", title: `Afspraak geannuleerd: ${existing.title}` });
      return true;
    }
    return false;
  }

  const cls = classifyEvent(
    { summary: e.summary ?? null, colorId: e.colorId ?? null, location: e.location ?? null, attendees: (e.attendees ?? []).filter((a) => !a.self).map((a) => a.email ?? ""), ownEmails: own },
    { advies: rules.advies, montage: rules.montage },
  );
  if (cls.kind === "overig") {
    // Was het eerder een klantafspraak en is het label/titel veranderd? Dan niet meer meetellen.
    if (existing && existing.status !== "geannuleerd") await db.update(appointments).set({ status: "geannuleerd", updatedAt: new Date() }).where(eq(appointments.id, existing.id));
    return false;
  }

  const { startsAt, endsAt, allDay } = times(e);
  if (existing) {
    // Bestaande afspraak: tijd/locatie bijwerken (Google is leidend), koppeling behouden.
    if (existing.googleEtag === e.etag && existing.status === "gepland") return false;
    await db
      .update(appointments)
      .set({ title: e.summary ?? existing.title, startsAt, endsAt, allDay, location: e.location ?? null, status: "gepland", googleEtag: e.etag ?? null, updatedAt: new Date() })
      .where(eq(appointments.id, existing.id));
    if (existing.trajectId) await applyStageEvent(db, existing.trajectId, cls.kind === "advies" ? "adviesgesprek_gepland" : "montage_gepland", { refType: "appointment", refId: e.id });
    return true;
  }

  let customerId: string | null = null;
  if (cls.kind === "advies") {
    const lead: LeadInput = {
      name: null,
      person: { firstName: null, infix: null, lastName: null },
      emails: cls.emails,
      phones: [],
      street: cls.address?.street ?? null,
      houseNumber: cls.address?.houseNumber ?? null,
      addition: cls.address?.addition ?? null,
      postcode: cls.address?.postcode ?? null,
      city: cls.address?.city ?? null,
    };
    if (!lead.emails.length && !lead.postcode && !lead.street) {
      customerId = null;
    } else {
      const m = await matchProfile(db, { emails: lead.emails, phones: [], ...addressProfile(cls.address), names: [] });
      if (m.decision === "auto" && m.best) customerId = m.best.customerId;
      // Uitnodiging naar het e-mailadres van precies één bekende klant: dat ís die klant.
      else if (m.decision === "doubt" && m.doubts.length === 1 && m.doubts[0].result.signals.some((x) => x.key === "email"))
        customerId = m.doubts[0].customerId;
      else {
        const r = await intakeLead(db, lead, { provider: "agenda", externalId: `gcal:${e.id}`, traject: "none" });
        customerId = r.customerId;
      }
    }
  } else {
    customerId = await matchMontage(db, cls.nameCandidates, cls.address);
  }

  const trajectId = customerId ? await trajectFor(db, customerId) : null;
  await db
    .insert(appointments)
    .values({
      trajectId,
      customerId,
      kind: cls.kind,
      title: e.summary ?? (cls.kind === "advies" ? "Adviesgesprek" : "Montage"),
      startsAt,
      endsAt,
      allDay,
      location: e.location ?? null,
      googleCalendarId: CAL_ID,
      googleEventId: e.id,
      googleEtag: e.etag ?? null,
    })
    .onConflictDoNothing();
  if (customerId && trajectId) {
    await addTimeline(db, {
      customerId,
      trajectId,
      type: "afspraak",
      title: `${cls.kind === "advies" ? "Adviesgesprek" : "Montage"} ingepland`,
      body: `${startsAt.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "full", timeStyle: allDay ? undefined : "short" })}${e.location ? `\n${e.location}` : ""}`,
    });
    await applyStageEvent(db, trajectId, cls.kind === "advies" ? "adviesgesprek_gepland" : "montage_gepland", { refType: "appointment", refId: e.id });
  }
  return true;
}

export async function syncCalendar(db: DbOrTx, cal: CalendarClient): Promise<number> {
  const row = await getIntegration(db, "google_calendar");
  const c = cfg(row);
  let page;
  try {
    page = await cal.changes(c.syncToken ? { syncToken: String(c.syncToken) } : { timeMin: new Date(Date.now() - 30 * 86400000).toISOString() });
  } catch (e) {
    if ((e as { status?: number }).status === 410) {
      // Sync-token verlopen: volledig opnieuw (idempotent dankzij unieke event-id's).
      page = await cal.changes({ timeMin: new Date(Date.now() - 30 * 86400000).toISOString() });
    } else throw e;
  }
  const own = cal.account ? [cal.account.toLowerCase()] : [];
  let n = 0;
  for (const e of page.events) if (await processEvent(db, e, own)) n++;
  // Token pas opslaan als alles verwerkt is: faalt het halverwege, dan komt alles opnieuw (zonder dubbelen).
  if (page.nextSyncToken) await upsertIntegration(db, "google_calendar", { config: { ...cfg(await getIntegration(db, "google_calendar")), syncToken: page.nextSyncToken } });
  return n;
}


