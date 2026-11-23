import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { appointments, purchaseOrders, quotes, trajects } from "@/db/schema";
import { calcFinance } from "@/lib/finance";
import { montageDays } from "@/lib/montage-days";
import { DomainError, NotFoundError } from "./errors";
import { documentsForPurchases } from "./purchase-documents";
import { addTimeline } from "./timeline";

/**
 * Financieel overzicht van een traject.
 *  - Verkoop excl. btw: WeFact-offerte is leidend (geaccepteerd gaat voor),
 *    anders de handmatig ingevulde prijs.
 *  - Inkoop excl. btw: som van de gekoppelde inkooporders.
 *  - Montagedagen: handmatig, anders afgeleid uit de montage-afspraken.
 */
export async function getTrajectFinance(db: DbOrTx, trajectId: string) {
  const [t] = await db.select().from(trajects).where(eq(trajects.id, trajectId));
  if (!t) throw new NotFoundError("Traject");
  const qs = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.trajectId, trajectId), isNull(quotes.deletedAt)))
    .orderBy(sql`(${quotes.status} = 'geaccepteerd') desc`, desc(quotes.quoteDate), desc(quotes.createdAt));
  const quoteWithAmount = qs.find((q) => q.amountExcl !== null);
  const saleExcl = quoteWithAmount ? Number(quoteWithAmount.amountExcl) : t.saleAmountExclManual !== null ? Number(t.saleAmountExclManual) : null;
  const saleSource = quoteWithAmount ? `WeFact ${quoteWithAmount.number ?? ""}`.trim() : t.saleAmountExclManual !== null ? "handmatig" : null;

  const pos = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.trajectId, trajectId), isNull(purchaseOrders.deletedAt)))
    // Oudste eerst: de eerste is de hoofdbestelling, daarna de extra bestellingen.
    .orderBy(sql`coalesce(${purchaseOrders.orderDate}, ${purchaseOrders.createdAt})`, purchaseOrders.createdAt);
  const docs = await documentsForPurchases(db, pos.map((p) => p.id));
  const purchaseExcl = pos.length ? pos.reduce((s, p) => s + Number(p.amountExcl), 0) : null;

  const apps = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.trajectId, trajectId), eq(appointments.kind, "montage"), eq(appointments.status, "gepland"), isNull(appointments.deletedAt)));
  const days = montageDays(apps.map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt, allDay: a.allDay })));
  const daysCount = t.montageDaysManual ?? (days.length || null);

  return {
    ...calcFinance({ saleExcl, purchaseExcl: purchaseExcl === null ? null : Math.round(purchaseExcl * 100) / 100, montageDays: daysCount }),
    saleSource,
    saleManual: t.saleAmountExclManual !== null ? Number(t.saleAmountExclManual) : null,
    hasWefactAmount: !!quoteWithAmount,
    purchases: pos.map((p) => ({ ...p, documents: docs.filter((d) => d.purchaseOrderId === p.id) })),
    montageDates: days,
    montageDaysManual: t.montageDaysManual,
  };
}

export async function setManualFinance(
  db: DbOrTx,
  trajectId: string,
  data: { saleAmountExcl?: number | null; montageDays?: number | null },
  userId?: string | null,
) {
  if (data.saleAmountExcl !== undefined && data.saleAmountExcl !== null && !(data.saleAmountExcl >= 0)) throw new DomainError("Ongeldige verkoopprijs.");
  if (data.montageDays !== undefined && data.montageDays !== null && !(data.montageDays >= 1 && data.montageDays <= 60)) throw new DomainError("Ongeldig aantal montagedagen.");
  const [t] = await db
    .update(trajects)
    .set({
      ...(data.saleAmountExcl !== undefined ? { saleAmountExclManual: data.saleAmountExcl === null ? null : data.saleAmountExcl.toFixed(2) } : {}),
      ...(data.montageDays !== undefined ? { montageDaysManual: data.montageDays } : {}),
      updatedAt: new Date(),
    })
    .where(eq(trajects.id, trajectId))
    .returning();
  if (!t) throw new NotFoundError("Traject");
  await addTimeline(db, { customerId: t.customerId, trajectId, type: "financieel", title: "Financiële gegevens bijgewerkt", actorUserId: userId });
}
