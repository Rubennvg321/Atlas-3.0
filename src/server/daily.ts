import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { appointments, contactPoints, contacts, customers, tasks, trajects } from "@/db/schema";
import { dayKey, montageDays } from "@/lib/montage-days";
import { montageInProgress, reviewReminderDue, reviewRequestDue } from "@/lib/review-schedule";
import { buildRawEmail } from "@/lib/mime";
import { applyStageEvent } from "./automation";
import { getSetting } from "./settings";
import { addTimeline } from "./timeline";
import type { GmailClient } from "./integrations/gmail-client";

const MONTAGE_STAGES = ["offerte_geaccepteerd", "montage_gepland", "materiaal_besteld", "in_uitvoering"];

function fill(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");
}

/**
 * Dagelijkse controle:
 *  - montage begonnen -> "In uitvoering"
 *  - 2 dagen na de laatste montagedag -> reviewverzoek + "Review gestuurd"
 *  - 7 dagen na het verzoek zonder review -> herinnering
 */
export async function runDaily(db: DbOrTx, gmail: GmailClient | null, now = new Date()): Promise<number> {
  const today = dayKey(now);
  const reviews = await getSetting(db, "reviews");
  const canSend = !!(gmail && reviews.enabled && reviews.link);
  let n = 0;

  const active = await db
    .select()
    .from(trajects)
    .where(and(isNull(trajects.deletedAt), inArray(trajects.stage, [...MONTAGE_STAGES, "review_gestuurd"])));

  for (const t of active) {
    const apps = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.trajectId, t.id), eq(appointments.kind, "montage"), eq(appointments.status, "gepland"), isNull(appointments.deletedAt)))
      .orderBy(asc(appointments.startsAt));
    const days = montageDays(apps.map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt, allDay: a.allDay })));

    if (MONTAGE_STAGES.includes(t.stage) && t.stage !== "in_uitvoering" && montageInProgress(days, today)) {
      const r = await applyStageEvent(db, t.id, "montage_gestart", { refType: "montage", refId: days[0] });
      if (r.action !== "none") n++;
    }

    const last = days.length ? days[days.length - 1] : null;
    const needsRequest = MONTAGE_STAGES.includes(t.stage) && !t.reviewRequestedAt && reviewRequestDue(last, today);
    const needsReminder =
      t.stage === "review_gestuurd" && reviewReminderDue(t.reviewRequestedAt ? dayKey(t.reviewRequestedAt) : null, !!t.reviewReminderAt, !!t.reviewReceivedAt, today);
    if (!needsRequest && !needsReminder) continue;
    if (!canSend) continue;

    const [email] = await db
      .select()
      .from(contactPoints)
      .where(and(eq(contactPoints.customerId, t.customerId), eq(contactPoints.kind, "email"), isNull(contactPoints.deletedAt)))
      .orderBy(asc(contactPoints.createdAt));
    const [c] = await db.select().from(customers).where(eq(customers.id, t.customerId));
    if (!email) {
      const existing = await db.select().from(tasks).where(and(eq(tasks.trajectId, t.id), eq(tasks.title, "E-mailadres toevoegen voor reviewverzoek")));
      if (!existing.length) await db.insert(tasks).values({ trajectId: t.id, customerId: t.customerId, title: "E-mailadres toevoegen voor reviewverzoek", dueAt: now });
      continue;
    }
    const [person] = await db.select().from(contacts).where(and(eq(contacts.customerId, t.customerId), isNull(contacts.deletedAt))).orderBy(asc(contacts.createdAt));
    const naam = person?.lastName ? `familie ${[person.infix, person.lastName].filter(Boolean).join(" ")}` : c.displayName;
    const vars = { naam, link: reviews.link };
    const reminder = needsReminder;
    const raw = buildRawEmail({
      to: email.normalized,
      subject: fill(reminder ? reviews.reminderSubject : reviews.subject, vars),
      text: fill(reminder ? reviews.reminderBody : reviews.body, vars),
    });
    // Eerst vastleggen dat we gaan versturen, dan versturen: nooit twee keer een mail bij een herstart.
    const claimed = await db
      .update(trajects)
      .set(reminder ? { reviewReminderAt: now } : { reviewRequestedAt: now })
      .where(and(eq(trajects.id, t.id), reminder ? isNull(trajects.reviewReminderAt) : isNull(trajects.reviewRequestedAt)))
      .returning();
    if (!claimed.length) continue;
    try {
      await gmail!.send(raw);
    } catch (e) {
      await db.update(trajects).set(reminder ? { reviewReminderAt: null } : { reviewRequestedAt: null }).where(eq(trajects.id, t.id));
      throw e;
    }
    await addTimeline(db, { customerId: t.customerId, trajectId: t.id, type: "mail", title: reminder ? `Herinnering reviewverzoek verstuurd naar ${email.value}` : `Reviewverzoek verstuurd naar ${email.value}` });
    if (!reminder) await applyStageEvent(db, t.id, "review_verstuurd", { refType: "review", refId: t.id });
    n++;
  }
  return n;
}
