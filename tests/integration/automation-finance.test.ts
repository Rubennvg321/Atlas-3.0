import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { appointments, purchaseOrders, quotes, stageChanges, stageProposals, trajects } from "@/db/schema";
import { intakeLead } from "@/server/intake";
import { applyStageEvent, decideProposal } from "@/server/automation";
import { addManualPurchase, handleQuoteAccepted, linkPurchase, recordSupplierOrder } from "@/server/purchases";
import { getTrajectFinance, setManualFinance } from "@/server/finance";
import { changeStage } from "@/server/trajects";
import { setSetting } from "@/server/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import { parsePpcOrder } from "@/lib/parsers/ppc";
import { getQuotePdf } from "@/server/quote-pdf";
import { db, lead, resetDb, uid } from "./helpers";
import { fakeWefact } from "./fakes";

beforeEach(resetDb);
afterAll(closeDb);

const stageOf = async (id: string) => (await db().select().from(trajects).where(eq(trajects.id, id)))[0].stage;

async function klant(name: string, stage?: string) {
  const r = await intakeLead(db(), lead({ name, phone: `06${Math.floor(10000000 + Math.random() * 89999999)}` }), { provider: "handmatig", externalId: uid() });
  if (stage) await changeStage(db(), { trajectId: r.trajectId!, toStage: stage, source: "manual" });
  return r;
}

describe("automatische fasewijziging", () => {
  it("verschuift automatisch en logt het als 'automatisch'", async () => {
    const r = await klant("Jan Jansen");
    const res = await applyStageEvent(db(), r.trajectId!, "adviesgesprek_gepland", { refType: "appointment", refId: "evt1" });
    expect(res).toEqual({ action: "moved", to: "offerte_gepland" });
    const log = await db().select().from(stageChanges).where(eq(stageChanges.trajectId, r.trajectId!));
    expect(log.at(-1)).toMatchObject({ fromStage: "lead", toStage: "offerte_gepland", source: "automatic", refId: "evt1" });
  });

  it("nooit terug", async () => {
    const r = await klant("Jan Jansen", "montage_gepland");
    expect(await applyStageEvent(db(), r.trajectId!, "adviesgesprek_gepland")).toEqual({ action: "none" });
    expect(await stageOf(r.trajectId!)).toBe("montage_gepland");
  });

  it("als voorstel: niets verschuift tot je bevestigt; dubbel voorstel wordt niet dubbel", async () => {
    await setSetting(db(), "automation", { ...DEFAULT_SETTINGS.automation, offerte_geaccepteerd: "proposal" });
    const r = await klant("Jan Jansen", "offerte_gemaakt");
    expect(await applyStageEvent(db(), r.trajectId!, "offerte_geaccepteerd", { refId: "OF1" })).toEqual({ action: "proposed", to: "offerte_geaccepteerd" });
    await applyStageEvent(db(), r.trajectId!, "offerte_geaccepteerd", { refId: "OF1" });
    const props = await db().select().from(stageProposals);
    expect(props).toHaveLength(1);
    expect(await stageOf(r.trajectId!)).toBe("offerte_gemaakt");
    await decideProposal(db(), props[0].id, true);
    expect(await stageOf(r.trajectId!)).toBe("offerte_geaccepteerd");
  });
});

