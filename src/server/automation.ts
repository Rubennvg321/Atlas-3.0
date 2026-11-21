import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { pipelineStages, stageProposals, trajects } from "@/db/schema";
import { EVENT_LABEL, EVENT_TARGET, nextStage, type StageEvent } from "@/lib/stage-rules";
import { getSetting } from "./settings";
import { changeStage } from "./trajects";
import { DomainError, NotFoundError } from "./errors";
import { addTimeline } from "./timeline";

export interface StageEventOptions {
  refType?: string | null;
  refId?: string | null;
  detail?: string | null;
}

export type StageEventResult = { action: "moved"; to: string } | { action: "proposed"; to: string } | { action: "none" };

/**
 * Verwerkt een gebeurtenis (afspraak, offerte, orderbevestiging, ...) voor een
 * traject: verschuift de kaart automatisch of maakt een voorstel, afhankelijk
 * van de instelling. Alleen vooruit; dubbel verwerken doet niets extra.
 */
export async function applyStageEvent(db: DbOrTx, trajectId: string, event: StageEvent, opts: StageEventOptions = {}): Promise<StageEventResult> {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(trajects).where(eq(trajects.id, trajectId)).for("update");
    if (!t || t.deletedAt) return { action: "none" };
    const stages = await tx.select().from(pipelineStages).where(eq(pipelineStages.active, true));
    const to = nextStage(t.stage, event, stages);
    if (!to) return { action: "none" };
    const automation = await getSetting(tx, "automation");
    const mode = automation[event] ?? "proposal";
    const reason = [EVENT_LABEL[event], opts.detail].filter(Boolean).join(" – ");
    if (mode === "automatic") {
      await changeStage(tx, { trajectId, toStage: to, source: "automatic", reason, refType: opts.refType ?? event, refId: opts.refId ?? null });
      return { action: "moved", to };
    }
    const inserted = await tx
      .insert(stageProposals)
      .values({ trajectId, toStage: to, reason, refType: opts.refType ?? event, refId: opts.refId ?? `${event}:${trajectId}` })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      await addTimeline(tx, { customerId: t.customerId, trajectId, type: "fase", title: `Voorstel: naar ${stages.find((s) => s.key === to)?.label ?? to}`, body: reason });
    }
    return { action: "proposed", to };
  });
}

export async function decideProposal(db: DbOrTx, proposalId: string, accept: boolean, userId?: string | null) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(stageProposals).where(eq(stageProposals.id, proposalId)).for("update");
    if (!p) throw new NotFoundError("Voorstel");
    if (p.status !== "open") throw new DomainError("Over dit voorstel is al beslist.");
    await tx
      .update(stageProposals)
      .set({ status: accept ? "accepted" : "rejected", decidedBy: userId ?? null, decidedAt: new Date() })
      .where(eq(stageProposals.id, proposalId));
    if (accept) {
      await changeStage(tx, { trajectId: p.trajectId, toStage: p.toStage, source: "proposal", userId, reason: p.reason, refType: p.refType, refId: p.refId });
    }
    return p;
  });
}

export async function openProposals(db: DbOrTx, trajectId: string) {
  return db.select().from(stageProposals).where(and(eq(stageProposals.trajectId, trajectId), eq(stageProposals.status, "open")));
}

export { EVENT_TARGET };
