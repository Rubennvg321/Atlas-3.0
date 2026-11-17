import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { pipelineStages, stageChanges, trajects, customers } from "@/db/schema";
import { ConflictError, DomainError, NotFoundError } from "./errors";
import { addTimeline } from "./timeline";

export const LOST_REASONS = {
  te_duur: "Te duur",
  geen_reactie: "Geen reactie",
  concurrent: "Concurrent",
  anders: "Anders",
} as const;
export type LostReason = keyof typeof LOST_REASONS;

export async function getStages(db: DbOrTx) {
  return db.select().from(pipelineStages).where(eq(pipelineStages.active, true)).orderBy(pipelineStages.position);
}

export async function openStageKeys(db: DbOrTx): Promise<string[]> {
  const rows = await db.select().from(pipelineStages).where(inArray(pipelineStages.kind, ["open", "won"]));
  return rows.map((r) => r.key);
}

export async function createTraject(
  db: DbOrTx,
  input: { customerId: string; stage?: string; title?: string | null; description?: string | null; source?: string | null; referral?: string | null },
  actor: { userId?: string | null; source?: "manual" | "automatic" } = {},
) {
  const stage = input.stage ?? "lead";
  const [t] = await db
    .insert(trajects)
    .values({
      customerId: input.customerId,
      stage,
      title: input.title ?? null,
      description: input.description ?? null,
      source: input.source ?? null,
      referral: input.referral ?? null,
    })
    .returning();
  await db.insert(stageChanges).values({
    trajectId: t.id,
    fromStage: null,
    toStage: stage,
    source: actor.source ?? "manual",
    userId: actor.userId ?? null,
    reason: "Traject aangemaakt",
  });
  await addTimeline(db, {
    customerId: input.customerId,
    trajectId: t.id,
    type: "traject_aangemaakt",
    title: `Traject aangemaakt in fase ${stage}`,
    actorUserId: actor.userId,
  });
  return t;
}

export interface ChangeStageInput {
  trajectId: string;
  toStage: string;
  /** Versie zoals de gebruiker die zag. Wijkt die af, dan is er ondertussen iets veranderd. */
  expectedVersion?: number;
  source: "manual" | "automatic" | "proposal";
  userId?: string | null;
  lostReason?: LostReason | null;
  lostNote?: string | null;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
}

/**
 * De ENIGE manier om de fase van een traject te wijzigen. Slepen op het bord,
 * de dropdown op de kaart en automatische regels gebruiken allemaal deze
 * functie. Veld + log + tijdlijn worden in één transactie geschreven.
 */
export async function changeStage(db: DbOrTx, input: ChangeStageInput) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(trajects).where(eq(trajects.id, input.trajectId)).for("update");
    if (!t || t.deletedAt) throw new NotFoundError("Traject");
    if (input.expectedVersion !== undefined && input.expectedVersion !== t.version) throw new ConflictError();

    const [stage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.key, input.toStage));
    if (!stage || !stage.active) throw new DomainError(`Onbekende fase: ${input.toStage}`);
    if (t.stage === input.toStage && stage.kind !== "lost") return t; // niets te doen

    if (stage.kind === "lost") {
      if (!input.lostReason || !(input.lostReason in LOST_REASONS)) throw new DomainError("Kies een reden waarom het traject is vervallen.");
      if (input.lostReason === "anders" && !input.lostNote?.trim()) throw new DomainError("Geef een toelichting bij 'Anders'.");
      if (t.stage === input.toStage && t.lostReason === input.lostReason && (t.lostNote ?? "") === (input.lostNote ?? "")) return t;
    }

    const [updated] = await tx
      .update(trajects)
      .set({
        stage: input.toStage,
        stageChangedAt: t.stage === input.toStage ? t.stageChangedAt : new Date(),
        lostReason: stage.kind === "lost" ? input.lostReason : null,
        lostNote: stage.kind === "lost" ? (input.lostNote?.trim() || null) : null,
        version: t.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(trajects.id, t.id), eq(trajects.version, t.version)))
      .returning();
    if (!updated) throw new ConflictError();

    await tx.insert(stageChanges).values({
      trajectId: t.id,
      fromStage: t.stage,
      toStage: input.toStage,
      source: input.source,
      userId: input.userId ?? null,
      reason:
        input.reason ??
        (stage.kind === "lost" ? `Vervallen: ${LOST_REASONS[input.lostReason!]}${input.lostNote ? ` – ${input.lostNote}` : ""}` : null),
      refType: input.refType ?? null,
      refId: input.refId ?? null,
    });
    const labels = Object.fromEntries((await tx.select().from(pipelineStages)).map((s) => [s.key, s.label]));
    const how = input.source === "manual" ? "" : input.source === "automatic" ? " (automatisch)" : " (voorstel geaccepteerd)";
    await addTimeline(tx, {
      customerId: t.customerId,
      trajectId: t.id,
      type: "fase",
      title: `Fase: ${labels[t.stage] ?? t.stage} → ${labels[input.toStage] ?? input.toStage}${how}`,
      body: stage.kind === "lost" ? `Reden: ${LOST_REASONS[input.lostReason!]}${input.lostNote ? ` – ${input.lostNote}` : ""}` : null,
      actorUserId: input.userId,
      payload: { from: t.stage, to: input.toStage, source: input.source },
    });
    return updated;
  });
}

export async function updateTrajectDetails(
  db: DbOrTx,
  trajectId: string,
  data: {
    title?: string | null;
    description?: string | null;
    siteStreet?: string | null;
    siteHouseNumber?: number | null;
    siteHouseNumberAddition?: string | null;
    sitePostcode?: string | null;
    siteCity?: string | null;
  },
  userId?: string | null,
) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(trajects).where(eq(trajects.id, trajectId)).for("update");
    if (!t) throw new NotFoundError("Traject");
    const [u] = await tx
      .update(trajects)
      .set({ ...data, version: t.version + 1, updatedAt: new Date() })
      .where(eq(trajects.id, trajectId))
      .returning();
    await addTimeline(tx, { customerId: t.customerId, trajectId, type: "traject_bijgewerkt", title: "Trajectgegevens bijgewerkt", actorUserId: userId });
    return u;
  });
}

/** Meest recente lopende traject van een klant (fase open of won). */
export async function findOpenTraject(db: DbOrTx, customerId: string) {
  const keys = await openStageKeys(db);
  const rows = await db
    .select()
    .from(trajects)
    .where(and(eq(trajects.customerId, customerId), isNull(trajects.deletedAt), inArray(trajects.stage, keys)))
    .orderBy(desc(trajects.createdAt));
  return rows;
}

export async function softDeleteTraject(db: DbOrTx, trajectId: string, userId?: string | null) {
  return db.transaction(async (tx) => {
    const [t] = await tx.update(trajects).set({ deletedAt: new Date() }).where(eq(trajects.id, trajectId)).returning();
    if (!t) throw new NotFoundError("Traject");
    await addTimeline(tx, { customerId: t.customerId, trajectId, type: "verwijderd", title: "Traject verwijderd (prullenbak)", actorUserId: userId });
  });
}

export async function customerOfTraject(db: DbOrTx, trajectId: string) {
  const [row] = await db
    .select({ customer: customers })
    .from(trajects)
    .innerJoin(customers, eq(customers.id, trajects.customerId))
    .where(eq(trajects.id, trajectId));
  return row?.customer ?? null;
}
