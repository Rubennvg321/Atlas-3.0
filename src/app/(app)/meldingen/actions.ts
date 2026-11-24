"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/server/session";
import { setSetting, getSetting } from "@/server/settings";
import { deliverPending, liveSender, queueNotification, removeSubscription, saveSubscription } from "@/server/notify";
import { NOTIFICATION_TYPES } from "@/lib/notification-types";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const SubSchema = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(4) }),
});

/** Apparaat aanmelden voor meldingen (aangeroepen door de knop "Meldingen aanzetten"). */
export async function subscribePush(sub: unknown, label: string | null): Promise<Result> {
  const user = await requireUser();
  const parsed = SubSchema.safeParse(sub);
  if (!parsed.success) return { ok: false, error: "De aanmelding van dit apparaat is ongeldig. Probeer het opnieuw." };
  await saveSubscription(getDb(), {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    label: label?.slice(0, 60) ?? null,
    userId: user.id,
  });
  revalidatePath("/meldingen");
  return { ok: true };
}

export async function unsubscribePush(endpoint: string): Promise<Result> {
  await requireUser();
  await removeSubscription(getDb(), endpoint);
  revalidatePath("/meldingen");
  return { ok: true };
}

/** Stuurt direct een testmelding naar alle aangemelde apparaten. */
export async function sendTestNotification(): Promise<Result> {
  await requireUser();
  const db = getDb();
  await queueNotification(db, {
    type: "test",
    refKey: `test:${Date.now()}`,
    title: "Testmelding van Atlas",
    body: "Meldingen werken. Tik hierop om Atlas te openen.",
    url: "/meldingen",
  });
  const sent = await deliverPending(db, await liveSender(db));
  revalidatePath("/meldingen");
  return sent > 0
    ? { ok: true, message: "Verstuurd. De melding hoort binnen een paar seconden te verschijnen." }
    : { ok: false, error: "Geen apparaat bereikt. Zet eerst meldingen aan op dit apparaat." };
}

/** Per soort melding aan/uit. */
export async function saveNotificationTypes(_prev: Result | null, fd: FormData): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const current = await getSetting(db, "notifications");
  const types: Record<string, boolean> = { ...current.types };
  for (const key of Object.keys(NOTIFICATION_TYPES)) if (key !== "test") types[key] = fd.get(`type_${key}`) === "on";
  await setSetting(db, "notifications", { types }, user.id);
  revalidatePath("/meldingen");
  return { ok: true, message: "Opgeslagen." };
}
