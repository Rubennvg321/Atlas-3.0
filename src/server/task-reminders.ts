import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { customers, tasks, trajects } from "@/db/schema";
import { dayKey } from "@/lib/montage-days";
import { amsterdamClock, amsterdamTime } from "@/lib/zoned";
import { queueNotification } from "./notify";

/**
 * Melding als een taak zijn datum/tijd bereikt:
 *  - taak met tijd: op dat moment;
 *  - taak met alleen een datum: om 08:00 (Nederlandse tijd) op die dag.
 * Verschuif je de deadline, dan komt er voor het nieuwe moment opnieuw een melding.
 * Meldingen die meer dan een dag te laat zouden komen (bv. na een storing) worden overgeslagen.
 */
export const DATE_ONLY_REMINDER = "08:00";

export function reminderMoment(t: { dueAt: Date; dueHasTime: boolean }): Date {
  return t.dueHasTime ? t.dueAt : amsterdamTime(dayKey(t.dueAt), DATE_ONLY_REMINDER);
}

export async function planTaskReminders(db: DbOrTx, now = new Date()): Promise<number> {
  const day = 24 * 3600_000;
  // Ruim selecteren (datum-taken staan op 17:00/18:00 maar melden om 08:00); precies filteren hieronder.
  const rows = await db
    .select({ task: tasks, customerName: customers.displayName })
    .from(tasks)
    .leftJoin(customers, eq(customers.id, tasks.customerId))
    .leftJoin(trajects, eq(trajects.id, tasks.trajectId))
    .where(
      and(
        isNull(tasks.doneAt),
        isNull(tasks.deletedAt),
        isNull(trajects.deletedAt),
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, new Date(now.getTime() - 2 * day)),
        lte(tasks.dueAt, new Date(now.getTime() + day)),
      ),
    );
  let n = 0;
  for (const { task, customerName } of rows) {
    const at = reminderMoment({ dueAt: task.dueAt!, dueHasTime: task.dueHasTime });
    if (at > now || now.getTime() - at.getTime() > day) continue;
    if (task.remindedFor && task.remindedFor.getTime() === at.getTime()) continue;
    // Claimen, zodat de melding nooit dubbel komt.
    const claimed = await db
      .update(tasks)
      .set({ remindedFor: at })
      .where(and(eq(tasks.id, task.id), task.remindedFor ? eq(tasks.remindedFor, task.remindedFor) : isNull(tasks.remindedFor)))
      .returning({ id: tasks.id });
    if (!claimed.length) continue;
    await queueNotification(db, {
      type: "taak",
      refKey: `taak:${task.id}:${at.toISOString()}`,
      title: `Taak: ${task.title}`,
      body: [customerName, task.dueHasTime ? `vandaag ${amsterdamClock(task.dueAt!)}` : "vandaag"].filter(Boolean).join(" · "),
      url: task.trajectId ? `/trajecten/${task.trajectId}` : "/taken",
    });
    n++;
  }
  return n;
}
