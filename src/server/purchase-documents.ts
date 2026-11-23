import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { purchaseDocuments, purchaseOrders } from "@/db/schema";
import { DomainError, NotFoundError } from "./errors";
import { addTimeline } from "./timeline";

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const DOCUMENT_KINDS = { orderbevestiging: "Orderbevestiging", factuur: "Factuur", overig: "Document" } as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;

/** Bestandstypes die we bewaren en in de browser kunnen tonen. */
const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp|gif|heic|heif)|text\/html)$/;

export function guessMimeType(filename: string, given: string | null | undefined): string {
  const g = (given ?? "").toLowerCase().split(";")[0].trim();
  if (g && g !== "application/octet-stream") return g;
  const ext = filename.toLowerCase().split(".").pop();
  return (
    { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", html: "text/html", htm: "text/html" }[
      ext ?? ""
    ] ?? g
  );
}

/** Controle vooraf (type en grootte), zodat er geen halve bestelling ontstaat bij een verkeerd bestand. */
export function validateDocument(filename: string, mimeType: string | null | undefined, size: number) {
  const m = guessMimeType(filename, mimeType);
  if (!ALLOWED.test(m)) throw new DomainError("Alleen PDF's en foto's (jpg, png) kunnen worden toegevoegd.");
  if (!size) throw new DomainError("Het bestand is leeg.");
  if (size > MAX_DOCUMENT_BYTES) throw new DomainError("Het bestand is te groot (maximaal 15 MB).");
}

export async function addPurchaseDocument(
  db: DbOrTx,
  input: {
    purchaseOrderId: string;
    kind: DocumentKind;
    filename: string;
    mimeType: string;
    data: Buffer;
    source?: "gmail" | "upload";
    gmailMessageId?: string | null;
    userId?: string | null;
  },
) {
  validateDocument(input.filename, input.mimeType, input.data.length);
  const mimeType = guessMimeType(input.filename, input.mimeType);
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.purchaseOrderId));
  if (!po) throw new NotFoundError("Bestelling");
  const filename = input.filename.replace(/[\r\n"\\/]+/g, "_").slice(0, 200) || "document";
  const [doc] = await db
    .insert(purchaseDocuments)
    .values({
      purchaseOrderId: po.id,
      kind: input.kind,
      filename,
      mimeType,
      size: input.data.length,
      data: input.data,
      source: input.source ?? "upload",
      gmailMessageId: input.gmailMessageId ?? null,
      createdBy: input.userId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: purchaseDocuments.id });
  if (doc && po.trajectId && po.customerId && (input.source !== "gmail" || input.kind === "factuur")) {
    await addTimeline(db, {
      customerId: po.customerId,
      trajectId: po.trajectId,
      type: "inkoop",
      title: `${DOCUMENT_KINDS[input.kind]} toegevoegd bij ${po.supplier}${po.orderNumber ? ` ${po.orderNumber}` : ""}`,
      body: filename,
      actorUserId: input.userId ?? null,
    });
  }
  return doc ?? null;
}

/** Overzicht (zonder de bestanden zelf) per bestelling. */
export async function documentsForPurchases(db: DbOrTx, purchaseIds: string[]) {
  if (!purchaseIds.length) return [];
  return db
    .select({
      id: purchaseDocuments.id,
      purchaseOrderId: purchaseDocuments.purchaseOrderId,
      kind: purchaseDocuments.kind,
      filename: purchaseDocuments.filename,
      mimeType: purchaseDocuments.mimeType,
      size: purchaseDocuments.size,
      source: purchaseDocuments.source,
      createdAt: purchaseDocuments.createdAt,
    })
    .from(purchaseDocuments)
    .where(and(inArray(purchaseDocuments.purchaseOrderId, purchaseIds), isNull(purchaseDocuments.deletedAt)))
    .orderBy(purchaseDocuments.createdAt);
}

export async function getPurchaseDocument(db: DbOrTx, id: string) {
  const [d] = await db.select().from(purchaseDocuments).where(and(eq(purchaseDocuments.id, id), isNull(purchaseDocuments.deletedAt)));
  if (!d) throw new NotFoundError("Document");
  return d;
}

export async function deletePurchaseDocument(db: DbOrTx, id: string) {
  const [d] = await db.update(purchaseDocuments).set({ deletedAt: new Date() }).where(eq(purchaseDocuments.id, id)).returning({ po: purchaseDocuments.purchaseOrderId });
  if (!d) throw new NotFoundError("Document");
  const [po] = await db.select({ trajectId: purchaseOrders.trajectId }).from(purchaseOrders).where(eq(purchaseOrders.id, d.po));
  return { trajectId: po?.trajectId ?? null };
}

/**
 * Bij welke bestelling hoort een inkoopfactuur? We zoeken het ordernummer van
 * een bekende bestelling van deze leverancier in de tekst van de factuur.
 * Alleen bij precies één treffer; anders niet gokken.
 */
export async function findPurchaseForInvoice(db: DbOrTx, supplier: string, invoiceText: string) {
  const pos = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.supplier, supplier), isNotNull(purchaseOrders.orderNumber), isNull(purchaseOrders.deletedAt)))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(500);
  const hits = pos.filter((p) => {
    const nr = p.orderNumber!.trim();
    if (nr.length < 4) return false;
    const esc = nr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`).test(invoiceText);
  });
  return hits.length === 1 ? hits[0] : null;
}
