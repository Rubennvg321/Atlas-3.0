import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { customers, quotes, trajects } from "@/db/schema";
import { normalizeEmail, normalizePhone, normalizePostcode, parseAddressLine, splitDutchName, tidyCity } from "@/lib/normalize";
import type { LeadInput } from "@/lib/intake/types";
import { leadProfile, matchProfile } from "../customers";
import { intakeLead } from "../intake";
import { applyStageEvent } from "../automation";
import { createTraject, findOpenTraject } from "../trajects";
import { addTimeline } from "../timeline";
import { decrypt } from "../crypto";
import { DomainError, NotFoundError } from "../errors";
import { cfg, getIntegration, upsertIntegration } from "./state";
import { liveWefact, mapQuoteStatus, type WefactClient, type WefactDebtor, type WefactQuote } from "./wefact-client";

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

/** Zet het WeFact-debiteurnummer op de klant als die er nog geen heeft (en het nummer nog vrij is). */
async function rememberDebtorCode(db: DbOrTx, customerId: string, code: string | undefined) {
  if (!code) return;
  const [c] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!c || c.wefactDebtorCode) return;
  const [taken] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.wefactDebtorCode, code), ne(customers.id, customerId)));
  if (!taken) await db.update(customers).set({ wefactDebtorCode: code }).where(eq(customers.id, customerId));
}

export async function processQuote(db: DbOrTx, wf: WefactClient, q: WefactQuote, opts: { forceTrajectId?: string } = {}): Promise<boolean> {
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
  let isNew = !existing || !existing.trajectId;

  if (opts.forceTrajectId) {
    // Handmatig gekoppeld door de gebruiker: dat traject is leidend.
    const [t] = await db.select().from(trajects).where(eq(trajects.id, opts.forceTrajectId));
    if (!t || t.deletedAt) throw new NotFoundError("Traject");
    isNew = existing?.trajectId !== t.id;
    trajectId = t.id;
    customerId = t.customerId;
    await rememberDebtorCode(db, t.customerId, q.DebtorCode);
  } else if (!trajectId) {
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

/** WeFact-client met de opgeslagen sleutel, of null als WeFact niet gekoppeld is. */
export async function getWefactClient(db: DbOrTx): Promise<WefactClient | null> {
  const row = await getIntegration(db, "wefact");
  return row?.encryptedTokens ? liveWefact(decrypt(row.encryptedTokens)) : null;
}

/**
 * Koppelt een offerte handmatig aan een traject, op offertenummer. Haalt de
 * actuele gegevens (bedrag, status) uit WeFact; kent Atlas de offerte al, dan
 * wordt die verplaatst. Idempotent: nogmaals koppelen doet niets extra.
 */
export async function linkQuoteToTraject(db: DbOrTx, wf: WefactClient | null, trajectId: string, quoteNumber: string, userId?: string | null) {
  const number = quoteNumber.trim().replace(/\s+/g, "");
  if (!number) throw new DomainError("Vul een offertenummer in, bijvoorbeeld OF2026-0076.");
  const [local] = await db
    .select()
    .from(quotes)
    .where(and(sql`lower(${quotes.number}) = ${number.toLowerCase()}`, isNull(quotes.deletedAt)));
  const remote = wf ? await wf.quoteByCode(local?.number ?? number) : null;

  if (remote && wf) {
    await processQuote(db, wf, remote, { forceTrajectId: trajectId });
  } else if (local) {
    // WeFact niet bereikbaar/gekoppeld, maar Atlas kent de offerte al: alleen verplaatsen.
    const [t] = await db.select().from(trajects).where(eq(trajects.id, trajectId));
    if (!t || t.deletedAt) throw new NotFoundError("Traject");
    if (local.trajectId !== t.id) {
      await db.update(quotes).set({ trajectId: t.id, customerId: t.customerId, updatedAt: new Date() }).where(eq(quotes.id, local.id));
      await addTimeline(db, { customerId: t.customerId, trajectId: t.id, type: "offerte", title: `Offerte ${local.number} gekoppeld`, actorUserId: userId });
      await applyStageEvent(db, t.id, "offerte_gemaakt", { refType: "quote", refId: local.number, detail: local.number ?? undefined });
      if (local.status === "geaccepteerd") await applyStageEvent(db, t.id, "offerte_geaccepteerd", { refType: "quote", refId: local.number, detail: local.number ?? undefined });
    }
  } else if (!wf) {
    throw new DomainError("WeFact is niet gekoppeld en Atlas kent deze offerte nog niet. Koppel WeFact via Koppelingen.");
  } else {
    throw new DomainError(`Offerte ${number} is niet gevonden in WeFact. Controleer het nummer.`);
  }
  const [q] = await db.select().from(quotes).where(and(sql`lower(${quotes.number}) = ${(remote?.PriceQuoteCode ?? local?.number ?? number).toLowerCase()}`, isNull(quotes.deletedAt)));
  return q;
}

/** Offertes uit WeFact die (nog) aan geen traject gekoppeld zijn. */
export async function unlinkedQuotes(db: DbOrTx) {
  return db
    .select()
    .from(quotes)
    .where(and(isNull(quotes.trajectId), isNull(quotes.deletedAt)))
    .orderBy(sql`${quotes.quoteDate} desc nulls last`);
}
