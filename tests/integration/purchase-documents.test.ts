import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { purchaseDocuments, purchaseOrders } from "@/db/schema";
import { syncSupplierMails } from "@/server/integrations/gmail-sync";
import { getTrajectFinance } from "@/server/finance";
import { intakeLead } from "@/server/intake";
import { changeStage } from "@/server/trajects";
import { addManualPurchase } from "@/server/purchases";
import { addPurchaseDocument, deletePurchaseDocument, getPurchaseDocument } from "@/server/purchase-documents";
import { anonymizeCustomer } from "@/server/customer-edit";
import { db, lead, resetDb, uid } from "./helpers";
import { fakeGmail } from "./fakes";

beforeEach(resetDb);
afterAll(closeDb);

const PPC_TEXT = readFileSync(path.join(__dirname, "../fixtures/ppc-orderbevestiging.txt"), "utf8");
const FEDI = readFileSync(path.join(__dirname, "../fixtures/fedi-orderbevestiging.txt"), "utf8");
const PDF = (label: string) => Buffer.from(`%PDF-1.4 ${label}`);
/** Nagebootste pdftotext: de "PDF" bevat het label; de orderbevestiging geeft de PPC-tekst. */
const pdfText = async (buf: Buffer) => {
  const s = buf.toString();
  return s.includes("orderbevestiging") ? PPC_TEXT : s;
};

async function klant(name: string) {
  const r = await intakeLead(db(), lead({ name, phone: `06${Math.floor(10000000 + Math.random() * 89999999)}` }), { provider: "handmatig", externalId: uid() });
  await changeStage(db(), { trajectId: r.trajectId!, toStage: "montage_gepland", source: "manual" });
  return r;
}

const ppcMail = { id: "p1", from: "PPC <verkoop@plintenenprofielencentrale.nl>", subject: "Orderbevestiging 26510197", body: "Zie bijlage", attachments: [{ filename: "OB26510197.pdf", mimeType: "application/pdf", data: PDF("orderbevestiging") }] };

describe("documenten bij bestellingen", () => {
  it("PPC: de PDF van de orderbevestiging wordt bij de bestelling bewaard (één keer)", async () => {
    const r = await klant("Kees Voorbeeld");
    const g = fakeGmail([ppcMail]);
    await syncSupplierMails(db(), g, { pdfText });
    await syncSupplierMails(db(), g, { pdfText });
    const f = await getTrajectFinance(db(), r.trajectId!);
    expect(f.purchases).toHaveLength(1);
    expect(f.purchases[0].documents).toMatchObject([{ kind: "orderbevestiging", filename: "OB26510197.pdf", source: "gmail" }]);
    const doc = await getPurchaseDocument(db(), f.purchases[0].documents[0].id);
    expect(doc.mimeType).toBe("application/pdf");
    expect(doc.data.toString()).toContain("%PDF");
  });

  it("fedi (geen PDF): de mail zelf wordt als document bewaard", async () => {
    const r = await klant("Kees Voorbeeld");
    const g = fakeGmail([{ id: "f1", from: "Fedi <verkoop@fedi.de>", subject: "Orderbevestiging", body: FEDI }]);
    await syncSupplierMails(db(), g, { pdfText });
    const [p] = (await getTrajectFinance(db(), r.trajectId!)).purchases;
    expect(p.documents).toHaveLength(1);
    const doc = await getPurchaseDocument(db(), p.documents[0].id);
    expect(doc.mimeType).toBe("text/html");
    expect(doc.data.toString()).toContain("Orderbevestiging");
  });

  it("bestaande bestellingen uit Gmail krijgen hun document achteraf", async () => {
    const r = await klant("Kees Voorbeeld");
    const [p] = await db()
      .insert(purchaseOrders)
      .values({ supplier: "PPC", orderNumber: "26510197", amountExcl: "100.00", source: "gmail", gmailMessageId: "p1", trajectId: r.trajectId, customerId: r.customerId })
      .returning();
    // De mail is eerder al verwerkt (zonder document): niet opnieuw als bestelling inlezen.
    const g = fakeGmail([{ ...ppcMail, subject: "Oud bericht" }]);
    await syncSupplierMails(db(), g, { pdfText });
    const docs = await db().select().from(purchaseDocuments).where(eq(purchaseDocuments.purchaseOrderId, p.id));
    expect(docs).toHaveLength(1);
    await syncSupplierMails(db(), g, { pdfText });
    expect(await db().select().from(purchaseDocuments)).toHaveLength(1);
  });

  it("inkoopfactuur per mail komt via het ordernummer bij de juiste bestelling", async () => {
    const r = await klant("Kees Voorbeeld");
    await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "PPC", orderNumber: "26510197", amountExcl: 949.15 });
    await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "PPC", orderNumber: "26510999", amountExcl: 50 });
    const g = fakeGmail([
      { id: "i1", from: "PPC <administratie@plintenenprofielencentrale.nl>", subject: "Factuur 2026-1234", body: "Bijgaand de factuur", attachments: [{ filename: "F2026-1234.pdf", mimeType: "application/pdf", data: PDF("Factuur 2026-1234 Uw ordernummer: 26510197 Totaal 949,15") }] },
      { id: "i2", from: "PPC <administratie@plintenenprofielencentrale.nl>", subject: "Factuur 2026-9999", body: "x", attachments: [{ filename: "F2026-9999.pdf", mimeType: "application/pdf", data: PDF("Factuur zonder bekend ordernummer 11112222") }] },
    ]);
    await syncSupplierMails(db(), g, { pdfText });
    const f = await getTrajectFinance(db(), r.trajectId!);
    const main = f.purchases.find((p) => p.orderNumber === "26510197")!;
    expect(main.documents).toMatchObject([{ kind: "factuur", filename: "F2026-1234.pdf" }]);
    expect(f.purchases.find((p) => p.orderNumber === "26510999")!.documents).toHaveLength(0);
    await syncSupplierMails(db(), g, { pdfText });
    expect(await db().select().from(purchaseDocuments)).toHaveLength(1);
  });

  it("handmatig: PDF of foto toevoegen en verwijderen; andere bestanden worden geweigerd", async () => {
    const r = await klant("Jan Jansen");
    const p = await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "Bouwmarkt Voorbeeld", amountExcl: 45 });
    const d = await addPurchaseDocument(db(), { purchaseOrderId: p.id, kind: "factuur", filename: "bon.jpg", mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff]) });
    await expect(addPurchaseDocument(db(), { purchaseOrderId: p.id, kind: "factuur", filename: "virus.exe", mimeType: "application/x-msdownload", data: Buffer.from("MZ") })).rejects.toThrow(/PDF/);
    expect((await getTrajectFinance(db(), r.trajectId!)).purchases[0].documents).toHaveLength(1);
    await deletePurchaseDocument(db(), d!.id);
    expect((await getTrajectFinance(db(), r.trajectId!)).purchases[0].documents).toHaveLength(0);
  });

  it("anonimiseren verwijdert de documenten, het bedrag blijft", async () => {
    const r = await klant("Jan Jansen");
    const p = await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "PPC", amountExcl: 45 });
    await addPurchaseDocument(db(), { purchaseOrderId: p.id, kind: "factuur", filename: "factuur.pdf", mimeType: "application/pdf", data: PDF("Fam. Jansen") });
    await anonymizeCustomer(db(), r.customerId);
    const [doc] = await db().select().from(purchaseDocuments);
    expect(doc.deletedAt).not.toBeNull();
    expect(doc.data.length).toBe(0);
    expect((await getTrajectFinance(db(), r.trajectId!)).purchaseExcl).toBe(45);
  });
});
