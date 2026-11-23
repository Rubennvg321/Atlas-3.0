import { and, eq, gt, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { appointments } from "@/db/schema";
import { classifyEvent, parseLocation, parseMontageTitle, type ParsedAddress } from "@/lib/parsers/calendar";
import { scoreMatch, type MatchProfile } from "@/lib/matching/score";
import { splitDutchName, streetKey } from "@/lib/normalize";
import type { LeadInput } from "@/lib/intake/types";
import { findCandidateIds, loadProfiles, matchProfile } from "../customers";
import { intakeLead } from "../intake";
import { applyStageEvent } from "../automation";
import { findOpenTraject, createTraject } from "../trajects";
import { findTrajectByFamilyName } from "../purchases";
import { pipelineStages } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getMatchSettings, getSetting } from "../settings";
import { addTimeline } from "../timeline";
import type { CalendarClient, CalendarEvent } from "./calendar-client";
import { cfg, getIntegration, upsertIntegration } from "./state";

/**
 * Versie van de herkenningsregels. Wordt die hoger, dan leest Atlas alle
 * afspraken (vanaf 30 dagen terug) opnieuw in plaats van alleen wijzigingen,
 * zodat afspraken die eerder gemist zijn alsnog worden herkend.
 */
const RULES_VERSION = 4; // 4: e-mailadressen van gasten bewaren, losse afspraken later alsnog koppelen
/** Zo ver terug leest Atlas de agenda bij een volledige ronde (voor al uitgevoerde montages). */
const LOOKBACK_DAYS = 120;
/** Oudere adviesgesprekken maken geen nieuwe klant/lead meer aan; ze worden alleen gekoppeld. */
const NEW_LEAD_MAX_AGE_DAYS = 30;

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
  if (best && best.score >= s.autoThreshold && best.score > second) return { customerId: best.customerId, trajectId: null as string | null };

  // Geen (bruikbaar) adres in de titel, zoals "Fam. Jonker": koppel op achternaam, maar alleen aan
  // een traject waarvan de offerte al geaccepteerd is én alleen als er precies één zo'n traject is.
  const won = (await db.select().from(pipelineStages).where(inArray(pipelineStages.kind, ["won"]))).map((x) => x.key);
  if (!won.length) return null;
  for (const c of cands) {
    const hit = await findTrajectByFamilyName(db, `fam. ${c.name}`, won);
    if (hit) return { customerId: hit.customerId, trajectId: hit.trajectId as string | null };
  }
  return null;
}

/**
 * Adviesgesprek: welke bestaande klant hoort bij deze gasten/dit adres? Maakt zelf
 * geen klant aan. Een uitnodiging naar het e-mailadres van precies één bekende klant
 * telt als zeker.
 */
async function matchAdvies(db: DbOrTx, emails: string[], address: ParsedAddress | null): Promise<string | null> {
  if (!emails.length && !address?.postcode && !address?.street) return null;
  const m = await matchProfile(db, { emails, phones: [], ...addressProfile(address), names: [] });
  if (m.decision === "auto" && m.best) return m.best.customerId;
  if (m.decision === "doubt" && m.doubts.length === 1 && m.doubts[0].result.signals.some((x) => x.key === "email")) return m.doubts[0].customerId;
  return null;
}

