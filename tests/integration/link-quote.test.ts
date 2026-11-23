import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db";
import { customers, quotes, trajects } from "@/db/schema";
import { intakeLead } from "@/server/intake";
import { changeStage, createTraject } from "@/server/trajects";
import { getTrajectFinance } from "@/server/finance";
import { linkQuoteToTraject, syncWefact, unlinkedQuotes } from "@/server/integrations/wefact-sync";
import { DomainError } from "@/server/errors";
import { db, lead, resetDb, uid } from "./helpers";
import { fakeWefact } from "./fakes";

beforeEach(resetDb);
afterAll(closeDb);

const today = () => new Date().toISOString().slice(0, 10);
const stageOf = async (id: string) => (await db().select().from(trajects).where(eq(trajects.id, id)))[0].stage;
const quote = (o: Partial<{ id: string; code: string; debtor: string; amount: string; status: string; name: string }> = {}) => ({
  Identifier: o.id ?? "201",
  PriceQuoteCode: o.code ?? "OF2026-0090",
  DebtorCode: o.debtor ?? "DB900",
  SurName: o.name ?? "Pater",
  AmountExcl: o.amount ?? "4250.00",
  AmountIncl: "5142.50",
  Date: today(),
  Status: o.status ?? "2",
  Modified: "2026-11-22 10:00:00",
});

async function klant(name: string, phone: string) {
  return intakeLead(db(), lead({ name, phone }), { provider: "handmatig", externalId: uid() });
}

describe("offerte uit WeFact handmatig koppelen", () => {
  it("op offertenummer: offerte wordt opgehaald, gekoppeld, verkoop excl. btw ingevuld en de kaart schuift door", async () => {
    const r = await klant("Jan Pater", "0611110001");
    const wf = fakeWefact([quote()], []);
    const q = await linkQuoteToTraject(db(), wf, r.trajectId!, " of2026-0090 ");
    expect(q.number).toBe("OF2026-0090");
    expect(q.trajectId).toBe(r.trajectId);
    expect((await getTrajectFinance(db(), r.trajectId!)).saleExcl).toBe(4250);
    expect(await stageOf(r.trajectId!)).toBe("offerte_gemaakt");
    const [c] = await db().select().from(customers).where(eq(customers.id, r.customerId));
    expect(c.wefactDebtorCode).toBe("DB900");
  });

  it("geaccepteerde offerte zet de kaart op 'Offerte geaccepteerd'", async () => {
    const r = await klant("Jan Pater", "0611110001");
    await linkQuoteToTraject(db(), fakeWefact([quote({ status: "3" })], []), r.trajectId!, "OF2026-0090");
    expect(await stageOf(r.trajectId!)).toBe("offerte_geaccepteerd");
  });

  it("twee keer koppelen geeft geen dubbele offerte", async () => {
    const r = await klant("Jan Pater", "0611110001");
    const wf = fakeWefact([quote()], []);
    await linkQuoteToTraject(db(), wf, r.trajectId!, "OF2026-0090");
    await linkQuoteToTraject(db(), wf, r.trajectId!, "OF2026-0090");
    expect(await db().select().from(quotes)).toHaveLength(1);
  });

  it("offerte die automatisch bij het verkeerde traject terechtkwam, wordt verplaatst", async () => {
    const goed = await klant("Jan Pater", "0611110001");
    const fout = await klant("Kees Anders", "0622220002");
    await db().update(customers).set({ wefactDebtorCode: "DB900" }).where(eq(customers.id, fout.customerId));
    const wf = fakeWefact([quote()], []);
    await syncWefact(db(), wf);
    expect((await db().select().from(quotes))[0].trajectId).toBe(fout.trajectId);
    await linkQuoteToTraject(db(), wf, goed.trajectId!, "OF2026-0090");
    const [q] = await db().select().from(quotes);
    expect(q.trajectId).toBe(goed.trajectId);
    expect(q.customerId).toBe(goed.customerId);
    // debiteurnummer hoort al bij een andere klant: niet dubbel toekennen
    const [c] = await db().select().from(customers).where(eq(customers.id, goed.customerId));
    expect(c.wefactDebtorCode).toBeNull();
  });

  it("klant met twee lopende trajecten: offerte staat onder 'te koppelen' tot je kiest", async () => {
    const r = await klant("Jan Pater", "0611110001");
    const tweede = await createTraject(db(), { customerId: r.customerId, source: "handmatig" });
    await changeStage(db(), { trajectId: tweede.id, toStage: "offerte_gepland", source: "manual" });
    await db().update(customers).set({ wefactDebtorCode: "DB900" }).where(eq(customers.id, r.customerId));
    const wf = fakeWefact([quote()], []);
    await syncWefact(db(), wf);
    const loose = await unlinkedQuotes(db());
    expect(loose.map((q) => q.number)).toEqual(["OF2026-0090"]);
    await linkQuoteToTraject(db(), wf, tweede.id, loose[0].number!);
    expect(await unlinkedQuotes(db())).toHaveLength(0);
    expect(await stageOf(tweede.id)).toBe("offerte_gemaakt");
  });

  it("onbekend nummer geeft een duidelijke melding", async () => {
    const r = await klant("Jan Pater", "0611110001");
    await expect(linkQuoteToTraject(db(), fakeWefact([], []), r.trajectId!, "OF1999-0001")).rejects.toThrow(/niet gevonden in WeFact/);
    await expect(linkQuoteToTraject(db(), fakeWefact([], []), r.trajectId!, "  ")).rejects.toThrow(DomainError);
  });

  it("zonder WeFact-koppeling kan een al bekende offerte toch worden verplaatst", async () => {
    const r = await klant("Jan Pater", "0611110001");
    await db().insert(quotes).values({ number: "OF2026-0090", amountExcl: "1000.00", status: "verzonden" });
    await linkQuoteToTraject(db(), null, r.trajectId!, "OF2026-0090");
    expect((await db().select().from(quotes))[0].trajectId).toBe(r.trajectId);
    await expect(linkQuoteToTraject(db(), null, r.trajectId!, "OF2026-0999")).rejects.toThrow(/niet gekoppeld/);
  });
});
