import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import webpush from "web-push";
import type { DbOrTx } from "@/db";
import { integrations, notifications, pushSubscriptions } from "@/db/schema";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notification-types";
import { decryptJson, encryptJson } from "./crypto";
import { getSetting } from "./settings";

/**
 * Pushmeldingen. Werkwijze:
 *  1. Een gebeurtenis (bv. nieuwe lead) zet een melding klaar met queueNotification().
 *     Elke gebeurtenis heeft een unieke refKey, dus nooit twee meldingen voor hetzelfde.
 *  2. De worker verstuurt elke 30 seconden wat klaarstaat (deliverPending) naar alle
 *     apparaten die meldingen hebben aangezet.
 * Apparaten die niet meer bestaan (melding uitgezet, app verwijderd) worden opgeruimd.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Verstuurt één bericht naar één apparaat; gooit een fout met `statusCode` als het mislukt. */
export type PushSender = (target: PushTarget, payload: string) => Promise<void>;

const MAX_ATTEMPTS = 5;
/** Oudere meldingen worden niet meer verstuurd (bv. na een storing): geen stortvloed achteraf. */
const MAX_AGE_HOURS = 24;

// ---------------------------------------------------------------------------
// Sleutels (VAPID): worden bij het eerste gebruik aangemaakt en versleuteld bewaard.
// ---------------------------------------------------------------------------

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

async function getVapidKeys(db: DbOrTx): Promise<VapidKeys> {
  const read = async () => {
    const [row] = await db.select().from(integrations).where(eq(integrations.provider, "push"));
    return row?.encryptedTokens ? decryptJson<VapidKeys>(row.encryptedTokens) : null;
  };
  const existing = await read();
  if (existing) return existing;
  const fresh = webpush.generateVAPIDKeys();
  // Bij twee gelijktijdige aanroepen wint de eerste; daarna lezen we wat er staat.
  await db
    .insert(integrations)
    .values({ provider: "push", status: "gekoppeld", encryptedTokens: encryptJson(fresh) })
    .onConflictDoNothing();
  return (await read()) ?? fresh;
}

/** Publieke sleutel die de browser nodig heeft om zich aan te melden. */
export async function getVapidPublicKey(db: DbOrTx): Promise<string> {
  return (await getVapidKeys(db)).publicKey;
}

export async function liveSender(db: DbOrTx): Promise<PushSender> {
  const keys = await getVapidKeys(db);
  // Contactadres voor de pushdiensten (Apple/Google): de website van Atlas zelf.
  const subject = (process.env.AUTH_URL ?? "https://atlas.stepsandstairs.nl").replace(/\/$/, "");
  return async (target, payload) => {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
      { vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 24 * 3600, urgency: "high" },
    );
  };
}

// ---------------------------------------------------------------------------
// Apparaten aan- en afmelden
// ---------------------------------------------------------------------------

export async function saveSubscription(db: DbOrTx, sub: PushTarget & { label?: string | null; userId?: string | null }) {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.p256dh || !sub.auth) throw new Error("Ongeldige aanmelding voor meldingen.");
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, label: sub.label ?? null, userId: sub.userId ?? null })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: sub.p256dh, auth: sub.auth, label: sub.label ?? null, userId: sub.userId ?? null, failures: 0 },
    });
}

export async function removeSubscription(db: DbOrTx, endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

// ---------------------------------------------------------------------------
// Meldingen klaarzetten en versturen
// ---------------------------------------------------------------------------

export interface NotificationInput {
  type: NotificationType;
  /** Uniek per gebeurtenis, bv. "nieuwe_lead:gmail:<message-id>". */
  refKey: string;
  title: string;
  body?: string | null;
  /** Pagina in Atlas die opent als je op de melding tikt, bv. "/trajecten/<id>". */
  url?: string | null;
}

/** Zet een melding klaar. Staat deze soort uit, dan wordt hij alleen gelogd ("skipped"). */
export async function queueNotification(db: DbOrTx, n: NotificationInput): Promise<{ queued: boolean }> {
  const s = await getSetting(db, "notifications");
  const enabled = n.type === "test" || s.types[n.type] !== false;
  const inserted = await db
    .insert(notifications)
    .values({
      type: n.type,
      refKey: n.refKey,
      title: n.title.slice(0, 120),
      body: n.body?.slice(0, 300) ?? null,
      url: n.url ?? null,
      status: enabled ? "pending" : "skipped",
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return { queued: enabled && inserted.length > 0 };
}

/** Verstuurt wat klaarstaat. Geeft het aantal verstuurde meldingen terug. */
export async function deliverPending(db: DbOrTx, send: PushSender, opts: { onlyId?: string; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - MAX_AGE_HOURS * 3600_000);
  // Te oud of vastgelopen (proces gestopt tijdens versturen): opruimen / opnieuw.
  await db.update(notifications).set({ status: "skipped" }).where(and(inArray(notifications.status, ["pending", "sending"]), lt(notifications.createdAt, cutoff)));
  await db
    .update(notifications)
    .set({ status: "pending" })
    .where(and(eq(notifications.status, "sending"), lt(notifications.createdAt, new Date(now.getTime() - 10 * 60_000))));

  const pending = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.status, "pending"), gte(notifications.createdAt, cutoff), opts.onlyId ? eq(notifications.id, opts.onlyId) : undefined))
    .orderBy(asc(notifications.createdAt))
    .limit(20);
  if (!pending.length) return 0;

  const targets = await db.select().from(pushSubscriptions);
  let sent = 0;
  for (const { id } of pending) {
    // Claimen, zodat een tweede proces (bv. de testknop) dezelfde melding niet ook verstuurt.
    const [n] = await db
      .update(notifications)
      .set({ status: "sending", attempts: sql`${notifications.attempts} + 1` })
      .where(and(eq(notifications.id, id), eq(notifications.status, "pending")))
      .returning();
    if (!n) continue;
    if (!targets.length) {
      await db.update(notifications).set({ status: "skipped" }).where(eq(notifications.id, n.id));
      continue;
    }
    const payload = JSON.stringify({ title: n.title, body: n.body ?? "", url: n.url ?? "/dashboard", tag: n.id });
    let ok = 0;
    for (const t of targets) {
      try {
        await send(t, payload);
        ok++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: now, failures: 0 }).where(eq(pushSubscriptions.id, t.id));
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Apparaat bestaat niet meer bij de pushdienst: afmelden.
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, t.id));
        } else {
          await db.update(pushSubscriptions).set({ failures: sql`${pushSubscriptions.failures} + 1` }).where(eq(pushSubscriptions.id, t.id));
          console.warn(`melding naar apparaat ${t.label ?? t.id} mislukt:`, status ?? (e instanceof Error ? e.message : e));
        }
      }
    }
    const status = ok > 0 ? "sent" : n.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
    await db.update(notifications).set({ status, sentAt: ok > 0 ? now : null }).where(eq(notifications.id, n.id));
    if (ok > 0) sent++;
  }
  return sent;
}

/** Laatste meldingen, voor het overzicht op de pagina Meldingen. */
export async function recentNotifications(db: DbOrTx, limit = 20) {
  return db.select().from(notifications).orderBy(sql`${notifications.createdAt} desc`).limit(limit);
}

export async function listSubscriptions(db: DbOrTx) {
  return db.select().from(pushSubscriptions).orderBy(asc(pushSubscriptions.createdAt));
}

export const notificationTypes = Object.entries(NOTIFICATION_TYPES)
  .filter(([, v]) => !("hidden" in v && v.hidden))
  .map(([key, v]) => ({ key, label: v.label, description: v.description }));
