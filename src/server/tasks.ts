import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { notes, tasks, trajects } from "@/db/schema";
import { DomainError, NotFoundError } from "./errors";
import { addTimeline } from "./timeline";

async function trajectCustomer(db: DbOrTx, trajectId: string) {
  const [t] = await db.select({ customerId: trajects.customerId }).from(trajects).where(eq(trajects.id, trajectId));
  if (!t) throw new NotFoundError("Traject");
  return t.customerId;
}

export async function createTask(db: DbOrTx, input: { trajectId: string; title: string; dueAt?: Date | null; userId?: string | null }) {
  if (!input.title.trim()) throw new DomainError("Geef de taak een omschrijving.");
  return db.transaction(async (tx) => {
    const customerId = await trajectCustomer(tx, input.trajectId);
    const [task] = await tx
      .insert(tasks)
      .values({
        trajectId: input.trajectId,
        customerId,
        title: input.title.trim(),
        dueAt: input.dueAt ?? null,
        assigneeId: input.userId ?? null,
        createdBy: input.userId ?? null,
      })
      .returning();
    await addTimeline(tx, { customerId, trajectId: input.trajectId, type: "taak", title: `Taak: ${task.title}`, actorUserId: input.userId });
    return task;
  });
}

export async function setTaskDone(db: DbOrTx, taskId: string, done: boolean, userId?: string | null) {
  return db.transaction(async (tx) => {
    const [task] = await tx.update(tasks).set({ doneAt: done ? new Date() : null, updatedAt: new Date() }).where(eq(tasks.id, taskId)).returning();
    if (!task) throw new NotFoundError("Taak");
    if (task.customerId)
      await addTimeline(tx, {
        customerId: task.customerId,
        trajectId: task.trajectId,
        type: "taak",
        title: done ? `Taak afgerond: ${task.title}` : `Taak heropend: ${task.title}`,
        actorUserId: userId,
      });
    return task;
  });
}

export async function updateTask(db: DbOrTx, taskId: string, data: { title?: string; dueAt?: Date | null }) {
  const [task] = await db.update(tasks).set({ ...data, updatedAt: new Date() }).where(eq(tasks.id, taskId)).returning();
  if (!task) throw new NotFoundError("Taak");
  return task;
}

export async function deleteTask(db: DbOrTx, taskId: string) {
  await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
}

export async function addNote(db: DbOrTx, input: { trajectId: string; body: string; userId?: string | null }) {
  if (!input.body.trim()) throw new DomainError("Notitie is leeg.");
  return db.transaction(async (tx) => {
    const customerId = await trajectCustomer(tx, input.trajectId);
    const [n] = await tx
      .insert(notes)
      .values({ trajectId: input.trajectId, customerId, body: input.body.trim(), createdBy: input.userId ?? null })
      .returning();
    await addTimeline(tx, { customerId, trajectId: input.trajectId, type: "notitie", title: "Notitie", body: n.body, actorUserId: input.userId });
    return n;
  });
}
