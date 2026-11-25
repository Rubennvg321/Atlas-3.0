"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/server/session";
import { chooseArrivalTime } from "@/server/arrival";
import { getAccessToken } from "@/server/integrations/google-oauth";
import { liveGmail } from "@/server/integrations/gmail-client";
import { audit } from "@/server/timeline";
import { setSetting } from "@/server/settings";

export type ArrivalActionResult = { ok: true; message: string } | { ok: false; error: string } | null;

export async function chooseArrivalAction(_prev: ArrivalActionResult, fd: FormData): Promise<ArrivalActionResult> {
  const user = await requireUser();
  const db = getDb();
  const id = String(fd.get("id") ?? "");
  const time = String(fd.get("time") ?? "");
  let gmail = null;
  try {
    const { token, account } = await getAccessToken(db);
    gmail = liveGmail(token, account);
  } catch {
    gmail = null; // Google niet gekoppeld of verlopen: keuze wordt bewaard, mail volgt later
  }
  const r = await chooseArrivalTime(db, id, time, gmail);
  await audit(db, user.id, "arrival_time", "arrival_request", id, { time, ok: r.ok });
  revalidatePath(`/aankomst/${id}`);
  revalidatePath("/meldingen");
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: r.changed ? `Gewijzigde tijd gemaild naar ${r.sentTo}.` : r.sentTo ? `Gemaild naar ${r.sentTo}.` : "Deze tijd was al gemaild." };
}

/** Instellingen van de aankomstmail (Koppelingen → Aankomstmail). */
export async function saveArrivalSettingsAction(_prev: ArrivalActionResult, fd: FormData): Promise<ArrivalActionResult> {
  const user = await requireUser();
  const v = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
  const times = v("times")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((t) => t.replace(".", ":"))
    .map((t) => (/^\d:\d{2}$/.test(t) ? `0${t}` : t));
  if (times.length < 2 || times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return { ok: false, error: "Vul minstens twee tijden in, zoals 07:30, 07:45, 08:00." };
  const askHour = Number(v("askHour"));
  const reminderHour = Number(v("reminderHour"));
  if (!(askHour >= 5 && askHour <= 22) || !(reminderHour >= 5 && reminderHour <= 23)) return { ok: false, error: "Kies een uur tussen 5 en 23." };
  if (!v("subject") || !v("body")) return { ok: false, error: "Vul een onderwerp en een tekst in." };
  if (!v("body").includes("{tijd}")) return { ok: false, error: "Zet {tijd} in de tekst, anders staat de aankomsttijd niet in de mail." };
  await setSetting(
    getDb(),
    "arrivalMail",
    { enabled: fd.get("enabled") === "on", askHour, reminderHour, times: [...new Set(times)].sort(), subject: v("subject"), body: String(fd.get("body") ?? "") },
    user.id,
  );
  revalidatePath("/koppelingen");
  return { ok: true, message: "Opgeslagen." };
}
