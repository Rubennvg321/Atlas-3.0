import { and, eq, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { inboundItems } from "@/db/schema";
import type { LeadInput } from "@/lib/intake/types";
import { createCustomerFromLead, enrichCustomer, leadProfile, matchProfile, recordDuplicate } from "./customers";
import { createTraject, findOpenTraject } from "./trajects";
import { addTimeline } from "./timeline";

export interface IntakeOptions {
  provider: string; // website | handmatig | import | agenda
  /** Uniek per bron (bv. Gmail-message-id). Dubbel verwerken levert hetzelfde resultaat op. */
  externalId: string;
  userId?: string | null;
  /**
   * Wat te doen met het traject:
   *  - "lead" (standaard): koppel aan lopend traject of start een nieuw traject in Lead
   *  - { stage }: maak altijd een traject in deze fase (bv. import van afgeronde klussen),
   *    tenzij er al een lopend traject is
   *  - "none": alleen klant (bv. import van klantenbestand)
   */
  traject?: "lead" | "none" | { stage: string; title?: string | null };
  occurredAt?: Date;
}

export interface IntakeResult {
  inboundId: string;
  decision: "auto" | "doubt" | "none";
  customerId: string;
  trajectId: string | null;
  createdCustomer: boolean;
  createdTraject: boolean;
  duplicateOf: string[];
  alreadyProcessed: boolean;
}

/**
 * Eén ingang voor alle nieuwe klant-/leadgegevens: websiteformulier, handmatig
 * invoeren en import. Gaat altijd via de herkenningslogica.
 */
export async function intakeLead(db: DB | DbOrTx, lead: LeadInput, opts: IntakeOptions): Promise<IntakeResult> {
  return db.transaction(async (tx) => {
    // Eén intake tegelijk: voorkomt dat twee gelijktijdige aanvragen van
    // dezelfde persoon allebei een nieuwe klant aanmaken.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('atlas:intake'))`);

    const [inserted] = await tx
      .insert(inboundItems)
      .values({ provider: opts.provider, externalId: opts.externalId, payload: lead })
      .onConflictDoNothing()
      .returning();
    if (!inserted) {
      const [prev] = await tx
        .select()
        .from(inboundItems)
        .where(and(eq(inboundItems.provider, opts.provider), eq(inboundItems.externalId, opts.externalId)));
      return {
        inboundId: prev.id,
        decision: (prev.decision ?? "none") as IntakeResult["decision"],
        customerId: prev.customerId!,
        trajectId: prev.trajectId,
        createdCustomer: false,
        createdTraject: false,
        duplicateOf: [],
        alreadyProcessed: true,
      };
    }

    const outcome = await matchProfile(tx, leadProfile(lead));
    let customerId: string;
    let createdCustomer = false;
    const duplicateOf: string[] = [];

    if (outcome.decision === "auto" && outcome.best) {
      customerId = outcome.best.customerId;
    } else {
      customerId = await createCustomerFromLead(tx, lead, opts.provider);
      createdCustomer = true;
      for (const d of outcome.doubts) {
        await recordDuplicate(tx, customerId, d.customerId, d.result, opts.provider);
        duplicateOf.push(d.customerId);
      }
    }

    // Traject bepalen
    let trajectId: string | null = null;
    let createdTraject = false;
    const mode = opts.traject ?? "lead";
    if (mode !== "none") {
      const open = createdCustomer ? [] : await findOpenTraject(tx, customerId);
      if (open.length > 0) {
        trajectId = open[0].id;
      } else {
        const stage = mode === "lead" ? "lead" : mode.stage;
        const t = await createTraject(
          tx,
          {
            customerId,
            stage,
            title: mode !== "lead" ? mode.title ?? null : null,
            description: lead.message ?? null,
            source: opts.provider,
            referral: lead.referral ?? null,
          },
          { userId: opts.userId, source: opts.userId || opts.provider === "handmatig" ? "manual" : "automatic" },
        );
        trajectId = t.id;
        createdTraject = true;
      }
    }

    if (!createdCustomer) await enrichCustomer(tx, customerId, lead, trajectId);

    const providerLabel: Record<string, string> = {
      website: "Nieuwe aanvraag via website",
      handmatig: "Handmatig ingevoerd",
      import: "Geïmporteerd",
      agenda: "Herkend uit agenda",
    };
    await addTimeline(tx, {
      customerId,
      trajectId,
      type: "aanvraag",
      title: providerLabel[opts.provider] ?? `Binnengekomen via ${opts.provider}`,
      body: [
        lead.message,
        lead.referral ? `Via: ${lead.referral}` : null,
        lead.sourcePage ? `Pagina: ${lead.sourcePage}` : null,
        outcome.decision === "auto" && !createdTraject && trajectId ? "Gekoppeld aan lopend traject." : null,
        outcome.decision === "doubt" ? "Mogelijk dubbel met een bestaande klant: controleer onder 'Mogelijk dubbel'." : null,
      ]
        .filter(Boolean)
        .join("\n") || null,
      payload: { decision: outcome.decision, score: outcome.best?.result.score ?? outcome.doubts[0]?.result.score ?? 0 },
      actorUserId: opts.userId,
      occurredAt: opts.occurredAt,
    });

    await tx
      .update(inboundItems)
      .set({ status: "done", decision: outcome.decision, customerId, trajectId, processedAt: new Date() })
      .where(eq(inboundItems.id, inserted.id));

    return {
      inboundId: inserted.id,
      decision: outcome.decision,
      customerId,
      trajectId,
      createdCustomer,
      createdTraject,
      duplicateOf,
      alreadyProcessed: false,
    };
  });
}
