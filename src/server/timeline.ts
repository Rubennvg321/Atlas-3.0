import type { DbOrTx } from "@/db";
import { auditLog, timelineEvents } from "@/db/schema";

export async function addTimeline(
  db: DbOrTx,
  e: {
    customerId: string;
    trajectId?: string | null;
    type: string;
    title: string;
    body?: string | null;
    payload?: unknown;
    actorUserId?: string | null;
    occurredAt?: Date;
  },
) {
  await db.insert(timelineEvents).values({
    customerId: e.customerId,
    trajectId: e.trajectId ?? null,
    type: e.type,
    title: e.title,
    body: e.body ?? null,
    payload: e.payload ?? null,
    actorUserId: e.actorUserId ?? null,
    occurredAt: e.occurredAt ?? new Date(),
  });
}

export async function audit(db: DbOrTx, userId: string | null | undefined, action: string, entity: string, entityId: string | null, data?: unknown) {
  await db.insert(auditLog).values({ userId: userId ?? null, action, entity, entityId, data: data ?? null });
}
