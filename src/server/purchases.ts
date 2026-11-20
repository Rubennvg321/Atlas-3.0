import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { contacts, customers, pipelineStages, purchaseOrders, quotes, trajects } from "@/db/schema";
import type { SupplierOrder } from "@/lib/parsers/ppc";
import type { QuoteAccepted } from "@/lib/parsers/wefact-mail";
import { lastNameSimilarity } from "@/lib/matching/similarity";
import { splitDutchName } from "@/lib/normalize";
import { applyStageEvent } from "./automation";
import { DomainError, NotFoundError } from "./errors";
import { addTimeline } from "./timeline";

/**
 * Zoekt het lopende traject bij een naam zoals "Fam. Hoedemaker" of
 * "Familie Van Huissteden". Geeft alleen een resultaat als er precies één
 * duidelijke kandidaat is; anders moet de gebruiker kiezen.
 */
export async function findTrajectByFamilyName(db: DbOrTx, rawName: string | null, stageKeys?: string[]): Promise<{ trajectId: string; customerId: string } | null> {
  if (!rawName) return null;
  const person = splitDutchName(rawName);
  if (!person.lastName) return null;
  const keys =
    stageKeys ??
    (await db.select().from(pipelineStages).where(inArray(pipelineStages.kind, ["open", "won"]))).map((s) => s.key);
  const rows = await db
    .select({ trajectId: trajects.id, customerId: trajects.customerId, infix: contacts.infix, lastName: contacts.lastName, displayName: customers.displayName })
    .from(trajects)
    .innerJoin(customers, eq(customers.id, trajects.customerId))
    .leftJoin(contacts, and(eq(contacts.customerId, customers.id), isNull(contacts.deletedAt)))
    .where(and(isNull(trajects.deletedAt), isNull(customers.mergedIntoId), inArray(trajects.stage, keys)));
  const hits = new Map<string, { trajectId: string; customerId: string; sim: number }>();
  for (const r of rows) {
    const fromDisplay = splitDutchName(r.displayName);
    const sim = Math.max(
      r.lastName ? lastNameSimilarity({ infix: r.infix, lastName: r.lastName }, person) : 0,
      fromDisplay.lastName ? lastNameSimilarity(fromDisplay, person) : 0,
    );
    if (sim >= 0.92) {
      const prev = hits.get(r.trajectId);
      if (!prev || prev.sim < sim) hits.set(r.trajectId, { trajectId: r.trajectId, customerId: r.customerId, sim });
    }
  }
  const list = [...hits.values()].sort((a, b) => b.sim - a.sim);
  if (list.length === 1) return list[0];
  // Meerdere trajecten van dezelfde klant: neem het nieuwste lopende traject niet blind; laat kiezen.
  return null;
}

/** Legt een orderbevestiging vast (idempotent op leverancier + ordernummer) en koppelt hem als dat kan. */
export async function recordSupplierOrder(db: DbOrTx, order: SupplierOrder, opts: { gmailMessageId?: string | null; source?: string } = {}) {
  const amount = order.amountExcl;
  if (amount === null) throw new DomainError("Geen bedrag excl. btw gevonden in de orderbevestiging.");
  return db.transaction(async (tx) => {
    if (order.orderNumber) {
      const [existing] = await tx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.supplier, order.supplier), eq(purchaseOrders.orderNumber, order.orderNumber)));
      if (existing) return { purchase: existing, created: false };
    }
    const match = await findTrajectByFamilyName(tx, order.commission);
    const [p] = await tx
      .insert(purchaseOrders)
      .values({
        supplier: order.supplier,
        orderNumber: order.orderNumber,
        commission: order.commission,
        amountExcl: amount.toFixed(2),
        orderDate: order.orderDate,
        source: opts.source ?? "gmail",
        gmailMessageId: opts.gmailMessageId ?? null,
        trajectId: match?.trajectId ?? null,
        customerId: match?.customerId ?? null,
        status: match ? "gekoppeld" : "te_koppelen",
      })
      .returning();
    if (match) await afterLink(tx, p.id, match.trajectId, match.customerId, null);
    return { purchase: p, created: true };
  });
}

