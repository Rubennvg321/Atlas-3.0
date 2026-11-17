import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  appointments,
  contactPoints,
  contacts,
  customerMerges,
  customers,
  duplicateCandidates,
  emails,
  inboundItems,
  notes,
  quotes,
  tasks,
  timelineEvents,
  trajects,
} from "@/db/schema";
import { DomainError, NotFoundError } from "./errors";
import { orderedPair } from "./customers";
import { addTimeline, audit } from "./timeline";

/** Alle tabellen met een customer_id die bij samenvoegen mee moeten. */
const LINKED = {
  contacts,
  contact_points: contactPoints,
  trajects,
  tasks,
  notes,
  timeline_events: timelineEvents,
  appointments,
  quotes,
  emails,
  inbound_items: inboundItems,
} as const;
type LinkedName = keyof typeof LINKED;

/** Velden die bij de overblijvende klant worden aangevuld als ze leeg zijn. */
const FILLABLE = ["street", "houseNumber", "houseNumberAddition", "postcode", "city", "streetKey", "wefactDebtorCode", "notes"] as const;

/**
 * Voegt klant `mergedId` samen in `survivorId`. Niets wordt verwijderd: alle
 * koppelingen verhuizen, de samengevoegde klant krijgt `merged_into_id`. Wat er
 * verplaatst is wordt vastgelegd, zodat het ongedaan kan worden gemaakt.
 */
export async function mergeCustomers(db: DbOrTx, survivorId: string, mergedId: string, userId?: string | null) {
  if (survivorId === mergedId) throw new DomainError("Kan een klant niet met zichzelf samenvoegen.");
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(customers)
      .where(inArray(customers.id, [survivorId, mergedId]))
      .orderBy(customers.id)
      .for("update");
    const survivor = rows.find((r) => r.id === survivorId);
    const merged = rows.find((r) => r.id === mergedId);
    if (!survivor || !merged) throw new NotFoundError("Klant");
    if (survivor.mergedIntoId || merged.mergedIntoId) throw new DomainError("Een van beide klanten is al samengevoegd.");

    const moved: Partial<Record<LinkedName, string[]>> = {};
    for (const [name, table] of Object.entries(LINKED) as [LinkedName, (typeof LINKED)[LinkedName]][]) {
      const res = await tx
        .update(table)
        .set({ customerId: survivorId } as never)
        .where(eq(table.customerId, mergedId))
        .returning({ id: table.id });
      moved[name] = res.map((r) => r.id);
    }

    // Lege velden van de overblijvende klant aanvullen.
    const survivorBefore: Record<string, unknown> = {};
    const fill: Record<string, unknown> = {};
    for (const f of FILLABLE) {
      if ((survivor[f] === null || survivor[f] === "") && merged[f] !== null && merged[f] !== "") {
        survivorBefore[f] = survivor[f];
        fill[f] = merged[f];
      }
    }
    const mergedBefore = { wefactDebtorCode: merged.wefactDebtorCode };
    await tx
      .update(customers)
      .set({ mergedIntoId: survivorId, mergedAt: new Date(), wefactDebtorCode: null, updatedAt: new Date() })
      .where(eq(customers.id, mergedId));
    if (Object.keys(fill).length) {
      await tx.update(customers).set({ ...fill, updatedAt: new Date() }).where(eq(customers.id, survivorId));
    }

    const [a, b] = orderedPair(survivorId, mergedId);
    await tx
      .insert(duplicateCandidates)
      .values({ customerAId: a, customerBId: b, score: 0, signals: [], status: "merged", origin: "handmatig", decidedBy: userId ?? null, decidedAt: new Date() })
      .onConflictDoUpdate({
        target: [duplicateCandidates.customerAId, duplicateCandidates.customerBId],
        set: { status: "merged", decidedBy: userId ?? null, decidedAt: new Date(), updatedAt: new Date() },
      });

    const [m] = await tx
      .insert(customerMerges)
      .values({ survivorId, mergedId, moved, survivorBefore: { fields: survivorBefore, merged: mergedBefore }, createdBy: userId ?? null })
      .returning();

    await addTimeline(tx, {
      customerId: survivorId,
      type: "samengevoegd",
      title: `Samengevoegd met "${merged.displayName}"`,
      payload: { mergeId: m.id, mergedId },
      actorUserId: userId,
    });
    await audit(tx, userId, "merge", "customer", survivorId, { mergedId, mergeId: m.id });
    return m;
  });
}

