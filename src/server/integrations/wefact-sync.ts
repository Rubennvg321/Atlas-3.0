import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { customers, quotes } from "@/db/schema";
import { normalizeEmail, normalizePhone, normalizePostcode, parseAddressLine, splitDutchName, tidyCity } from "@/lib/normalize";
import type { LeadInput } from "@/lib/intake/types";
import { leadProfile, matchProfile } from "../customers";
import { intakeLead } from "../intake";
import { applyStageEvent } from "../automation";
import { createTraject, findOpenTraject } from "../trajects";
import { addTimeline } from "../timeline";
import { cfg, getIntegration, upsertIntegration } from "./state";
import { mapQuoteStatus, type WefactClient, type WefactDebtor, type WefactQuote } from "./wefact-client";

function debtorToLead(d: WefactDebtor): LeadInput {
  const name = [d.Initials, d.SurName].filter(Boolean).join(" ") || d.CompanyName || null;
  const addr = parseAddressLine(d.Address);
  return {
    name,
    // "van Huissteden" als achternaam: via "fam." wordt het tussenvoegsel herkend
    person: d.SurName ? { ...splitDutchName(`fam. ${d.SurName}`), firstName: d.Initials || null } : splitDutchName(name),
    emails: [normalizeEmail(d.EmailAddress)].filter((x): x is string => !!x),
    phones: [normalizePhone(d.PhoneNumber), normalizePhone(d.MobileNumber)].filter((x): x is string => !!x),
    street: addr.street,
    houseNumber: addr.houseNumber,
    addition: addr.addition,
    postcode: normalizePostcode(d.ZipCode),
    city: tidyCity(d.City),
  };
}

/** Klant bij een WeFact-debiteur: eerst op debiteurnummer, daarna via de herkenningslogica. */
async function customerForDebtor(db: DbOrTx, wf: WefactClient, code: string | undefined, q: WefactQuote): Promise<string | null> {
  if (code) {
    const [c] = await db.select().from(customers).where(and(eq(customers.wefactDebtorCode, code), isNull(customers.mergedIntoId)));
    if (c) return c.id;
  }
  const d = code ? await wf.debtor(code) : null;
  const lead = d ? debtorToLead(d) : debtorToLead({ DebtorCode: code ?? "", Initials: q.Initials, SurName: q.SurName, CompanyName: q.CompanyName });
  const m = await matchProfile(db, leadProfile(lead));
  let customerId: string;
  if (m.decision === "auto" && m.best) customerId = m.best.customerId;
  else {
    const r = await intakeLead(db, lead, { provider: "wefact", externalId: `debtor:${code ?? q.Identifier}`, traject: "none" });
    customerId = r.customerId;
  }
  if (code) {
    const [c] = await db.select().from(customers).where(eq(customers.id, customerId));
    if (!c.wefactDebtorCode) await db.update(customers).set({ wefactDebtorCode: code }).where(eq(customers.id, customerId));
  }
  return customerId;
}

export async function processQuote(db: DbOrTx, wf: WefactClient, q: WefactQuote): Promise<boolean> {
  const status = mapQuoteStatus(q.Status);
  const amountExcl = q.AmountExcl ? Number(q.AmountExcl).toFixed(2) : null;
  const amountIncl = q.AmountIncl ? Number(q.AmountIncl).toFixed(2) : null;
  const quoteDate = q.Date ? new Date(`${q.Date}T12:00:00Z`) : null;

  // Bestaat hij al (op WeFact-id, of als stub vanuit de "geaccepteerd"-mail op nummer)?
  let [existing] = await db.select().from(quotes).where(eq(quotes.wefactId, q.Identifier));
  if (!existing) [existing] = await db.select().from(quotes).where(and(eq(quotes.number, q.PriceQuoteCode), isNull(quotes.wefactId)));

  let trajectId = existing?.trajectId ?? null;
  let customerId = existing?.customerId ?? null;
  const wasAccepted = existing?.status === "geaccepteerd";
  const isNew = !existing;

  if (!trajectId) {
    customerId = await customerForDebtor(db, wf, q.DebtorCode, q);
    if (customerId) {
      const open = await findOpenTraject(db, customerId);
      if (open.length === 1) trajectId = open[0].id;
      else if (open.length === 0) trajectId = (await createTraject(db, { customerId, stage: "lead", source: "wefact" }, { source: "automatic" })).id;
      // Twee of meer lopende trajecten: niet gokken, de offerte verschijnt onder Taken om te koppelen.
    }
  }

  const values = { wefactId: q.Identifier, number: q.PriceQuoteCode, amountExcl, amountIncl, status, quoteDate, trajectId, customerId, raw: { Status: q.Status, Modified: q.Modified }, updatedAt: new Date() };
  if (existing) {
    // Status "geaccepteerd" uit de mail niet terugdraaien naar "verzonden" als WeFact achterloopt.
    await db.update(quotes).set({ ...values, status: wasAccepted && status !== "geaccepteerd" && status !== "vervallen" && status !== "afgewezen" ? "geaccepteerd" : status }).where(eq(quotes.id, existing.id));
  } else {
    await db.insert(quotes).values(values).onConflictDoNothing();
  }

  if (trajectId && customerId) {
    if (isNew) {
      await addTimeline(db, { customerId, trajectId, type: "offerte", title: `Offerte ${q.PriceQuoteCode} in WeFact: € ${Number(amountExcl ?? 0).toLocaleString("nl-NL", { minimumFractionDigits: 2 })} excl. btw` });
      await applyStageEvent(db, trajectId, "offerte_gemaakt", { refType: "quote", refId: q.PriceQuoteCode, detail: q.PriceQuoteCode });
    }
    if (status === "geaccepteerd") await applyStageEvent(db, trajectId, "offerte_geaccepteerd", { refType: "quote", refId: q.PriceQuoteCode, detail: q.PriceQuoteCode });
  }
  return true;
}

/** Haalt gewijzigde offertes op (nieuwste eerst) tot aan de vorige keer. */
export async function syncWefact(db: DbOrTx, wf: WefactClient): Promise<number> {
  const row = await getIntegration(db, "wefact");
  const c = cfg(row);
  const cursor = typeof c.modifiedCursor === "string" ? c.modifiedCursor : null;
  const firstRunFrom = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  let newest = cursor ?? "";
  let n = 0;
  for (let offset = 0; offset < 2000; offset += 100) {
    const { quotes: page } = await wf.listQuotes(offset, 100);
    if (!page.length) break;
    let reachedCursor = false;
    for (const q of page) {
      const mod = q.Modified ?? q.Date ?? "";
      if (cursor && mod && mod < cursor) {
        reachedCursor = true;
        break;
      }
      if (!cursor && (q.Date ?? "") < firstRunFrom) continue;
      await processQuote(db, wf, q);
      if (mod > newest) newest = mod;
      n++;
    }
    if (reachedCursor || page.length < 100) break;
  }
  if (newest) await upsertIntegration(db, "wefact", { config: { ...cfg(await getIntegration(db, "wefact")), modifiedCursor: newest } });
  return n;
}