async function afterLink(tx: DbOrTx, purchaseId: string, trajectId: string, customerId: string, userId: string | null) {
  const [p] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseId));
  await addTimeline(tx, {
    customerId,
    trajectId,
    type: "inkoop",
    title: `Inkoop ${p.supplier}${p.orderNumber ? ` ${p.orderNumber}` : ""}: € ${Number(p.amountExcl).toLocaleString("nl-NL", { minimumFractionDigits: 2 })} excl. btw`,
    body: p.commission ? `Commissie: ${p.commission}` : null,
    actorUserId: userId,
  });
  await applyStageEvent(tx, trajectId, "materiaal_besteld", { refType: "purchase_order", refId: purchaseId, detail: `${p.supplier}${p.orderNumber ? ` ${p.orderNumber}` : ""}` });
}

export async function addManualPurchase(
  db: DbOrTx,
  input: { trajectId: string; supplier: string; orderNumber?: string | null; amountExcl: number; userId?: string | null },
) {
  if (!input.supplier.trim()) throw new DomainError("Vul een leverancier in.");
  if (!(input.amountExcl > 0)) throw new DomainError("Vul een bedrag excl. btw in.");
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(trajects).where(eq(trajects.id, input.trajectId));
    if (!t) throw new NotFoundError("Traject");
    const [p] = await tx
      .insert(purchaseOrders)
      .values({
        trajectId: t.id,
        customerId: t.customerId,
        supplier: input.supplier.trim(),
        orderNumber: input.orderNumber?.trim() || null,
        amountExcl: input.amountExcl.toFixed(2),
        source: "handmatig",
        status: "gekoppeld",
        createdBy: input.userId ?? null,
      })
      .returning();
    await afterLink(tx, p.id, t.id, t.customerId, input.userId ?? null);
    return p;
  });
}

export async function linkPurchase(db: DbOrTx, purchaseId: string, trajectId: string, userId?: string | null) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(trajects).where(eq(trajects.id, trajectId));
    if (!t) throw new NotFoundError("Traject");
    await tx.update(purchaseOrders).set({ trajectId, customerId: t.customerId, status: "gekoppeld" }).where(eq(purchaseOrders.id, purchaseId));
    await afterLink(tx, purchaseId, trajectId, t.customerId, userId ?? null);
  });
}

export async function deletePurchase(db: DbOrTx, purchaseId: string) {
  await db.update(purchaseOrders).set({ deletedAt: new Date() }).where(eq(purchaseOrders.id, purchaseId));
}

/** "Offerte OF2026-0076 is online geaccepteerd": zoek het traject via het offertenummer, anders via de naam. */
export async function handleQuoteAccepted(db: DbOrTx, q: QuoteAccepted, opts: { gmailMessageId?: string | null } = {}) {
  return db.transaction(async (tx) => {
    const [quote] = await tx.select().from(quotes).where(and(eq(quotes.number, q.quoteNumber), isNull(quotes.deletedAt)));
    let trajectId = quote?.trajectId ?? null;
    let customerId = quote?.customerId ?? null;
    if (!trajectId) {
      const m = await findTrajectByFamilyName(tx, q.customerName);
      trajectId = m?.trajectId ?? null;
      customerId = m?.customerId ?? null;
    }
    if (!trajectId || !customerId) return { matched: false as const };
    if (quote) {
      await tx.update(quotes).set({ status: "geaccepteerd", acceptedAt: q.acceptedAt ?? new Date(), updatedAt: new Date() }).where(eq(quotes.id, quote.id));
    } else {
      await tx
        .insert(quotes)
        .values({ trajectId, customerId, number: q.quoteNumber, status: "geaccepteerd", acceptedAt: q.acceptedAt ?? new Date() });
    }
    await addTimeline(tx, { customerId, trajectId, type: "offerte", title: `Offerte ${q.quoteNumber} geaccepteerd`, body: q.customerName ? `Door ${q.customerName}` : null });
    const result = await applyStageEvent(tx, trajectId, "offerte_geaccepteerd", { refType: "quote", refId: q.quoteNumber, detail: q.quoteNumber });
    return { matched: true as const, trajectId, result };
  });
}

/** Inkooporders die nog aan een traject gekoppeld moeten worden. */
export async function unlinkedPurchases(db: DbOrTx) {
  return db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.status, "te_koppelen"), isNull(purchaseOrders.deletedAt)))
    .orderBy(sql`${purchaseOrders.createdAt} desc`);
}