export async function processEvent(db: DbOrTx, e: CalendarEvent, own: string[], calendarId = "primary"): Promise<boolean> {
  const rules = await getSetting(db, "calendarRules");
  const [existing] = await db.select().from(appointments).where(and(eq(appointments.googleCalendarId, calendarId), eq(appointments.googleEventId, e.id)));

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
  const attendeeEmails = cls.kind === "advies" ? cls.emails : [];
  if (existing && existing.customerId) {
    // Bestaande afspraak: tijd/locatie bijwerken (Google is leidend), koppeling behouden.
    if (existing.googleEtag === e.etag && existing.status === "gepland") return false;
    await db
      .update(appointments)
      .set({ title: e.summary ?? existing.title, startsAt, endsAt, allDay, location: e.location ?? null, attendeeEmails, status: "gepland", googleEtag: e.etag ?? null, updatedAt: new Date() })
      .where(eq(appointments.id, existing.id));
    if (existing.trajectId) await applyStageEvent(db, existing.trajectId, cls.kind === "advies" ? "adviesgesprek_gepland" : "montage_gepland", { refType: "appointment", refId: e.id });
    return true;
  }

  let customerId: string | null = null;
  let montageTraject: string | null = null;
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
    const stale = endsAt.getTime() < Date.now() - NEW_LEAD_MAX_AGE_DAYS * 86400000;
    customerId = await matchAdvies(db, cls.emails, cls.address);
    if (!customerId && !stale && (lead.emails.length || lead.postcode || lead.street)) {
      const r = await intakeLead(db, lead, { provider: "agenda", externalId: `gcal:${e.id}`, traject: "none" });
      customerId = r.customerId;
    }
  } else {
    const m = await matchMontage(db, cls.nameCandidates, cls.address);
    customerId = m?.customerId ?? null;
    montageTraject = m?.trajectId ?? null;
  }

  const trajectId = montageTraject ?? (customerId ? await trajectFor(db, customerId) : null);
  if (existing) {
    // Eerder opgeslagen zonder klant: nu opnieuw geprobeerd te koppelen.
    if (!customerId && existing.googleEtag === e.etag && existing.status === "gepland" && existing.attendeeEmails.join() === attendeeEmails.join()) return false;
    await db
      .update(appointments)
      .set({ trajectId, customerId, kind: cls.kind, title: e.summary ?? existing.title, startsAt, endsAt, allDay, location: e.location ?? null, attendeeEmails, status: "gepland", googleEtag: e.etag ?? null, updatedAt: new Date() })
      .where(eq(appointments.id, existing.id));
  } else await db
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
      attendeeEmails,
      googleCalendarId: calendarId,
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
  const { calendars } = await getSetting(db, "calendarRules");
  const ids = [...new Set((calendars ?? []).map((c) => c.id).filter(Boolean))];
  if (!ids.length) ids.push("primary");
  const own = cal.account ? [cal.account.toLowerCase()] : [];
  const timeMin = () => new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  let n = 0;
  for (const calendarId of ids) {
    const c = cfg(await getIntegration(db, "google_calendar"));
    const fresh = c.rulesVersion !== RULES_VERSION;
    const tokens = (fresh ? {} : ((c.syncTokens as Record<string, string>) ?? {})) as Record<string, string>;
    // Oude opslag (één token, alleen hoofdagenda) blijft bruikbaar.
    if (!fresh && !tokens.primary && c.syncToken && calendarId === "primary") tokens.primary = String(c.syncToken);
    const token = tokens[calendarId];

    let page;
    try {
      page = await cal.changes(token ? { calendarId, syncToken: token } : { calendarId, timeMin: timeMin() });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 410) {
        // Sync-token verlopen: volledig opnieuw (idempotent dankzij unieke event-id's).
        page = await cal.changes({ calendarId, timeMin: timeMin() });
      } else if (status === 404 && calendarId !== "primary") {
        // Agenda bestaat niet (meer) of is niet gedeeld: de andere agenda's gewoon doorlopen.
        console.warn(`agenda ${calendarId} niet gevonden, overgeslagen`);
        continue;
      } else throw e;
    }
    for (const e of page.events) if (await processEvent(db, e, own, calendarId)) n++;
    // Token pas opslaan als alles verwerkt is: faalt het halverwege, dan komt alles opnieuw (zonder dubbelen).
    if (page.nextSyncToken) {
      const latest = cfg(await getIntegration(db, "google_calendar"));
      const kept = latest.rulesVersion === RULES_VERSION ? ((latest.syncTokens as Record<string, string>) ?? {}) : {};
      await upsertIntegration(db, "google_calendar", {
        config: { ...latest, syncToken: undefined, rulesVersion: RULES_VERSION, syncTokens: { ...kept, [calendarId]: page.nextSyncToken } },
      });
    }
  }
  // Afspraken die eerder zonder klant zijn opgeslagen: is de klant er inmiddels wel?
  n += await relinkUnlinkedAppointments(db);
  return n;
}

/**
 * Probeert opgeslagen afspraken zonder klant opnieuw te koppelen, met de bewaarde
 * titel, locatie en gast-e-mailadressen. Nodig omdat een ongewijzigde afspraak niet
 * opnieuw uit Google komt: komt de klant later in Atlas (aanvraag, WeFact, handmatig),
 * dan wordt de afspraak zo alsnog gekoppeld. Maakt zelf geen klanten aan.
 */
export async function relinkUnlinkedAppointments(db: DbOrTx, now: Date = new Date()): Promise<number> {
  const loose = await db
    .select()
    .from(appointments)
    .where(
      and(
        isNull(appointments.customerId),
        isNull(appointments.deletedAt),
        eq(appointments.status, "gepland"),
        inArray(appointments.kind, ["advies", "montage"]),
        gt(appointments.endsAt, new Date(now.getTime() - LOOKBACK_DAYS * 86400000)),
      ),
    );
  let n = 0;
  for (const a of loose) {
    const address = parseLocation(a.location);
    let customerId: string | null = null;
    let trajectId: string | null = null;
    if (a.kind === "advies") {
      customerId = await matchAdvies(db, a.attendeeEmails, address);
    } else {
      const m = await matchMontage(db, parseMontageTitle(a.title), address);
      customerId = m?.customerId ?? null;
      trajectId = m?.trajectId ?? null;
    }
    if (customerId && (await linkAppointmentToCustomer(db, a.id, customerId, trajectId))) n++;
  }
  return n;
}

/**
 * Koppelt een agenda-afspraak die Atlas niet zelf kon koppelen alsnog aan een klant
 * (bijv. via "Klant aanmaken" bij "Afspraken zonder klant" op het dashboard).
 * Doet niets als de afspraak inmiddels al gekoppeld is. Fase alleen vooruit.
 */
export async function linkAppointmentToCustomer(db: DbOrTx, appointmentId: string, customerId: string, trajectId?: string | null) {
  const [a] = await db.select().from(appointments).where(and(eq(appointments.id, appointmentId), isNull(appointments.deletedAt)));
  if (!a || a.customerId || a.trajectId) return false;
  const tId = trajectId ?? (await trajectFor(db, customerId));
  await db.update(appointments).set({ customerId, trajectId: tId, updatedAt: new Date() }).where(eq(appointments.id, a.id));
  await addTimeline(db, {
    customerId,
    trajectId: tId,
    type: "afspraak",
    title: `${a.kind === "advies" ? "Adviesgesprek" : "Montage"} gekoppeld`,
    body: `${a.startsAt.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "full", timeStyle: a.allDay ? undefined : "short" })}${a.location ? `\n${a.location}` : ""}`,
  });
  if (a.status === "gepland" && (a.kind === "advies" || a.kind === "montage"))
    await applyStageEvent(db, tId, a.kind === "advies" ? "adviesgesprek_gepland" : "montage_gepland", { refType: "appointment", refId: a.googleEventId ?? a.id });
  return true;
}