describe("inkoop uit orderbevestigingen", () => {
  const ppc = parsePpcOrder(readFileSync(path.join(__dirname, "../fixtures/ppc-orderbevestiging.txt"), "utf8"))!;

  it("PPC-orderbevestiging wordt via 'Commissie: Fam. Voorbeeld' aan het juiste traject gekoppeld", async () => {
    const r = await klant("Kees Voorbeeld", "montage_gepland");
    await klant("Piet Anders", "montage_gepland");
    const { purchase } = await recordSupplierOrder(db(), ppc, { gmailMessageId: "m1" });
    expect(purchase.status).toBe("gekoppeld");
    expect(purchase.trajectId).toBe(r.trajectId);
    expect(await stageOf(r.trajectId!)).toBe("materiaal_besteld");
  });

  it("dezelfde orderbevestiging twee keer verwerken geeft één inkooporder", async () => {
    await klant("Kees Voorbeeld", "montage_gepland");
    await recordSupplierOrder(db(), ppc);
    const again = await recordSupplierOrder(db(), ppc);
    expect(again.created).toBe(false);
    expect(await db().select().from(purchaseOrders)).toHaveLength(1);
  });

  it("twee klanten met dezelfde naam: 'te koppelen', daarna handmatig koppelen", async () => {
    const a = await klant("Anna Voorbeeld", "offerte_geaccepteerd");
    await klant("Bert Voorbeeld", "offerte_geaccepteerd");
    const { purchase } = await recordSupplierOrder(db(), ppc);
    expect(purchase.status).toBe("te_koppelen");
    await linkPurchase(db(), purchase.id, a.trajectId!);
    const [p] = await db().select().from(purchaseOrders);
    expect(p.status).toBe("gekoppeld");
    expect(await stageOf(a.trajectId!)).toBe("materiaal_besteld");
  });

  it("vervallen en afgeronde trajecten worden niet gekozen", async () => {
    const r = await klant("Kees Voorbeeld", "review_ontvangen");
    const { purchase } = await recordSupplierOrder(db(), ppc);
    expect(purchase.status).toBe("te_koppelen");
    expect(await stageOf(r.trajectId!)).toBe("review_ontvangen");
  });
});

describe("extra bestellingen", () => {
  const ppc = parsePpcOrder(readFileSync(path.join(__dirname, "../fixtures/ppc-orderbevestiging.txt"), "utf8"))!;

  it("een tweede orderbevestiging (ander ordernummer) komt automatisch bij hetzelfde traject", async () => {
    const r = await klant("Kees Voorbeeld", "montage_gepland");
    await recordSupplierOrder(db(), ppc);
    const extra = await recordSupplierOrder(db(), { ...ppc, orderNumber: `${ppc.orderNumber}-2`, amountExcl: 120 });
    expect(extra.purchase).toMatchObject({ status: "gekoppeld", trajectId: r.trajectId });
    const f = await getTrajectFinance(db(), r.trajectId!);
    expect(f.purchases.map((p) => p.orderNumber)).toEqual([ppc.orderNumber, `${ppc.orderNumber}-2`]);
  });

  it("nabestelling na afronding: alleen bij een traject dat al een hoofdbestelling had", async () => {
    const r = await klant("Kees Voorbeeld", "montage_gepland");
    await recordSupplierOrder(db(), ppc);
    await changeStage(db(), { trajectId: r.trajectId!, toStage: "review_gestuurd", source: "manual" });
    const extra = await recordSupplierOrder(db(), { supplier: "fedi", orderNumber: "F-77", orderDate: null, commission: "Fam. Voorbeeld", amountExcl: 80, amountIncl: null });
    expect(extra.purchase).toMatchObject({ status: "gekoppeld", trajectId: r.trajectId });
    expect(await stageOf(r.trajectId!)).toBe("review_gestuurd"); // nooit terug
  });

  it("handmatig bij een andere leverancier, met omschrijving; dubbel ordernummer wordt geweigerd", async () => {
    const r = await klant("Jan Jansen", "montage_gepland");
    await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "ppc", orderNumber: "10", amountExcl: 1000 });
    await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "Bouwmarkt Voorbeeld", amountExcl: 45.5, description: "lijm en schroeven" });
    await expect(addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "PPC", orderNumber: "10", amountExcl: 5 })).rejects.toThrow(/staat al in Atlas/);
    const f = await getTrajectFinance(db(), r.trajectId!);
    expect(f.purchases.map((p) => [p.supplier, p.description])).toEqual([
      ["PPC", null],
      ["Bouwmarkt Voorbeeld", "lijm en schroeven"],
    ]);
    expect(f.purchaseExcl).toBe(1045.5);
  });
});