export async function undoMerge(db: DbOrTx, mergeId: string, userId?: string | null) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(customerMerges).where(eq(customerMerges.id, mergeId)).for("update");
    if (!m) throw new NotFoundError("Samenvoeging");
    if (m.undoneAt) throw new DomainError("Deze samenvoeging is al ongedaan gemaakt.");

    const [merged] = await tx.select().from(customers).where(eq(customers.id, m.mergedId)).for("update");
    if (merged.mergedIntoId !== m.survivorId) throw new DomainError("Deze klant is ondertussen anders gekoppeld; ongedaan maken kan niet meer.");

    const moved = m.moved as Partial<Record<LinkedName, string[]>>;
    for (const [name, ids] of Object.entries(moved) as [LinkedName, string[]][]) {
      if (!ids?.length) continue;
      const table = LINKED[name];
      await tx
        .update(table)
        .set({ customerId: m.mergedId } as never)
        .where(and(inArray(table.id, ids), eq(table.customerId, m.survivorId)));
    }

    const before = m.survivorBefore as { fields: Record<string, unknown>; merged: { wefactDebtorCode: string | null } };
    if (Object.keys(before.fields).length) {
      await tx.update(customers).set({ ...before.fields, updatedAt: new Date() }).where(eq(customers.id, m.survivorId));
    }
    await tx
      .update(customers)
      .set({ mergedIntoId: null, mergedAt: null, wefactDebtorCode: before.merged.wefactDebtorCode, updatedAt: new Date() })
      .where(eq(customers.id, m.mergedId));

    const [a, b] = orderedPair(m.survivorId, m.mergedId);
    await tx
      .update(duplicateCandidates)
      .set({ status: "open", decidedBy: null, decidedAt: null, updatedAt: new Date() })
      .where(and(eq(duplicateCandidates.customerAId, a), eq(duplicateCandidates.customerBId, b)));

    await tx.update(customerMerges).set({ undoneAt: new Date(), undoneBy: userId ?? null }).where(eq(customerMerges.id, mergeId));
    await addTimeline(tx, {
      customerId: m.survivorId,
      type: "samenvoeging_ongedaan",
      title: `Samenvoeging met "${merged.displayName}" ongedaan gemaakt`,
      actorUserId: userId,
    });
    await audit(tx, userId, "undo_merge", "customer", m.survivorId, { mergeId });
  });
}

/** Onthoudt dat twee klanten verschillende personen zijn. */
export async function markNotSame(db: DbOrTx, customerX: string, customerY: string, userId?: string | null) {
  const [a, b] = orderedPair(customerX, customerY);
  await db
    .insert(duplicateCandidates)
    .values({ customerAId: a, customerBId: b, score: 0, signals: [], status: "not_same", origin: "handmatig", decidedBy: userId ?? null, decidedAt: new Date() })
    .onConflictDoUpdate({
      target: [duplicateCandidates.customerAId, duplicateCandidates.customerBId],
      set: { status: "not_same", decidedBy: userId ?? null, decidedAt: new Date(), updatedAt: new Date() },
    });
  await audit(db, userId, "not_same", "customer", a, { other: b });
}

export async function lastMergeFor(db: DbOrTx, survivorId: string) {
  const rows = await db
    .select()
    .from(customerMerges)
    .where(and(eq(customerMerges.survivorId, survivorId), sql`${customerMerges.undoneAt} is null`))
    .orderBy(sql`${customerMerges.createdAt} desc`);
  return rows;
}