describe("offerte-PDF", () => {
  it("haalt de PDF op bij WeFact via het WeFact-id van de offerte", async () => {
    const r = await klant("Jan Jansen", "offerte_gemaakt");
    const [q] = await db().insert(quotes).values({ trajectId: r.trajectId, customerId: r.customerId, wefactId: "55", number: "OF2026-0101", status: "verzonden" }).returning();
    const wf = fakeWefact([{ Identifier: "55", PriceQuoteCode: "OF2026-0101" }], []);
    const pdf = await getQuotePdf(db(), q.id, wf);
    expect(pdf.filename).toBe("OF2026-0101.pdf");
    expect(pdf.pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
  it("geeft een duidelijke melding als WeFact niet gekoppeld is", async () => {
    const r = await klant("Jan Jansen", "offerte_gemaakt");
    const [q] = await db().insert(quotes).values({ trajectId: r.trajectId, customerId: r.customerId, number: "OF2026-0102", status: "verzonden" }).returning();
    await expect(getQuotePdf(db(), q.id)).rejects.toThrow(/niet gekoppeld/);
  });
});

describe("offerte geaccepteerd (mail van WeFact)", () => {
  it("via offertenummer", async () => {
    const r = await klant("Jan Jansen", "offerte_gemaakt");
    await db().insert(quotes).values({ trajectId: r.trajectId, customerId: r.customerId, number: "OF2026-0076", amountExcl: "5000.00", status: "verzonden" });
    const res = await handleQuoteAccepted(db(), { quoteNumber: "OF2026-0076", customerName: "Iemand Anders", acceptedAt: new Date() });
    expect(res.matched).toBe(true);
    expect(await stageOf(r.trajectId!)).toBe("offerte_geaccepteerd");
    const [q] = await db().select().from(quotes);
    expect(q.status).toBe("geaccepteerd");
  });
  it("zonder bekende offerte via de naam ('Familie Van Huissteden' ~ 'van Huissteden')", async () => {
    const r = await klant("Mark van Huissteden", "offerte_gemaakt");
    const res = await handleQuoteAccepted(db(), { quoteNumber: "OF2026-0080", customerName: "Familie Van Huissteden", acceptedAt: new Date() });
    expect(res.matched).toBe(true);
    expect(await stageOf(r.trajectId!)).toBe("offerte_geaccepteerd");
  });
});

describe("marge en marge per dag", () => {
  it("verkoop uit WeFact, inkoop uit orders, dagen uit montage-afspraken", async () => {
    const r = await klant("Jan Jansen", "montage_gepland");
    await db().insert(quotes).values({ trajectId: r.trajectId, customerId: r.customerId, number: "OF1", amountExcl: "6347.10", status: "geaccepteerd" });
    await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "PPC", orderNumber: "1", amountExcl: 2000 });
    await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "fedi", orderNumber: "2", amountExcl: 344.54 });
    for (const d of ["2026-12-07", "2026-12-08"])
      await db().insert(appointments).values({ trajectId: r.trajectId, customerId: r.customerId, kind: "montage", title: "Fam. Jansen", startsAt: new Date(`${d}T07:00:00Z`), endsAt: new Date(`${d}T16:00:00Z`) });
    const f = await getTrajectFinance(db(), r.trajectId!);
    expect(f).toMatchObject({ saleExcl: 6347.1, purchaseExcl: 2344.54, margin: 4002.56, montageDays: 2, marginPerDay: 2001.28, saleSource: "WeFact OF1" });
  });
  it("handmatige verkoopprijs en dagen zolang WeFact/agenda er nog niet zijn", async () => {
    const r = await klant("Jan Jansen");
    await setManualFinance(db(), r.trajectId!, { saleAmountExcl: 3000, montageDays: 3 });
    await addManualPurchase(db(), { trajectId: r.trajectId!, supplier: "PPC", amountExcl: 900 });
    const f = await getTrajectFinance(db(), r.trajectId!);
    expect(f).toMatchObject({ saleExcl: 3000, purchaseExcl: 900, margin: 2100, montageDays: 3, marginPerDay: 700, saleSource: "handmatig" });
  });
  it("WeFact-bedrag gaat voor op handmatig", async () => {
    const r = await klant("Jan Jansen");
    await setManualFinance(db(), r.trajectId!, { saleAmountExcl: 3000 });
    await db().insert(quotes).values({ trajectId: r.trajectId, customerId: r.customerId, number: "OF9", amountExcl: "3500.00", status: "verzonden" });
    expect((await getTrajectFinance(db(), r.trajectId!)).saleExcl).toBe(3500);
  });
});
